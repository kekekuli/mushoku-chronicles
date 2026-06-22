// @ts-check
import dotenv from 'dotenv'
import * as clack from '@clack/prompts'
import pLimit from 'p-limit'

import fs from 'fs'
import path from 'path'

dotenv.config({
  path: ".dev.vars"
})

/** @typedef {ReturnType<typeof clack.taskLog>} TaskLog */

if (!process.env.STRAPI_URL || !process.env.STRAPI_TOKEN) {
  console.error("Missing STRAPI_URL or STRAPI_TOKEN")
  process.exit(1)
}

async function main() {
  clack.intro('Mushoku-chronicles Images seeding script')
  const source = await clack.select({
    message: 'Select which image source you want to use',
    options: [
      { value: 'anilist', label: 'AniList API (Mushoku Tensei characters)' },
      { value: 'jikan', label: 'Jikan API (Mushoku Tensei characters)' },
      { value: 'local', label: 'Local folder' },
    ],
  })

  if (clack.isCancel(source)) {
    clack.cancel('Cancelled');
    return
  }

  if (source === 'anilist') {
    await seedFromAniList()
  } else if (source === 'jikan') {
    await seedFromJikan()
  } else if (source === 'local') {
    await seedFromLocal()
  }
}

async function seedFromAniList() {
  const searchTerm = await clack.text({
    message: 'Enter a search term',
    defaultValue: 'Mushoku Tensei',
    placeholder: 'Mushoku Tensei',
  })

  const spinner = clack.spinner();
  spinner.start('Fetching anime data from AniList...');

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        characters(sort: ROLE, perPage: 50) {
          nodes {
            name { full }
            image { large }
          }
        }
      }
    }
  `;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { search: String(searchTerm) } }),
  });

  const data = /** @type {any} */ (await response.json());
  if (!response.ok || data.errors) {
    spinner.stop(`Failed to fetch anime data — ${data.errors?.[0]?.message ?? response.statusText}`);
    return;
  }

  const characters = data.data?.Media?.characters?.nodes ?? [];
  if (characters.length === 0) {
    spinner.stop('No characters found.');
    return;
  }

  const imageUrls = /** @type {string[]} */ (characters.map((/** @type {any} */ c) => c.image.large).filter(Boolean));
  spinner.stop(`Found ${imageUrls.length} characters`);

  await uploadAll(imageUrls);
}

async function seedFromJikan() {
  const searchTerm = await clack.text({
    message: 'Enter a search term',
    defaultValue: 'Mushoku Tensei',
    placeholder: 'Mushoku Tensei',
  })

  const spinner = clack.spinner();
  spinner.start('Fetching anime data...');

  const animeResponse = await fetch(`https://api.jikan.moe/v4/anime?q=${String(searchTerm)}&limit=1`);
  const animeData = /** @type {any} */ (await animeResponse.json())
  if (!animeResponse.ok) {
    spinner.stop(`Failed to fetch anime data — ${animeData.message ?? animeResponse.statusText}`);
    return;
  }
  const animeid = animeData.data[0].mal_id;

  const charactersResponse = await fetch(`https://api.jikan.moe/v4/anime/${animeid}/characters`);
  const charactersData = /** @type {any} */ (await charactersResponse.json())
  if (!charactersResponse.ok) {
    spinner.stop(`Failed to fetch characters — ${charactersData.message ?? charactersResponse.statusText}`);
    return;
  }

  const imageUrls = /** @type {any[]} */ (charactersData.data).map(entry => entry.character.images.jpg.image_url);

  spinner.stop('Fetched anime data done');

  await uploadAll(imageUrls);
}

/**
 * @param {Array<{ status: 'uploaded' | 'skipped' | 'failed', reason?: string }>} results
 */
function summarize(results) {
  return results.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { uploaded: 0, skipped: 0, failed: 0 }
  );
}

/**
 * @param {string[]} urls
 * @param {number} [concurrency=3]
 */
async function uploadAll(urls, concurrency = 3) {
  const taskLog = clack.taskLog({
    title: `Uploading ${urls.length} images...`,
  });

  const limit = pLimit(concurrency);
  const results = await Promise.all(urls.map((url) => limit(() => uploadImage(url, taskLog))));

  // Note: we deliberately don't call taskLog.success()/error() — those clear
  // the per-image lines (or re-print stale text via showLog). Leaving the log
  // un-completed keeps every line's final in-place status on screen; outro
  // closes the flow.
  const summary = summarize(results);
  clack.outro(`Uploaded ${summary.uploaded}  Skipped ${summary.skipped}  Failed ${summary.failed}`);
}

/**
 * @param {string} url
 * @param {TaskLog} log
 * @returns {Promise<{ status: 'uploaded' | 'skipped' | 'failed', reason?: string }>}
 */
async function uploadImage(url, log) {
  const filename = path.basename(url);
  // Each image gets its own line that updates in place: "name — uploading…"
  // becomes "✓ name — uploaded" on the same line when it finishes. A group
  // entry is a persistent line; .success()/.error() replace it (unlike
  // log.message(), which appends a new line each time).
  const entry = log.group('');
  entry.message(`${filename} — uploading…`);
  /** @param {{ status: 'uploaded' | 'skipped' | 'failed', reason?: string }} result */
  const report = (result) => {
    const icon = result.status === 'uploaded' ? '✓' : result.status === 'skipped' ? '–' : '✗';
    const verb = result.status === 'uploaded' ? 'uploaded' : result.status === 'skipped' ? 'skipped' : 'failed';
    const line = `${icon} ${filename} — ${verb}${result.reason ? ` (${result.reason})` : ''}`;
    if (result.status === 'failed') entry.error(line);
    else entry.success(line);
    return result;
  };
  try {
    const strapiResponse = await fetch(`${process.env.STRAPI_URL}/api/upload/files?filters[name][$eq]=${filename}`, {
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}` }
    });
    if (!strapiResponse.ok) {
      return report({ status: 'failed', reason: `Duplicate check failed: ${strapiResponse.statusText}` });
    }
    const checkData = /** @type {any} */ (await strapiResponse.json());
    if (checkData.length > 0) {
      return report({ status: 'skipped', reason: 'already exists' });
    }

    const buffer = url.startsWith('http')
      ? Buffer.from(await (await fetch(url)).arrayBuffer())
      : fs.readFileSync(url);

    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('files', blob, filename);
    const uploadResponse = await fetch(`${process.env.STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}` },
      body: formData
    });
    if (!uploadResponse.ok) {
      const errBody = await uploadResponse.text();
      return report({ status: 'failed', reason: `Upload failed: ${uploadResponse.statusText} — ${errBody}` });
    }

    const uploadData = /** @type {any} */ (await uploadResponse.json());
    if (!uploadData?.[0]?.id) {
      return report({ status: 'failed', reason: 'No media ID returned' });
    }

    const galleryResponse = await fetch(`${process.env.STRAPI_URL}/api/galleries`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { image: uploadData[0].id } })
    });
    if (!galleryResponse.ok) {
      return report({ status: 'failed', reason: `Gallery entry failed: ${galleryResponse.statusText}` });
    }

    return report({ status: 'uploaded' });

  } catch (e) {
    return report({ status: 'failed', reason: `${e}` });
  }
}

async function seedFromLocal() {
  const folderPath = await clack.text({
    message: 'Enter the absolute path to your image folder',
    placeholder: '/Users/you/Pictures/mushoku',
    validate: (value) => {
      if (!value) return 'Path is required';
      if (!fs.existsSync(value)) return 'Folder does not exist';
    }
  });

  if (clack.isCancel(folderPath)) {
    clack.cancel('Cancelled');
    return;
  }

  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const files = fs.readdirSync(String(folderPath)).filter(f => allowed.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    clack.outro('No image files found in that folder.');
    return;
  }

  const filePaths = files.map(f => path.join(String(folderPath), f));
  await uploadAll(filePaths, 1);
}

main();

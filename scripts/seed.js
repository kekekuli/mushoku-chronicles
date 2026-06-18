// @ts-check
import dotenv from 'dotenv'
import * as clack from '@clack/prompts'
import pLimit from 'p-limit'

import fs from 'fs'
import path from 'path'

dotenv.config({
  path: ".dev.vars"
})

if (!process.env.STRAPI_URL || !process.env.STRAPI_TOKEN) {
  console.error("Missing STRAPI_URL or STRAPI_TOKEN")
  process.exit(1)
}

async function main() {
  clack.intro('Mushoku-chronicles Images seeding script')
  const source = await clack.select({
    message: 'Select which image source you want to use',
    options: [
      { value: 'jikan', label: 'Jikan API (Mushoku Tensei characters)' },
      { value: 'local', label: 'Local folder' },
    ],
  })

  if (clack.isCancel(source)) {
    clack.cancel('Cancelled');
    return
  }

  if (source === 'jikan') {
    await seedFromJikan()
  } else if (source === 'local') {
    await seedFromLocal()
  }
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

  spinner.start('Fetching images...');

  const limit = pLimit(3);

  const results = await Promise.all(imageUrls.map((url) => limit(() => uploadImage(url, spinner))));
  spinner.stop('Done');

  const summary = results.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { uploaded: 0, skipped: 0, failed: 0 }
  );

  const errors = results.filter(r => r.status === 'failed' && r.reason);
  errors.forEach(r => clack.log.error(r.reason ?? ''));

  clack.outro(`Uploaded ${summary.uploaded}  Skipped ${summary.skipped}  Failed ${summary.failed}`);
}
/**
 * @param {string} url
 * @param {ReturnType<typeof clack.spinner>} spinner
 */
/**
 * @param {string} url
 * @param {ReturnType<typeof clack.spinner>} spinner
 * @returns {Promise<{ status: 'uploaded' | 'skipped' | 'failed', reason?: string }>}
 */
async function uploadImage(url, spinner) {
  const filename = path.basename(url);
  try {
    const strapiResponse = await fetch(`${process.env.STRAPI_URL}/api/upload/files?filters[name][$eq]=${filename}`, {
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}` }
    });
    if (!strapiResponse.ok) {
      return { status: 'failed', reason: `Duplicate check failed for ${filename}: ${strapiResponse.statusText}` };
    }
    const checkData = /** @type {any} */ (await strapiResponse.json());
    if (checkData.length > 0) {
      spinner.message(`Skipping ${filename} — already exists`);
      return { status: 'skipped' };
    }

    const buffer = url.startsWith('http')
      ? Buffer.from(await (await fetch(url)).arrayBuffer())
      : fs.readFileSync(url);

    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('files', blob, filename);
    spinner.message(`Uploading ${filename}...`);
    const uploadResponse = await fetch(`${process.env.STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}` },
      body: formData
    });
    if (!uploadResponse.ok) {
      const errBody = await uploadResponse.text();
      return { status: 'failed', reason: `Upload failed for ${filename}: ${uploadResponse.statusText} — ${errBody}` };
    }

    const uploadData = /** @type {any} */ (await uploadResponse.json());
    if (!uploadData?.[0]?.id) {
      return { status: 'failed', reason: `No media ID returned for ${filename}` };
    }

    const galleryResponse = await fetch(`${process.env.STRAPI_URL}/api/galleries`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { image: uploadData[0].id } })
    });
    if (!galleryResponse.ok) {
      return { status: 'failed', reason: `Gallery entry failed for ${filename}: ${galleryResponse.statusText}` };
    }

    spinner.message(`Uploaded ${filename}`);
    return { status: 'uploaded' };

  } catch (e) {
    return { status: 'failed', reason: `${filename}: ${e}` };
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

  const spinner = clack.spinner();
  spinner.start(`Found ${files.length} images, uploading...`);

  const limit = pLimit(1);
  const results = await Promise.all(
    files.map(f => limit(() => uploadImage(path.join(String(folderPath), f), spinner)))
  );
  spinner.stop('Done');

  const summary = results.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { uploaded: 0, skipped: 0, failed: 0 }
  );

  const errors = results.filter(r => r.status === 'failed' && r.reason);
  errors.forEach(r => clack.log.error(r.reason ?? ''));

  clack.outro(`Uploaded ${summary.uploaded}  Skipped ${summary.skipped}  Failed ${summary.failed}`);
}

main();

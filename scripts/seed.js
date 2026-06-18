// @ts-check
import dotenv from 'dotenv'
import * as clack from '@clack/prompts'
import FormData from 'form-data'
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
  spinner.stop('Fetched images done');

  const summary = results.reduce(
    (acc, r) => { acc[r]++; return acc; },
    { uploaded: 0, skipped: 0, failed: 0 }
  );

  clack.outro(`Uploaded ${summary.uploaded} images.\nSkipped ${summary.skipped} images.\nFailed to upload ${summary.failed} images.`);
}
/**
 * @param {string} url
 * @param {ReturnType<typeof clack.spinner>} spinner
 */
async function uploadImage(url, spinner) {
  try {
    // dulipicate check
    const filename = path.basename(url);
    const strapiUrl = `${process.env.STRAPI_URL}/api/upload/files?filters[name][$eq]=${filename}`;
    const strapiResponse = await fetch(strapiUrl, {
      headers: {
        Authorization: `Bearer ${process.env.STRAPI_TOKEN}`
      }
    });
    const checkData = /** @type {any} */ (await strapiResponse.json());
    if (checkData.length > 0) {
      spinner.message(`Skipping ${filename} — already exists`);
      return 'skipped'
    }

    const imgResponse = await fetch(url);
    const buffer = Buffer.from(await imgResponse.arrayBuffer());

    const formData = new FormData();
    formData.append('files', buffer, { filename, contentType: 'image/jpeg' });
    const uploadResponse = await fetch(`${process.env.STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    if (uploadResponse.ok) {
      spinner.message(`Uploaded ${filename}`);
    } else {
      spinner.message(`Failed to upload ${filename}`);
    }

    const uploadData = /** @type {any} */ (await uploadResponse.json());
    const mediaId = uploadData[0].id;
    await fetch(`${process.env.STRAPI_URL}/api/galleries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: { image: mediaId }
      })
    })

    return 'uploaded'

  } catch (e) {
    spinner.message(`Error: ${e}`);
    return 'failed'
  }
}

function seedFromLocal() {
  return Promise.resolve()
}

main();

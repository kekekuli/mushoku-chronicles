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
/** @typedef {{ id: number, name: string, imageUrl: string, tag?: string }} Character */
/** @typedef {'anilist' | 'jikan' | 'safebooru'} Source */

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
      { value: 'safebooru', label: 'Safebooru (fan art & screenshots by character)' },
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
  } else if (source === 'safebooru') {
    await seedFromSafebooru()
  } else if (source === 'local') {
    await seedFromLocal()
  }
}

/**
 * Prompt for a search term, returning null if the prompt was cancelled.
 * @returns {Promise<string | null>}
 */
async function promptSearchTerm() {
  const searchTerm = await clack.text({
    message: 'Enter a search term',
    defaultValue: 'Mushoku Tensei',
    placeholder: 'Mushoku Tensei',
  })
  if (clack.isCancel(searchTerm)) {
    clack.cancel('Cancelled');
    return null;
  }
  return String(searchTerm);
}

async function seedFromAniList() {
  const searchTerm = await promptSearchTerm();
  if (searchTerm === null) return;

  const characters = await fetchAniListCharacters(searchTerm);
  if (characters === null) return;

  await chooseAndUpload(characters, searchTerm, 'anilist');
}

/**
 * @param {string} searchTerm
 * @returns {Promise<Character[] | null>} characters, or null if the fetch failed
 */
async function fetchAniListCharacters(searchTerm) {
  const spinner = clack.spinner();
  spinner.start('Fetching anime data from AniList...');

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        characters(sort: ROLE, perPage: 50) {
          nodes {
            id
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
    body: JSON.stringify({ query, variables: { search: searchTerm } }),
  });

  const data = /** @type {any} */ (await response.json());
  if (!response.ok || data.errors) {
    spinner.stop(`Failed to fetch anime data — ${data.errors?.[0]?.message ?? response.statusText}`);
    return null;
  }

  const nodes = /** @type {any[]} */ (data.data?.Media?.characters?.nodes ?? []);
  const characters = nodes
    .map((c) => ({ id: c.id, name: c.name?.full ?? 'Unknown', imageUrl: c.image?.large }))
    .filter((c) => c.imageUrl);

  spinner.stop(`Found ${characters.length} characters`);
  return characters;
}

// Safebooru = Danbooru's all-ages mirror. Character images are tagged by
// character. Naive name→tag transforms are unreliable (cross-series name
// collisions, editorial qualifiers), so we constrain matching to the series'
// own character tags: resolve the series copyright tag, pull its character
// tags, then match each character name within that set.
const SAFEBOORU_BASE = 'https://safebooru.donmai.us';
const SAFEBOORU_HEADERS = { 'User-Agent': 'mushoku-chronicles-seed/1.0' };
const SAFEBOORU_MAX_IMAGES = 40; // cap per character (posts.json max is 200)
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
// A real series character's posts mostly sit within the series, so its overlap
// with the copyright tag is near 1; cross-series noise sits near 0.
const SERIES_TAG_MIN_OVERLAP = 0.5;

/**
 * Split a name or tag into lowercase word tokens, dropping any
 * `_(qualifier)` suffix Danbooru adds (e.g. `sylphiette_(mushoku_tensei)`).
 * @param {string} value
 * @returns {string[]}
 */
function tokenize(value) {
  return value.toLowerCase().replace(/_\(.*?\)/g, '').split(/[\s_]+/).filter(Boolean);
}

/**
 * Resolve a series name (e.g. "Mushoku Tensei") to the list of its character
 * tags on Safebooru, via the copyright tag's related character tags. Returns
 * an empty list if the series can't be resolved.
 * @param {string} seriesName
 * @returns {Promise<string[]>}
 */
async function fetchSeriesCharacterTags(seriesName) {
  const glob = tokenize(seriesName).join('*') + '*';
  const tagUrl = `${SAFEBOORU_BASE}/tags.json?search[name_matches]=${encodeURIComponent(glob)}&search[category]=3&search[order]=count&limit=1`;
  const tagResponse = await fetch(tagUrl, { headers: SAFEBOORU_HEADERS });
  if (!tagResponse.ok) return [];
  const copyrightTag = /** @type {any[]} */ (await tagResponse.json())[0]?.name;
  if (!copyrightTag) return [];

  const relUrl = `${SAFEBOORU_BASE}/related_tag.json?query=${encodeURIComponent(copyrightTag)}&category=4`;
  const relResponse = await fetch(relUrl, { headers: SAFEBOORU_HEADERS });
  if (!relResponse.ok) return [];
  const data = /** @type {any} */ (await relResponse.json());
  return /** @type {string[]} */ (
    (data.related_tags ?? [])
      .filter((/** @type {any} */ r) => (r.overlap_coefficient ?? 0) >= SERIES_TAG_MIN_OVERLAP)
      .map((/** @type {any} */ r) => r.tag?.name)
      .filter(Boolean)
  );
}

async function seedFromSafebooru() {
  const searchTerm = await promptSearchTerm();
  if (searchTerm === null) return;

  const characters = await fetchSafebooruCharacters(searchTerm);
  if (characters === null) return;

  await chooseAndUpload(characters, searchTerm, 'safebooru');
}

/**
 * Build the character list straight from Safebooru's series character tags.
 * @param {string} seriesName
 * @returns {Promise<Character[] | null>} characters, or null if unresolved
 */
async function fetchSafebooruCharacters(seriesName) {
  const spinner = clack.spinner();
  spinner.start('Fetching characters from Safebooru...');

  const tags = await fetchSeriesCharacterTags(seriesName);
  if (tags.length === 0) {
    spinner.stop(`Could not resolve "${seriesName}" on Safebooru.`);
    return null;
  }

  const characters = tags.map((tag, i) => ({ id: i, name: prettifyTag(tag), imageUrl: '', tag }));
  spinner.stop(`Found ${characters.length} characters`);
  return characters;
}

/**
 * Turn a Danbooru tag into a display name: "eris_greyrat" -> "Eris Greyrat",
 * "sylphiette_(mushoku_tensei)" -> "Sylphiette".
 * @param {string} tag
 * @returns {string}
 */
function prettifyTag(tag) {
  return tag
    .replace(/_\(.*?\)/g, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Match a character name to the best tag within a series' character-tag set.
 * Scores by token overlap, with a strong bonus when the given (first) name
 * matches. Returns null when no candidate is confident enough.
 * @param {string} name
 * @param {string[]} candidateTags
 * @returns {string | null}
 */
function matchCharacterTag(name, candidateTags) {
  const nameTokens = tokenize(name);
  if (nameTokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const tag of candidateTags) {
    const tagTokens = tokenize(tag);
    const overlap = nameTokens.filter((t) => tagTokens.includes(t)).length;
    const firstMatch = nameTokens[0] === tagTokens[0] ? 2 : 0;
    const score = overlap + firstMatch;
    if (score > bestScore) {
      bestScore = score;
      best = tag;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * Fetch image URLs for a resolved character tag.
 * @param {string} tag
 * @param {number} [limit=SAFEBOORU_MAX_IMAGES]
 * @returns {Promise<string[]>}
 */
async function fetchTagImages(tag, limit = SAFEBOORU_MAX_IMAGES) {
  const url = `${SAFEBOORU_BASE}/posts.json?tags=${encodeURIComponent(tag)}&limit=${limit}`;
  const response = await fetch(url, { headers: SAFEBOORU_HEADERS });
  if (!response.ok) return [];

  const posts = /** @type {any[]} */ (await response.json());
  return /** @type {string[]} */ (
    posts.filter((p) => IMAGE_EXTS.has(p.file_ext)).map((p) => p.file_url).filter(Boolean)
  );
}

/**
 * Fetch every picture Jikan has for one character. Returns null when the
 * request fails (Jikan/MAL unavailable) so the caller can fall back.
 * @param {Character} character
 * @returns {Promise<string[] | null>}
 */
async function fetchJikanCharacterImages(character) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/characters/${character.id}/pictures`);
    if (!response.ok) return null;
    const data = /** @type {any} */ (await response.json());
    return /** @type {string[]} */ (
      (data.data ?? []).map((/** @type {any} */ p) => p?.jpg?.image_url).filter(Boolean)
    );
  } catch {
    return null;
  }
}

/**
 * Resolve a character's images, preferring the selected source's own API and
 * falling back to Safebooru, then the portrait. `used` records which source
 * actually supplied the images so the caller can surface a tip.
 * @param {Character} character
 * @param {Source} source
 * @param {() => Promise<string[]>} getCandidateTags lazily-loaded series tags
 * @returns {Promise<{ urls: string[], used: 'native' | 'safebooru' | 'portrait' }>}
 */
async function fetchCharacterImages(character, source, getCandidateTags) {
  // Safebooru source: the exact character tag is already known, no matching.
  if (source === 'safebooru') {
    return { urls: character.tag ? await fetchTagImages(character.tag) : [], used: 'native' };
  }

  // 1. Try the selected source's own image API (AniList has no gallery API).
  if (source === 'jikan') {
    const native = await fetchJikanCharacterImages(character);
    if (native && native.length > 0) return { urls: native, used: 'native' };
  }

  // 2. Fall back to Safebooru, constrained to the series' character tags.
  const tag = matchCharacterTag(character.name, await getCandidateTags());
  if (tag) {
    const booru = await fetchTagImages(tag);
    if (booru.length > 0) return { urls: booru, used: 'safebooru' };
  }

  // 3. Last resort: the single portrait we already have.
  return { urls: [character.imageUrl], used: 'portrait' };
}

async function seedFromJikan() {
  const searchTerm = await promptSearchTerm();
  if (searchTerm === null) return;

  const characters = await fetchJikanCharacters(searchTerm);
  if (characters === null) return;

  await chooseAndUpload(characters, searchTerm, 'jikan');
}

/**
 * @param {string} searchTerm
 * @returns {Promise<Character[] | null>} characters, or null if the fetch failed
 */
async function fetchJikanCharacters(searchTerm) {
  const spinner = clack.spinner();
  spinner.start('Fetching anime data from Jikan...');

  const animeResponse = await fetch(`https://api.jikan.moe/v4/anime?q=${searchTerm}&limit=1`);
  const animeData = /** @type {any} */ (await animeResponse.json())
  if (!animeResponse.ok) {
    spinner.stop(`Failed to fetch anime data — ${animeData.message ?? animeResponse.statusText}`);
    return null;
  }
  const animeid = animeData.data[0].mal_id;

  const charactersResponse = await fetch(`https://api.jikan.moe/v4/anime/${animeid}/characters`);
  const charactersData = /** @type {any} */ (await charactersResponse.json())
  if (!charactersResponse.ok) {
    spinner.stop(`Failed to fetch characters — ${charactersData.message ?? charactersResponse.statusText}`);
    return null;
  }

  const entries = /** @type {any[]} */ (charactersData.data);
  const characters = entries
    .map((e) => ({ id: e.character?.mal_id, name: e.character?.name ?? 'Unknown', imageUrl: e.character?.images?.jpg?.image_url }))
    .filter((c) => c.imageUrl);

  spinner.stop(`Found ${characters.length} characters`);
  return characters;
}

/**
 * Let the user upload every character's portrait, or pick a subset and pull
 * each picked character's full picture set. The picked path prefers the
 * selected source's own image API and falls back to Safebooru (with a tip)
 * when it can't deliver. Duplicate image URLs are removed before uploading.
 * @param {Character[]} characters
 * @param {string} seriesName used to constrain Safebooru tag matching
 * @param {Source} source the API the user selected
 */
async function chooseAndUpload(characters, seriesName, source) {
  if (characters.length === 0) {
    clack.outro('No characters found.');
    return;
  }

  const mode = await clack.select({
    message: `Found ${characters.length} characters — what do you want to upload?`,
    options: [
      { value: 'all', label: 'All characters (one image each)' },
      { value: 'pick', label: 'Select specific characters (all their images)' },
    ],
  });
  if (clack.isCancel(mode)) {
    clack.cancel('Cancelled');
    return;
  }

  /** @type {string[]} */
  let imageUrls;
  if (mode === 'pick') {
    const byId = new Map(characters.map((c) => [c.id, c]));
    const picked = await clack.multiselect({
      message: 'Select characters to upload (space to toggle, enter to confirm)',
      options: characters.map((c) => ({ value: c.id, label: c.name })),
      required: true,
    });
    if (clack.isCancel(picked)) {
      clack.cancel('Cancelled');
      return;
    }

    const pickedChars = /** @type {number[]} */ (picked)
      .map((id) => byId.get(id))
      .filter(/** @returns {c is Character} */ (c) => c !== undefined);

    // Load the series' Safebooru tags only once, and only if a fallback needs them.
    /** @type {Promise<string[]> | null} */
    let tagsPromise = null;
    const getCandidateTags = () => (tagsPromise ??= fetchSeriesCharacterTags(seriesName));

    const spinner = clack.spinner();
    spinner.start(`Fetching images from ${source === 'jikan' ? 'Jikan' : 'AniList'}...`);
    const limit = pLimit(3);
    const results = await Promise.all(
      pickedChars.map((c) => limit(() => fetchCharacterImages(c, source, getCandidateTags)))
    );
    imageUrls = unique(results.flatMap((r) => r.urls));
    spinner.stop(`Found ${imageUrls.length} images`);

    surfaceFallbackTips(source, pickedChars, results);
  } else if (source === 'safebooru') {
    // Safebooru characters have no portrait field; fetch one image each.
    const spinner = clack.spinner();
    spinner.start('Fetching one image per character...');
    const limit = pLimit(3);
    const imageLists = await Promise.all(
      characters.map((c) => limit(() => (c.tag ? fetchTagImages(c.tag, 1) : Promise.resolve([]))))
    );
    imageUrls = unique(imageLists.flat());
    spinner.stop(`Found ${imageUrls.length} images`);
  } else {
    imageUrls = unique(characters.map((c) => c.imageUrl));
  }

  await uploadAll(imageUrls);
}

/**
 * Tell the user when images came from somewhere other than the selected
 * source, so the fallback is never silent.
 * @param {Source} source
 * @param {Character[]} pickedChars aligned with `results`
 * @param {Array<{ used: 'native' | 'safebooru' | 'portrait' }>} results
 */
function surfaceFallbackTips(source, pickedChars, results) {
  const fellBackToBooru = results.filter((r) => r.used === 'safebooru').length;
  const portraitChars = pickedChars.filter((_, i) => results[i].used === 'portrait');

  if (source === 'jikan' && fellBackToBooru > 0) {
    clack.log.warn(`Jikan had no images for ${fellBackToBooru} character(s) — used Safebooru instead.`);
  } else if (source === 'anilist' && fellBackToBooru > 0) {
    clack.log.info('AniList has no per-character galleries — fetched extra images from Safebooru.');
  }

  if (portraitChars.length > 0) {
    clack.log.warn(`No gallery found for: ${portraitChars.map((c) => c.name).join(', ')} — used the single portrait.`);
  }
}

/**
 * @param {string[]} items
 * @returns {string[]}
 */
function unique(items) {
  return [...new Set(items)];
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

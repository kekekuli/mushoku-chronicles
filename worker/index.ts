import { Hono } from 'hono';

const FAKE_DESCS = [
  'Red wild with pure love',
  'White intellectual with support',
  'Blue scepter light the road, encourage brave',
  'Unsuitable time but have meet together',
  'Dissolute solider become a naughty father'
]

const app = new Hono<{ Bindings: Env }>();

app.get('/api/hello', c => {
  return c.json({ message: 'Hello from the Worker!' });
});

app.get('/api/images', async c => {
  const page = c.req.query('page') || 1;
  const pageSize = c.req.query('pageSize') || 20;
  const url = c.env.STRAPI_URL + `/api/galleries?populate=*&pagination[page]=${page}&pagination[pageSize]=${pageSize}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${c.env.STRAPI_TOKEN}`
    }
  })

  const data = await response.json();
  return c.json(data);
});

app.get('/api/images/:id/meta', c => {
  const id = Number(c.req.param('id'));
  return c.json(generateMeta(id));
})

app.post('/api/addImage', async c => {
  const formData = await c.req.formData();
  // Strapi's upload reads the field named "files", and we forward this same
  // FormData to it below — so the client must send the file under "files" too.
  if (!formData.has('files')) {
    return c.json({ error: 'No file uploaded' }, 400);
  }
  const image = formData.get('files');
  if (!(image instanceof File)) {
    return c.json({ error: 'Invalid file' }, 400);
  }
  try {
    const checkDuplicateResponse = await fetch(`${c.env.STRAPI_URL}/api/upload/files?filters[name][$eq]=${encodeURIComponent(image.name)}`, {
      headers: {
        Authorization: `Bearer ${c.env.STRAPI_TOKEN}`
      }
    })
    if (!checkDuplicateResponse.ok) {
      throw new Error("Duplicate check failed");
    }
    const checkData = await checkDuplicateResponse.json<unknown[]>();
    if (checkData.length > 0) {
      return c.json({ error: 'Duplicate image' }, 400);
    }

    const uploadResponse = await fetch(`${c.env.STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRAPI_TOKEN}`
      },
      body: formData
    })

    if (!uploadResponse.ok) {
      throw new Error("Upload image to strapi failed");
    }

    const uploadData = await uploadResponse.json<{
      id: number,
      url: string,
      width: number,
      height: number,
      alternativeText: string | null
    }[]>();
    const uploadedFile = uploadData[0];
    if (!uploadedFile?.id) {
      throw new Error("Uploaded image has no id");
    }

    const galleryResponse = await fetch(`${c.env.STRAPI_URL}/api/galleries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRAPI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { image: uploadedFile.id } })
    })

    if (!galleryResponse.ok) {
      throw new Error("Create gallery entry failed");
    }

    // Create returns a single object: { data: {...}, meta }, not an array.
    const galleryData = await galleryResponse.json<{
      data: {
        id: number,
        documentId: string
      }
    }>();
    const entry = galleryData.data;
    if (!entry?.id) {
      throw new Error("Gallery entry has no id");
    }

    // Return a full GalleryItem so the client cache can insert it directly.
    return c.json({
      id: entry.id,
      documentId: entry.documentId,
      image: {
        id: uploadedFile.id,
        url: uploadedFile.url,
        width: uploadedFile.width,
        height: uploadedFile.height,
        alternativeText: uploadedFile.alternativeText,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    return c.json({ error: 'Failed to upload file', details: message }, 502);
  }
})

// Delete a gallery item: the content entry (by documentId) AND its media file
// (by numeric file id). Strapi doesn't cascade-delete uploaded files, so we
// remove both explicitly.
app.delete('/api/images/:documentId', async c => {
  const documentId = c.req.param('documentId');
  const fileId = c.req.query('fileId');
  const headers = { Authorization: `Bearer ${c.env.STRAPI_TOKEN}` };

  // Content entry is what the gallery list shows — its deletion is what
  // determines success/failure for the client's optimistic patch.
  const contentRes = await fetch(`${c.env.STRAPI_URL}/api/galleries/${documentId}`, {
    method: 'DELETE',
    headers,
  });

  if (!contentRes.ok) {
    return c.json({ error: 'Failed to delete gallery entry' }, 502);
  }

  // Best-effort media cleanup; don't fail the request if the file is already gone.
  if (fileId) {
    await fetch(`${c.env.STRAPI_URL}/api/upload/files/${fileId}`, {
      method: 'DELETE',
      headers,
    });
  }

  return c.body(null, 204);
})


// Fall through to static assets (React app)
app.all('*', c => {
  const { pathname } = new URL(c.req.url);
  const target = pathname.includes('.')
    ? c.req.raw
    : new Request(new URL('/', c.req.url), c.req.raw);
  return c.env.ASSETS.fetch(target);
});

function generateMeta(id: number) {
  let x = (id * 48273) % 2147483647
  if (x <= 0) x += 2147483647
  const next = () => (x = (x * 16807) % 2147483647) / 2147483647

  return {
    like: Math.floor(next() * 100),
    desc: FAKE_DESCS[Math.floor(next() * FAKE_DESCS.length)]
  }
}

export default { fetch: app.fetch };

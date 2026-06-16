import { Hono } from 'hono';

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


// Fall through to static assets (React app)
app.all('*', c => {
  const { pathname } = new URL(c.req.url);
  const target = pathname.includes('.')
    ? c.req.raw
    : new Request(new URL('/', c.req.url), c.req.raw);
  return c.env.ASSETS.fetch(target);
});


export default { fetch: app.fetch };

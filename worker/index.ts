import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/hello', c => {
  return c.json({ message: 'Hello from the Worker!' });
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

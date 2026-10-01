import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { spec } from './openapi.ts';

type Row = Record<string, unknown> & { id: number };

function createDb() {
  let nextId = 1;
  const categories: Row[] = [{ id: nextId++, name: 'Electronics' }];
  const products: Row[] = [];
  return { categories, products, newId: () => nextId++ };
}

const db = createDb();

function send(res: ServerResponse, status: number, body?: unknown, contentType = 'application/json') {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', contentType);
  res.end(JSON.stringify(body));
}

const problem = (res: ServerResponse, status: number, title: string, errors?: Record<string, string[]>) =>
  send(res, status, { type: 'about:blank', title, status, errors }, 'application/problem+json');

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function validateProduct(body: Record<string, unknown>): Record<string, string[]> | undefined {
  const errors: Record<string, string[]> = {};
  if (typeof body.name !== 'string' || !body.name.trim()) errors.name = ['The name field is required.'];
  if (typeof body.price !== 'number' || body.price < 0) errors.price = ['The price must be a non-negative number.'];
  return Object.keys(errors).length ? errors : undefined;
}

/** In-memory demo API under /mock-api. */
const mockApi: Connect.NextHandleFunction = async (req, res, next) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/mock-api')) return next();
  const path = url.pathname.slice('/mock-api'.length);
  const method = req.method ?? 'GET';
  const raw = await readBody(req);
  let body: Record<string, unknown> = {};
  try {
    body = raw.length ? JSON.parse(raw.toString()) : {};
  } catch {
    return problem(res, 400, 'Malformed JSON body');
  }

  if (path === '/openapi.json') return send(res, 200, spec);
  if (path === '/api/health') return send(res, 200, { status: 'Healthy' });

  if (path === '/api/categories') {
    if (method === 'GET') return send(res, 200, db.categories);
    if (method === 'POST') {
      if (typeof body.name !== 'string' || !body.name) return problem(res, 400, 'Validation failed', { name: ['Required.'] });
      const row = { id: db.newId(), name: body.name };
      db.categories.push(row);
      return send(res, 201, row);
    }
  }

  if (path === '/api/products') {
    if (method === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase();
      const categoryId = url.searchParams.get('categoryId');
      return send(
        res,
        200,
        db.products.filter(
          (p) => (!search || String(p.name).toLowerCase().includes(search)) && (!categoryId || p.categoryId === Number(categoryId)),
        ),
      );
    }
    if (method === 'POST') {
      const errors = validateProduct(body);
      if (errors) return problem(res, 400, 'One or more validation errors occurred.', errors);
      const { id: _ignored, ...rest } = body;
      const row: Row = { ...rest, id: db.newId(), createdAt: new Date().toISOString() };
      db.products.push(row);
      return send(res, 201, row);
    }
  }

  const match = path.match(/^\/api\/products\/(\d+)$/);
  if (match) {
    const idx = db.products.findIndex((p) => p.id === Number(match[1]));
    if (idx < 0) return problem(res, 404, `Product ${match[1]} not found`);
    if (method === 'GET') return send(res, 200, db.products[idx]);
    if (method === 'DELETE') {
      db.products.splice(idx, 1);
      return send(res, 204);
    }
    if (method === 'PUT') {
      const errors = validateProduct(body);
      if (errors) return problem(res, 400, 'One or more validation errors occurred.', errors);
      const { stockQuantity, ...rest } = body;
      const old = db.products[idx];
      db.products[idx] = { ...rest, stock: stockQuantity ?? old.stock, id: old.id, createdAt: old.createdAt };
      return send(res, 200, db.products[idx]);
    }
  }

  return problem(res, 404, `No route for ${method} ${path}`);
};

const HOP_BY_HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'origin', 'referer', 'x-proxy-target', 'accept-encoding'];

/**
 * Dev-only relay so the UI can call APIs on other origins without CORS headers.
 * The target URL comes from the `x-proxy-target` header.
 */
const proxy: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/__proxy')) return next();
  const target = req.headers['x-proxy-target'];
  if (typeof target !== 'string' || !/^https?:\/\//.test(target)) return problem(res, 400, 'Missing or invalid x-proxy-target header');

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string' && !HOP_BY_HOP.includes(k)) headers[k] = v;
  }
  const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : new Uint8Array(await readBody(req));
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual' });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) res.setHeader(key, value);
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    problem(res, 502, `Proxy request to ${target} failed: ${String(e)}`);
  }
};

export function devServerPlugin(): Plugin {
  return {
    name: 'improved-swagger-dev-server',
    configureServer(server) {
      server.middlewares.use(proxy);
      server.middlewares.use(mockApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(proxy);
      server.middlewares.use(mockApi);
    },
  };
}

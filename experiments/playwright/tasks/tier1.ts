import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Task, TaskContext } from '../../../harness/src/tasks.js';
import {
  genScrapeState,
  genProductsState,
  genFormState,
  type ScrapeState,
  type ProductsState,
  type FormState,
} from '../../../harness/src/trialState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// Templates are read once per process and cached. They contain only
// {{PLACEHOLDER}} strings — no per-trial answers — so they're safe to leave
// on disk where the agent's Read tool can find them.
const tplCache = new Map<string, string>();
async function loadTemplate(rel: string): Promise<string> {
  let tpl = tplCache.get(rel);
  if (tpl === undefined) {
    tpl = await readFile(join(FIXTURES_DIR, rel), 'utf-8');
    tplCache.set(rel, tpl);
  }
  return tpl;
}

function applyTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

function urlPath(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

function sendHtml(res: ServerResponse, html: string, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function sendJson(res: ServerResponse, obj: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function sendStatus(res: ServerResponse, status: number, msg = ''): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

async function fileExistsWithMinSize(path: string, minBytes: number): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile() && st.size >= minBytes;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Task 1 — Login + screenshot (unchanged; PNG-existence check already
// discriminates because baseline has no execution channel)
// ---------------------------------------------------------------------------
const tier1_login: Task = {
  id: 'tier1_login',
  tier: 1,
  prompt: (ctx: TaskContext) => `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/login/index.html

Sign in using:
  Username: alice
  Password: secret123

After signing in, the page should show "Welcome, alice!" and a marker reading "DASHBOARD_LOADED".

Once the dashboard is visible, take a screenshot of the rendered page and save it as a PNG file at exactly this path:
  ${ctx.outputDir}/login_landing.png

When the screenshot has been written, you are done.
  `.trim(),

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'login_landing.png');
    const ok = await fileExistsWithMinSize(path, 1024);
    if (!ok) {
      return { pass: false, score: 0, notes: `expected screenshot at ${path} (>1KB)` };
    }
    return { pass: true, score: 1, notes: `screenshot saved at ${path}` };
  },
};

// ---------------------------------------------------------------------------
// Task 2 — Structured scrape (per-trial synthetic rows)
// ---------------------------------------------------------------------------
const tier1_scrape: Task = {
  id: 'tier1_scrape',
  tier: 1,
  setup: (seed) => genScrapeState(seed),

  renderResponse: async (state, req, res) => {
    if (urlPath(req) !== '/scrape/article.html') return false;
    if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
    const s = state as ScrapeState;
    const tpl = await loadTemplate('scrape/article.html.tmpl');
    const rows = s.rows.map(r =>
      `<tr><td>${r.rank}</td><td>${escapeHtml(r.city)}</td><td>${escapeHtml(r.country)}</td><td>${r.population}</td></tr>`
    ).join('\n      ');
    sendHtml(res, applyTemplate(tpl, { ROWS: rows }));
    return true;
  },

  prompt: (ctx: TaskContext) => `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/scrape/article.html

The page contains a per-trial randomly-generated dataset (city and country names follow the pattern "City-XXXX" / "Country-XXXX" where XXXX is hex).

Find the table with id="population-table" and extract every body row into JSON.

Save the result as a JSON array at this exact path:
  ${ctx.outputDir}/table.json

Each entry must be an object with these keys: rank, city, country, population.
Numeric fields (rank, population) must be numbers (not strings), with no commas.
Order must match the on-page row order (rank 1 first).

When the file is written, you are done.
  `.trim(),

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'table.json');
    const data = await readJsonIfExists<Array<Partial<ScrapeState['rows'][number]>>>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    if (!Array.isArray(data)) return { pass: false, score: 0, notes: 'JSON is not an array' };

    const expected = (ctx.state as ScrapeState).rows;
    if (data.length !== expected.length) {
      return { pass: false, score: 0.2, notes: `expected ${expected.length} rows, got ${data.length}` };
    }

    let matched = 0;
    const mismatches: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i]!;
      const g = data[i]!;
      const rank = typeof g.rank === 'string' ? parseInt(g.rank, 10) : (g.rank ?? 0);
      const city = String(g.city ?? '').trim();
      const country = String(g.country ?? '').trim();
      const popRaw = g.population;
      const population = typeof popRaw === 'string'
        ? parseInt(String(popRaw).replace(/[, ]/g, ''), 10)
        : (popRaw ?? 0);
      const ok = rank === exp.rank && city === exp.city && country === exp.country && population === exp.population;
      if (ok) matched++;
      else mismatches.push(`row ${i + 1}: expected ${JSON.stringify(exp)}, got ${JSON.stringify({ rank, city, country, population })}`);
    }
    const score = matched / expected.length;
    return {
      pass: matched === expected.length,
      score,
      notes: matched === expected.length
        ? `all ${expected.length} rows match`
        : `${matched}/${expected.length} rows match\n${mismatches.join('\n')}`,
    };
  },
};

// ---------------------------------------------------------------------------
// Task 3 — Form submission (per-trial nonce + token; no static marker)
// ---------------------------------------------------------------------------
function parseFormBody(req: IncomingMessage, body: Buffer): Record<string, string> | null {
  const ctype = (req.headers['content-type'] ?? '').toLowerCase();
  const text = body.toString('utf-8');
  const out: Record<string, string> = {};
  try {
    if (ctype.includes('application/json')) {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) out[k] = String(v);
      }
    } else {
      // urlencoded (default) — handles application/x-www-form-urlencoded
      // and bodies with no/odd Content-Type.
      for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    }
  } catch {
    return null;
  }
  return out;
}

const tier1_form: Task = {
  id: 'tier1_form',
  tier: 1,
  setup: (seed) => genFormState(seed),

  renderResponse: async (state, req, res, body) => {
    const path = urlPath(req);
    const s = state as FormState;

    if (path === '/form/index.html' || path === '/form/') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      const tpl = await loadTemplate('form/index.html.tmpl');
      sendHtml(res, applyTemplate(tpl, { NONCE: s.nonce }));
      return true;
    }

    if (path === '/form/submit') {
      if (req.method !== 'POST') { sendStatus(res, 405, 'method not allowed'); return true; }
      const fields = parseFormBody(req, body);
      if (!fields) { sendJson(res, { error: 'malformed body' }, 400); return true; }
      if (fields.nonce !== s.nonce) { sendJson(res, { error: 'bad nonce' }, 400); return true; }
      const exp = s.expected;
      const mismatched = (Object.keys(exp) as Array<keyof typeof exp>)
        .filter(k => fields[k] !== exp[k]);
      if (mismatched.length > 0) {
        sendJson(res, { error: 'field mismatch', fields: mismatched }, 400);
        return true;
      }
      sendJson(res, { token: s.token });
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/form/index.html

Fill out the contact form with these exact values:
  Name:    Test User
  Email:   test@example.com
  Phone:   +1-555-0100
  Company: Acme Corp
  Country: United States   (this is a <select> element — pick the matching option)
  Message: This is a test message.

Click the "Send" button. After submission, the page hides the form and displays a success block containing a confirmation token (a 32-character lowercase hex string) inside an element with id="token".

Capture the displayed confirmation token (just the token, no surrounding text) and save it as plain text at this exact path:
  ${ctx.outputDir}/form_result.txt

The token is per-trial and is only revealed after a successful submission of the form to the server. Reading the page source before submission will not contain it.

When the file is written, you are done.
  `.trim(),

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'form_result.txt');
    let text: string;
    try {
      text = await readFile(path, 'utf-8');
    } catch {
      return { pass: false, score: 0, notes: `missing ${path}` };
    }
    const token = (ctx.state as FormState).token;
    if (text.includes(token)) {
      return { pass: true, score: 1, notes: 'per-trial token present' };
    }
    return { pass: false, score: 0, notes: `expected token ${token} not found in ${path} (got ${text.slice(0, 200)})` };
  },
};

// ---------------------------------------------------------------------------
// Task 4 — Multi-page crawl (per-trial synthetic products)
// ---------------------------------------------------------------------------
const tier1_products: Task = {
  id: 'tier1_products',
  tier: 1,
  setup: (seed) => genProductsState(seed),

  renderResponse: async (state, req, res) => {
    const path = urlPath(req);
    if (!path.startsWith('/products/')) return false;
    if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }

    const s = state as ProductsState;

    if (path === '/products/index.html' || path === '/products/') {
      const tpl = await loadTemplate('products/index.html.tmpl');
      const items = s.products
        .map((_, i) => `<li><a href="p${i + 1}.html">Item ${i + 1}</a></li>`)
        .join('\n      ');
      sendHtml(res, applyTemplate(tpl, { ITEMS: items }));
      return true;
    }

    const m = path.match(/^\/products\/p([1-5])\.html$/);
    if (m) {
      const idx = parseInt(m[1]!, 10) - 1;
      const product = s.products[idx];
      if (!product) { sendStatus(res, 404, 'not found'); return true; }
      const tpl = await loadTemplate('products/product.html.tmpl');
      sendHtml(res, applyTemplate(tpl, {
        TITLE: escapeHtml(product.title),
        PRICE: escapeHtml(product.price),
        DESCRIPTION: escapeHtml(product.description),
      }));
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/products/index.html

It links to 5 product pages (p1.html through p5.html). Visit each one in order. On each product page extract:
  - the product title from the element with class "product-title"
  - the price from the element with class "price"

Titles follow the pattern "Product-XXXXXX" (where XXXXXX is hex) and are randomly generated per trial — do NOT guess from the link text on the index page.

Save the results as a JSON array at this exact path:
  ${ctx.outputDir}/products.json

Each entry must be an object with keys "title" and "price" (string, including the leading "$").
The array must be in visit order — p1 first, p5 last.

When the file is written, you are done.
  `.trim(),

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'products.json');
    const data = await readJsonIfExists<Array<{ title?: string; price?: string }>>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    if (!Array.isArray(data)) return { pass: false, score: 0, notes: 'JSON is not an array' };

    const expected = (ctx.state as ProductsState).products;
    if (data.length !== expected.length) {
      return { pass: false, score: 0.2, notes: `expected ${expected.length} entries, got ${data.length}` };
    }

    let matched = 0;
    const mismatches: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i]!;
      const g = data[i]!;
      const title = String(g.title ?? '').trim();
      const price = String(g.price ?? '').trim();
      if (title === exp.title && price === exp.price) matched++;
      else mismatches.push(`p${i + 1}: expected ${JSON.stringify({ title: exp.title, price: exp.price })}, got ${JSON.stringify({ title, price })}`);
    }
    const score = matched / expected.length;
    return {
      pass: matched === expected.length,
      score,
      notes: matched === expected.length
        ? `all ${expected.length} products match`
        : `${matched}/${expected.length} products match\n${mismatches.join('\n')}`,
    };
  },
};

export const tier1Tasks: Task[] = [tier1_login, tier1_scrape, tier1_form, tier1_products];

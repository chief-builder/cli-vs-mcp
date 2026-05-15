import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Task, TaskContext } from '../../../harness/src/tasks.js';
import {
  genCheckoutState,
  genRecoveryState,
  type CheckoutState,
  type CheckoutSession,
  type RecoveryState,
} from '../../../harness/src/trialState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

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

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sendHtml(
  res: ServerResponse,
  html: string,
  status = 200,
  extraHeaders: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(html);
}

function sendStatus(res: ServerResponse, status: number, msg = ''): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

function sendRedirect(
  res: ServerResponse,
  location: string,
  extraHeaders: Record<string, string | string[]> = {},
): void {
  // 303 See Other so POST → GET on follow.
  res.writeHead(303, { Location: location, ...extraHeaders });
  res.end();
}

function parseBody(req: IncomingMessage, body: Buffer): Record<string, string> {
  const ctype = (req.headers['content-type'] ?? '').toLowerCase();
  const text = body.toString('utf-8');
  const out: Record<string, string> = {};
  if (ctype.includes('application/json')) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) out[k] = String(v);
      }
    } catch {
      /* swallow */
    }
  } else {
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  }
  return out;
}

function readSid(req: IncomingMessage): string | null {
  return parseCookies(req).sid ?? null;
}

function newSid(): string {
  return randomBytes(8).toString('hex');
}

function setSidCookie(sid: string): string {
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`;
}

async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Task — tier2_checkout
// ---------------------------------------------------------------------------

function ensureCheckoutSession(state: CheckoutState, req: IncomingMessage): { sid: string; sess: CheckoutSession; setCookie?: string } {
  let sid = readSid(req);
  let setCookie: string | undefined;
  if (!sid || !state.sessions.has(sid)) {
    sid = newSid();
    setCookie = setSidCookie(sid);
  }
  let sess = state.sessions.get(sid);
  if (!sess) {
    sess = { cart: [], stage: 'browsing' };
    state.sessions.set(sid, sess);
  }
  return { sid, sess, ...(setCookie ? { setCookie } : {}) };
}

const tier2_checkout: Task = {
  id: 'tier2_checkout',
  tier: 2,
  setup: (seed) => genCheckoutState(seed),

  renderResponse: async (rawState, req, res, body) => {
    const s = rawState as CheckoutState;
    const path = urlPath(req);
    if (!path.startsWith('/checkout/')) return false;

    const { sid, sess, setCookie } = ensureCheckoutSession(s, req);
    const cookieHeader = setCookie ? { 'Set-Cookie': setCookie } : {};

    // --- GET / (product list) -------------------------------------------
    if (path === '/checkout/index.html' || path === '/checkout/') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      const tpl = await loadTemplate('checkout/index.html.tmpl');
      const items = s.products.map(p => `
        <li class="product" data-product-id="${p.id}">
          <div class="product-title">${escapeHtml(p.title)}</div>
          <div class="price">${escapeHtml(p.price)}</div>
          <form method="POST" action="/checkout/add" style="margin-top:8px;">
            <input type="hidden" name="product_id" value="${p.id}" />
            <button type="submit" id="add-${p.id}">Add to cart</button>
          </form>
        </li>`).join('\n');
      sendHtml(res, applyTemplate(tpl, { PRODUCTS: items }), 200, cookieHeader);
      return true;
    }

    // --- POST /checkout/add ---------------------------------------------
    if (path === '/checkout/add') {
      if (req.method !== 'POST') { sendStatus(res, 405, 'method not allowed'); return true; }
      const fields = parseBody(req, body);
      const pid = fields.product_id;
      if (!pid || !s.products.some(p => p.id === pid)) {
        sendStatus(res, 400, 'unknown product');
        return true;
      }
      sess.cart.push(pid);
      sendRedirect(res, '/checkout/cart', cookieHeader);
      return true;
    }

    // --- GET /checkout/cart ---------------------------------------------
    if (path === '/checkout/cart') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      const tpl = await loadTemplate('checkout/cart.html.tmpl');
      let cartBody: string;
      if (sess.cart.length === 0) {
        cartBody = `<p class="empty" id="empty-cart">Your cart is empty.</p>`;
      } else {
        const rows = sess.cart.map(pid => {
          const p = s.products.find(x => x.id === pid)!;
          return `<tr><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.price)}</td></tr>`;
        }).join('\n');
        cartBody = `
          <table id="cart-table">
            <thead><tr><th>Item</th><th>Price</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="actions">
            <a class="btn" id="checkout" href="/checkout/shipping">Proceed to checkout</a>
          </div>`;
      }
      sendHtml(res, applyTemplate(tpl, { CART_BODY: cartBody }), 200, cookieHeader);
      return true;
    }

    // --- GET /checkout/shipping -----------------------------------------
    if (path === '/checkout/shipping') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      if (sess.cart.length === 0) {
        sendHtml(res, `<!doctype html><body><p id="error">Cart is empty. <a href="/checkout/index.html">Go back</a>.</p></body>`, 200, cookieHeader);
        return true;
      }
      const tpl = await loadTemplate('checkout/shipping.html.tmpl');
      sendHtml(res, applyTemplate(tpl, { ERROR: '' }), 200, cookieHeader);
      return true;
    }

    // --- POST /checkout/shipping/submit ---------------------------------
    if (path === '/checkout/shipping/submit') {
      if (req.method !== 'POST') { sendStatus(res, 405, 'method not allowed'); return true; }
      if (sess.cart.length === 0) { sendStatus(res, 400, 'empty cart'); return true; }
      const fields = parseBody(req, body);
      const exp = s.expectedShipping;
      const got = {
        name: (fields.name ?? '').trim(),
        address: (fields.address ?? '').trim(),
        city: (fields.city ?? '').trim(),
        zip: (fields.zip ?? '').trim(),
      };
      const mismatched = (Object.keys(exp) as Array<keyof typeof exp>).filter(k => got[k] !== exp[k]);
      if (mismatched.length > 0) {
        const tpl = await loadTemplate('checkout/shipping.html.tmpl');
        const errHtml = `<div class="error" id="shipping-error">Please correct the following fields: ${mismatched.join(', ')}.</div>`;
        sendHtml(res, applyTemplate(tpl, { ERROR: errHtml }), 200, cookieHeader);
        return true;
      }
      sess.shipping = got;
      sess.stage = 'confirm';
      sendRedirect(res, '/checkout/confirm', cookieHeader);
      return true;
    }

    // --- GET /checkout/confirm ------------------------------------------
    if (path === '/checkout/confirm') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      if (sess.stage !== 'confirm' || !sess.shipping) {
        sendHtml(res, `<!doctype html><body><p id="error">Shipping not completed yet. <a href="/checkout/shipping">Go back</a>.</p></body>`, 200, cookieHeader);
        return true;
      }
      const tpl = await loadTemplate('checkout/confirm.html.tmpl');
      const items = sess.cart.map(pid => {
        const p = s.products.find(x => x.id === pid)!;
        return `<tr><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.price)}</td></tr>`;
      }).join('\n');
      sendHtml(res, applyTemplate(tpl, {
        ITEMS: items,
        SHIP_NAME: escapeHtml(sess.shipping.name),
        SHIP_ADDRESS: escapeHtml(sess.shipping.address),
        SHIP_CITY: escapeHtml(sess.shipping.city),
        SHIP_ZIP: escapeHtml(sess.shipping.zip),
      }), 200, cookieHeader);
      return true;
    }

    // --- POST /checkout/place_order -------------------------------------
    if (path === '/checkout/place_order') {
      if (req.method !== 'POST') { sendStatus(res, 405, 'method not allowed'); return true; }
      if (sess.stage !== 'confirm' || !sess.shipping || sess.cart.length === 0) {
        sendStatus(res, 400, 'cannot place order in current stage');
        return true;
      }
      const orderId = randomBytes(8).toString('hex'); // 16 hex
      sess.orderId = orderId;
      sess.stage = 'placed';
      s.placedOrders.push({ sid, orderId, productIds: [...sess.cart] });
      const tpl = await loadTemplate('checkout/success.html.tmpl');
      sendHtml(res, applyTemplate(tpl, { ORDER_ID: orderId }), 200, cookieHeader);
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => {
    const sub = (ctx.state as CheckoutState).targetSubstring;
    return `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/checkout/index.html

The page lists three products with titles of the form "Product-XXXXXX" (hex). Find the one whose title contains the substring "${sub}" (case-sensitive) and add it to your cart by clicking its "Add to cart" button.

Then proceed through checkout:
  1. Open the cart and click "Proceed to checkout".
  2. Fill the shipping form with these exact values:
       Name:    Test User
       Address: 123 Main St
       City:    Springfield
       ZIP:     12345
     Click "Continue".
  3. On the order confirmation page, click "Place order".

After the order is placed, the page displays a 16-character lowercase hex order ID inside an element with id="order-id".

Save just the order ID (no surrounding text) to:
  ${ctx.outputDir}/order_id.txt

When the file is written, you are done.
`.trim();
  },

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'order_id.txt');
    const text = await readTextIfExists(path);
    const s = ctx.state as CheckoutState;
    const extras: Record<string, unknown> = {
      orders_placed: s.placedOrders.length,
      sessions_seen: s.sessions.size,
    };
    if (text === null) {
      return { pass: false, score: 0, notes: `missing ${path}`, extras };
    }
    const trimmed = text.trim();
    if (!/^[0-9a-f]{16}$/.test(trimmed)) {
      return {
        pass: false,
        score: 0.2,
        notes: `expected 16-hex order ID, got ${JSON.stringify(trimmed.slice(0, 80))}`,
        extras,
      };
    }
    const order = s.placedOrders.find(o => o.orderId === trimmed);
    if (!order) {
      return {
        pass: false,
        score: 0.3,
        notes: `order ID ${trimmed} was never issued by the server`,
        extras,
      };
    }
    if (!order.productIds.includes(s.targetProductId)) {
      return {
        pass: false,
        score: 0.6,
        notes: `order placed but did not contain the target product ${s.targetProductId} (cart was ${JSON.stringify(order.productIds)})`,
        extras,
      };
    }
    return { pass: true, score: 1, notes: 'order placed with target product', extras };
  },
};

// ---------------------------------------------------------------------------
// Task — tier2_recovery
// ---------------------------------------------------------------------------

function ensureRecoverySession(state: RecoveryState, req: IncomingMessage): { sid: string; setCookie?: string } {
  let sid = readSid(req);
  let setCookie: string | undefined;
  if (!sid || !state.sessions.has(sid)) {
    sid = newSid();
    setCookie = setSidCookie(sid);
    state.sessions.set(sid, { attempts: 0 });
  }
  return { sid, ...(setCookie ? { setCookie } : {}) };
}

const tier2_recovery: Task = {
  id: 'tier2_recovery',
  tier: 2,
  setup: (seed) => genRecoveryState(seed),

  renderResponse: async (rawState, req, res, body) => {
    const s = rawState as RecoveryState;
    const path = urlPath(req);
    if (!path.startsWith('/recovery/')) return false;

    const { sid, setCookie } = ensureRecoverySession(s, req);
    const cookieHeader = setCookie ? { 'Set-Cookie': setCookie } : {};

    // --- GET /recovery/index.html ---------------------------------------
    if (path === '/recovery/index.html' || path === '/recovery/') {
      if (req.method !== 'GET') { sendStatus(res, 405, 'method not allowed'); return true; }
      const tpl = await loadTemplate('recovery/index.html.tmpl');
      sendHtml(res, applyTemplate(tpl, {
        NONCE: s.nonce,
        VAL_NAME: '',
        VAL_EMAIL: '',
        VAL_CODE: '',
        ERRORS: '',
      }), 200, cookieHeader);
      return true;
    }

    // --- POST /recovery/submit ------------------------------------------
    if (path === '/recovery/submit') {
      if (req.method !== 'POST') { sendStatus(res, 405, 'method not allowed'); return true; }
      const fields = parseBody(req, body);
      if (fields.nonce !== s.nonce) {
        sendStatus(res, 400, 'bad nonce');
        return true;
      }
      const sess = s.sessions.get(sid)!;
      sess.attempts += 1;

      const name = (fields.name ?? '').trim();
      const email = (fields.email ?? '').trim();
      const code = (fields.code ?? '').trim();

      const errors: string[] = [];
      if (name !== s.expectedName) {
        errors.push(`<div class="error" id="error-name">Name does not match the account on file. Enter "${escapeHtml(s.expectedName)}".</div>`);
      }
      if (email !== s.expectedEmail) {
        errors.push(`<div class="error" id="error-email">Email does not match the account on file. Enter "${escapeHtml(s.expectedEmail)}".</div>`);
      }
      if (code !== s.requiredCode) {
        // The error reveals the per-trial code — this is the introspection
        // point that distinguishes the tasks. Agent must read this from the
        // DOM after the failed submit.
        errors.push(`<div class="error" id="error-code">The verification code is "${escapeHtml(s.requiredCode)}". Enter it exactly to proceed.</div>`);
      }

      if (errors.length > 0) {
        const tpl = await loadTemplate('recovery/index.html.tmpl');
        sendHtml(res, applyTemplate(tpl, {
          NONCE: s.nonce,
          VAL_NAME: escapeHtml(name),
          VAL_EMAIL: escapeHtml(email),
          VAL_CODE: escapeHtml(code),
          ERRORS: errors.join('\n'),
        }), 200, cookieHeader);
        return true;
      }

      const tpl = await loadTemplate('recovery/success.html.tmpl');
      sendHtml(res, applyTemplate(tpl, { TOKEN: s.token }), 200, cookieHeader);
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => `
Navigate a browser to this URL:
  ${ctx.fixturesUrl}/recovery/index.html

Fill the form with these values:
  Name:              Test User
  Email:             test@example.com
  Verification code: unknown

Click "Verify". The verification code you were given is intentionally wrong; the server will reject the submission and re-render the form with an inline error message (look for elements with class="error" on the page). The error message for the code field reveals the correct verification code for this session.

Read the inline error from the page, update the verification code field with the correct value (keep Name and Email as before), and click "Verify" again. Continue until the page shows a success block containing a 32-character lowercase hex confirmation token inside an element with id="token".

Save just the token to:
  ${ctx.outputDir}/recovery_token.txt

When the file is written, you are done.
`.trim(),

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'recovery_token.txt');
    const text = await readTextIfExists(path);
    const s = ctx.state as RecoveryState;
    let totalAttempts = 0;
    for (const sess of s.sessions.values()) totalAttempts += sess.attempts;
    const extras: Record<string, unknown> = {
      recovery_attempts: totalAttempts,
      sessions_seen: s.sessions.size,
    };
    if (text === null) {
      return { pass: false, score: 0, notes: `missing ${path}`, extras };
    }
    const trimmed = text.trim();
    if (trimmed === s.token) {
      return { pass: true, score: 1, notes: 'per-trial token present', extras };
    }
    return {
      pass: false,
      score: 0,
      notes: `expected token ${s.token}, got ${JSON.stringify(trimmed.slice(0, 80))}`,
      extras,
    };
  },
};

export const tier2Tasks: Task[] = [tier2_checkout, tier2_recovery];

import { createHash, randomBytes } from 'node:crypto';

// Deterministic PRNG (mulberry32) seeded from FNV-1a hash of a hex seed.
// Avoids adding seedrandom as a dep. Reproducible across runs given the
// same seed string.
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a = (a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFromSeed(seed: string, salt: string): () => number {
  return mulberry32(fnv1a(seed + ':' + salt));
}

function hexN(rng: () => number, len: number): string {
  let s = '';
  while (s.length < len) {
    s += Math.floor(rng() * 0x10000).toString(16).padStart(4, '0');
  }
  return s.slice(0, len);
}

function intBetween(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/** Generates a fresh per-trial seed (16 hex chars, ~64 bits of entropy). */
export function mkSeed(): string {
  return randomBytes(8).toString('hex');
}

/** Deterministic paired seed shared by every arm for the same task/trial. */
export function mkPairedSeed(experiment: string, runName: string, taskId: string, trialN: number): string {
  return createHash('sha256')
    .update(`${experiment}:${runName}:${taskId}:${trialN}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// tier1_scrape
// ---------------------------------------------------------------------------

export interface ScrapeRow {
  rank: number;
  city: string;
  country: string;
  population: number;
}

export interface ScrapeState {
  rows: ScrapeRow[];
}

export function genScrapeState(seed: string): ScrapeState {
  const rng = rngFromSeed(seed, 'scrape');
  const rows: ScrapeRow[] = [];
  for (let i = 1; i <= 5; i++) {
    rows.push({
      rank: i,
      city: 'City-' + hexN(rng, 4),
      country: 'Country-' + hexN(rng, 4),
      population: intBetween(rng, 1_000_000, 49_999_999),
    });
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// tier1_products
// ---------------------------------------------------------------------------

export interface ProductRow {
  title: string;
  price: string;
  description: string;
}

export interface ProductsState {
  products: ProductRow[];
}

export function genProductsState(seed: string): ProductsState {
  const rng = rngFromSeed(seed, 'products');
  const products: ProductRow[] = [];
  for (let i = 1; i <= 5; i++) {
    const title = 'Product-' + hexN(rng, 6);
    const dollars = intBetween(rng, 10, 999);
    const cents = intBetween(rng, 0, 99).toString().padStart(2, '0');
    products.push({
      title,
      price: `$${dollars}.${cents}`,
      description: `Synthetic product ${i} for trial.`,
    });
  }
  return { products };
}

// ---------------------------------------------------------------------------
// tier1_form
// ---------------------------------------------------------------------------

export interface FormFields {
  name: string;
  email: string;
  phone: string;
  company: string;
  country: string;
  message: string;
}

export interface FormState {
  nonce: string;       // 16 hex; rendered into a hidden form field on GET
  token: string;       // 32 hex; revealed only on a valid POST
  expected: FormFields;
}

export const FORM_EXPECTED: FormFields = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '+1-555-0100',
  company: 'Acme Corp',
  country: 'US',                      // <select> value, not the visible label
  message: 'This is a test message.',
};

export function genFormState(seed: string): FormState {
  const rng = rngFromSeed(seed, 'form');
  return {
    nonce: hexN(rng, 16),
    token: hexN(rng, 32),
    expected: { ...FORM_EXPECTED },
  };
}

// ---------------------------------------------------------------------------
// tier2_checkout
// ---------------------------------------------------------------------------

export interface CheckoutProduct {
  id: string;       // "p1" | "p2" | "p3"
  title: string;    // "Product-XXXXXX"
  price: string;    // "$NNN.NN"
}

export interface CheckoutSession {
  cart: string[];                                                    // product ids
  shipping?: { name: string; address: string; city: string; zip: string };
  stage: 'browsing' | 'shipping' | 'confirm' | 'placed';
  orderId?: string;
}

export interface CheckoutState {
  products: CheckoutProduct[];
  targetProductId: string;
  targetSubstring: string;   // 4 hex chars present in exactly one product title
  expectedShipping: { name: string; address: string; city: string; zip: string };
  sessions: Map<string, CheckoutSession>;
  placedOrders: Array<{ sid: string; orderId: string; productIds: string[] }>;
}

export const CHECKOUT_SHIPPING = {
  name: 'Test User',
  address: '123 Main St',
  city: 'Springfield',
  zip: '12345',
};

export function genCheckoutState(seed: string): CheckoutState {
  const rng = rngFromSeed(seed, 'checkout');
  const products: CheckoutProduct[] = [];
  // Each product gets a 6-hex title. The first 4 hex of the target product's
  // title double as the substring the agent must match. Other products share
  // no overlap because their hex strings are independently sampled.
  let targetIdx = intBetween(rng, 0, 2);
  for (let i = 0; i < 3; i++) {
    const title = 'Product-' + hexN(rng, 6);
    const dollars = intBetween(rng, 10, 999);
    const cents = intBetween(rng, 0, 99).toString().padStart(2, '0');
    products.push({
      id: 'p' + (i + 1),
      title,
      price: `$${dollars}.${cents}`,
    });
  }
  const target = products[targetIdx]!;
  const targetSubstring = target.title.slice(-4); // last 4 hex of "Product-XXXXXX"
  return {
    products,
    targetProductId: target.id,
    targetSubstring,
    expectedShipping: { ...CHECKOUT_SHIPPING },
    sessions: new Map(),
    placedOrders: [],
  };
}

// ---------------------------------------------------------------------------
// tier2_recovery
// ---------------------------------------------------------------------------

export interface RecoverySession {
  attempts: number;
}

export interface RecoveryState {
  nonce: string;
  token: string;           // 32 hex; revealed only on valid POST
  requiredCode: string;    // 8 hex; agent learns this from the inline error
  expectedName: string;
  expectedEmail: string;
  sessions: Map<string, RecoverySession>;
}

export const RECOVERY_FIELDS = {
  name: 'Test User',
  email: 'test@example.com',
};

export function genRecoveryState(seed: string): RecoveryState {
  const rng = rngFromSeed(seed, 'recovery');
  return {
    nonce: hexN(rng, 16),
    token: hexN(rng, 32),
    requiredCode: hexN(rng, 8),
    expectedName: RECOVERY_FIELDS.name,
    expectedEmail: RECOVERY_FIELDS.email,
    sessions: new Map(),
  };
}

import { describe, expect, it } from 'vitest';
import { genCheckoutState, genFormState, genScrapeState, mkPairedSeed } from '../harness/src/trialState.js';
import { repoNameFor } from '../experiments/github/provisioner.js';

describe('mkPairedSeed', () => {
  it('is deterministic, 16 hex chars, and independent of the arm', () => {
    const a = mkPairedSeed('playwright', 'n5', 'tier1_scrape', 3);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(mkPairedSeed('playwright', 'n5', 'tier1_scrape', 3)).toBe(a);
  });
  it('changes with any input', () => {
    const a = mkPairedSeed('playwright', 'n5', 'tier1_scrape', 3);
    expect(mkPairedSeed('playwright', 'n5', 'tier1_scrape', 4)).not.toBe(a);
    expect(mkPairedSeed('playwright', 'n6', 'tier1_scrape', 3)).not.toBe(a);
    expect(mkPairedSeed('github', 'n5', 'tier1_scrape', 3)).not.toBe(a);
  });
});

describe('per-task state generators', () => {
  it('produce the same state for the same seed', () => {
    expect(genScrapeState('abc')).toEqual(genScrapeState('abc'));
    expect(genFormState('abc')).toEqual(genFormState('abc'));
  });
  it('produce different state for different seeds', () => {
    expect(genScrapeState('abc')).not.toEqual(genScrapeState('abd'));
  });
  it('generates five well-formed scrape rows', () => {
    const { rows } = genScrapeState('seed');
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.city).toMatch(/^City-[0-9a-f]{4}$/);
      expect(r.population).toBeGreaterThanOrEqual(1_000_000);
    }
  });
  it('puts the checkout target substring in exactly one product title', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const s = genCheckoutState(seed);
      expect(s.products.filter(p => p.title.includes(s.targetSubstring))).toHaveLength(1);
    }
  });
});

describe('repoNameFor', () => {
  it('builds a prefixed, dash-separated repo name from the seed', () => {
    expect(repoNameFor('tier1_issue_triage', '0123456789abcdef')).toBe('clivsmcp-tier1-issue-triage-01234567');
  });
});

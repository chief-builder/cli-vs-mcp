// All token-shaped strings in this file are fake test fixtures (see SECURITY.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../harness/src/log.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_FORMAT;
});

function capture(stream: NodeJS.WriteStream): string[] {
  const out: string[] = [];
  vi.spyOn(stream, 'write').mockImplementation(chunk => {
    out.push(String(chunk));
    return true;
  });
  return out;
}

describe('log', () => {
  it('writes human-readable lines with fields, info to stdout and errors to stderr', () => {
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);
    log.info('trial done', { turns: 3 });
    log.error('trial failed', { error: new Error('boom') });
    expect(stdout).toEqual(['trial done  turns=3\n']);
    expect(stderr).toEqual(['trial failed  error=boom\n']);
  });

  it('writes one JSON object per line when LOG_FORMAT=json', () => {
    process.env.LOG_FORMAT = 'json';
    const stderr = capture(process.stderr);
    log.warn('slow', { ms: 5 });
    const record = JSON.parse(stderr[0]!);
    expect(record).toMatchObject({ level: 'warn', msg: 'slow', ms: 5 });
    expect(typeof record.ts).toBe('string');
  });

  it('redacts tokens in messages and fields in both formats', () => {
    const stdout = capture(process.stdout);
    log.info('using ghp_abcdefghijklmnopqrstuvwxyz0123', { header: 'Authorization: token abc123' });
    process.env.LOG_FORMAT = 'json';
    log.info('x', { err: new Error('github_pat_11AAAAAAAAAAAAAAAAAAAAAA_bbbb failed') });
    const all = stdout.join('');
    expect(all).not.toMatch(/ghp_abc|abc123|github_pat_11/);
    expect(all).toContain('[REDACTED]');
  });
});

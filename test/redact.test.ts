import { describe, expect, it } from 'vitest';
import { isOutsideDir, OUTSIDE_READ_MARKER, redactHomePaths, redactTranscript } from '../harness/src/redact.js';

const HOME = '/Users/dev';
const WORK = '/private/var/folders/x/T/clivsmcp-playwright-baseline-tier1_scrape-abc';

const toLines = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n');
const read = (id: string, file_path: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path } }] },
});
const result = (id: string, content: string) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
  tool_use_result: { file: { content } },
});

describe('redactHomePaths', () => {
  it('replaces the home directory with ~', () => {
    expect(redactHomePaths('cwd /Users/dev/proj and /Users/dev', HOME)).toBe('cwd ~/proj and ~');
  });
  it('does not touch other users or longer names', () => {
    expect(redactHomePaths('/Users/devops/x /Users/other/y', HOME)).toBe('/Users/devops/x /Users/other/y');
  });
  it('is a no-op for an empty or root home', () => {
    expect(redactHomePaths('/x', '')).toBe('/x');
    expect(redactHomePaths('/x', '/')).toBe('/x');
  });
});

describe('isOutsideDir', () => {
  it('treats /private/var and /var as the same tree', () => {
    expect(isOutsideDir('/var/folders/x/T/clivsmcp-playwright-baseline-tier1_scrape-abc/out.json', WORK)).toBe(false);
  });
  it('flags home, absolute paths elsewhere, and sibling dirs with a shared prefix', () => {
    expect(isOutsideDir('~/.gitconfig', WORK)).toBe(true);
    expect(isOutsideDir('/Users/dev/.netrc', WORK)).toBe(true);
    expect(isOutsideDir(`${WORK}-other/x`, WORK)).toBe(true);
  });
  it('treats relative paths as inside', () => {
    expect(isOutsideDir('table.json', WORK)).toBe(false);
  });
});

describe('redactTranscript', () => {
  it('replaces results of reads outside the trial dir but keeps the call', () => {
    const raw = toLines(
      { type: 'system', subtype: 'init', cwd: WORK },
      read('t1', '/Users/dev/.gitconfig'),
      result('t1', 'email = someone@example.invalid'),
      read('t2', `${WORK}/table.json`),
      result('t2', '[1,2,3]'),
    );
    const out = redactTranscript(raw, HOME);
    expect(out).not.toContain('someone@example.invalid');
    expect(out).toContain(OUTSIDE_READ_MARKER);
    expect(out).toContain('"file_path":"~/.gitconfig"');
    expect(out).toContain('[1,2,3]');
    expect(out).not.toContain('/Users/dev');
  });

  it('uses an explicit work dir when given', () => {
    const raw = toLines(read('t1', '/elsewhere/secret'), result('t1', 'secret-data'));
    expect(redactTranscript(raw, HOME, WORK)).not.toContain('secret-data');
  });

  it('handles Glob with an absolute pattern and no path', () => {
    const raw = toLines(
      { type: 'system', subtype: 'init', cwd: WORK },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'g', name: 'Glob', input: { pattern: '/Users/dev/**/*.json' } }] },
      },
      result('g', '/Users/dev/private-project/a.json'),
    );
    expect(redactTranscript(raw, HOME)).not.toContain('private-project');
  });

  it('passes non-JSON and malformed lines through (with home paths redacted)', () => {
    expect(redactTranscript('plain /Users/dev/x\n{oops', HOME)).toBe('plain ~/x\n{oops');
  });
});

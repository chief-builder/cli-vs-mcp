import { describe, expect, it } from 'vitest';
import {
  hasShellAccountingSyntax,
  splitTopLevelShellSegments,
  standaloneWordPattern,
  stripSimpleRedirections,
} from '../harness/src/shell.js';
import { buildGitHubClassifier } from '../harness/src/experiments/github.js';
import { playwrightClassifier } from '../harness/src/experiments/playwright.js';

describe('splitTopLevelShellSegments', () => {
  it('splits on ; && || and |', () => {
    expect(splitTopLevelShellSegments('a; b && c || d | e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('keeps operators inside quotes and after escapes', () => {
    expect(splitTopLevelShellSegments(`gh issue list --search "a; b | c" && gh x 'y && z'`)).toEqual([
      'gh issue list --search "a; b | c"',
      "gh x 'y && z'",
    ]);
    expect(splitTopLevelShellSegments('echo a\\;b')).toEqual(['echo a\\;b']);
  });
  it('drops empty segments', () => {
    expect(splitTopLevelShellSegments(' ; ;; ')).toEqual([]);
  });
});

describe('redirection helpers', () => {
  it('strips simple redirections', () => {
    expect(stripSimpleRedirections('gh issue list > out.json 2>&1')).toBe('gh issue list');
    expect(stripSimpleRedirections('gh api x < "in file"')).toBe('gh api x');
  });
  it('counts redirections and chaining as accounting syntax', () => {
    expect(hasShellAccountingSyntax('gh issue list')).toBe(false);
    expect(hasShellAccountingSyntax('gh issue list > f')).toBe(true);
    expect(hasShellAccountingSyntax('gh a && gh b')).toBe(true);
  });
});

describe('standaloneWordPattern', () => {
  const re = standaloneWordPattern(['cat', 'jq']);
  it('matches standalone words', () => {
    expect(re.test('x cat file')).toBe(true);
    expect(re.test('jq .')).toBe(true);
  });
  it('ignores flags and paths that contain the word', () => {
    expect(re.test(' --jq .name')).toBe(false);
    expect(re.test(' open http://host/cat')).toBe(false);
    expect(re.test(' concat')).toBe(false);
  });
});

describe('GitHub classifier (read-only)', () => {
  const c = buildGitHubClassifier({ readOnly: true });
  const surface = (cmd: string) => c.classifyShellCommand(cmd).surfaceReason;

  it('accepts plain gh reads, including --jq and explicit GET with fields', () => {
    expect(surface('gh issue list --repo o/r --label bug --json number,title')).toBeNull();
    expect(surface('gh api repos/o/r --jq .description')).toBeNull();
    expect(surface('gh api -X GET repos/o/r/issues -f state=open')).toBeNull();
    expect(surface('gh pr view 1 && gh pr diff 1')).toBeNull();
  });

  it('rejects non-gh segments and helpers', () => {
    expect(surface('env | grep -i github')).toMatch(/non-gh Bash segment/);
    expect(surface('gh api repos/o/r/readme --jq .content | base64 -d')).toMatch(/non-gh/);
    expect(surface('gh api x | jq .a')).toMatch(/non-gh/);
    expect(surface('gh repo clone o/r && git log')).toMatch(/non-gh/);
  });

  it('rejects credential overrides and command substitution', () => {
    expect(surface('GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api repos/o/r/issues')).toMatch(/non-gh/);
    expect(surface('gh api -F "content=$(cat f)" x')).toMatch(/command substitution/);
    expect(surface('gh api `echo x`')).toMatch(/command substitution/);
  });

  it('rejects mutators and implicit POSTs in read-only mode', () => {
    expect(surface('gh issue edit 1 --add-label x')).toMatch(/read-only mode/);
    expect(surface('gh api -X POST repos/o/r/issues')).toMatch(/read-only mode/);
    expect(surface('gh api --method=PATCH repos/o/r')).toMatch(/read-only mode/);
    expect(surface('gh api repos/o/r/issues -f title=x')).toMatch(/implicit POST/);
  });

  it('treats redirection as a granularity issue, not a surface escape', () => {
    const r = c.classifyShellCommand('gh issue list > out.json');
    expect(r.surfaceReason).toBeNull();
    expect(r.granularityReason).toMatch(/multiple shell operations/);
  });

  it('rejects empty commands', () => {
    expect(surface('   ')).toBe('empty Bash command');
  });
});

describe('GitHub classifier (read-write)', () => {
  const c = buildGitHubClassifier({ readOnly: false });
  it('allows mutators', () => {
    expect(c.classifyShellCommand('gh issue edit 1 --add-label x').surfaceReason).toBeNull();
    expect(c.classifyShellCommand('gh api -X PUT repos/o/r/contents/f --input body.json').surfaceReason).toBeNull();
  });
  it('still rejects shell helpers', () => {
    expect(c.classifyShellCommand('NEW=$(cat f) gh api x').surfaceReason).not.toBeNull();
  });
});

describe('Playwright classifier', () => {
  const surface = (cmd: string) => playwrightClassifier.classifyShellCommand(cmd).surfaceReason;
  it('accepts playwright-cli commands, including words inside URLs and JS', () => {
    expect(surface('playwright-cli open http://localhost:1234/cat/index.html')).toBeNull();
    expect(surface('playwright-cli eval "document.cat"')).toBeNull();
    expect(surface('playwright-cli fill e3 "x" && playwright-cli click e4')).toBeNull();
  });
  it('rejects other binaries and helpers', () => {
    expect(surface('curl http://localhost')).toMatch(/non-playwright-cli/);
    expect(surface('playwright-cli --raw eval "x" | jq .')).toMatch(/non-playwright-cli/);
    expect(surface('playwright-cli snapshot | head -5')).toMatch(/non-playwright-cli/);
    expect(surface('playwright-cli eval "$(cat f)"')).toMatch(/non-playwright-cli/);
  });
  it('flags chained calls for research-single mode only', () => {
    const r = playwrightClassifier.classifyShellCommand('playwright-cli open x; playwright-cli snapshot');
    expect(r.surfaceReason).toBeNull();
    expect(r.granularityReason).not.toBeNull();
  });
});

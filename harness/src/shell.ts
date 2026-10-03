/**
 * Splits a Bash command into top-level segments by `;`, `&&`, `||`, and `|`.
 * Quoted regions and backslash-escapes are respected. Used by classifiers to
 * inspect each shell segment independently.
 */
export function splitTopLevelShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const next = command[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      continue;
    }

    if (ch === ';' || ch === '|') {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = '';
      if (ch === '|' && next === '|') i++;
      continue;
    }

    if (ch === '&' && next === '&') {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);
  return segments;
}

export function stripSimpleRedirections(segment: string): string {
  return segment
    .replace(/\s+\d?>{1,2}\s*(?:"[^"]*"|'[^']*'|\S+)/g, '')
    .replace(/\s+\d?<\s*(?:"[^"]*"|'[^']*'|\S+)/g, '')
    .trim();
}

export function hasShellAccountingSyntax(command: string): boolean {
  return splitTopLevelShellSegments(command).length !== 1 || /(^|\s)\d?[<>]/.test(command);
}

/**
 * Shell helpers that turn a CLI call into general-purpose scripting. A segment
 * that uses one is out of surface.
 */
export const SHELL_HELPERS = [
  'curl',
  'wget',
  'cat',
  'ls',
  'python',
  'python3',
  'node',
  'npm',
  'npx',
  'sh',
  'bash',
  'zsh',
  'jq',
  'sed',
  'awk',
  'grep',
  'head',
  'tail',
  'base64',
] as const;

/**
 * Builds a regex that matches any of `names` as a standalone shell word:
 * preceded by start-of-string or whitespace and followed by a word boundary.
 * The whitespace anchor keeps flag values and paths from matching, so
 * `gh api --jq .x` and `playwright-cli open http://x/cat` are fine.
 */
export function standaloneWordPattern(names: readonly string[]): RegExp {
  return new RegExp(`(?:^|\\s)(${names.join('|')})\\b`);
}

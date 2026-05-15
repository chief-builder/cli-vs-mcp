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

export function hasShellRedirection(command: string): boolean {
  return /(^|\s)\d?[<>]/.test(command);
}

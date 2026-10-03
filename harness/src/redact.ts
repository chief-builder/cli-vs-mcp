/**
 * Redaction applied to every artifact the harness writes, and available as a
 * one-off pass over existing runs (`pnpm harness redact-artifacts`).
 *
 * Two rules:
 *  1. The developer's home directory is replaced with `~` everywhere.
 *  2. A file-tool result (Read/Glob/Grep/LS) for a path outside the trial's
 *     working directory is replaced with a marker. The tool call itself, with
 *     its `~`-relative path, stays in the transcript, so the escape attempt
 *     is still visible and still classified.
 */

const FILE_READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);

export const OUTSIDE_READ_MARKER = '[redacted by harness: file-tool result for a path outside the trial directory]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces every occurrence of `homeDir` (as a path prefix) with `~`. */
export function redactHomePaths(text: string, homeDir: string): string {
  if (!homeDir || homeDir === '/') return text;
  const home = homeDir.replace(/\/+$/, '');
  return text.replace(new RegExp(`${escapeRegExp(home)}(?=/|\\b|$)`, 'g'), '~');
}

function stripPrivate(p: string): string {
  return p.startsWith('/private/') ? p.slice('/private'.length) : p;
}

/** True when `path` points outside `workDir`. Relative paths count as inside. */
export function isOutsideDir(path: string, workDir: string): boolean {
  if (path.startsWith('~')) return true;
  if (!path.startsWith('/')) return false;
  const p = stripPrivate(path).replace(/\/+$/, '');
  const w = stripPrivate(workDir).replace(/\/+$/, '');
  return !(p === w || p.startsWith(w + '/'));
}

function targetPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof i[key] === 'string' && i[key]) return i[key];
  }
  // Glob with an absolute pattern and no path.
  if (typeof i.pattern === 'string' && /^[~/]/.test(i.pattern)) return i.pattern;
  return undefined;
}

interface StreamLine {
  type?: string;
  subtype?: string;
  cwd?: string;
  message?: { content?: unknown };
  tool_use_result?: unknown;
}

/**
 * Redacts one stream-json transcript. `workDir` defaults to the `cwd` reported
 * by the transcript's `init` event, which is how existing runs are handled.
 */
export function redactTranscript(raw: string, homeDir: string, workDir?: string): string {
  const outsideIds = new Set<string>();
  let cwd = workDir;

  const lines = raw.split('\n').map(line => {
    if (!line.startsWith('{')) return line;
    let event: StreamLine;
    try {
      event = JSON.parse(line) as StreamLine;
    } catch {
      return line;
    }
    let changed = false;

    if (event.type === 'system' && event.subtype === 'init' && !cwd && typeof event.cwd === 'string') {
      cwd = event.cwd;
    }

    const content = event.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (event.type === 'assistant' && block.type === 'tool_use' && FILE_READ_TOOLS.has(String(block.name))) {
          const p = targetPath(block.input);
          if (p && cwd && isOutsideDir(p, cwd)) outsideIds.add(String(block.id));
        }
        if (event.type === 'user' && block.type === 'tool_result' && outsideIds.has(String(block.tool_use_id))) {
          block.content = OUTSIDE_READ_MARKER;
          if ('tool_use_result' in event) delete event.tool_use_result;
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(event) : line;
  });

  return redactHomePaths(lines.join('\n'), homeDir);
}

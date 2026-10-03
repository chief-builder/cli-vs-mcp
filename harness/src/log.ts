/**
 * Minimal logger. Human-readable lines by default; one JSON object per line
 * when LOG_FORMAT=json. Every string value passes through `redactSecrets`
 * so a token that ends up in an error message never reaches the log.
 */

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const TOKEN_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /(Authorization:\s*(?:Bearer|token)\s+)\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of TOKEN_PATTERNS) {
    out = out.replace(re, (match, prefix: unknown) =>
      typeof prefix === 'string' ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  return out;
}

function clean(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value instanceof Error) return redactSecrets(value.message);
  return value;
}

function write(level: Level, msg: string, fields: Fields = {}): void {
  const stream = level === 'info' ? process.stdout : process.stderr;
  if (process.env.LOG_FORMAT === 'json') {
    const record: Fields = { ts: new Date().toISOString(), level, msg: redactSecrets(msg) };
    for (const [k, v] of Object.entries(fields)) record[k] = clean(v);
    stream.write(JSON.stringify(record) + '\n');
    return;
  }
  const extras = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(clean(v))}`)
    .join(' ');
  stream.write(redactSecrets(msg) + (extras ? `  ${extras}` : '') + '\n');
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

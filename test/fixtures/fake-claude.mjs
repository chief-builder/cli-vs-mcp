#!/usr/bin/env node
// Stand-in for the `claude` CLI in integration tests. Behaviour is chosen by
// FAKE_CLAUDE_MODE: "scrape" solves tier1_scrape over HTTP, "hang" never exits.
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const out = e => process.stdout.write(JSON.stringify(e) + '\n');

// Record what the child could see: argv and every GH_/GITHUB_ variable name.
writeFileSync(
  join(process.cwd(), 'child-env.json'),
  JSON.stringify({
    args,
    ghVars: Object.keys(process.env).filter(k => /^(GH|GITHUB)_/.test(k)),
    ghConfigDir: process.env.GH_CONFIG_DIR,
  }),
);

out({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read', 'Write'], mcp_servers: [] });

if (process.env.FAKE_CLAUDE_MODE === 'hang') {
  out({
    type: 'assistant',
    message: {
      id: 'm1',
      content: [{ type: 'text', text: 'thinking' }],
      usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 },
    },
  });
  setInterval(() => {}, 1000);
} else {
  const url = /(http:\/\/\S+\/scrape\/article\.html)/.exec(prompt)[1];
  const target = /(\S+\/table\.json)/.exec(prompt)[1];
  const html = await (await fetch(url)).text();
  const rows = [...html.matchAll(/<tr><td>(\d+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>(\d+)<\/td><\/tr>/g)].map(
    m => ({
      rank: Number(m[1]),
      city: m[2],
      country: m[3],
      population: Number(m[4]),
    }),
  );
  writeFileSync(target, JSON.stringify(rows));

  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
  out({
    type: 'assistant',
    message: {
      id: 'm1',
      content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: join(homedir(), '.gitconfig') } }],
      usage,
    },
  });
  out({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'email = private@example.invalid' }] },
    tool_use_result: { file: { content: 'email = private@example.invalid' } },
  });
  out({
    type: 'assistant',
    message: {
      id: 'm2',
      content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: target, content: '[]' } }],
      usage,
    },
  });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: `wrote ${target}` }] } });
  out({
    type: 'result',
    subtype: 'success',
    duration_ms: 1234,
    num_turns: 2,
    total_cost_usd: 0.01,
    modelUsage: {
      'claude-test': {
        inputTokens: 10,
        outputTokens: 40,
        cacheReadInputTokens: 2000,
        cacheCreationInputTokens: 100,
        costUSD: 0.01,
      },
    },
  });
}

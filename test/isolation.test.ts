// All token-shaped strings in this file are fake test fixtures (see SECURITY.md).
import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { buildChildEnv, buildClaudeArgs, buildTrialSettings } from '../harness/src/runner.js';
import { buildGithubAgentEnv, githubExperiment } from '../harness/src/experiments/github.js';
import { playwrightExperiment } from '../harness/src/experiments/playwright.js';
import { loadGithubConfig } from '../harness/src/config.js';
import { redactSecrets } from '../harness/src/log.js';

const SECRET_ENV = {
  PATH: process.env.PATH,
  HOME: '/home/dev',
  GITHUB_CONTROLLER_TOKEN: 'controller-secret',
  GITHUB_AGENT_TOKEN: 'agent-secret',
  GH_TOKEN: 'personal-pat',
  GITHUB_TOKEN: 'personal-pat-2',
  GH_HOST: 'evil.example',
  GH_CONFIG_DIR: '/home/dev/.config/gh',
  GITHUB_SOMETHING_NEW: 'x',
  UNRELATED: 'keep-me',
};

describe('buildChildEnv', () => {
  it('removes every inherited GH_* and GITHUB_* variable', () => {
    const env = buildChildEnv(undefined, {}, '/tmp/empty-gh', SECRET_ENV);
    const ghKeys = Object.keys(env).filter(k => /^(GH|GITHUB)_/.test(k));
    expect(ghKeys.sort()).toEqual(['GH_CONFIG_DIR', 'GH_NO_UPDATE_NOTIFIER', 'GH_PAGER', 'GH_PROMPT_DISABLED']);
    expect(JSON.stringify(env)).not.toMatch(/secret|personal-pat|evil\.example/);
    expect(env.UNRELATED).toBe('keep-me');
  });

  it('points gh at the per-trial config dir, not the developer login', () => {
    expect(buildChildEnv(undefined, {}, '/tmp/empty-gh', SECRET_ENV).GH_CONFIG_DIR).toBe('/tmp/empty-gh');
  });

  it('puts the arm env and agent token back after the scrub', () => {
    const env = buildChildEnv({ GITHUB_TOOLSETS: 'repos' }, { GH_TOKEN: 'agent' }, '/tmp/g', SECRET_ENV);
    expect(env.GITHUB_TOOLSETS).toBe('repos');
    expect(env.GH_TOKEN).toBe('agent');
    expect(env.GITHUB_CONTROLLER_TOKEN).toBeUndefined();
  });

  it('really hides scrubbed variables from a child process', async () => {
    // execa merges process.env unless extendEnv is false; this is the bug that
    // let the controller token survive the original scrub.
    process.env.GITHUB_CONTROLLER_TOKEN_TEST_PROBE = 'leak';
    try {
      const env = buildChildEnv(undefined, {}, '/tmp/g');
      const r = await execa('node', ['-e', 'console.log(process.env.GITHUB_CONTROLLER_TOKEN_TEST_PROBE ?? "absent")'], {
        env,
        extendEnv: false,
      });
      expect(r.stdout).toBe('absent');
    } finally {
      delete process.env.GITHUB_CONTROLLER_TOKEN_TEST_PROBE;
    }
  });
});

describe('buildGithubAgentEnv', () => {
  const env = { GITHUB_AGENT_TOKEN: 'agent', GITHUB_CONTROLLER_TOKEN: 'controller', GITHUB_HOST: 'ghe.example' };
  it('gives baseline nothing', () => {
    expect(buildGithubAgentEnv('baseline', env)).toEqual({});
  });
  it('gives the skill arm the agent token under gh keys', () => {
    expect(buildGithubAgentEnv('skill', env)).toEqual({
      GH_TOKEN: 'agent',
      GITHUB_TOKEN: 'agent',
      GH_HOST: 'ghe.example',
    });
  });
  it('gives the mcp arm the agent token under the server key', () => {
    expect(buildGithubAgentEnv('mcp', env)).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: 'agent',
      GITHUB_HOST: 'ghe.example',
    });
  });
  it('never forwards the controller token', () => {
    for (const arm of ['baseline', 'skill', 'mcp'] as const) {
      expect(Object.values(buildGithubAgentEnv(arm, env))).not.toContain('controller');
    }
  });
});

describe('buildClaudeArgs / buildTrialSettings', () => {
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

  it('passes the positive tool list and blocks out-of-band tools', () => {
    const args = buildClaudeArgs(playwrightExperiment.arms.mcp, 'p', 'm', '/repo');
    expect(flag(args, '--tools')).toBe('Write,ToolSearch,TodoWrite');
    expect(flag(args, '--disallowed-tools')).toContain('WebFetch');
    expect(flag(args, '--mcp-config')).toBe('/repo/.mcp.playwright.json');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--allowed-tools');
  });

  it('denies file-tool access to the home directory and the repo', () => {
    const s = buildTrialSettings(playwrightExperiment.arms.baseline, '/work/repo') as {
      permissions: { deny: string[] };
    };
    expect(s.permissions.deny).toEqual(
      expect.arrayContaining(['Read(~/**)', 'Edit(~/**)', 'Read(//work/repo/**)', 'Edit(//work/repo/**)']),
    );
  });

  it('sandboxes Bash for the GitHub skill arm with no unsandboxed fallback', () => {
    const s = buildTrialSettings(githubExperiment.arms.skill, '/r') as { sandbox: Record<string, unknown> };
    expect(s.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: ['~/'] },
      network: { allowedDomains: ['api.github.com', 'github.com'] },
    });
  });

  it('does not sandbox arms without a network list', () => {
    expect(buildTrialSettings(playwrightExperiment.arms.skill, '/r')).not.toHaveProperty('sandbox');
  });

  it('never puts token values on the command line', () => {
    const prev = process.env.GITHUB_AGENT_TOKEN;
    process.env.GITHUB_AGENT_TOKEN = 'ghp_shouldnotappear000000000000000';
    try {
      for (const arm of ['baseline', 'skill', 'mcp'] as const) {
        expect(buildClaudeArgs(githubExperiment.arms[arm], 'p', 'm', '/r').join(' ')).not.toContain('ghp_');
      }
    } finally {
      if (prev === undefined) delete process.env.GITHUB_AGENT_TOKEN;
      else process.env.GITHUB_AGENT_TOKEN = prev;
    }
  });
});

describe('loadGithubConfig', () => {
  const good = { GITHUB_AGENT_TOKEN: 'a', GITHUB_CONTROLLER_TOKEN: 'c', GITHUB_SANDBOX_OWNER: 'my-lab' };

  it('accepts a complete config and defaults the API host', () => {
    expect(loadGithubConfig(good)).toEqual({
      agentToken: 'a',
      controllerToken: 'c',
      sandboxOwner: 'my-lab',
      apiHost: 'api.github.com',
      agentHost: undefined,
    });
    expect(loadGithubConfig({ ...good, GITHUB_HOST: 'ghe.example.com' }).apiHost).toBe('ghe.example.com');
  });

  it('lists every missing variable', () => {
    expect(() => loadGithubConfig({})).toThrow(
      /GITHUB_AGENT_TOKEN[\s\S]*GITHUB_CONTROLLER_TOKEN[\s\S]*GITHUB_SANDBOX_OWNER/,
    );
  });

  it('rejects malformed owner and host values', () => {
    expect(() => loadGithubConfig({ ...good, GITHUB_SANDBOX_OWNER: '../etc' })).toThrow(/GITHUB_SANDBOX_OWNER/);
    expect(() => loadGithubConfig({ ...good, GITHUB_HOST: 'https://x/y' })).toThrow(/GITHUB_HOST/);
  });

  it('never echoes token values in errors', () => {
    try {
      loadGithubConfig({ GITHUB_AGENT_TOKEN: 'ghp_topsecretvalue', GITHUB_SANDBOX_OWNER: 'bad owner' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('topsecretvalue');
    }
  });
});

describe('redactSecrets', () => {
  it('redacts GitHub and Anthropic tokens and auth headers', () => {
    const text =
      'a ghp_abcdefghijklmnopqrstuvwxyz0123 b github_pat_11ABCDEFGHIJKLMNOPQRSTUV_xyz c sk-ant-api03-abcdefghijklmnopqrstu Authorization: Bearer abc.def';
    const out = redactSecrets(text);
    expect(out).not.toMatch(/ghp_a|github_pat_1|sk-ant-api|abc\.def/);
    expect(out).toContain('Authorization: Bearer [REDACTED]');
  });
  it('leaves ordinary text alone', () => {
    expect(redactSecrets('gh issue list --json number')).toBe('gh issue list --json number');
  });
});

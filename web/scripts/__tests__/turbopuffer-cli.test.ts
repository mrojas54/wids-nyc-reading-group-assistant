import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = resolve(import.meta.dirname, '../..');
function run(args: string[], apiKey = '') {
  return spawnSync(process.execPath, ['--experimental-strip-types', '--conditions=react-server',
    'scripts/turbopuffer.mts', ...args], {
    cwd: web, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, TURBOPUFFER_API_KEY: apiKey, TURBOPUFFER_REGION: 'gcp-us-central1',
      TURBOPUFFER_NAMESPACE_PREFIX: 'paperpal-local-cli-test', TURBOPUFFER_EMBEDDING_MODEL: 'nvidia/nemotron-3-embed-8b',
      TURBOPUFFER_EMBEDDING_DIMENSIONS: '1024' },
  });
}

describe('local Turbopuffer command entrypoint', () => {
  it('provides help without credentials', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('prepare <paper-id>');
  });
  it('fails doctor when credentials are missing', () => {
    const result = run(['doctor']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TURBOPUFFER_API_KEY');
  });
  it('checks configuration without contacting the service or printing the key', () => {
    const result = run(['doctor'], 'fake-offline-secret');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).apiKey).toBe('present (not verified)');
    expect(result.stdout + result.stderr).not.toContain('fake-offline-secret');
  });
  it('rejects unresolved 1Password references', () => {
    const result = run(['doctor'], 'op://Example/Item/key');
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('op://');
  });
  it('keeps the retrieval module server-only', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      "import './lib/paperpal/retrieval/turbopuffer.mts'"], { cwd: web, encoding: 'utf8', timeout: 10_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Client Component');
  });
});

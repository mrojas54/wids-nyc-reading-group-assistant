import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = resolve(import.meta.dirname, '../..');
function run(args: string[], overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--conditions=react-server', 'scripts/paperpal-search.mts', ...args], {
    cwd: web, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PAPERPAL_RETRIEVAL_BACKEND: 'supabase',
      PAPERPAL_SUPABASE_URL: 'http://127.0.0.1:54321', PAPERPAL_SUPABASE_KEY: 'fake-offline-secret',
      PAPERPAL_SUPABASE_ACCESS_TOKEN: 'fake-member-token', PAPERPAL_SUPABASE_SERVICE_ROLE_KEY: '', ...overrides },
  });
}

describe('Paper Pal search command', () => {
  it('provides help without credentials', () => {
    const result = run(['--help'], { PAPERPAL_SUPABASE_KEY: '' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Defaults to Supabase');
  });
  it('checks Supabase configuration offline without printing credentials', () => {
    const result = run(['doctor']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ backend: 'supabase', credentials: { search: 'present (not verified)' } });
    expect(result.stdout + result.stderr).not.toContain('fake-offline-secret');
    expect(result.stdout + result.stderr).not.toContain('fake-member-token');
  });
  it('refuses search without a member token instead of falling back to a key', () => {
    for (const token of ['', 'fake-offline-secret', 'sb_secret_fake']) {
      const result = run(['doctor'], { PAPERPAL_SUPABASE_ACCESS_TOKEN: token });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('fake-offline-secret');
    }
    const searched = run(['search', 'nonexistent.json', 'Why?'], { PAPERPAL_SUPABASE_ACCESS_TOKEN: '',
      PAPERPAL_SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' });
    expect(searched.status).toBe(1);
    expect(searched.stderr).toContain('PAPERPAL_SUPABASE_ACCESS_TOKEN');
  });
  it('keeps ingestion on its own service-role key', () => {
    const result = run(['doctor'], { PAPERPAL_SUPABASE_ACCESS_TOKEN: '', PAPERPAL_SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).credentials.index).toBe('present (not verified)');
    expect(result.stdout).not.toContain('fake-service-key');
  });
  it('requires explicit remote indexing before reading the input or loading a model', () => {
    const result = run(['index', 'nonexistent.json'], { PAPERPAL_SUPABASE_URL: 'https://example.supabase.co' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Remote indexing requires --allow-remote');
  });
  it('retains explicit Turbopuffer selection', () => {
    const result = run(['doctor'], { PAPERPAL_RETRIEVAL_BACKEND: 'turbopuffer',
      TURBOPUFFER_API_KEY: 'fake-offline-secret', TURBOPUFFER_REGION: 'gcp-us-central1',
      TURBOPUFFER_NAMESPACE_PREFIX: 'paperpal-cli-test', TURBOPUFFER_EMBEDDING_MODEL: 'nvidia/nemotron-3-embed-8b',
      TURBOPUFFER_EMBEDDING_DIMENSIONS: '1024' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).backend).toBe('turbopuffer');
    expect(result.stdout + result.stderr).not.toContain('fake-offline-secret');
  });
});

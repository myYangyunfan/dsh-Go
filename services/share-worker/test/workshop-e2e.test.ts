import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DART_TEST, dartResultObserver, diagnosticLines, localConfig, localEnvironment,
  loopbackOrigin, parseJsonc } from '../scripts/workshop-e2e-support.mjs';

const worker = fileURLToPath(new URL('..', import.meta.url));
const config = () => parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

describe('local rehearsal configuration and result boundaries', () => {
  it('retains URL strings while removing JSONC comments and trailing commas', () => {
    expect(parseJsonc('{ "url": "https://127.0.0.1:1234/", // local\n"items": [1,],}'))
      .toEqual({ url: 'https://127.0.0.1:1234/', items: [1] });
  });

  it('accepts only an explicit numeric loopback HTTPS origin', () => {
    expect(loopbackOrigin('https://127.0.0.1:1234/')).toBe('https://127.0.0.1:1234');
    for (const value of ['http://127.0.0.1:1234', 'https://example.org:1234', 'https://127.0.0.1:1234/path']) {
      expect(() => loopbackOrigin(value)).toThrow('expected_numeric_loopback_https_origin');
    }
  });

  it('uses isolated local bindings and does not change the production configuration', () => {
    const original = config(), before = JSON.stringify(original);
    const local = localConfig(worker, original, 'https://127.0.0.1:1234', { uploads: false, companion: true, port: 1235 });
    expect(JSON.stringify(original)).toBe(before);
    expect(local).not.toHaveProperty('account_id');
    expect(local).not.toHaveProperty('routes');
    expect(local).not.toHaveProperty('triggers');
    expect(local).not.toHaveProperty('analytics_engine_datasets');
    expect(local).not.toHaveProperty('build');
    expect(local.vars).toMatchObject({ WORKSHOP_FORUM_URL: 'https://127.0.0.1:1234', WORKSHOP_UPLOAD_ENABLED: '0', WORKSHOP_COMPANION_ENABLED: '1', DL_BASE_URL: '', CN_BASE_URL: '' });
    expect(local.dev).toMatchObject({ ip: '127.0.0.1', port: 1235, local_protocol: 'https', inspector_port: 0 });
    expect(local.r2_buckets.every(bucket => bucket.remote === false && bucket.bucket_name.startsWith('local-'))).toBe(true);
    expect(local.kv_namespaces.every(namespace => namespace.remote === false && namespace.id === '0'.repeat(32))).toBe(true);
    expect(local.ratelimits.every(limit => limit.simple.limit === 1000)).toBe(true);
    expect(original.ratelimits.find(limit => limit.name === 'UPLOAD_BURST').simple.limit).toBe(5);
    expect(local.assets.run_worker_first).toContain('/workshop/admin');
  });

  it('does not inherit real credentials, proxies, Node hooks, or Wrangler telemetry settings', () => {
    const parent = { PATH: '/tools', ADMIN_KEY: 'parent-admin', USER_API_KEY: 'parent-user',
      CLOUDFLARE_API_TOKEN: 'parent-cloud', CF_ACCOUNT_ID: 'parent-account', WRANGLER_WRITE_LOGS: 'true',
      GITHUB_TOKEN: 'parent-github', HTTPS_PROXY: 'http://proxy.invalid', NODE_OPTIONS: '--require arbitrary',
      NODE_TLS_REJECT_UNAUTHORIZED: '0', DSH_WORKSHOP_E2E_ORIGIN: 'https://example.org' };
    const child = localEnvironment(parent, { NODE_EXTRA_CA_CERTS: '/local/test-ca.pem' });
    for (const key of ['ADMIN_KEY', 'USER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CF_ACCOUNT_ID', 'GITHUB_TOKEN', 'HTTPS_PROXY', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'DSH_WORKSHOP_E2E_ORIGIN']) {
      expect(child).not.toHaveProperty(key);
    }
    expect(child).toMatchObject({ PATH: '/tools', NODE_EXTRA_CA_CERTS: '/local/test-ca.pem',
      WRANGLER_HIDE_BANNER: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false',
      CLOUDFLARE_CF_FETCH_ENABLED: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' });
    expect(parent.ADMIN_KEY).toBe('parent-admin');
  });

  it('redacts a synthetic key split across output chunks before exposing the line', () => {
    const seen: string[] = [], output = diagnosticLines(['synthetic-private-value'], line => seen.push(line));
    output.write('message synthetic-pri');
    expect(seen).toEqual([]);
    output.write('vate-value done\nsecond synthetic-private-value'); output.end();
    expect(seen).toEqual(['message [REDACTED] done', 'second [REDACTED]']);
    expect(output.summary()).not.toContain('synthetic-private-value');
  });

  it('omits an oversized diagnostic whole and keeps later complete lines', () => {
    const output = diagnosticLines(['synthetic-secret']);
    output.write('x'.repeat(16380) + 'synthetic-'); output.write('secret\nready\n'); output.end();
    expect(output.summary()).toBe('[oversized diagnostic line omitted]\nready');
  });

  it('requires the named Dart test and the complete run to pass', () => {
    const observer = dartResultObserver();
    observer.line(JSON.stringify({ type: 'testStart', test: { id: 7, name: DART_TEST } }));
    observer.line(JSON.stringify({ type: 'testDone', testID: 7, result: 'success', skipped: false }));
    expect(observer.passed()).toBe(false);
    observer.line(JSON.stringify({ type: 'done', success: true }));
    expect(observer.passed()).toBe(true);
  });

  it('does not count a skipped Dart test as an HTTP pass', () => {
    const observer = dartResultObserver();
    observer.line(JSON.stringify({ type: 'testStart', test: { id: 7, name: DART_TEST } }));
    observer.line(JSON.stringify({ type: 'testDone', testID: 7, result: 'success', skipped: true }));
    observer.line(JSON.stringify({ type: 'done', success: true }));
    expect(observer.passed()).toBe(false);
  });

  it('does not accept another test or a failed run as the required Dart result', () => {
    for (const [name, success] of [['some other test', true], [DART_TEST, false]] as const) {
      const observer = dartResultObserver();
      observer.line(JSON.stringify({ type: 'testStart', test: { id: 7, name } }));
      observer.line(JSON.stringify({ type: 'testDone', testID: 7, result: 'success', skipped: false }));
      observer.line(JSON.stringify({ type: 'done', success }));
      expect(observer.passed()).toBe(false);
    }
  });

  it('uses the matching public test key and a certificate limited to loopback', () => {
    const certificate = new X509Certificate(readFileSync(new URL('./fixtures/workshop-local-tls/localhost-cert.pem', import.meta.url)));
    const key = createPrivateKey(readFileSync(new URL('./fixtures/workshop-local-tls/localhost-key.pem', import.meta.url)));
    expect(certificate.checkPrivateKey(key)).toBe(true);
    expect(certificate.ca).toBe(true);
    expect(certificate.subjectAltName).toBe('IP Address:127.0.0.1');
    expect(certificate.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(certificate.checkHost('example.org')).toBeUndefined();
  });
});

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadProxyRoute, parseOptions, publicBootstrapTargets, runBootstrap, sanitizeError } = require('../live-http-only.cjs');

describe('CycleTLS live HTTP-only options', () => {
  it('requires an explicit KiotProxy route file for public bootstrap', () => {
    expect(parseOptions(['--bootstrap', '--proxy-file=fixtures/kiot-route.json'])).toEqual({
      mode: 'bootstrap', proxyPath: 'fixtures/kiot-route.json'
    });
    expect(() => parseOptions(['--bootstrap'])).toThrow('HTTP_ONLY_PROXY_FILE_REQUIRED');
    expect(publicBootstrapTargets).toEqual([
      { label: 'baseline-1', url: 'https://capcut.com/' },
      { label: 'baseline-2', url: 'https://www.capcut.com/' },
      { label: 'baseline-81', url: 'https://www.capcut.com/login-embed' }
    ]);
  });

  it('keeps the existing session-ledger path explicit and rejects ambiguous modes', () => {
    expect(parseOptions(['--session=fixtures/session.json'])).toEqual({ mode: 'session', materialPath: 'fixtures/session.json' });
    expect(() => parseOptions([])).toThrow('HTTP_ONLY_SESSION_REQUIRED');
    expect(() => parseOptions(['--bootstrap', '--session=fixtures/session.json'])).toThrow('HTTP_ONLY_MODE_AMBIGUOUS');
    expect(() => parseOptions(['--session=fixtures/session.json', '--proxy-file=fixtures/kiot-route.json'])).toThrow('HTTP_ONLY_MODE_AMBIGUOUS');
    expect(() => parseOptions(['--bootstrap', '--bootstrap'])).toThrow('HTTP_ONLY_OPTION_DUPLICATE');
    expect(() => parseOptions(['--bootstrap', '--proxy-file=a.json', '--proxy-file=b.json'])).toThrow('HTTP_ONLY_OPTION_DUPLICATE');
    expect(() => parseOptions(['--session=a.json', '--session=b.json'])).toThrow('HTTP_ONLY_OPTION_DUPLICATE');
    expect(() => parseOptions(['--bootstrap', '--url=https://other.test/'])).toThrow('HTTP_ONLY_OPTION_UNKNOWN');
  });

  it('accepts only the strict KiotProxy route schema without CLI credentials', () => {
    const read = value => () => JSON.stringify(value);
    expect(loadProxyRoute('route.json', read({
      provider: 'kiotproxy', proxy: { server: 'http://proxy.example:8080', username: 'user', password: 'pass' }
    }))).toEqual({ provider: 'kiotproxy', proxy: { server: 'http://proxy.example:8080', username: 'user', password: 'pass' } });
    expect(() => loadProxyRoute('route.json', read({ provider: 'other', proxy: { server: 'http://proxy.example:8080' } }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
    expect(() => loadProxyRoute('route.json', read({ provider: 'kiotproxy', proxy: { server: 'http://user:pass@proxy.example:8080' } }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
    expect(() => loadProxyRoute('route.json', read({ provider: 'kiotproxy', proxy: { server: 'http://proxy.example:8080' }, bypass: true }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
    expect(() => parseOptions(['--bootstrap', '--proxy=http://user:pass@proxy.example:8080'])).toThrow('HTTP_ONLY_OPTION_UNKNOWN');
  });

  it('rejects dirty proxy endpoints and credential control characters before native init', () => {
    const route = proxy => () => JSON.stringify({ provider: 'kiotproxy', proxy });
    for (const server of [
      'http://proxy.example:8080/nonroot',
      'http://proxy.example:8080/?route=direct',
      'http://proxy.example:8080/#fragment',
      'http://proxy.example:8080/%0d%0aheader',
      'http://proxy.example:8080/%00'
    ]) {
      expect(() => loadProxyRoute('route.json', route({ server }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
    }
    expect(loadProxyRoute('route.json', route({ server: 'socks5://proxy.example:1080/' }))).toEqual({
      provider: 'kiotproxy', proxy: { server: 'socks5://proxy.example:1080/' }
    });
    expect(() => loadProxyRoute('route.json', route({ server: 'http://proxy.example:8080', username: 'user\rname' }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
    expect(() => loadProxyRoute('route.json', route({ server: 'http://proxy.example:8080', password: 'pass\0word' }))).toThrow('HTTP_ONLY_PROXY_ROUTE_INVALID');
  });

  it('rejects malformed boolean and empty value option forms', () => {
    expect(() => parseOptions(['--bootstrap=true', '--proxy-file=route.json'])).toThrow('HTTP_ONLY_OPTION_UNKNOWN');
    expect(() => parseOptions(['--bootstrap', '--proxy-file='])).toThrow('HTTP_ONLY_PROXY_FILE_REQUIRED');
    expect(() => parseOptions(['--session='])).toThrow('HTTP_ONLY_SESSION_REQUIRED');
  });

  it('passes the file-backed proxy to native context and reports no route credentials', async () => {
    const proxy = { server: 'http://proxy.example:8080', username: 'user', password: 'pass' };
    const contextOptions = [];
    let output = '';
    const response = {
      status: () => 200,
      ok: () => true,
      headers: () => ({ 'content-type': 'text/html' }),
      body: async () => Buffer.from('ok'),
      dispose: async () => undefined
    };
    await runBootstrap('route.json', {
      readFile: () => JSON.stringify({ provider: 'kiotproxy', proxy }),
      createContext: async options => {
        contextOptions.push(options);
        return { transport: 'cycletls', get: async () => response, dispose: async () => undefined };
      },
      write: value => { output += value; }
    });
    expect(contextOptions).toEqual([{ proxy }]);
    expect(JSON.parse(output)).toMatchObject({ mechanism: 'cycletls', proxyProvider: 'kiotproxy', browserLaunched: false });
    expect(output).not.toContain('proxy.example');
    expect(output).not.toContain('user');
    expect(output).not.toContain('pass');
  });

  it('never exposes an arbitrary exception message in CLI output', () => {
    expect(sanitizeError(new Error('failed token=synthetic-secret'))).toBe('HTTP_ONLY_FAILED');
    expect(sanitizeError(new Error('HTTP_ONLY_MODE_AMBIGUOUS'))).toBe('HTTP_ONLY_MODE_AMBIGUOUS');
    expect(sanitizeError(new Error('HTTP_ONLY_PROXY_ROUTE_INVALID secret'))).toBe('HTTP_ONLY_FAILED');
    expect(sanitizeError(new Error('HTTP_ONLY_PROXY_FILE_REQUIRED'))).toBe('HTTP_ONLY_PROXY_FILE_REQUIRED');
  });
});

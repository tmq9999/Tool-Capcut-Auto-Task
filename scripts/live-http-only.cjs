// CycleTLS-only health/verification harness. It never starts Electron or a browser.
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');
const { createHttpOnlySession } = require('../src/main/services/capcut/http/httpSessionFactory.ts');
const { createHttpOnlyTransport } = require('../src/main/services/capcut/http/httpOnlyTransport.ts');
const { CapcutHttpTaskApi } = require('../src/main/services/capcut/http/taskApi.ts');

const publicBootstrapTargets = Object.freeze([
  Object.freeze({ label: 'baseline-1', url: 'https://capcut.com/' }),
  Object.freeze({ label: 'baseline-2', url: 'https://www.capcut.com/' }),
  Object.freeze({ label: 'baseline-81', url: 'https://www.capcut.com/login-embed' })
]);

function readArg(args, name) {
  const value = args.find(arg => arg.startsWith(`--${name}=`));
  return value?.slice(name.length + 3);
}

function parseOptions(args) {
  const supported = new Set(['--bootstrap', '--proxy-file']);
  const seen = new Set();
  for (const arg of args) {
    const key = arg.startsWith('--session=') ? '--session' : arg.split('=')[0];
    if (seen.has(key)) throw new Error('HTTP_ONLY_OPTION_DUPLICATE');
    seen.add(key);
    if (!supported.has(key) && key !== '--session') throw new Error('HTTP_ONLY_OPTION_UNKNOWN');
    if (key === '--bootstrap' && arg !== '--bootstrap') throw new Error('HTTP_ONLY_OPTION_UNKNOWN');
    if (key === '--proxy-file' && !arg.startsWith('--proxy-file=')) throw new Error('HTTP_ONLY_OPTION_UNKNOWN');
    if (key === '--session' && !arg.startsWith('--session=')) throw new Error('HTTP_ONLY_OPTION_UNKNOWN');
  }
  const bootstrap = args.includes('--bootstrap');
  const materialPath = readArg(args, 'session');
  const proxyPath = readArg(args, 'proxy-file');
  if (bootstrap && materialPath) throw new Error('HTTP_ONLY_MODE_AMBIGUOUS');
  if (materialPath && proxyPath) throw new Error('HTTP_ONLY_MODE_AMBIGUOUS');
  if (bootstrap && !proxyPath) throw new Error('HTTP_ONLY_PROXY_FILE_REQUIRED');
  if (bootstrap) return { mode: 'bootstrap', proxyPath };
  if (proxyPath) throw new Error('HTTP_ONLY_MODE_AMBIGUOUS');
  if (!materialPath) throw new Error('HTTP_ONLY_SESSION_REQUIRED');
  return { mode: 'session', materialPath };
}

function loadProxyRoute(proxyPath, readFile = fs.readFileSync) {
  try {
    const route = JSON.parse(readFile(path.resolve(proxyPath), 'utf8'));
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error();
    if (Object.keys(route).sort().join(',') !== 'provider,proxy' || route.provider !== 'kiotproxy') throw new Error();
    const proxy = route.proxy;
    if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) throw new Error();
    const keys = Object.keys(proxy);
    if (keys.some(key => !['server', 'username', 'password'].includes(key))) throw new Error();
    if (typeof proxy.server !== 'string' || !proxy.server || proxy.server !== proxy.server.trim() || /[\u0000-\u001f\u007f]/.test(proxy.server)) throw new Error();
    const server = new URL(proxy.server);
    if (!['http:', 'https:', 'socks5:'].includes(server.protocol) || !server.hostname || server.username || server.password) throw new Error();
    if (!['', '/'].includes(server.pathname) || server.search || server.hash) throw new Error();
    for (const key of ['username', 'password']) {
      if (key in proxy && (typeof proxy[key] !== 'string' || !proxy[key] || /[\u0000-\u001f\u007f]/.test(proxy[key]))) throw new Error();
    }
    return route;
  } catch {
    throw new Error('HTTP_ONLY_PROXY_ROUTE_INVALID');
  }
}

async function runBootstrap(proxyPath, dependencies = {}) {
  const route = loadProxyRoute(proxyPath, dependencies.readFile);
  const createContext = dependencies.createContext ?? createCycleTlsContext;
  const write = dependencies.write ?? (value => process.stdout.write(value));
  const context = await createContext({ proxy: route.proxy });
  let report;
  try {
    const requests = [];
    for (const target of publicBootstrapTargets) {
      const response = await context.get(target.url, {
        timeout: 30_000,
        maxBytes: 1024 * 1024,
        maxRedirects: 0,
        maxRetries: 0
      });
      try {
        const body = await response.body();
        requests.push({
          target: target.label,
          status: response.status(),
          ok: response.ok(),
          contentType: response.headers()['content-type'] ?? null,
          bytes: body.byteLength
        });
      } finally {
        await response.dispose();
      }
    }
    report = {
      mode: 'public-bootstrap',
      mechanism: context.transport,
      proxyProvider: route.provider,
      browserLaunched: false,
      requests,
      at: new Date().toISOString()
    };
  } finally {
    await context.dispose();
  }
  write(JSON.stringify(report) + '\n');
}

async function runSession(materialPath) {
  const absolute = path.resolve(materialPath);
  const material = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!material.accountId || !material.proxy || !material.headers) throw new Error('HTTP_ONLY_SESSION_INVALID');
  const live = await createHttpOnlySession(material);
  let report;
  try {
    const transport = createHttpOnlyTransport(live.session);
    const snapshot = await new CapcutHttpTaskApi(transport, 'direct-http').getTaskList(AbortSignal.timeout(30_000));
    report = {
      mode: 'session-ledger',
      mechanism: live.session.context.transport,
      browserLaunched: false,
      total: snapshot.byKey.size,
      done: snapshot.doneKeys.length,
      credits: snapshot.earnedReward,
      creditsTotal: snapshot.totalReward,
      missing: [...snapshot.byKey.values()].filter(task => task.status !== 4).map(task => task.taskKey),
      at: new Date().toISOString()
    };
  } finally {
    await live.dispose();
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.total === 0) process.exitCode = 2;
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.mode === 'bootstrap') await runBootstrap(options.proxyPath);
  else await runSession(options.materialPath);
}

function sanitizeError(error) {
  const code = error?.message;
  return new Set(['HTTP_ONLY_SESSION_REQUIRED', 'HTTP_ONLY_SESSION_INVALID', 'HTTP_ONLY_MODE_AMBIGUOUS', 'HTTP_ONLY_OPTION_DUPLICATE', 'HTTP_ONLY_OPTION_UNKNOWN', 'HTTP_ONLY_PROXY_FILE_REQUIRED', 'HTTP_ONLY_PROXY_ROUTE_INVALID', 'CYCLETLS_BINARY_MISSING']).has(code)
    ? code : 'HTTP_ONLY_FAILED';
}

if (require.main === module) {
  main().catch(error => {
    process.stdout.write(JSON.stringify({ mechanism: 'cycletls', browserLaunched: false, error: sanitizeError(error) }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { loadProxyRoute, main, parseOptions, publicBootstrapTargets, runBootstrap, runSession, sanitizeError };

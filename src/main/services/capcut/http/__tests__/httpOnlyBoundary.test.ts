import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const workspace = path.resolve(import.meta.dirname, '../../../../../..');
const forbiddenPackages = new Set(['playwright', 'playwright-core', 'undici']);
const forbiddenNames = /(?:^|\/)(?:browserHttpSession|privateCapture|discoverCanvasRequest|signedRequest)\.[cm]?[jt]sx?$/;

function dependencies(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.cjs$/.test(file) ? ts.ScriptKind.JS : undefined);
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'require') imports.push(node.arguments[0].text);
      if (expression.kind === ts.SyntaxKind.ImportKeyword) imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return imports;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.cjs`, `${base}.mjs`, path.join(base, 'index.ts')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function inspectGraph(entries: readonly string[]): { packages: string[]; files: string[] } {
  const pending = entries.map(entry => path.resolve(workspace, entry));
  const seen = new Set<string>();
  const packages = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of dependencies(file)) {
      const local = resolveLocal(file, specifier);
      if (local) pending.push(local);
      else packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
    }
  }
  return { packages: [...packages].sort(), files: [...seen].map(file => path.relative(workspace, file).replaceAll('\\', '/')).sort() };
}

describe('HTTP-only dependency boundary', () => {
  it('detects literal dynamic imports and CommonJS requires transitively', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'http-only-graph-'));
    try {
      const entry = path.join(directory, 'entry.ts');
      fs.writeFileSync(entry, "import('./fallback.cjs');\n");
      fs.writeFileSync(path.join(directory, 'fallback.cjs'), "require('playwright-core');\n");
      expect(inspectGraph([entry]).packages).toContain('playwright-core');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the CLI, account runner, Passport context and trial API free of browser and undici modules', () => {
    const graph = inspectGraph([
      'scripts/live-http-only.cjs',
      'src/main/services/capcut/http/httpOnlyAccount.ts',
      'src/main/services/capcut/http/authHttp.ts',
      'src/main/services/capcut/http/httpSignup.ts',
      'src/main/services/capcut/http/passportContext.ts',
      'src/main/services/capcut/http/trialApi.ts'
    ]);
    expect(graph.packages.filter(name => forbiddenPackages.has(name))).toEqual([]);
    expect(graph.files.filter(file => forbiddenNames.test(file))).toEqual([]);
  });
});

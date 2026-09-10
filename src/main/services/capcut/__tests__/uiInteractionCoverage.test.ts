import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { notificationsGroup, pwaInstallGroup } from '../missions/simple';
import { designStudioGroup } from '../missions/designStudio';
import { videoStudioGroup } from '../missions/videoStudio';

const PRODUCTION_FILES = [
  'src/main/services/capcut/human.ts',
  'src/main/services/capcut/rendererHealth.ts',
  'src/main/services/capcut/auth.ts',
  'src/main/services/capcut/login.ts',
  'src/main/services/capcut/signup.ts',
  'src/main/services/capcut/trial.ts',
  'src/main/services/capcut/overlays.ts',
  'src/main/services/capcut/steps.ts',
  'src/main/services/capcut/missionRunner.ts',
  'src/main/services/capcut/missions/simple.ts',
  'src/main/services/capcut/missions/designStudio.ts',
  'src/main/services/capcut/missions/videoStudio.ts',
  'src/main/services/capcut/httpTasks.ts',
  'src/main/services/capcut/runTasks.ts',
  'src/main/services/CapcutEngineService.ts',
  'src/main/services/capcut/launcher/BrowserLauncher.ts',
  'src/main/services/capcut/launcher/ApiV3Launcher.ts',
  'src/main/services/capcut/launcher/XcliLauncher.ts'
];

interface Violation {
  file: string;
  line: number;
  column: number;
  form: string;
  snippet: string;
}

const DIRECT_METHOD_NAMES = new Set([
  'click',
  'press',
  'pressSequentially',
  'type',
  'fill',
  'clear',
  'hover',
  'bringToFront',
  'setViewportSize',
  'setWindowBounds'
]);

function isDirectCall(node: ts.CallExpression): { isDirect: boolean; form: string } {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) {
    return { isDirect: false, form: '' };
  }

  const methodName = expr.name.text;

  // Direct method on locator/page/window: .click, .press, .pressSequentially, .type, .fill, .clear, .hover, .bringToFront, .setViewportSize, .setWindowBounds
  if (DIRECT_METHOD_NAMES.has(methodName)) {
    return { isDirect: true, form: `.${methodName}()` };
  }

  // Calls on page.mouse.* or page.keyboard.* (e.g. page.mouse.move(), page.mouse.down(), page.keyboard.down())
  if (ts.isPropertyAccessExpression(expr.expression)) {
    const receiverProp = expr.expression.name.text;
    if (receiverProp === 'mouse' || receiverProp === 'keyboard') {
      return { isDirect: true, form: `.${receiverProp}.${methodName}()` };
    }
  }

  return { isDirect: false, form: '' };
}

function isInsideFunctionNamed(node: ts.Node, names: string[]): boolean {
  let curr: ts.Node | undefined = node.parent;
  while (curr) {
    if (ts.isFunctionDeclaration(curr) && curr.name && names.includes(curr.name.text)) {
      return true;
    }
    if (ts.isVariableDeclaration(curr) && ts.isIdentifier(curr.name) && names.includes(curr.name.text)) {
      return true;
    }
    if (ts.isMethodDeclaration(curr) && ts.isIdentifier(curr.name) && names.includes(curr.name.text)) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

function isOperationArgumentOfForeground(fnNode: ts.Node): boolean {
  const parent = fnNode.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;

  const argIndex = parent.arguments.indexOf(fnNode as ts.Expression);
  if (argIndex < 0) return false;

  const expr = parent.expression;
  // ui.foreground(label, operation) -> argIndex 1
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'foreground') {
    return argIndex === 1;
  }
  // foregroundPage(page, options, operation) -> argIndex 2
  if (ts.isIdentifier(expr) && expr.text === 'foregroundPage') {
    return argIndex === 2;
  }
  return false;
}

function isInsideForegroundOperation(node: ts.Node): boolean {
  let curr: ts.Node | undefined = node.parent;
  while (curr) {
    if (ts.isArrowFunction(curr) || ts.isFunctionExpression(curr)) {
      if (isOperationArgumentOfForeground(curr)) {
        return true;
      }
    }
    curr = curr.parent;
  }
  return false;
}

function isAllowedContext(node: ts.CallExpression, relPath: string): boolean {
  const normPath = relPath.replace(/\\/g, '/');

  // Allowed low-level adapters in human.ts
  if (normPath.endsWith('src/main/services/capcut/human.ts')) {
    if (isInsideFunctionNamed(node, ['foregroundPage', 'humanClickUnlocked', 'humanTypeUnlocked'])) {
      return true;
    }
  }

  // Allowed adapter in BrowserLauncher.ts
  if (normPath.endsWith('src/main/services/capcut/launcher/BrowserLauncher.ts')) {
    if (isInsideFunctionNamed(node, ['configureHeadedWindowUnlocked'])) {
      return true;
    }
  }

  // Operation argument of ui.foreground or foregroundPage
  if (isInsideForegroundOperation(node)) {
    return true;
  }

  return false;
}

function findViolationsInFile(filePath: string): Violation[] {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`UI interaction inventory file is missing: ${filePath}`);
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'createDirectUiInteraction' &&
        !(
          filePath.replace(/\\/g, '/').endsWith('src/main/services/capcut/launcher/BrowserLauncher.ts') &&
          isInsideFunctionNamed(node, ['attachOverCdp'])
        )
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: filePath.replace(/\\/g, '/'),
          line: line + 1,
          column: character + 1,
          form: 'createDirectUiInteraction()',
          snippet: node.getText(sourceFile).slice(0, 100).replace(/\r?\n/g, ' ')
        });
      }

      const requiredArguments: Record<string, number> = {
        humanClick: 3,
        humanType: 5,
        clickIfVisible: 4,
        dismissOverlays: 2,
        skipOnboardingSurvey: 4,
        closeBlockingPricingModal: 4,
        ensurePageUsable: 4,
        checkProTrial: 5,
        closeTaskPopover: 4,
        assertNoPopover: 4,
        claimIfPending: 6,
        withTaskPopover: 4
      };
      if (ts.isIdentifier(node.expression)) {
        const minimum = requiredArguments[node.expression.text];
        if (minimum !== undefined && node.arguments.length < minimum) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            file: filePath.replace(/\\/g, '/'),
            line: line + 1,
            column: character + 1,
            form: `${node.expression.text}(missing-ui-arguments)`,
            snippet: node.getText(sourceFile).slice(0, 100).replace(/\r?\n/g, ' ')
          });
        }
      }

      const { isDirect, form } = isDirectCall(node);
      if (isDirect && !isAllowedContext(node, filePath)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: filePath.replace(/\\/g, '/'),
          line: line + 1,
          column: character + 1,
          form,
          snippet: node.getText(sourceFile).slice(0, 100).replace(/\r?\n/g, ' ')
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('UI Interaction Coverage and Mission Group Metadata', () => {
  it('exposes correct id and workspace on built-in mission groups', () => {
    expect(pwaInstallGroup.id).toBe('pwa-install');
    expect(pwaInstallGroup.workspace).toBe('none');

    expect(notificationsGroup.id).toBe('notifications');
    expect(notificationsGroup.workspace).toBe('none');

    expect(designStudioGroup.id).toBe('design-studio');
    expect(designStudioGroup.workspace).toBe('editor');

    expect(videoStudioGroup.id).toBe('video-studio');
    expect(videoStudioGroup.workspace).toBe('editor');
  });

  it('never uses group.name.includes(...) to choose workspace behavior', () => {
    const files = [
      'src/main/services/capcut/missionRunner.ts',
      'src/main/services/capcut/runTasks.ts'
    ];

    for (const relPath of files) {
      const absolutePath = path.resolve(process.cwd(), relPath);
      const content = fs.readFileSync(absolutePath, 'utf8');
      expect(content).not.toMatch(/group\.name\.includes\(/);
    }
  });

  it('routes every direct browser input through reviewed foreground adapters or operations', () => {
    const allViolations: Violation[] = [];

    for (const relPath of PRODUCTION_FILES) {
      const fileViolations = findViolationsInFile(relPath);
      allViolations.push(...fileViolations);
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  - [${v.file}:${v.line}:${v.column}] ${v.form}: ${v.snippet}`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} unscheduled direct input call(s):\n${report}\n` +
        `Direct input calls must only appear inside foregroundPage/humanClickUnlocked/humanTypeUnlocked in human.ts, ` +
        `configureHeadedWindowUnlocked in BrowserLauncher.ts, or an operation callback passed to ui.foreground(...) / foregroundPage(...).`
      );
    }
  });

  it('fails closed when a production inventory file is missing', () => {
    expect(() => findViolationsInFile('src/main/services/capcut/does-not-exist.ts'))
      .toThrow('UI interaction inventory file is missing');
  });
});

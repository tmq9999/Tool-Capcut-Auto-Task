import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createBuildSpec({ platform = process.platform, repositoryRoot }) {
  const outputName = platform === 'win32' ? 'index.exe' : 'index';
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  return {
    command: 'go',
    args: [
      'build',
      '-trimpath',
      '-o',
      platformPath.join(repositoryRoot, 'build', 'cycletls-bridge', outputName),
      '.',
    ],
    options: {
      cwd: platformPath.join(repositoryRoot, 'tools', 'cycletls-bridge'),
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    },
  };
}

export async function buildCycleTlsBridge({
  platform = process.platform,
  repositoryRoot,
  spawnProcess = spawn,
} = {}) {
  const resolvedRoot = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const spec = createBuildSpec({ platform, repositoryRoot: resolvedRoot });
  await mkdir(path.dirname(spec.args[3]), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawnProcess(spec.command, spec.args, spec.options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`CycleTLS bridge build failed (${signal ?? `exit ${code}`})`));
    });
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildCycleTlsBridge();
}

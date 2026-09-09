import { describe, expect, it } from 'vitest';

import { createBuildSpec } from '../build-cycletls-bridge.mjs';

describe('CycleTLS bridge build', () => {
  it('builds a hidden Windows executable without a shell', () => {
    const spec = createBuildSpec({
      platform: 'win32',
      repositoryRoot: 'D:\\workspace',
    });

    expect(spec).toEqual({
      command: 'go',
      args: [
        'build',
        '-trimpath',
        '-o',
        'D:\\workspace\\build\\cycletls-bridge\\index.exe',
        '.',
      ],
      options: {
        cwd: 'D:\\workspace\\tools\\cycletls-bridge',
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    });
  });

  it('uses a platform-native filename outside Windows', () => {
    const spec = createBuildSpec({
      platform: 'linux',
      repositoryRoot: '/workspace',
    });

    expect(spec.args[3]).toBe('/workspace/build/cycletls-bridge/index');
    expect(spec.options.cwd).toBe('/workspace/tools/cycletls-bridge');
  });
});

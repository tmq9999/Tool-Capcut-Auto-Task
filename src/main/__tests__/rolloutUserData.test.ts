import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { configureRolloutUserData, ROLLOUT_USER_DATA_ENV } from '../rolloutUserData';

describe('configureRolloutUserData', () => {
  const workspaceRoot = 'd:/workspace/test-repo';

  it('returns app.getPath("userData") unchanged when env var is omitted', () => {
    const defaultPath = 'C:/Users/User/AppData/Roaming/AutoManager';
    const fakeApp = {
      getPath: vi.fn().mockReturnValue(defaultPath),
      setPath: vi.fn(),
    };

    const result = configureRolloutUserData(fakeApp, {}, workspaceRoot);
    expect(result).toBe(defaultPath);
    expect(fakeApp.getPath).toHaveBeenCalledWith('userData');
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });

  it('sets and returns resolved userData when valid external absolute path is provided', () => {
    const externalPath = path.resolve(os.tmpdir(), 'automanager-rollout-test');
    const fakeApp = {
      getPath: vi.fn().mockImplementation((name) => name === 'userData' ? externalPath : ''),
      setPath: vi.fn(),
    };

    const env = { [ROLLOUT_USER_DATA_ENV]: externalPath };
    const result = configureRolloutUserData(fakeApp, env, workspaceRoot);

    expect(fakeApp.setPath).toHaveBeenCalledWith('userData', externalPath);
    expect(result).toBe(externalPath);
  });

  it('rejects relative path with descriptive error', () => {
    const fakeApp = {
      getPath: vi.fn().mockReturnValue(''),
      setPath: vi.fn(),
    };

    const env = { [ROLLOUT_USER_DATA_ENV]: './relative-user-data' };
    expect(() => configureRolloutUserData(fakeApp, env, workspaceRoot)).toThrow(
      /absolute path/i
    );
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });

  it('rejects path located inside the workspace directory', () => {
    const fakeApp = {
      getPath: vi.fn().mockReturnValue(''),
      setPath: vi.fn(),
    };

    const insidePath = path.join(path.resolve(workspaceRoot), 'subfolder', 'user-data');
    const env = { [ROLLOUT_USER_DATA_ENV]: insidePath };
    expect(() => configureRolloutUserData(fakeApp, env, workspaceRoot)).toThrow(
      /outside the workspace/i
    );
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });

  it('rejects path exactly equal to workspace root', () => {
    const fakeApp = {
      getPath: vi.fn().mockReturnValue(''),
      setPath: vi.fn(),
    };

    const env = { [ROLLOUT_USER_DATA_ENV]: path.resolve(workspaceRoot) };
    expect(() => configureRolloutUserData(fakeApp, env, workspaceRoot)).toThrow(
      /outside the workspace/i
    );
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });

  it('does not echo private paths from an invalid override', () => {
    const fakeApp = { getPath: vi.fn(), setPath: vi.fn() };
    const privatePath = './private-user-data-token';
    let caught: unknown;
    try { configureRolloutUserData(fakeApp, { [ROLLOUT_USER_DATA_ENV]: privatePath }, workspaceRoot); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(privatePath);
    expect(String(caught)).not.toContain(workspaceRoot);
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });

  it('rejects a repository child whose name starts with two dots', () => {
    const fakeApp = { getPath: vi.fn(), setPath: vi.fn() };
    const child = path.resolve(workspaceRoot, '..private-data');
    expect(() => configureRolloutUserData(fakeApp, { [ROLLOUT_USER_DATA_ENV]: child }, workspaceRoot)).toThrow();
    expect(fakeApp.setPath).not.toHaveBeenCalled();
  });
});

import path from 'node:path';

export const ROLLOUT_USER_DATA_ENV = 'AUTOMANAGER_ROLLOUT_USER_DATA_DIR';

export interface AppUserDataTarget {
  getPath(name: string): string;
  setPath(name: string, path: string): void;
}

export function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const normChild = path.resolve(childPath).toLowerCase();
  const normParent = path.resolve(parentPath).toLowerCase();

  if (normChild === normParent) {
    return true;
  }

  const rel = path.relative(normParent, normChild);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

export function configureRolloutUserData(
  app: AppUserDataTarget,
  env: NodeJS.ProcessEnv = process.env,
  workspaceRoot: string = process.cwd()
): string {
  const overridePath = env[ROLLOUT_USER_DATA_ENV];
  if (!overridePath || overridePath.trim() === '') {
    return app.getPath('userData');
  }

  const trimmed = overridePath.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error('Rollout userData must be an absolute path.');
  }

  const resolved = path.resolve(trimmed);
  if (isPathInsideOrEqual(resolved, workspaceRoot)) {
    throw new Error(
      'Rollout userData must be outside the workspace directory.'
    );
  }

  app.setPath('userData', resolved);
  return app.getPath('userData');
}

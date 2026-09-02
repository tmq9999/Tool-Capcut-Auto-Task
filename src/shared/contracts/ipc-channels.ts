export const IPC_CHANNELS = {
  PING: 'app:ping',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  CREDENTIALS_TEST: 'credentials:test',

  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_CREATE: 'accounts:create',
  ACCOUNTS_UPDATE: 'accounts:update',
  ACCOUNTS_DELETE: 'accounts:delete',

  LOGS_LIST: 'logs:list',
  LOGS_CLEAR: 'logs:clear',

  RUN_START: 'run:start',
  RUN_STOP: 'run:stop',
  RUN_STOP_THREAD: 'run:stop-thread',
  RUN_THREADS: 'run:threads',
  RUN_PROGRESS: 'run:progress',

  EMAIL_PROVIDERS: 'email:providers',
  EMAIL_READ_OTP: 'email:read-otp'
} as const;

/** Main to renderer push channels. */
export const IPC_EVENTS = {
  LOG_ENTRY: 'logs:on-entry',
  RUN_PROGRESS: 'run:on-progress',
  SERVICE_STATUS: 'services:on-status-changed'
} as const;

export type IpcEvent = typeof IPC_EVENTS[keyof typeof IPC_EVENTS];

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

export const FUTURE_IPC_CHANNELS = {
  ACCOUNTS_EXPORT: 'accounts:export'
} as const;

export type FutureIpcChannel = typeof FUTURE_IPC_CHANNELS[keyof typeof FUTURE_IPC_CHANNELS];

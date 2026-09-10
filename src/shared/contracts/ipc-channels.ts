export const IPC_CHANNELS = {
  PING: 'app:ping',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_SAVE_AUTOMATION: 'settings:save-automation',
  CREDENTIALS_TEST: 'credentials:test',

  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_CREATE: 'accounts:create',
  ACCOUNTS_UPDATE: 'accounts:update',
  ACCOUNTS_DELETE: 'accounts:delete',
  /**
   * Xuất account ra file. Chạy ở main process vì hai cột bắt buộc của AGENTS §21
   * ("Password CapCut", "Email Data") nằm trong DB dạng đã mã hoá — renderer chỉ
   * nhận cờ boolean nên không có gì để ghi ra file.
   */
  ACCOUNTS_EXPORT: 'accounts:export',
  /**
   * Tiến độ 12 nhiệm vụ của một account. Bảng `account_tasks` trước đây chỉ được
   * GHI: không kênh nào đọc nên UI không thấy tiến độ thật của CapCut.
   */
  ACCOUNTS_TASKS: 'accounts:tasks',

  LOGS_LIST: 'logs:list',
  LOGS_CLEAR: 'logs:clear',

  RUN_START: 'run:start',
  RUN_STOP: 'run:stop',
  RUN_STOP_THREAD: 'run:stop-thread',
  RUN_THREADS: 'run:threads',
  RUN_PROGRESS: 'run:progress',
  RUN_HEALTH: 'run:health',
  RUN_USER_DATA: 'run:user-data',

  EMAIL_PROVIDERS: 'email:providers',
  EMAIL_READ_OTP: 'email:read-otp'
} as const;

/** Main to renderer push channels. */
export const IPC_EVENTS = {
  LOG_ENTRY: 'logs:on-entry',
  LOGS_RESET: 'logs:on-reset',
  RUN_PROGRESS: 'run:on-progress',
  SERVICE_STATUS: 'services:on-status-changed'
} as const;

export type IpcEvent = typeof IPC_EVENTS[keyof typeof IPC_EVENTS];

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

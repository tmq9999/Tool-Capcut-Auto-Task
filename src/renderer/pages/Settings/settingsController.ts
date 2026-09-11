import { DEFAULT_APP_SETTINGS } from '../../../shared/settings/default-settings';
import { AppSettingsSchema, type AppSettingsDTO } from '../../../shared/schemas/settings.schema';
import {
  CredentialStatusDTOSchema,
  type CredentialStatusDTO,
  type SanitizedDiagnosticResult,
} from '../../../shared/schemas/diagnostics.schema';
import {
  SettingsSaveRequestSchema,
  type SettingsSaveRequestDTO,
  type SimpleSecretOperation,
  type MultiloginSecretOperation,
} from '../../../shared/schemas/settings-save.schema';
import type { IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';

export type SimpleServiceName = 'gmail94' | 'kiotproxy' | 'dongvanfb' | 'gologin';
export type KnownServiceName = SimpleServiceName | 'multilogin';

export type SimpleDraft = SimpleSecretOperation;
export type MultiloginDraft = MultiloginSecretOperation;

export interface ControllerError {
  code: string;
  message: string;
}

export interface SettingsState {
  isLoading: boolean;
  isSaving: boolean;
  isSaved: boolean;
  warning: string | null;
  error: ControllerError | null;
  settings: AppSettingsDTO;
  credentialStatuses: Record<KnownServiceName, CredentialStatusDTO>;
  drafts: {
    gmail94: SimpleDraft;
    multilogin: MultiloginDraft;
    kiotproxy: SimpleDraft;
    dongvanfb: SimpleDraft;
    gologin: SimpleDraft;
  };
}

export interface ISettingsBridge {
  settings: {
    get: () => Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>>;
    save: (req: SettingsSaveRequestDTO) => Promise<IpcEnvelope<{ success: boolean }>>;
  };
  credentials?: {
    test?: (
      request:
        | string
        | {
            serviceName: KnownServiceName;
            draftSecret?: string;
            multiloginDraft?: {
              mode: 'token' | 'credentials';
              automationToken?: string;
              email?: string;
              password?: string;
            };
          }
    ) => Promise<IpcEnvelope<SanitizedDiagnosticResult>>;
  };
}

const KNOWN_SERVICES: readonly KnownServiceName[] = [
  'gmail94',
  'multilogin',
  'kiotproxy',
  'dongvanfb',
  'gologin',
] as const;

function createInitialStatuses(): Record<KnownServiceName, CredentialStatusDTO> {
  return {
    gmail94: {
      serviceName: 'gmail94',
      isConfigured: false,
      isStale: false,
      metadata: { maskedHint: '••••••••', status: 'unknown' },
    },
    multilogin: {
      serviceName: 'multilogin',
      isConfigured: false,
      isStale: false,
      metadata: { maskedHint: '••••••••', status: 'unknown' },
    },
    kiotproxy: {
      serviceName: 'kiotproxy',
      isConfigured: false,
      isStale: false,
      metadata: { maskedHint: '••••••••', status: 'unknown' },
    },
    dongvanfb: {
      serviceName: 'dongvanfb',
      isConfigured: false,
      isStale: false,
      metadata: { maskedHint: '••••••••', status: 'unknown' },
    },
    gologin: {
      serviceName: 'gologin',
      isConfigured: false,
      isStale: false,
      metadata: { maskedHint: '••••••••', status: 'unknown' },
    },
  };
}

function createInitialDrafts(): SettingsState['drafts'] {
  return {
    gmail94: { action: 'keep' },
    multilogin: { action: 'keep' },
    kiotproxy: { action: 'keep' },
    dongvanfb: { action: 'keep' },
    gologin: { action: 'keep' },
  };
}

function cloneDefaultSettings(): AppSettingsDTO {
  return JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)) as AppSettingsDTO;
}

function markLeafDiff(prev: unknown, next: unknown, prefix: string, out: Set<string>): void {
  if (prev === next) return;
  if (
    typeof prev !== 'object' ||
    prev === null ||
    typeof next !== 'object' ||
    next === null ||
    Array.isArray(prev) ||
    Array.isArray(next)
  ) {
    out.add(prefix);
    return;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const sub = prefix ? `${prefix}.${key}` : key;
    markLeafDiff((prev as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], sub, out);
  }
}

function mergeUntouched<T>(current: T, incoming: T, prefix: string, touched: Set<string>): T {
  if (
    typeof incoming !== 'object' ||
    incoming === null ||
    typeof current !== 'object' ||
    current === null ||
    Array.isArray(incoming) ||
    Array.isArray(current)
  ) {
    return touched.has(prefix) ? current : incoming;
  }
  const result: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const key of Object.keys(incoming as Record<string, unknown>)) {
    const sub = prefix ? `${prefix}.${key}` : key;
    result[key] = mergeUntouched(
      (current as Record<string, unknown>)[key],
      (incoming as Record<string, unknown>)[key],
      sub,
      touched
    );
  }
  return result as T;
}

export class SettingsController {
  private state: SettingsState;
  private readonly listeners = new Set<(state: SettingsState) => void>();
  private editRevision = 0;
  private loadToken = 0;
  private generation = 0;
  private disposed = false;
  private readonly touchedSettingPaths = new Set<string>();
  private readonly touchedDrafts = new Set<KnownServiceName>();
  private lastCommittedGeneral: {
    revision: number;
    general: Pick<AppSettingsDTO['general'], 'theme' | 'sessionRestore'>;
  } | null = null;
  private activeSavePromise: Promise<boolean> | null = null;

  constructor(private readonly bridge: ISettingsBridge) {
    this.state = {
      isLoading: true,
      isSaving: false,
      isSaved: false,
      warning: null,
      error: null,
      settings: cloneDefaultSettings(),
      credentialStatuses: createInitialStatuses(),
      drafts: createInitialDrafts(),
    };
  }

  getState(): SettingsState {
    return this.state;
  }

  getLastCommittedGeneral(): {
    revision: number;
    general: Pick<AppSettingsDTO['general'], 'theme' | 'sessionRestore'>;
  } | null {
    return this.lastCommittedGeneral;
  }

  subscribe(listener: (state: SettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async load(): Promise<void> {
    this.disposed = false;
    const token = ++this.loadToken;
    const gen = this.generation;
    this.state = {
      ...this.state,
      isLoading: true,
      isSaving: this.activeSavePromise !== null,
      error: null,
    };
    this.notify();

    try {
      const response = await this.bridge.settings.get();
      if (this.disposed || token !== this.loadToken || gen !== this.generation) {
        return;
      }

      if (!response.success) {
        this.state = {
          ...this.state,
          isLoading: false,
          isSaving: this.activeSavePromise !== null,
          error: {
            code: response.error.code || 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to retrieve application settings or credentials.',
          },
        };
        this.notify();
        return;
      }

      const parsedSettings = AppSettingsSchema.parse(response.data.settings);
      const parsedStatuses = createInitialStatuses();

      if (Array.isArray(response.data.credentials)) {
        for (const rawCred of response.data.credentials) {
          const validCred = CredentialStatusDTOSchema.parse(rawCred);
          if (KNOWN_SERVICES.includes(validCred.serviceName as KnownServiceName)) {
            parsedStatuses[validCred.serviceName as KnownServiceName] = validCred;
          }
        }
      }

      const nextSettings = mergeUntouched(
        this.state.settings,
        parsedSettings,
        '',
        this.touchedSettingPaths
      );

      const nextDrafts = { ...createInitialDrafts() };
      for (const svc of this.touchedDrafts) {
        (nextDrafts as Record<string, unknown>)[svc] = this.state.drafts[svc];
      }

      this.state = {
        ...this.state,
        isLoading: false,
        isSaving: this.activeSavePromise !== null,
        settings: nextSettings,
        credentialStatuses: parsedStatuses,
        drafts: nextDrafts,
        error: null,
      };
      this.notify();
    } catch {
      if (this.disposed || token !== this.loadToken || gen !== this.generation) {
        return;
      }
      this.state = {
        ...this.state,
        isLoading: false,
        isSaving: this.activeSavePromise !== null,
        error: {
          code: 'ERR_PERSISTENCE_FAILED',
          message: 'Failed to retrieve application settings or credentials.',
        },
      };
      this.notify();
    }
  }

  updateSettings(updater: (prev: AppSettingsDTO) => AppSettingsDTO): void {
    const prevSettings = this.state.settings;
    const nextSettings = updater(prevSettings);
    markLeafDiff(prevSettings, nextSettings, '', this.touchedSettingPaths);
    this.editRevision += 1;
    this.state = {
      ...this.state,
      settings: nextSettings,
      isSaved: false,
    };
    this.notify();
  }

  setSimpleDraft(service: SimpleServiceName, draft: SimpleDraft): void {
    this.touchedDrafts.add(service);
    this.editRevision += 1;
    this.state = {
      ...this.state,
      drafts: {
        ...this.state.drafts,
        [service]: draft,
      },
      isSaved: false,
    };
    this.notify();
  }

  setMultiloginDraft(draft: MultiloginDraft): void {
    this.touchedDrafts.add('multilogin');
    this.editRevision += 1;
    this.state = {
      ...this.state,
      drafts: {
        ...this.state.drafts,
        multilogin: draft,
      },
      isSaved: false,
    };
    this.notify();
  }

  save(): Promise<boolean> {
    if (this.activeSavePromise) {
      return Promise.resolve(false);
    }
    const savePromise = this.executeSave().finally(() => {
      if (this.activeSavePromise === savePromise) {
        this.activeSavePromise = null;
        if (!this.disposed && this.state.isSaving) {
          this.state = {
            ...this.state,
            isSaving: false,
          };
          this.notify();
        }
      }
    });
    this.activeSavePromise = savePromise;
    return savePromise;
  }

  private async executeSave(): Promise<boolean> {
    const savedRevision = this.editRevision;
    const gen = this.generation;

    const savePayload: SettingsSaveRequestDTO = {
      settings: this.state.settings,
      credentials: [
        { serviceName: 'gmail94', operation: this.state.drafts.gmail94 },
        { serviceName: 'multilogin', operation: this.state.drafts.multilogin },
        { serviceName: 'kiotproxy', operation: this.state.drafts.kiotproxy },
        { serviceName: 'dongvanfb', operation: this.state.drafts.dongvanfb },
        { serviceName: 'gologin', operation: this.state.drafts.gologin },
      ],
    };

    try {
      SettingsSaveRequestSchema.parse(savePayload);
    } catch {
      if (!this.disposed && gen === this.generation) {
        this.state = {
          ...this.state,
          isSaving: false,
          isSaved: false,
          error: {
            code: 'ERR_VALIDATION_FAILED',
            message: 'Invalid settings save payload.',
          },
        };
        this.notify();
      }
      return false;
    }

    this.state = {
      ...this.state,
      isSaving: true,
      isSaved: false,
      warning: null,
      error: null,
    };
    this.notify();

    let response: IpcEnvelope<{ success: boolean }>;
    try {
      response = await this.bridge.settings.save(savePayload);
    } catch {
      if (!this.disposed && gen === this.generation) {
        this.state = {
          ...this.state,
          isSaving: false,
          isSaved: false,
          error: {
            code: 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to persist application settings or credentials.',
          },
        };
        this.notify();
      }
      return false;
    }

    if (!response.success || !response.data?.success) {
      if (!this.disposed && gen === this.generation) {
        this.state = {
          ...this.state,
          isSaving: false,
          isSaved: false,
          error: {
            code: (!response.success && response.error?.code) || 'ERR_PERSISTENCE_FAILED',
            message: (!response.success && response.error?.message) || 'Failed to persist application settings or credentials.',
          },
        };
        this.notify();
      }
      return false;
    }

    this.lastCommittedGeneral = {
      revision: savedRevision,
      general: {
        theme: savePayload.settings.general.theme,
        sessionRestore: savePayload.settings.general.sessionRestore,
      },
    };

    let refreshFailed = false;
    let nextStatuses = this.state.credentialStatuses;
    let nextSettings = this.state.settings;

    try {
      const refreshResponse = await this.bridge.settings.get();
      if (refreshResponse.success) {
        const parsedRefresh = AppSettingsSchema.parse(refreshResponse.data.settings);
        nextSettings = mergeUntouched(this.state.settings, parsedRefresh, '', this.touchedSettingPaths);
        nextStatuses = createInitialStatuses();
        if (Array.isArray(refreshResponse.data.credentials)) {
          for (const rawCred of refreshResponse.data.credentials) {
            const validCred = CredentialStatusDTOSchema.parse(rawCred);
            if (KNOWN_SERVICES.includes(validCred.serviceName as KnownServiceName)) {
              nextStatuses[validCred.serviceName as KnownServiceName] = validCred;
            }
          }
        }
      } else {
        refreshFailed = true;
      }
    } catch {
      refreshFailed = true;
    }

    if (this.disposed || gen !== this.generation) {
      return true;
    }

    const hasNewEdits = this.editRevision !== savedRevision;

    this.state = {
      ...this.state,
      isSaving: false,
      isSaved: !hasNewEdits,
      warning: refreshFailed ? 'Cài đặt đã được lưu nhưng không thể làm mới dữ liệu từ hệ thống.' : null,
      settings: hasNewEdits ? this.state.settings : nextSettings,
      credentialStatuses: nextStatuses,
      drafts: hasNewEdits ? this.state.drafts : createInitialDrafts(),
      error: null,
    };
    if (!hasNewEdits) {
      this.touchedDrafts.clear();
      this.touchedSettingPaths.clear();
    }
    this.notify();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.loadToken += 1;
    this.listeners.clear();
  }
}

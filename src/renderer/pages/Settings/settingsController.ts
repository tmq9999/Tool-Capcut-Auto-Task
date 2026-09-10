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

export class SettingsController {
  private state: SettingsState;
  private readonly listeners = new Set<(state: SettingsState) => void>();
  private editRevision = 0;

  constructor(private readonly bridge: ISettingsBridge) {
    this.state = {
      isLoading: true,
      isSaving: false,
      isSaved: false,
      error: null,
      settings: cloneDefaultSettings(),
      credentialStatuses: createInitialStatuses(),
      drafts: createInitialDrafts(),
    };
  }

  getState(): SettingsState {
    return this.state;
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
    this.state = {
      ...this.state,
      isLoading: true,
      error: null,
    };
    this.notify();

    try {
      const response = await this.bridge.settings.get();

      if (!response.success) {
        this.state = {
          ...this.state,
          isLoading: false,
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

      this.editRevision += 1;
      this.state = {
        ...this.state,
        isLoading: false,
        settings: parsedSettings,
        credentialStatuses: parsedStatuses,
        drafts: createInitialDrafts(),
        error: null,
      };
      this.notify();
    } catch {
      this.state = {
        ...this.state,
        isLoading: false,
        error: {
          code: 'ERR_PERSISTENCE_FAILED',
          message: 'Failed to retrieve application settings or credentials.',
        },
      };
      this.notify();
    }
  }

  updateSettings(updater: (prev: AppSettingsDTO) => AppSettingsDTO): void {
    this.editRevision += 1;
    this.state = {
      ...this.state,
      settings: updater(this.state.settings),
      isSaved: false,
    };
    this.notify();
  }

  setSimpleDraft(service: SimpleServiceName, draft: SimpleDraft): void {
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

  async save(): Promise<boolean> {
    if (this.state.isSaving) {
      return false;
    }

    const savedRevision = this.editRevision;

    this.state = {
      ...this.state,
      isSaving: true,
      isSaved: false,
      error: null,
    };
    this.notify();

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
      return false;
    }

    try {
      const response = await this.bridge.settings.save(savePayload);

      if (!response.success) {
        this.state = {
          ...this.state,
          isSaving: false,
          isSaved: false,
          error: {
            code: response.error.code || 'ERR_PERSISTENCE_FAILED',
            message: 'Failed to persist application settings or credentials.',
          },
        };
        this.notify();
        return false;
      }

      // Refresh credentials and settings from backend after saving
      const refreshResponse = await this.bridge.settings.get();
      let nextStatuses = this.state.credentialStatuses;
      let nextSettings = this.state.settings;

      if (refreshResponse.success) {
        nextSettings = AppSettingsSchema.parse(refreshResponse.data.settings);
        nextStatuses = createInitialStatuses();
        if (Array.isArray(refreshResponse.data.credentials)) {
          for (const rawCred of refreshResponse.data.credentials) {
            const validCred = CredentialStatusDTOSchema.parse(rawCred);
            if (KNOWN_SERVICES.includes(validCred.serviceName as KnownServiceName)) {
              nextStatuses[validCred.serviceName as KnownServiceName] = validCred;
            }
          }
        }
      }

      const hasNewEdits = this.editRevision !== savedRevision;

      this.state = {
        ...this.state,
        isSaving: false,
        isSaved: !hasNewEdits,
        settings: hasNewEdits ? this.state.settings : nextSettings,
        credentialStatuses: nextStatuses,
        drafts: hasNewEdits ? this.state.drafts : createInitialDrafts(),
        error: null,
      };
      this.notify();
      return true;
    } catch {
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
      return false;
    }
  }

  dispose(): void {
    this.state = {
      ...this.state,
      drafts: createInitialDrafts(),
    };
    this.listeners.clear();
  }
}

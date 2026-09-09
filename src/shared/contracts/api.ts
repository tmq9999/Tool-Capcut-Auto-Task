import { z } from 'zod';
import { createIpcEnvelopeSchema, type IpcEnvelope } from '../schemas/ipc-envelope.schema';
import { AppSettingsSchema, type AppSettingsDTO } from '../schemas/settings.schema';
import { SettingsSaveRequestSchema, type SettingsSaveRequestDTO } from '../schemas/settings-save.schema';
import { SaveCredentialInputSchema } from '../schemas/credentials.schema';
import {
  AccountCreateInputSchema,
  AccountUpdateInputSchema,
  AccountFilterSchema,
  AccountListItemSchema
} from '../schemas/account.schema';
import { LogFilterSchema, CanonicalRuntimeLogSchema, type CanonicalRuntimeLog, type LogFilterDTO } from '../schemas/log.schema';
import {
  AutomationRunConfigSchema,
  AutomationRunProgressSchema,
  RunningThreadInfoSchema,
  RunHealthRequestSchema,
  RunHealthResponseSchema,
  type RunHealthRequestDTO,
  type RunHealthResponseDTO,
  type AutomationRunConfigDTO,
  type AutomationRunProgressDTO,
  type RunningThreadInfoDTO
} from '../schemas/automation.schema';
import {
  EmailProviderConfigDTOSchema,
  type EmailProviderConfigDTO
} from '../schemas/provider.schema';
import type {
  AccountCreateInputDTO,
  AccountFilterDTO,
  AccountListItemDTO,
  AccountUpdateInputDTO
} from '../schemas/account.schema';
import {
  AccountExportRequestSchema,
  AccountExportResultSchema,
  type AccountExportRequestDTO,
  type AccountExportResultDTO
} from '../schemas/account-export.schema';
import {
  AccountTasksRequestSchema,
  AccountTasksResponseSchema,
  type AccountTasksRequestDTO,
  type AccountTasksResponseDTO
} from '../schemas/account-task.schema';
import {
  CredentialStatusDTOSchema,
  type CredentialStatusDTO,
  SanitizedDiagnosticResultSchema,
  type SanitizedDiagnosticResult
} from '../schemas/diagnostics.schema';

export const PingResponseSchema = z.object({
  pong: z.literal(true),
  timestamp: z.number()
}).strict();

export type PingResponse = z.infer<typeof PingResponseSchema>;

export const PingEnvelopeSchema = createIpcEnvelopeSchema(PingResponseSchema);
export type PingEnvelope = z.infer<typeof PingEnvelopeSchema>;

// Explicit Request/Response Schema Registry for Phase 1 & Future Phase 2 Contracts
export const IpcContractRegistry = {
  ping: {
    request: z.void(),
    response: PingResponseSchema
  },
  settings: {
    get: {
      request: z.void(),
      response: z.object({
        settings: AppSettingsSchema,
        credentials: z.array(CredentialStatusDTOSchema)
      }).strict()
    },
    save: {
      request: SettingsSaveRequestSchema,
      response: z.object({ success: z.boolean() }).strict()
    }
  },
  credentials: {
    save: {
      request: SaveCredentialInputSchema,
      response: z.object({ success: z.boolean(), maskedHint: z.string() }).strict()
    },
    getStatus: {
      request: z.void(),
      response: z.array(CredentialStatusDTOSchema)
    },
    test: {
      request: z.object({
        serviceName: z.enum(['gmail94', 'multilogin', 'kiotproxy', 'dongvanfb', 'gologin']),
        draftSecret: z.string().optional(),
        multiloginDraft: z.object({
          mode: z.enum(['token', 'credentials']),
          automationToken: z.string().optional(),
          email: z.string().optional(),
          password: z.string().optional(),
        }).optional(),
      }).strict(),
      response: SanitizedDiagnosticResultSchema
    }
  },
  accounts: {
    list: {
      request: AccountFilterSchema,
      response: z.object({
        items: z.array(AccountListItemSchema),
        total: z.number().int().min(0)
      }).strict()
    },
    create: {
      request: AccountCreateInputSchema,
      response: z.object({ id: z.string().min(1) }).strict()
    },
    update: {
      request: z.object({
        id: z.string().min(1),
        data: AccountUpdateInputSchema
      }).strict(),
      response: z.object({ success: z.boolean() }).strict()
    },
    delete: {
      request: z.object({ ids: z.array(z.string().min(1)).min(1) }).strict(),
      response: z.object({ deletedCount: z.number().int().min(0) }).strict()
    },
    export: {
      request: AccountExportRequestSchema,
      response: AccountExportResultSchema
    },
    tasks: {
      request: AccountTasksRequestSchema,
      response: AccountTasksResponseSchema
    }
  },
  logs: {
    list: {
      request: LogFilterSchema,
      response: z.object({
        items: z.array(CanonicalRuntimeLogSchema),
        total: z.number().int().min(0)
      }).strict()
    },
    clear: {
      request: z.void(),
      response: z.object({ success: z.boolean() }).strict()
    }
  },
  run: {
    start: {
      request: AutomationRunConfigSchema,
      response: z.object({ runId: z.string().min(1), artifactBasename: z.string().min(1).optional() }).strict()
    },
    health: { request: RunHealthRequestSchema, response: RunHealthResponseSchema },
    userData: { request: z.void(), response: z.object({ userDataDir: z.string().min(1), rolloutHandshake: z.string().regex(/^[a-f0-9]{32,128}$/i).optional() }).strict() },
    stop: {
      request: z.void(),
      response: z.object({ success: z.boolean() }).strict()
    },
    stopThread: {
      request: z.object({ accountId: z.string().min(1) }).strict(),
      response: z.object({ stopped: z.boolean() }).strict()
    },
    threads: {
      request: z.void(),
      response: z.array(RunningThreadInfoSchema)
    },
    progress: {
      request: z.void(),
      response: AutomationRunProgressSchema
    }
  },
  email: {
    providers: {
      request: z.void(),
      response: z.array(EmailProviderConfigDTOSchema)
    },
    readOtp: {
      request: z.object({
        purchasedEmailId: z.string().min(1),
        type: z.string().min(1).optional()
      }).strict(),
      response: z.object({ otp: z.string().nullable() }).strict()
    }
  }
} as const;

export interface ElectronBridge {
  platform: string;
  version: string;
  ping(): Promise<IpcEnvelope<PingResponse>>;
  settings: {
    get(): Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>>;
    save(req: SettingsSaveRequestDTO): Promise<IpcEnvelope<{ success: boolean }>>;
  };
  credentials: {
    test(
      request:
        | string
        | {
            serviceName: 'gmail94' | 'multilogin' | 'kiotproxy' | 'dongvanfb' | 'gologin';
            draftSecret?: string;
            multiloginDraft?: {
              mode: 'token' | 'credentials';
              automationToken?: string;
              email?: string;
              password?: string;
            };
          }
    ): Promise<IpcEnvelope<SanitizedDiagnosticResult>>;
  };
  accounts: {
    list(filter: AccountFilterDTO): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>>;
    create(input: AccountCreateInputDTO): Promise<IpcEnvelope<{ id: string }>>;
    update(id: string, data: AccountUpdateInputDTO): Promise<IpcEnvelope<{ success: boolean }>>;
    remove(ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>>;
    /**
     * Xuất ra file. Main tự mở hộp thoại lưu và tự ghi đĩa; renderer nhận lại
     * đường dẫn + số dòng, KHÔNG nhận nội dung (AGENTS §13).
     */
    export(request: AccountExportRequestDTO): Promise<IpcEnvelope<AccountExportResultDTO>>;
    /** Tiến độ 12 nhiệm vụ CapCut của một account, đọc từ `account_tasks`. */
    tasks(request: AccountTasksRequestDTO): Promise<IpcEnvelope<AccountTasksResponseDTO>>;
  };
  logs: {
    list(filter: LogFilterDTO): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>>;
    clear(): Promise<IpcEnvelope<{ success: boolean }>>;
    onEntry(listener: (log: CanonicalRuntimeLog) => void): () => void;
  };
  run: {
    start(config: AutomationRunConfigDTO): Promise<IpcEnvelope<{ runId: string; artifactBasename?: string }>>;
    health(input: RunHealthRequestDTO): Promise<IpcEnvelope<RunHealthResponseDTO>>;
    userData(): Promise<IpcEnvelope<{ userDataDir: string; rolloutHandshake?: string }>>;
    stop(): Promise<IpcEnvelope<{ success: boolean }>>;
    stopThread(accountId: string): Promise<IpcEnvelope<{ stopped: boolean }>>;
    threads(): Promise<IpcEnvelope<RunningThreadInfoDTO[]>>;
    progress(): Promise<IpcEnvelope<AutomationRunProgressDTO>>;
    onProgress(listener: (progress: AutomationRunProgressDTO) => void): () => void;
  };
  email: {
    providers(): Promise<IpcEnvelope<EmailProviderConfigDTO[]>>;
    readOtp(purchasedEmailId: string, type?: string): Promise<IpcEnvelope<{ otp: string | null }>>;
  };
  services: {
    onStatusChanged(listener: (statuses: CredentialStatusDTO[]) => void): () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

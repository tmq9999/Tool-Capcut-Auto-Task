import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
import { IpcContractRegistry } from '../../shared/contracts/api';
import type { IpcRegistrar } from './registerIpc';
import { ok, toErrorEnvelope, VALIDATION_ERROR } from './ipcResult';
import type { AutomationRunService } from '../services/AutomationRunService';
import type { EmailPurchaseService } from '../services/EmailPurchaseService';
import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
import type {
  AutomationRunProgressDTO,
  RunningThreadInfoDTO
} from '../../shared/schemas/automation.schema';
import type { EmailProviderConfigDTO } from '../../shared/schemas/provider.schema';

export function registerAutomationIpc(
  registrar: IpcRegistrar,
  runService: Pick<
    AutomationRunService,
    'start' | 'stop' | 'stopThread' | 'getProgress' | 'getRunningThreads'
  >,
  emailService: Pick<EmailPurchaseService, 'getProviderConfigs' | 'readOtp'>
): () => void {
  registrar.handle(
    IPC_CHANNELS.RUN_START,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ runId: string }>> => {
      const parsed = IpcContractRegistry.run.start.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok(await runService.start(parsed.data));
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.RUN_STOP,
    async (): Promise<IpcEnvelope<{ success: boolean }>> => {
      try {
        await runService.stop();
        return ok({ success: true });
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.RUN_STOP_THREAD,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ stopped: boolean }>> => {
      const parsed = IpcContractRegistry.run.stopThread.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        return ok({ stopped: await runService.stopThread(parsed.data.accountId) });
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.RUN_THREADS,
    async (): Promise<IpcEnvelope<RunningThreadInfoDTO[]>> => {
      try {
        return ok(runService.getRunningThreads());
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.RUN_PROGRESS,
    async (): Promise<IpcEnvelope<AutomationRunProgressDTO>> => {
      try {
        return ok(runService.getProgress());
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.EMAIL_PROVIDERS,
    async (): Promise<IpcEnvelope<EmailProviderConfigDTO[]>> => {
      try {
        return ok(emailService.getProviderConfigs());
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  registrar.handle(
    IPC_CHANNELS.EMAIL_READ_OTP,
    async (_event: unknown, request?: unknown): Promise<IpcEnvelope<{ otp: string | null }>> => {
      const parsed = IpcContractRegistry.email.readOtp.request.safeParse(request);
      if (!parsed.success) return VALIDATION_ERROR;
      try {
        const otp = await emailService.readOtp(parsed.data.purchasedEmailId, parsed.data.type);
        return ok({ otp });
      } catch (err: unknown) {
        return toErrorEnvelope(err);
      }
    }
  );

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    registrar.removeHandler(IPC_CHANNELS.RUN_START);
    registrar.removeHandler(IPC_CHANNELS.RUN_STOP);
    registrar.removeHandler(IPC_CHANNELS.RUN_STOP_THREAD);
    registrar.removeHandler(IPC_CHANNELS.RUN_THREADS);
    registrar.removeHandler(IPC_CHANNELS.RUN_PROGRESS);
    registrar.removeHandler(IPC_CHANNELS.EMAIL_PROVIDERS);
    registrar.removeHandler(IPC_CHANNELS.EMAIL_READ_OTP);
  };
}

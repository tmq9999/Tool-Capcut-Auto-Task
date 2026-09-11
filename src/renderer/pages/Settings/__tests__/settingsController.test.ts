import { describe, it, expect, vi } from 'vitest';
import {
  SettingsController,
  type ISettingsBridge,
  type MultiloginDraft,
} from '../settingsController';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings/default-settings';
import type { CredentialStatusDTO } from '../../../../shared/schemas/diagnostics.schema';
import type { SettingsSaveRequestDTO } from '../../../../shared/schemas/settings-save.schema';
import type { IpcEnvelope } from '../../../../shared/schemas/ipc-envelope.schema';

function createMockBridge(customSaveResult?: IpcEnvelope<{ success: boolean }>): {
  bridge: ISettingsBridge;
  getSpy: ReturnType<typeof vi.fn>;
  saveSpy: ReturnType<typeof vi.fn>;
} {
  const getSpy = vi.fn().mockResolvedValue({
    success: true,
    data: {
      settings: DEFAULT_APP_SETTINGS,
      credentials: [
        {
          serviceName: 'gmail94',
          isConfigured: true,
          isStale: false,
          metadata: {
            maskedHint: 'sk-••••1234',
            status: 'unknown',
          },
        },
        {
          serviceName: 'multilogin',
          isConfigured: false,
          isStale: false,
          metadata: {
            maskedHint: '••••••••',
            status: 'unknown',
          },
        },
      ] as CredentialStatusDTO[],
    },
  });

  const saveSpy = vi.fn().mockResolvedValue(
    customSaveResult ?? {
      success: true,
      data: { success: true },
    }
  );

  const bridge: ISettingsBridge = {
    settings: {
      get: getSpy,
      save: saveSpy,
    },
  };

  return { bridge, getSpy, saveSpy };
}

describe('Pure SettingsController Unit Tests (Task 2.1.4 RED)', () => {
  it('initial state is loading with canonical non-secret defaults and empty secret drafts', () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);
    const state = controller.getState();

    expect(state.isLoading).toBe(true);
    expect(state.isSaving).toBe(false);
    expect(state.isSaved).toBe(false);
    expect(state.error).toBeNull();
    expect(state.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(state.drafts.gmail94).toEqual({ action: 'keep' });
    expect(state.drafts.multilogin).toEqual({ action: 'keep' });
    expect(state.drafts.kiotproxy).toEqual({ action: 'keep' });
    expect(state.drafts.dongvanfb).toEqual({ action: 'keep' });
    expect(state.drafts.gologin).toEqual({ action: 'keep' });
  });

  it('load() calls settings.get, stores settings and sanitized credential statuses, and ends loading', async () => {
    const { bridge, getSpy } = createMockBridge();
    const controller = new SettingsController(bridge);

    await controller.load();

    expect(getSpy).toHaveBeenCalledTimes(1);
    const state = controller.getState();
    expect(state.isLoading).toBe(false);
    expect(state.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(state.credentialStatuses.gmail94.isConfigured).toBe(true);
    expect(state.credentialStatuses.gmail94.metadata.maskedHint).toBe('sk-••••1234');
    expect(state.credentialStatuses.multilogin.isConfigured).toBe(false);
  });

  it('a failed load stores only normalized error code/message and never raw exception text', async () => {
    const rawSensitiveError = new Error('SQLite crash at /private/var/secret-db');
    const bridge: ISettingsBridge = {
      settings: {
        get: vi.fn().mockRejectedValue(rawSensitiveError),
        save: vi.fn(),
      },
    };
    const controller = new SettingsController(bridge);

    await controller.load();

    const state = controller.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).not.toBeNull();
    expect(state.error?.code).toBe('ERR_PERSISTENCE_FAILED');
    expect(state.error?.message).toBe('Failed to retrieve application settings or credentials.');

    const serializedState = JSON.stringify(state);
    expect(serializedState).not.toContain('SQLite crash');
    expect(serializedState).not.toContain('/private/var/secret-db');
  });

  it('non-secret setting edits are represented in the eventual SettingsSaveRequestDTO', async () => {
    const { bridge, saveSpy } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();

    controller.updateSettings((prev) => ({
      ...prev,
      general: {
        ...prev.general,
        theme: 'light',
      },
    }));

    expect(controller.getState().settings.general.theme).toBe('light');

    await controller.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedRequest = saveSpy.mock.calls[0][0] as SettingsSaveRequestDTO;
    expect(savedRequest.settings.general.theme).toBe('light');
  });

  it('simple credential services support explicit keep/replace/clear; replace holds a write-only draft and clear contains no value', () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);

    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'sk-new-gmail-key' });
    expect(controller.getState().drafts.gmail94).toEqual({ action: 'replace', value: 'sk-new-gmail-key' });

    controller.setSimpleDraft('kiotproxy', { action: 'clear' });
    expect(controller.getState().drafts.kiotproxy).toEqual({ action: 'clear' });

    controller.setSimpleDraft('dongvanfb', { action: 'keep' });
    expect(controller.getState().drafts.dongvanfb).toEqual({ action: 'keep' });
  });

  it('Multilogin supports both typed token auth and credentials auth replacements, plus keep/clear, matching MultiloginAuthSchema exactly', () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);

    const tokenDraft: MultiloginDraft = {
      action: 'replace',
      auth: { mode: 'token', automationToken: 'mla-token-xyz' },
    };
    controller.setMultiloginDraft(tokenDraft);
    expect(controller.getState().drafts.multilogin).toEqual(tokenDraft);

    const credsDraft: MultiloginDraft = {
      action: 'replace',
      auth: { mode: 'credentials', email: 'user@mla.com', password: 'mlapassword123' },
    };
    controller.setMultiloginDraft(credsDraft);
    expect(controller.getState().drafts.multilogin).toEqual(credsDraft);

    controller.setMultiloginDraft({ action: 'clear' });
    expect(controller.getState().drafts.multilogin).toEqual({ action: 'clear' });
  });

  it('build/save constructs one composite SettingsSaveRequestDTO containing all known credential mutations', async () => {
    const { bridge, saveSpy } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();

    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'new-gmail-secret' });
    controller.setSimpleDraft('kiotproxy', { action: 'clear' });
    controller.setMultiloginDraft({
      action: 'replace',
      auth: { mode: 'token', automationToken: 'tok-123' },
    });

    await controller.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveReq = saveSpy.mock.calls[0][0] as SettingsSaveRequestDTO;

    expect(saveReq.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(saveReq.credentials).toEqual([
      { serviceName: 'gmail94', operation: { action: 'replace', value: 'new-gmail-secret' } },
      { serviceName: 'multilogin', operation: { action: 'replace', auth: { mode: 'token', automationToken: 'tok-123' } } },
      { serviceName: 'kiotproxy', operation: { action: 'clear' } },
      { serviceName: 'dongvanfb', operation: { action: 'keep' } },
      { serviceName: 'gologin', operation: { action: 'keep' } },
    ]);
  });

  it('successful save wipes every simple and Multilogin secret draft immediately while preserving non-secret settings and sets a saved indicator', async () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();

    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'secret-to-wipe' });
    controller.setMultiloginDraft({
      action: 'replace',
      auth: { mode: 'token', automationToken: 'token-to-wipe' },
    });

    const success = await controller.save();

    expect(success).toBe(true);
    const state = controller.getState();
    expect(state.isSaved).toBe(true);
    expect(state.isSaving).toBe(false);
    expect(state.drafts.gmail94).toEqual({ action: 'keep' });
    expect(state.drafts.multilogin).toEqual({ action: 'keep' });
    expect(state.drafts.kiotproxy).toEqual({ action: 'keep' });
  });

  it('failed save preserves non-secret edits and retains secret drafts for retry with normalized error data', async () => {
    const sensitiveDraftSecret = 'KEY-DRAFT-XYZ';
    const failedSaveResult: IpcEnvelope<{ success: boolean }> = {
      success: false,
      error: {
        code: 'ERR_PERSISTENCE_FAILED',
        message: 'Failed to persist application settings or credentials.',
      },
    };
    const { bridge } = createMockBridge(failedSaveResult);
    const controller = new SettingsController(bridge);
    await controller.load();

    controller.updateSettings((prev) => ({
      ...prev,
      general: { ...prev.general, language: 'en' },
    }));
    controller.setSimpleDraft('gmail94', { action: 'replace', value: sensitiveDraftSecret });

    const success = await controller.save();

    expect(success).toBe(false);
    const state = controller.getState();
    expect(state.settings.general.language).toBe('en');
    expect(state.drafts.gmail94).toEqual({ action: 'replace', value: sensitiveDraftSecret });
    expect(state.error?.code).toBe('ERR_PERSISTENCE_FAILED');
  });

  it('R08 failed save retains the API key input', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let finish!: (v: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const c = new SettingsController(bridge);
    await c.load();
    const draft = { action: 'replace' as const, value: 'KEY-DEMO' };
    c.setSimpleDraft('gmail94', draft);
    const saving = c.save();
    expect(c.getState().drafts.gmail94).toEqual(draft);
    finish({ success: false, error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk' } });
    expect(await saving).toBe(false);
    expect(c.getState().drafts.gmail94).toEqual(draft);
  });

  it('double submit while a first save is pending results in exactly one IPC call', async () => {
    let resolveFirstSave!: (val: IpcEnvelope<{ success: boolean }>) => void;
    const pendingPromise = new Promise<IpcEnvelope<{ success: boolean }>>((res) => {
      resolveFirstSave = res;
    });

    const saveSpy = vi.fn().mockReturnValue(pendingPromise);
    const bridge: ISettingsBridge = {
      settings: {
        get: vi.fn().mockResolvedValue({ success: true, data: { settings: DEFAULT_APP_SETTINGS, credentials: [] } }),
        save: saveSpy,
      },
    };
    const controller = new SettingsController(bridge);
    await controller.load();

    const savePromise1 = controller.save();
    const savePromise2 = controller.save();

    expect(controller.getState().isSaving).toBe(true);

    resolveFirstSave({ success: true, data: { success: true } });

    const [res1, res2] = await Promise.all([savePromise1, savePromise2]);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(res1).toBe(true);
    expect(res2).toBe(false);
    expect(controller.getState().isSaving).toBe(false);
  });

  it('dispose/unmount preserves drafts and detaches listeners', () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);

    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'secret-draft' });
    controller.setMultiloginDraft({
      action: 'replace',
      auth: { mode: 'token', automationToken: 'tok-draft' },
    });

    controller.dispose();

    const state = controller.getState();
    expect(state.drafts.gmail94).toEqual({ action: 'replace', value: 'secret-draft' });
    expect(state.drafts.multilogin).toEqual({
      action: 'replace',
      auth: { mode: 'token', automationToken: 'tok-draft' },
    });
  });

  it('reloads after replay and preserves a credential draft', async () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();
    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'DEMO' });
    controller.dispose();
    await controller.load();
    expect(controller.getState().isLoading).toBe(false);
    expect(controller.getState().drafts.gmail94)
      .toEqual({ action: 'replace', value: 'DEMO' });
  });

  it('preserves untouched stored settings in an early-edit save payload', async () => {
    const { bridge, getSpy, saveSpy } = createMockBridge();
    const server = structuredClone(DEFAULT_APP_SETTINGS);
    server.automation.threadCount = 17;
    let resolve!: (value: unknown) => void;
    getSpy.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const controller = new SettingsController(bridge);
    const loading = controller.load();
    controller.updateSettings((s) => ({
      ...s, general: { ...s.general, sessionRestore: !s.general.sessionRestore }
    }));
    resolve({ success: true, data: { settings: server, credentials: [] } });
    await loading;
    expect(controller.getState().settings.automation.threadCount).toBe(17);
    await controller.save();
    expect(saveSpy.mock.calls[0][0].settings.automation.threadCount).toBe(17);
  });

  it('no decrypted secret or stored credential value is ever accepted by load state; only isConfigured/masked metadata is stored', async () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);

    await controller.load();

    const state = controller.getState();
    const statuses = Object.values(state.credentialStatuses);
    for (const status of statuses) {
      const statusRecord = status as unknown as Record<string, unknown>;
      expect(statusRecord.apiKey).toBeUndefined();
      expect(statusRecord.token).toBeUndefined();
      expect(statusRecord.password).toBeUndefined();
      expect(statusRecord.encryptedCredentials).toBeUndefined();
      expect(typeof status.isConfigured).toBe('boolean');
      expect(typeof status.isStale).toBe('boolean');
      expect(typeof status.metadata.maskedHint).toBe('string');
    }
  });

  it('B14 preserves edits made while an earlier save is pending', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let finish!: (v: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const c = new SettingsController(bridge);
    await c.load();
    const saving = c.save();
    c.updateSettings((s) => ({
      ...s,
      browser: {
        ...s.browser,
        multilogin: { ...s.browser.multilogin, port: 54321 },
      },
    }));
    c.setSimpleDraft('gmail94', { action: 'replace', value: 'KEY-NEW-DEMO' });
    finish({ success: true, data: { success: true } });
    await saving;
    expect(c.getState().settings.browser.multilogin.port).toBe(54321);
    expect(c.getState().drafts.gmail94).toEqual({ action: 'replace', value: 'KEY-NEW-DEMO' });
    expect(c.getState().isSaved).toBe(false);

    // Saving again with the new edits
    const secondSave = await c.save();
    expect(secondSave).toBe(true);
    expect(c.getState().isSaved).toBe(true);
    expect(c.getState().drafts.gmail94).toEqual({ action: 'keep' });
  });

  it('B14 preserves edits made while an earlier save fails', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let finish!: (v: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const c = new SettingsController(bridge);
    await c.load();
    const saving = c.save();
    c.setSimpleDraft('gmail94', { action: 'replace', value: 'KEY-NEW-DEMO' });
    finish({
      success: false,
      error: { code: 'ERR_PERSISTENCE_FAILED', message: 'disk failure' }
    });
    await saving;
    expect(c.getState().drafts.gmail94).toEqual({ action: 'replace', value: 'KEY-NEW-DEMO' });
    expect(c.getState().isSaved).toBe(false);
  });
});

describe('T09: Settings hydration and committed boot prefs', () => {
  it('getLastCommittedGeneral returns null initially and committed general after successful save', async () => {
    const { bridge } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();

    expect(controller.getLastCommittedGeneral()).toBeNull();

    controller.updateSettings((s) => ({
      ...s,
      general: { ...s.general, theme: 'dark', sessionRestore: true },
    }));

    const saved = await controller.save();
    expect(saved).toBe(true);

    const committed = controller.getLastCommittedGeneral();
    expect(committed).not.toBeNull();
    expect(committed?.general.theme).toBe('dark');
    expect(committed?.general.sessionRestore).toBe(true);
  });

  it('preserves user edits made while load() is pending', async () => {
    const { bridge, getSpy } = createMockBridge();
    let resolveGet!: (val: unknown) => void;
    getSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveGet = resolve; }));

    const controller = new SettingsController(bridge);
    const loading = controller.load();

    // User edits while load is pending
    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'my-draft-key' });
    controller.updateSettings((s) => ({
      ...s,
      general: { ...s.general, theme: 'dark' },
    }));

    // Now load resolves with server defaults
    resolveGet({
      success: true,
      data: {
        settings: DEFAULT_APP_SETTINGS,
        credentials: [],
      },
    });

    await loading;

    // Touched draft and touched settings should NOT be overwritten by server response
    expect(controller.getState().drafts.gmail94).toEqual({ action: 'replace', value: 'my-draft-key' });
    expect(controller.getState().settings.general.theme).toBe('dark');
  });

  it('save() succeeds and records lastCommittedGeneral even if post-save refresh rejects', async () => {
    const { bridge, getSpy } = createMockBridge();
    const controller = new SettingsController(bridge);
    await controller.load();

    // Make refresh reject
    getSpy.mockRejectedValueOnce(new Error('temporary refresh timeout'));

    controller.updateSettings((s) => ({
      ...s,
      general: { ...s.general, theme: 'light' },
    }));

    const saved = await controller.save();
    expect(saved).toBe(true);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().warning).toContain('làm mới');
    expect(controller.getLastCommittedGeneral()?.general.theme).toBe('light');
  });

  it('F06 (AG08): save pending -> dispose -> old ack does not notify old listener and leaves new generation state untouched', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let resolveSave!: (val: unknown) => void;
    saveSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    const controller = new SettingsController(bridge);
    await controller.load();
    let listenerCalls = 0;
    controller.subscribe(() => { listenerCalls++; });

    controller.updateSettings((s) => ({
      ...s,
      general: { ...s.general, theme: 'dark' },
    }));

    const saving = controller.save();
    controller.dispose();
    const callsAtDispose = listenerCalls;

    // After dispose, save resolves
    resolveSave({ success: true, data: { success: true } });
    const result = await saving;

    expect(result).toBe(true);
    // Listener from disposed session should not receive further updates after dispose
    expect(listenerCalls).toBe(callsAtDispose);
  });

  it('settles save ownership after replay', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let resolve!: (reply: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const controller = new SettingsController(bridge);
    await controller.load();
    const saving = controller.save();
    controller.dispose();
    await controller.load();
    resolve({ success: true, data: { success: true } });
    expect(await saving).toBe(true);
    expect(controller.getState().isSaving).toBe(false);
    expect(await controller.save()).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it('settles save ownership after replay when commit rejects without polluting new generation', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let rejectSave!: (err: Error) => void;
    saveSpy.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    const controller = new SettingsController(bridge);
    await controller.load();
    const saving = controller.save();
    controller.dispose();
    await controller.load();
    rejectSave(new Error('IPC crash'));
    expect(await saving).toBe(false);
    expect(controller.getState().isSaving).toBe(false);
    expect(controller.getState().error).toBeNull();
  });

  it('settles save ownership after replay when post-save refresh rejects without publishing warning to new generation', async () => {
    const { bridge, getSpy, saveSpy } = createMockBridge();
    let resolveSave!: (reply: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((done) => { resolveSave = done; }));
    const controller = new SettingsController(bridge);
    await controller.load();
    const saving = controller.save();
    controller.dispose();
    await controller.load();
    // Simulate refresh failure for the old save's post-save refresh
    getSpy.mockRejectedValueOnce(new Error('post-save refresh timeout'));
    resolveSave({ success: true, data: { success: true } });
    expect(await saving).toBe(true);
    expect(controller.getState().isSaving).toBe(false);
    expect(controller.getState().warning).toBeNull();
  });

  it('preserves new edits in replayed session when old in-flight save resolves', async () => {
    const { bridge, saveSpy } = createMockBridge();
    let resolveSave!: (reply: IpcEnvelope<{ success: boolean }>) => void;
    saveSpy.mockImplementationOnce(() => new Promise((done) => { resolveSave = done; }));
    const controller = new SettingsController(bridge);
    await controller.load();
    const saving = controller.save();
    controller.dispose();
    await controller.load();
    controller.setSimpleDraft('gmail94', { action: 'replace', value: 'new-key-after-replay' });
    resolveSave({ success: true, data: { success: true } });
    expect(await saving).toBe(true);
    expect(controller.getState().isSaving).toBe(false);
    expect(controller.getState().drafts.gmail94).toEqual({ action: 'replace', value: 'new-key-after-replay' });
  });
});




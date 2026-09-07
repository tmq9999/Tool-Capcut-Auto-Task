import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRunTelemetry } from '../runTelemetry';
import type { AutomationEvidenceTerminalEvent, AutomationEvidenceEvent } from '../../../../shared/schemas/automation-evidence.schema';

const forbidden = [
  'secret@example.com',
  'capcut-password',
  'otp-123456',
  'profile-raw-id',
  '127.0.0.1:54321',
  'proxy.example:9000',
  'proxy-user',
  'proxy-pass',
  'cookie-secret',
  'authorization-secret'
];

describe('runTelemetry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('rejects path traversal in runId', () => {
    expect(() =>
      createRunTelemetry({
        userDataDir: tmpDir,
        runId: '../sneaky-run'
      })
    ).toThrow();

    expect(() =>
      createRunTelemetry({
        userDataDir: tmpDir,
        runId: 'run-1/nested'
      })
    ).toThrow();
  });

  it('serializes only run-local aliases and never raw identifiers or secrets', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId,
      now: () => new Date('2026-09-08T00:00:00.000Z')
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:01.000Z',
      type: 'run-start',
      mode: 'new',
      headed: true,
      stage: 1,
      workerTarget: 3,
      maxBillablePurchases: 5
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:02.000Z',
      type: 'stage',
      name: 'launch',
      state: 'start'
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:03.000Z',
      type: 'resource-snapshot',
      activeWorkers: 1,
      activeProfiles: 1,
      activeProxies: 1,
      activeMailReservations: 1
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:04.000Z',
      type: 'ui-queued',
      lane: 'foreground',
      label: 'test-gesture'
    });

    const terminalEvent: AutomationEvidenceTerminalEvent = {
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:05.000Z',
      type: 'terminal',
      state: 'completed',
      code: 'MAIL_LIMIT_REACHED',
      accepted: 1,
      completed: 1,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 0,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 0
    };

    await telemetry.close(terminalEvent);

    const filePath = telemetry.filePath();
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');

    // Verify all forbidden sentinels do not appear
    for (const secret of forbidden) {
      expect(content).not.toContain(secret);
    }

    // Verify run-local aliases appear
    expect(content).toContain('worker-1');
    expect(content).toContain('worker-1-session-1');
  });

  it('records queue wait, lease hold, quarantine, and confirmed stop order', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:01.000Z',
      type: 'ui-queued',
      lane: 'foreground',
      label: 'click-login'
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:02.000Z',
      type: 'ui-started',
      lane: 'foreground',
      label: 'click-login',
      waitMs: 150
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:03.000Z',
      type: 'ui-finished',
      lane: 'foreground',
      label: 'click-login',
      holdMs: 300
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:04.000Z',
      type: 'ui-quarantined',
      label: 'canvas-area',
      code: 'DOM_READ_TIMEOUT'
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:05.000Z',
      type: 'profile-stop',
      outcome: 'confirmed'
    });

    await telemetry.close({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:06.000Z',
      type: 'terminal',
      state: 'completed',
      code: 'MAIL_LIMIT_REACHED',
      accepted: 1,
      completed: 1,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 0,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 0
    });

    const lines = fs.readFileSync(telemetry.filePath(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(6);

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].type).toBe('ui-queued');
    expect(parsed[1].type).toBe('ui-started');
    expect(parsed[1].waitMs).toBe(150);
    expect(parsed[2].type).toBe('ui-finished');
    expect(parsed[2].holdMs).toBe(300);
    expect(parsed[3].type).toBe('ui-quarantined');
    expect(parsed[3].code).toBe('DOM_READ_TIMEOUT');
    expect(parsed[4].type).toBe('profile-stop');
    expect(parsed[4].outcome).toBe('confirmed');
    expect(parsed[5].type).toBe('terminal');
  });

  it('records exact task statuses and receipt times without request payloads', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      workerAlias: 'worker-1',
      sessionAlias: 'worker-1-session-1',
      at: '2026-09-08T00:00:01.000Z',
      type: 'task-checkpoint',
      fresh: true,
      final: false,
      observedAt: '2026-09-08T00:00:01.000Z',
      requiredAfter: '2026-09-08T00:00:00.000Z',
      serverTotal: 2,
      serverDone: 1,
      tasks: [
        { key: 'task-a', status: 4, errNo: 0 },
        { key: 'task-b', status: 1 }
      ]
    });

    await telemetry.close({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:02.000Z',
      type: 'terminal',
      state: 'completed',
      code: 'MAIL_LIMIT_REACHED',
      accepted: 1,
      completed: 1,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 0,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 0
    });

    const lines = fs.readFileSync(telemetry.filePath(), 'utf8').trim().split('\n');
    const checkpointEvent = JSON.parse(lines[0]);

    expect(checkpointEvent.type).toBe('task-checkpoint');
    expect(checkpointEvent.tasks).toEqual([
      { key: 'task-a', status: 4, errNo: 0 },
      { key: 'task-b', status: 1 }
    ]);
    expect(checkpointEvent.payload).toBeUndefined();
    expect(checkpointEvent.body).toBeUndefined();
  });

  it('rejects an event that contains an unknown field', () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    const invalidEvent = {
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:01.000Z',
      type: 'stage',
      name: 'auth',
      state: 'start',
      email: 'secret@example.com' // FORBIDDEN UNKNOWN FIELD
    } as unknown as AutomationEvidenceEvent;

    expect(() => telemetry.record(invalidEvent)).toThrow();
  });

  it('ignores late events after close and leaves the artifact byte-identical', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    await telemetry.close({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:01.000Z',
      type: 'terminal',
      state: 'completed',
      code: 'MAIL_LIMIT_REACHED',
      accepted: 1,
      completed: 1,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 0,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 0
    });

    const bytesBefore = fs.readFileSync(telemetry.filePath());

    // Late event after close
    telemetry.record({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:02.000Z',
      type: 'stage',
      name: 'cleanup',
      state: 'end'
    });

    const bytesAfter = fs.readFileSync(telemetry.filePath());
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  });

  it('closes idempotently and emits one terminal summary', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    const terminalEvent: AutomationEvidenceTerminalEvent = {
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:01.000Z',
      type: 'terminal',
      state: 'completed',
      code: 'MAIL_LIMIT_REACHED',
      accepted: 1,
      completed: 1,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 0,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 0
    };

    // Close concurrently twice
    await Promise.all([
      telemetry.close(terminalEvent),
      telemetry.close(terminalEvent)
    ]);

    const lines = fs.readFileSync(telemetry.filePath(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).type).toBe('terminal');

    // Verify last-run.json manifest
    const manifestPath = path.join(tmpDir, 'rollout-evidence', 'last-run.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest).toEqual({
      runId,
      artifact: `${runId}.jsonl`
    });
  });

  it('records billable attempts and ambiguous outcomes without provider identifiers', async () => {
    const runId = 'run-12345678-abcd-1234-abcd-123456789abc';
    const telemetry = createRunTelemetry({
      userDataDir: tmpDir,
      runId
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:01.000Z',
      type: 'purchase',
      provider: 'gmail94',
      outcome: 'attempted',
      attempted: 1,
      confirmed: 0,
      ambiguous: 0,
      budget: 10
    });

    telemetry.record({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:02.000Z',
      type: 'purchase',
      provider: 'gmail94',
      outcome: 'ambiguous',
      attempted: 1,
      confirmed: 0,
      ambiguous: 1,
      budget: 10
    });

    await telemetry.close({
      schemaVersion: 1,
      runId,
      at: '2026-09-08T00:00:03.000Z',
      type: 'terminal',
      state: 'blocked',
      code: 'PURCHASE_OUTCOME_UNKNOWN',
      accepted: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      skipped: 0,
      cleanupFailures: 0,
      purchaseAttempted: 1,
      purchaseConfirmed: 0,
      purchaseAmbiguous: 1
    });

    const lines = fs.readFileSync(telemetry.filePath(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(3);

    const purchase1 = JSON.parse(lines[0]);
    expect(purchase1.outcome).toBe('attempted');
    expect(purchase1.attempted).toBe(1);
    expect(purchase1.confirmed).toBe(0);
    expect(purchase1.ambiguous).toBe(0);

    const purchase2 = JSON.parse(lines[1]);
    expect(purchase2.outcome).toBe('ambiguous');
    expect(purchase2.ambiguous).toBe(1);

    const terminal = JSON.parse(lines[2]);
    expect(terminal.purchaseAttempted).toBe(1);
    expect(terminal.purchaseConfirmed).toBe(0);
    expect(terminal.purchaseAmbiguous).toBe(1);
  });
});

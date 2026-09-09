import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunTelemetry } from '../runTelemetry';
import type { AutomationEvidenceNonTerminalEvent, AutomationEvidenceTerminalEvent } from '../../../../shared/schemas/automation-evidence.schema';

const terminal: AutomationEvidenceTerminalEvent = {
  schemaVersion: 1, runId: 'run-boundary', at: '2026-09-08T00:00:00.000Z', type: 'terminal',
  mode: 'new', stage: 1, mailboxAcquisitions: 1, state: 'completed', code: 'MAIL_LIMIT_REACHED',
  accepted: 1, completed: 1, failed: 0, stopped: 0, skipped: 0, cleanupFailures: 0,
  purchaseAttempted: 1, purchaseConfirmed: 1, purchaseAmbiguous: 0
};

describe('run telemetry write authority', () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-boundary-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it('creates each run artifact exclusively and cannot append to an existing run', () => {
    const first = createRunTelemetry({ userDataDir: directory, runId: 'run-boundary' });
    expect(() => createRunTelemetry({ userDataDir: directory, runId: 'run-boundary' })).toThrow();
    expect(fs.readFileSync(first.filePath(), 'utf8')).toBe('');
  });

  it('rejects a terminal passed to record so close is the only terminal writer', async () => {
    const recorder = createRunTelemetry({ userDataDir: directory, runId: 'run-boundary' });
    expect(() => recorder.record(terminal as unknown as AutomationEvidenceNonTerminalEvent)).toThrow();
    await recorder.close(terminal);
    await recorder.close(terminal);
    expect(fs.readFileSync(recorder.filePath(), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('rejects another run id before writing bytes', () => {
    const recorder = createRunTelemetry({ userDataDir: directory, runId: 'run-boundary' });
    expect(() => recorder.record({ schemaVersion: 1, runId: 'run-other', at: terminal.at,
      type: 'stage', name: 'auth', state: 'start' })).toThrow();
    expect(fs.readFileSync(recorder.filePath(), 'utf8')).toBe('');
  });

  it('rejects secret-bearing event values without writing them or exposing them in errors', async () => {
    const recorder = createRunTelemetry({ userDataDir: directory, runId: 'run-boundary' });
    for (const secret of ['secret@example.invalid', 'authorization-secret', 'http://127.0.0.1:1234']) {
      let caught: unknown;
      try {
        recorder.record({ schemaVersion: 1, runId: terminal.runId, at: terminal.at,
          type: 'ui-queued', lane: 'foreground', label: secret } as unknown as AutomationEvidenceNonTerminalEvent);
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).not.toContain(secret);
    }
    await recorder.close(terminal);
    expect(fs.readFileSync(recorder.filePath(), 'utf8')).not.toMatch(/secret@example|authorization-secret|127\.0\.0\.1/);
  });
});

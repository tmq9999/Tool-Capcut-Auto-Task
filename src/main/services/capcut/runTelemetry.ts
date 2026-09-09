import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AutomationEvidenceEventSchema,
  EvidenceBaseSchema,
  TerminalEventSchema,
  type AutomationEvidenceNonTerminalEvent,
  type AutomationEvidenceTerminalEvent
} from '../../../shared/schemas/automation-evidence.schema';

export interface RunTelemetry {
  record(event: AutomationEvidenceNonTerminalEvent): void;
  close(summary: AutomationEvidenceTerminalEvent): Promise<void>;
  filePath(): string;
  artifactBasename(): string;
}

export function createRunTelemetry(options: {
  userDataDir: string;
  runId: string;
  now?: () => Date;
}): RunTelemetry {
  const { userDataDir, runId } = options;

  // Reject path traversal in runId
  if (!EvidenceBaseSchema.shape.runId.safeParse(runId).success || path.basename(runId) !== runId) {
    throw new Error('INVALID_ROLLOUT_RUN_ID');
  }

  const evidenceDir = path.join(userDataDir, 'rollout-evidence');
  const artifactName = `${runId}.jsonl`;
  const fullFilePath = path.join(evidenceDir, artifactName);
  const manifestPath = path.join(evidenceDir, 'last-run.json');

  // Ensure directory exists
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(fullFilePath, '', { encoding: 'utf8', flag: 'wx' });

  let isClosed = false;
  let closePromise: Promise<void> | null = null;

  const record = (event: AutomationEvidenceNonTerminalEvent): void => {
    if (isClosed) {
      // Ignore late events after close to preserve byte-identical artifact
      return;
    }

    const parsed = AutomationEvidenceEventSchema.safeParse(event);
    if (!parsed.success || parsed.data.type === 'terminal' || parsed.data.runId !== runId) {
      throw new Error('ROLLOUT_EVIDENCE_INVALID');
    }
    const line = JSON.stringify(parsed.data) + '\n';
    fs.appendFileSync(fullFilePath, line, 'utf8');
  };

  const close = async (summary: AutomationEvidenceTerminalEvent): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }

    closePromise = (async () => {
      if (isClosed) {
        return;
      }

      // Mark closed immediately to prevent any interleaved records
      isClosed = true;

      // Validate terminal summary
      const parsed = TerminalEventSchema.safeParse(summary);
      if (!parsed.success || parsed.data.runId !== runId) throw new Error('ROLLOUT_EVIDENCE_INVALID');
      const line = JSON.stringify(parsed.data) + '\n';
      fs.appendFileSync(fullFilePath, line, 'utf8');

      // Atomically write/replace last-run.json
      const manifestData = JSON.stringify({ runId, artifact: artifactName }, null, 2);
      const tmpManifest = `${manifestPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tmpManifest, manifestData, 'utf8');
      try {
        fs.renameSync(tmpManifest, manifestPath);
      } catch {
        // The manifest is optional convenience, never acceptance authority.
        // Omit its update if atomic replacement is unavailable.
        try {
          fs.unlinkSync(tmpManifest);
        } catch {
          // ignore unlink error
        }
      }
    })();

    return closePromise;
  };

  return {
    record,
    close,
    filePath: () => fullFilePath,
    artifactBasename: () => artifactName
  };
}

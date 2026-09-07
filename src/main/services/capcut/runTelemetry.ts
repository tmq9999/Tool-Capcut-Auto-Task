import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AutomationEvidenceEventSchema,
  TerminalEventSchema,
  type AutomationEvidenceEvent,
  type AutomationEvidenceTerminalEvent
} from '../../../shared/schemas/automation-evidence.schema';

export interface RunTelemetry {
  record(event: AutomationEvidenceEvent): void;
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
  if (!runId || runId.includes('..') || runId.includes('/') || runId.includes('\\') || path.basename(runId) !== runId) {
    throw new Error(`Invalid runId with potential path traversal: ${runId}`);
  }

  const evidenceDir = path.join(userDataDir, 'rollout-evidence');
  const artifactName = `${runId}.jsonl`;
  const fullFilePath = path.join(evidenceDir, artifactName);
  const manifestPath = path.join(evidenceDir, 'last-run.json');

  // Ensure directory exists
  fs.mkdirSync(evidenceDir, { recursive: true });

  let isClosed = false;
  let closePromise: Promise<void> | null = null;

  const record = (event: AutomationEvidenceEvent): void => {
    if (isClosed) {
      // Ignore late events after close to preserve byte-identical artifact
      return;
    }

    const validated = AutomationEvidenceEventSchema.parse(event);
    const line = JSON.stringify(validated) + '\n';
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
      const validatedTerminal = TerminalEventSchema.parse(summary);
      const line = JSON.stringify(validatedTerminal) + '\n';
      fs.appendFileSync(fullFilePath, line, 'utf8');

      // Atomically write/replace last-run.json
      const manifestData = JSON.stringify({ runId, artifact: artifactName }, null, 2);
      const tmpManifest = `${manifestPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tmpManifest, manifestData, 'utf8');
      try {
        fs.renameSync(tmpManifest, manifestPath);
      } catch {
        // Fallback for Windows cross-lock or atomic replace
        fs.copyFileSync(tmpManifest, manifestPath);
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

export const DEFAULT_SESSION_EVIDENCE_BYTES = 256 * 1024 * 1024;

export type EvidenceCategory = 'network' | 'screenshot' | 'artifact' | 'stream' | (string & {});

export interface EvidenceBudgetSnapshot {
  limitBytes: number;
  actualBytes: number;
  reservedBytes: number;
  rejectedBytes: number;
  rejectedReservations: number;
}

export interface Reservation {
  readonly category: EvidenceCategory;
  readonly reservedBytes: number;
  commit(actualBytes: number): void;
  release(): void;
}

function assertNonNegativeBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('EVIDENCE_INVALID_BYTES');
}

/** Synchronous byte accountant shared by every evidence sink in one session. */
export class SessionEvidenceBudget {
  private readonly limitBytes: number;
  private actualBytes = 0;
  private reservedBytes = 0;
  private rejectedBytes = 0;
  private rejectedReservations = 0;

  constructor(options: { maxBytes?: number } = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_SESSION_EVIDENCE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('EVIDENCE_INVALID_LIMIT');
    this.limitBytes = maxBytes;
  }

  reserve(category: EvidenceCategory, bytes: number): Reservation | null {
    assertNonNegativeBytes(bytes);
    if (this.actualBytes + this.reservedBytes + bytes > this.limitBytes) {
      this.rejectedBytes += bytes;
      this.rejectedReservations++;
      return null;
    }
    this.reservedBytes += bytes;
    let settled = false;
    const settle = () => {
      if (settled) throw new Error('EVIDENCE_RESERVATION_SETTLED');
      settled = true;
      this.reservedBytes -= bytes;
    };
    return {
      category,
      reservedBytes: bytes,
      commit: (actualBytes: number) => {
        assertNonNegativeBytes(actualBytes);
        if (settled) throw new Error('EVIDENCE_RESERVATION_SETTLED');
        if (actualBytes > bytes) throw new Error('EVIDENCE_COMMIT_EXCEEDS_RESERVATION');
        settle();
        this.actualBytes += actualBytes;
      },
      release: settle
    };
  }

  snapshot(): EvidenceBudgetSnapshot {
    return {
      limitBytes: this.limitBytes,
      actualBytes: this.actualBytes,
      reservedBytes: this.reservedBytes,
      rejectedBytes: this.rejectedBytes,
      rejectedReservations: this.rejectedReservations
    };
  }
}

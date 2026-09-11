export interface ProfileStopObservation {
  phase: 'token' | 'stop-request' | 'confirm-status' | 'cdp-close';
  remoteConfirmed: boolean;
}

export interface StopOptions {
  onPhase?: (observation: ProfileStopObservation) => void;
}

export interface ProfileStopDiagnostic {
  phase: 'token' | 'stop-request' | 'confirm-status' | 'cdp-close' | 'unknown';
  kind: 'provider-error' | 'deadline' | 'confirmation-timeout' | 'unexpected';
  providerCode?: string;
  httpStatus?: number;
  remoteConfirmed?: boolean;
}

export class ProfileStopError extends Error {
  readonly diagnostic: ProfileStopDiagnostic;
  override readonly cause?: unknown;

  constructor(diagnostic: ProfileStopDiagnostic, cause?: unknown, message?: string) {
    super(message || `Profile stop failed at phase "${diagnostic.phase}" (${diagnostic.kind})`);
    this.name = 'ProfileStopError';
    this.diagnostic = diagnostic;
    this.cause = cause;
  }
}

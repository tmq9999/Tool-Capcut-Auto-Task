import type {
  AutomationRunState,
  AutomationTerminalReasonDTO
} from '../../shared/schemas/automation.schema';

type TerminalState = Extract<AutomationRunState, 'blocked' | 'failed'>;

export class AutomationTerminalError extends Error {
  constructor(
    public readonly state: TerminalState,
    public readonly reason: AutomationTerminalReasonDTO,
    message: string
  ) {
    super(message);
    this.name = 'AutomationTerminalError';
  }
}

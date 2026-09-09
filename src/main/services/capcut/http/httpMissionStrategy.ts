import type { APIRequestContext } from 'playwright-core';
import type { CapcutHttpClient } from './CapcutHttpClient';
import { submitDesignChat, type DesignChatInput } from './designStudio';

export type HttpMissionMechanism = 'direct-http' | 'browser-http';
export interface HttpMissionJournal {
  accountId: string;
  operation: string;
  mechanism: HttpMissionMechanism;
  state: 'prepared' | 'dispatching' | 'accepted' | 'failed';
  at: string;
  refs?: Record<string, string>;
  errorCode?: string;
}

/** Account-scoped orchestrator. UI missions are not invoked by this strategy. */
export class HttpMissionStrategy {
  constructor(
    private readonly accountId: string,
    private readonly client: CapcutHttpClient,
    private readonly context: APIRequestContext,
    private readonly journal: (entry: HttpMissionJournal) => void,
  ) {}

  async designChat(input: DesignChatInput): Promise<void> {
    this.mark('design-chat', 'prepared');
    this.journal({ accountId: this.accountId, operation: 'design-chat', mechanism: 'direct-http', state: 'dispatching', at: new Date().toISOString() });
    try {
      const receipt = await submitDesignChat(this.client, input);
      this.journal({ accountId: this.accountId, operation: 'design-chat', mechanism: 'direct-http', state: 'accepted', at: new Date().toISOString(), refs: { threadId: receipt.threadId } });
    } catch (error) {
      this.journal({ accountId: this.accountId, operation: 'design-chat', mechanism: 'direct-http', state: 'failed', at: new Date().toISOString(), errorCode: error instanceof Error ? error.message : 'HTTP_ERROR' });
      throw error;
    }
  }

  requestContext(): APIRequestContext { return this.context; }

  /** Creator generation/confirm/poll/export are executed by the account CLI until wired into engine sessions. */
  readonly capabilities = {
    taskList: true,
    designChat: true,
    creatorGenerate: true,
    creatorConfirm: true,
    creatorPoll: true,
    creatorAssetExport: true,
    canvasEdit: true,
    pwa: false,
    notifications: false,
  } as const;

  private mark(operation: string, state: HttpMissionJournal['state']): void {
    this.journal({ accountId: this.accountId, operation, mechanism: 'direct-http', state, at: new Date().toISOString() });
  }
}

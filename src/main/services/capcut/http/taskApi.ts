import type { HttpJsonClient } from './httpTypes';
import type { TaskSnapshot } from './taskTypes';
import { parseHttpTaskList } from './taskClient';

export class CapcutHttpTaskApi {
  readonly mechanism: 'direct-http' | 'browser-http';
  constructor(private readonly client: HttpJsonClient, mechanism: 'direct-http' | 'browser-http' = 'browser-http') {
    this.mechanism = mechanism;
  }

  async getTaskList(signal?: AbortSignal): Promise<TaskSnapshot> {
    signal?.throwIfAborted();
    const response = await this.client.requestJson<unknown>({
      path: '/luckycat/i18n/capcut/task/v1/task_list',
      method: 'POST',
      body: { scene: 'capcut_web_task' },
      effect: 'read',
      signal,
    });
    if (!response.ok) throw new Error('CAPCUT_HTTP_TASK_LIST_' + response.status);
    signal?.throwIfAborted();
    return parseHttpTaskList(response.data);
  }
}

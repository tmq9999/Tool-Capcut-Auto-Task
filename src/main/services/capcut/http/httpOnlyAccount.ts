import { createHttpOnlySession, type HttpSessionMaterial, type LiveHttpSession } from './httpSessionFactory';
import { createHttpOnlyTransport } from './httpOnlyTransport';
import { CapcutHttpTaskApi } from './taskApi';
import { HttpOnlyRunner, type HttpMissionOperation, type HttpOnlyRunResult } from './httpOnlyRunner';

export interface HttpOnlyAccountRun {
  liveSession: LiveHttpSession;
  result: HttpOnlyRunResult;
}

/** Pure HTTP account entrypoint. It never creates a browser or UI session. */
export async function runHttpOnlyAccount(material: HttpSessionMaterial, operations: readonly HttpMissionOperation[], signal: AbortSignal): Promise<HttpOnlyAccountRun> {
  signal.throwIfAborted();
  const liveSession = await createHttpOnlySession(material);
  try {
    const client = createHttpOnlyTransport(liveSession.session);
    const taskApi = new CapcutHttpTaskApi(client, 'direct-http');
    const result = await new HttpOnlyRunner({ getTaskList: (requestSignal) => taskApi.getTaskList(requestSignal) }, operations).run(liveSession.session, signal);
    return { liveSession, result };
  } catch (error) {
    await liveSession.dispose();
    throw error;
  }
}

import React, { StrictMode, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ExportDialog } from '@renderer/pages/Accounts/ExportDialog';
import { TaskProgressDialog } from '@renderer/pages/Accounts/TaskProgressDialog';
import { EditAccountDrawer } from '@renderer/pages/Accounts/EditAccountDrawer';
import '@renderer/styles/index.css';
import type { AccountExportRequestDTO } from '@shared/schemas/account-export.schema';
import type { ExportOutcome } from '@renderer/pages/Accounts/accountsController';
import type { AccountTasksResponseDTO } from '@shared/schemas/account-task.schema';
import type { Account } from '@shared/types/account';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function FixtureApp() {
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCalls, setExportCalls] = useState(0);
  const [lastExportRequest, setLastExportRequest] = useState<AccountExportRequestDTO | null>(null);
  const currentExportDeferred = useRef<Deferred<ExportOutcome> | null>(null);

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskAccountId, setTaskAccountId] = useState<string | null>(null);
  const [taskEmail, setTaskEmail] = useState('');
  const [taskCalls, setTaskCalls] = useState(0);
  const currentTaskDeferred = useRef<Deferred<AccountTasksResponseDTO | null> | null>(null);
  const taskDeferredMap = useRef<Map<string, Deferred<AccountTasksResponseDTO | null>>>(new Map());

  const [editOpen, setEditOpen] = useState(false);
  const [savedAccount, setSavedAccount] = useState<Account | null>(null);
  const legacyAccount: Account = {
    id: 'acc-legacy-1',
    email: 'legacy@domain.test',
    provider: 'legacy-special-provider',
    status: 'active',
    notes: 'initial note',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  };

  const handleExport = React.useCallback((req: AccountExportRequestDTO): Promise<ExportOutcome> => {
    setExportCalls((c) => c + 1);
    setLastExportRequest(req);
    const deferred = createDeferred<ExportOutcome>();
    currentExportDeferred.current = deferred;
    return deferred.promise;
  }, []);

  const handleLoadTasks = React.useCallback((accId: string): Promise<AccountTasksResponseDTO | null> => {
    setTaskCalls((c) => c + 1);
    const deferred = createDeferred<AccountTasksResponseDTO | null>();
    currentTaskDeferred.current = deferred;
    taskDeferredMap.current.set(accId, deferred);
    return deferred.promise;
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="open-export"
          onClick={() => setExportOpen(true)}
          className="px-2 py-1 bg-primary text-white rounded"
        >
          Open Export
        </button>
        <button
          data-testid="close-export"
          onClick={() => setExportOpen(false)}
          className="px-2 py-1 bg-secondary text-white rounded"
        >
          Close Export
        </button>
        <button
          data-testid="resolve-export"
          onClick={() => {
            currentExportDeferred.current?.resolve({
              kind: 'done',
              filePath: 'C:/exports/accounts.txt',
              exportedCount: 5
            });
          }}
          className="px-2 py-1 bg-success text-white rounded"
        >
          Resolve Export
        </button>
        <button
          data-testid="reject-export"
          onClick={() => {
            currentExportDeferred.current?.reject(new Error('Export worker failed'));
          }}
          className="px-2 py-1 bg-error text-white rounded"
        >
          Reject Export
        </button>
        <button
          data-testid="cancel-export"
          onClick={() => {
            currentExportDeferred.current?.resolve({ kind: 'canceled' });
          }}
          className="px-2 py-1 bg-warning text-white rounded"
        >
          Cancel Export
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          data-testid="open-task-a"
          onClick={() => {
            setTaskAccountId('acc-A');
            setTaskEmail('accountA@test.com');
            setTaskOpen(true);
          }}
          className="px-2 py-1 bg-primary text-white rounded"
        >
          Open Task A
        </button>
        <button
          data-testid="open-task-b"
          onClick={() => {
            setTaskAccountId('acc-B');
            setTaskEmail('accountB@test.com');
            setTaskOpen(true);
          }}
          className="px-2 py-1 bg-primary text-white rounded"
        >
          Open Task B
        </button>
        <button
          data-testid="close-task"
          onClick={() => setTaskOpen(false)}
          className="px-2 py-1 bg-secondary text-white rounded"
        >
          Close Task
        </button>
        <button
          data-testid="resolve-task-a"
          onClick={() => {
            const def = taskDeferredMap.current.get('acc-A');
            def?.resolve({
              items: [
                {
                  taskKey: 'task_a_1',
                  title: 'Task A1',
                  reward: 20,
                  status: 4,
                  opId: 'op-a',
                  provedAt: '2026-09-10T00:00:00.000Z',
                  updatedAt: '2026-09-10T00:00:00.000Z'
                }
              ],
              doneCount: 1,
              creditsEarned: 20,
              verification: {
                state: 'verified',
                runId: 'run-a',
                observedAt: '2026-09-10T00:00:00.000Z',
                serverTotal: 1,
                serverDone: 1
              }
            });
          }}
          className="px-2 py-1 bg-success text-white rounded"
        >
          Resolve Task A
        </button>
        <button
          data-testid="resolve-task-b"
          onClick={() => {
            const def = taskDeferredMap.current.get('acc-B');
            def?.resolve({
              items: [
                {
                  taskKey: 'task_b_1',
                  title: 'Task B1',
                  reward: 40,
                  status: 4,
                  opId: 'op-b',
                  provedAt: '2026-09-10T00:00:00.000Z',
                  updatedAt: '2026-09-10T00:00:00.000Z'
                }
              ],
              doneCount: 1,
              creditsEarned: 40,
              verification: {
                state: 'verified',
                runId: 'run-b',
                observedAt: '2026-09-10T00:00:00.000Z',
                serverTotal: 1,
                serverDone: 1
              }
            });
          }}
          className="px-2 py-1 bg-success text-white rounded"
        >
          Resolve Task B
        </button>
        <button
          data-testid="reject-task-b"
          onClick={() => {
            const def = taskDeferredMap.current.get('acc-B');
            def?.reject(new Error('Task DB unreachable for B'));
          }}
          className="px-2 py-1 bg-error text-white rounded"
        >
          Reject Task B
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          data-testid="open-edit-legacy"
          onClick={() => setEditOpen(true)}
          className="px-2 py-1 bg-primary text-white rounded"
        >
          Open Edit Legacy
        </button>
        <button
          data-testid="close-edit-legacy"
          onClick={() => setEditOpen(false)}
          className="px-2 py-1 bg-secondary text-white rounded"
        >
          Close Edit Legacy
        </button>
      </div>

      <div className="flex gap-4">
        <div>Export Calls: <span data-testid="export-calls">{exportCalls}</span></div>
        <div>Task Calls: <span data-testid="task-calls">{taskCalls}</span></div>
      </div>

      <div data-testid="export-request-json" className="hidden">{JSON.stringify(lastExportRequest)}</div>
      <div data-testid="saved-account-json" className="hidden">{JSON.stringify(savedAccount)}</div>

      <ExportDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        checkedCount={2}
        filteredCount={5}
        totalCount={10}
        exportFields={['email', 'passwordCapcut', 'credit']}
        defaultFormat="TXT"
        checkedIds={['acc-1', 'acc-2']}
        currentFilter={{ query: 'test' }}
        onExport={handleExport}
      />

      <TaskProgressDialog
        isOpen={taskOpen}
        onClose={() => setTaskOpen(false)}
        accountId={taskAccountId}
        email={taskEmail}
        loadTasks={handleLoadTasks}
      />

      <EditAccountDrawer
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        account={legacyAccount}
        onSaveAccount={(updated) => {
          setSavedAccount(updated);
          setEditOpen(false);
        }}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <FixtureApp />
  </StrictMode>
);

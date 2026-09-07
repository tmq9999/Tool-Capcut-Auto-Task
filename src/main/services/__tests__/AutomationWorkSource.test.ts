import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationRunConfigSchema } from '../../../shared/schemas/automation.schema';
import type { EmailSourceProvider } from '../../../shared/schemas/provider.schema';
import type {
  EmailAcquisitionSession,
  ReservedEmail
} from '../EmailPurchaseService';
import {
  createAutomationWorkSourceFactory,
  type AutomationWorkItem
} from '../AutomationWorkSource';

const CONFIG = AutomationRunConfigSchema.parse({
  threadCount: 2,
  browser: 'multilogin',
  headless: false,
  retryCount: 0,
  stepDelayMinMs: 0,
  stepDelayMaxMs: 0,
  typeDelayMinMs: 0,
  typeDelayMaxMs: 0,
  module: 'credit',
  skipWithoutTrial: false,
  emailSource: { mode: 'manual', entries: ['seed@example.com'] },
  proxy: { mode: 'direct', entries: [] },
  password: {
    mode: 'random',
    length: 12,
    uppercase: true,
    numbers: true,
    special: false
  }
});

class FakeAcquisitionSession implements EmailAcquisitionSession {
  public acquireCalls: string[] = [];
  public committed: Array<{ reservationId: string; accountId: string }> = [];
  public released: string[] = [];
  private counter = 0;

  async acquireOne(
    workerId: string,
    _signal: AbortSignal
  ): Promise<ReservedEmail> {
    this.acquireCalls.push(workerId);
    this.counter += 1;
    return {
      reservationId: 'reservation-' + this.counter,
      purchasedEmail: {
        id: 'pe-' + this.counter,
        provider: 'gmail94',
        email: 'mail' + this.counter + '@gmail.com',
        hasPassword: false,
        hasOauth: false,
        orderId: 'order-' + this.counter,
        service: 'capcut',
        purchasedAt: '2026-09-05T00:00:00.000Z',
        consumedAt: null
      }
    };
  }

  commit(reservation: ReservedEmail, accountId: string): void {
    this.committed.push({ reservationId: reservation.reservationId, accountId });
  }

  release(reservation: ReservedEmail): void {
    this.released.push(reservation.reservationId);
  }
}

let fakeSession: FakeAcquisitionSession;
let fakeEmailService: {
  openCalls: Array<{ provider: string; initialConcurrency: number }>;
  openAcquisitionSession(
    provider: EmailSourceProvider,
    initialConcurrency: number,
    options: { service?: string },
    signal: AbortSignal
  ): Promise<EmailAcquisitionSession>;
};

beforeEach(() => {
  fakeSession = new FakeAcquisitionSession();
  fakeEmailService = {
    openCalls: [] as Array<{ provider: string; initialConcurrency: number }>,
    async openAcquisitionSession(
      provider: EmailSourceProvider,
      initialConcurrency: number,
      _options: { service?: string },
      _signal: AbortSignal
    ): Promise<EmailAcquisitionSession> {
      this.openCalls.push({ provider, initialConcurrency });
      return fakeSession;
    }
  };
});

describe('AutomationWorkSource', () => {
  it('does not refill a failed billable acquisition slot', async () => {
    fakeSession.acquireOne = async (id) => {
      fakeSession.acquireCalls.push(id);
      throw new Error('ambiguous purchase');
    };
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG, mailLimit: 1, emailSource: { mode: 'api', provider: 'gmail94' }
    }, 'failed-slot');
    const signal = new AbortController().signal;
    await source.prepare(1, signal);
    await expect(source.next('worker-1', signal)).rejects.toThrow('ambiguous purchase');
    expect(await source.next('worker-1', signal)).toBeNull();
    expect(fakeSession.acquireCalls).toHaveLength(1);
  });
  it('manual source returns every valid line once and then exhausts', async () => {
    const factory = createAutomationWorkSourceFactory(fakeEmailService);
    const source = factory.create({
      ...CONFIG,
      threadCount: 2,
      emailSource: {
        mode: 'manual',
        entries: ['one@example.com|pw1', 'two@example.com|pw2', 'one@example.com|pw1']
      }
    }, 'run-1');

    await expect(source.prepare(2, new AbortController().signal)).resolves.toEqual({
      workerTarget: 2
    });
    await expect(source.next('worker-1', new AbortController().signal))
      .resolves.toMatchObject({ email: 'one@example.com', emailPassword: 'pw1' });
    await expect(source.next('worker-2', new AbortController().signal))
      .resolves.toMatchObject({ email: 'two@example.com', emailPassword: 'pw2' });
    await expect(source.next('worker-1', new AbortController().signal))
      .resolves.toMatchObject({ email: 'one@example.com', emailPassword: 'pw1' });
    await expect(source.next('worker-1', new AbortController().signal)).resolves.toBeNull();
  });

  it('manual source rejects the complete set of invalid one-based line numbers', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      emailSource: {
        mode: 'manual',
        entries: ['good@example.com', 'not-an-email', '', 'also-bad']
      }
    }, 'run-1');

    await expect(source.prepare(2, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('2, 4')
    });
  });

  it('continuous source opens one session and asks it for every next item', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      threadCount: 1,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' }
    }, 'run-2');
    const signal = new AbortController().signal;

    await source.prepare(1, signal);
    const first = await source.next('worker-1', signal);
    source.commit(first as AutomationWorkItem, 'account-1');
    const second = await source.next('worker-1', signal);

    expect(first?.email).toBe('mail1@gmail.com');
    expect(second?.email).toBe('mail2@gmail.com');
    expect(fakeEmailService.openCalls).toHaveLength(1);
    expect(fakeSession.acquireCalls).toEqual(['run-2:worker-1', 'run-2:worker-1']);
    expect(fakeSession.committed).toEqual([{ reservationId: 'reservation-1', accountId: 'account-1' }]);
  });

  it('continuous source stops at mailLimit and never acquires a fourth mailbox', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      threadCount: 3,
      mailLimit: 3,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' }
    }, 'run-limit');
    const signal = new AbortController().signal;

    await expect(source.prepare(3, signal)).resolves.toMatchObject({ workerTarget: 3 });
    await source.next('worker-1', signal);
    await source.next('worker-2', signal);
    await source.next('worker-3', signal);
    await expect(source.next('worker-1', signal)).resolves.toBeNull();
    expect(fakeSession.acquireCalls).toHaveLength(3);
  });

  it('reserves the limit before concurrent acquisition awaits', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG, mailLimit: 3, emailSource: { mode: 'api', provider: 'gmail94' }
    }, 'race');
    const signal = new AbortController().signal;
    await source.prepare(3, signal);
    const items = await Promise.all(Array.from({ length: 6 }, (_, i) => source.next('worker-' + i, signal)));
    expect(items.filter(Boolean)).toHaveLength(3);
    expect(fakeSession.acquireCalls).toHaveLength(3);
    for (const item of items) if (item) source.release(item);
    expect(await source.next('again', signal)).toBeNull();
  });

  it('preflights only the limited initial wave', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG, mailLimit: 2, emailSource: { mode: 'api', provider: 'gmail94' }
    }, 'small');
    expect((await source.prepare(10, new AbortController().signal)).workerTarget).toBe(2);
    expect(fakeEmailService.openCalls[0].initialConcurrency).toBe(2);
  });

  it('does not acquire after Stop', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG, mailLimit: 3, emailSource: { mode: 'api', provider: 'gmail94' }
    }, 'stop');
    const controller = new AbortController();
    await source.prepare(3, controller.signal);
    controller.abort(new Error('Stop'));
    await expect(source.next('worker', controller.signal)).rejects.toThrow('Stop');
    expect(fakeSession.acquireCalls).toHaveLength(0);
  });

  it('limits manual entries without purchasing', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG, mailLimit: 1, emailSource: { mode: 'manual', entries: ['one@example.com', 'two@example.com'] }
    }, 'manual-limit');
    const signal = new AbortController().signal;
    expect((await source.prepare(3, signal)).workerTarget).toBe(1);
    expect(await source.next('worker', signal)).not.toBeNull();
    expect(await source.next('worker', signal)).toBeNull();
    expect(fakeSession.acquireCalls).toHaveLength(0);
  });

  it('continuous source releases reservation when item is released', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      threadCount: 1,
      emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' }
    }, 'run-rel');
    const signal = new AbortController().signal;

    await source.prepare(1, signal);
    const item = await source.next('worker-1', signal);
    expect(item).not.toBeNull();
    source.release(item as AutomationWorkItem);
    expect(fakeSession.released).toEqual(['reservation-1']);
  });

  it('maps custom emailSource mode to customdomain provider', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      threadCount: 1,
      emailSource: { mode: 'custom' }
    }, 'run-custom');
    const signal = new AbortController().signal;

    await source.prepare(1, signal);
    expect(fakeEmailService.openCalls).toEqual([{ provider: 'customdomain', initialConcurrency: 1 }]);
  });

  it('reduces only manual workerTarget when the finite list is shorter', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      threadCount: 5,
      emailSource: {
        mode: 'manual',
        entries: ['one@example.com', 'two@example.com']
      }
    }, 'run-short-manual');
    const signal = new AbortController().signal;

    await expect(source.prepare(5, signal)).resolves.toEqual({ workerTarget: 2 });
    await expect(source.next('worker-1', signal))
      .resolves.toMatchObject({ sourceId: 'manual:1', email: 'one@example.com' });
    await expect(source.next('worker-2', signal))
      .resolves.toMatchObject({ sourceId: 'manual:2', email: 'two@example.com' });
    await expect(source.next('worker-1', signal)).resolves.toBeNull();
  });

  it('throws CONFIG_ERROR when manual source has no valid entries', async () => {
    const source = createAutomationWorkSourceFactory(fakeEmailService).create({
      ...CONFIG,
      emailSource: {
        mode: 'manual',
        entries: ['', '   ', '']
      }
    }, 'run-empty');

    await expect(source.prepare(2, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('trống')
    });
  });

  it('does not open an email acquisition session for existing mode', async () => {
    const mockCredentialReader = vi.fn((id: string) => ({
      accountId: id,
      email: `${id}@example.com`,
      emailProvider: 'manual',
      capcutPassword: 'pass'
    }));

    const source = (createAutomationWorkSourceFactory as unknown as (
      email: typeof fakeEmailService,
      creds: typeof mockCredentialReader
    ) => ReturnType<typeof createAutomationWorkSourceFactory>)(fakeEmailService, mockCredentialReader).create({
      ...CONFIG,
      threadCount: 3,
      emailSource: {
        mode: 'existing',
        accountIds: ['acc-1', 'acc-2', 'acc-3']
      }
    }, 'run-existing');

    const signal = new AbortController().signal;
    const readiness = await source.prepare(3, signal);

    expect(readiness.workerTarget).toBe(3);
    expect(fakeEmailService.openCalls).toHaveLength(0);

    const item1 = await source.next('w1', signal);
    expect(item1).toMatchObject({
      kind: 'existing',
      accountId: 'acc-1',
      email: 'acc-1@example.com',
      capcutPassword: 'pass'
    });
  });

  it('fails before browser launch when an account or saved password is missing', async () => {
    const mockCredentialReader = vi.fn((id: string) => {
      if (id === 'acc-missing') return null;
      if (id === 'acc-no-pass') {
        return null;
      }
      return {
        accountId: id,
        email: `${id}@example.com`,
        emailProvider: 'manual',
        capcutPassword: 'pass'
      };
    });

    const factory = (createAutomationWorkSourceFactory as unknown as (
      email: typeof fakeEmailService,
      creds: typeof mockCredentialReader
    ) => ReturnType<typeof createAutomationWorkSourceFactory>)(fakeEmailService, mockCredentialReader);

    // Case 1: missing ID
    const source1 = factory.create({
      ...CONFIG,
      emailSource: {
        mode: 'existing',
        accountIds: ['acc-1', 'acc-missing']
      }
    }, 'run-missing');

    await expect(source1.prepare(2, new AbortController().signal)).rejects.toThrow();

    // Case 2: missing password
    const source2 = factory.create({
      ...CONFIG,
      emailSource: {
        mode: 'existing',
        accountIds: ['acc-no-pass']
      }
    }, 'run-no-pass');

    await expect(source2.prepare(1, new AbortController().signal)).rejects.toThrow();
  });
});


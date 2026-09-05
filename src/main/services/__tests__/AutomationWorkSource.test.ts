import { describe, it, expect, beforeEach } from 'vitest';
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
});

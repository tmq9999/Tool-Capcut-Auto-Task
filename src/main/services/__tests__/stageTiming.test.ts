import { describe, expect, it } from 'vitest';
import { canonicalStageName, measureStage } from '../stageTiming';

describe('stageTiming', () => {
  it('converts display names and diacritics to lowercase kebab tokens', () => {
    expect(canonicalStageName('mission-action:Cài CapCut Web Desktop')).toBe(
      'mission-action:cai-capcut-web-desktop'
    );
    expect(canonicalStageName('  Đăng Ký OTP  ')).toBe('dang-ky-otp');
    expect(canonicalStageName('   ')).toBe('unknown');
  });

  it('logs monotonic elapsed time on success', async () => {
    const ticks = [100, 137];
    const messages: string[] = [];
    const value = await measureStage(
      'browser-launch',
      async () => 'ok',
      (message) => messages.push(message),
      () => ticks.shift() as number
    );

    expect(value).toBe('ok');
    expect(messages).toEqual([
      'stage=browser-launch elapsedMs=37 outcome=success'
    ]);
  });

  it('logs elapsed time and rethrows on failure without copying the error', async () => {
    const messages: string[] = [];
    await expect(measureStage(
      'email-acquisition',
      async () => {
        throw new Error('token=secret');
      },
      (message) => messages.push(message),
      (() => {
        const ticks = [10, 25];
        return () => ticks.shift() as number;
      })()
    )).rejects.toThrow('token=secret');

    expect(messages).toEqual([
      'stage=email-acquisition elapsedMs=15 outcome=error'
    ]);
    expect(messages[0]).not.toContain('secret');
  });

  it('normalizes display names into one parseable stage token', async () => {
    const ticks = [50, 51];
    const messages: string[] = [];

    await measureStage(
      'mission-action:Cài CapCut Web Desktop',
      async () => undefined,
      (message) => messages.push(message),
      () => ticks.shift() as number
    );

    expect(messages).toEqual([
      'stage=mission-action:cai-capcut-web-desktop elapsedMs=1 outcome=success'
    ]);
  });
});

import type { Page } from 'playwright-core';
import { boundedDomRead } from './cancellation';
import { foregroundPage } from './human';
import type { AccountUiInteraction } from './types';

export interface RendererHealth {
  elapsedMs: number;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

export async function checkRendererHealth(
  page: Page,
  options: {
    timeoutMs?: number;
    signal: AbortSignal;
    log?: (message: string) => void;
    ui: AccountUiInteraction;
  }
): Promise<RendererHealth> {
  if (!options.ui) throw new Error('UI_INTERACTION_REQUIRED');
  if (!options.signal) throw new Error('ABORT_SIGNAL_REQUIRED');
  options.signal.throwIfAborted();
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const viewport = await boundedDomRead(
    () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })),
    'renderer-viewport', timeoutMs, options.signal
  );
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width < 320 || viewport.height < 240) throw new Error('Renderer viewport is invalid or too small.');
  await boundedDomRead(
    () => page.evaluate(() => document.readyState),
    'renderer-evaluate', timeoutMs, options.signal
  );
  const { signal, ui } = options;
  await foregroundPage(
    page,
    { signal, stage: 'renderer-health:mouse', ui },
    () => boundedDomRead(
      () => page.mouse.move(Math.min(10, viewport.width - 1), Math.min(10, viewport.height - 1)),
      'renderer-mouse', timeoutMs, signal
    )
  );
  const elapsedMs = Date.now() - started;
  options.log?.(`Renderer health: ${elapsedMs}ms ${viewport.width}x${viewport.height}@${viewport.devicePixelRatio}`);
  return { elapsedMs, viewport };
}

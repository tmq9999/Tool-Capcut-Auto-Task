import type { BrowserContext, Page } from 'playwright-core';
import { URLS } from './urls';

export interface PrimaryPageResolverOptions {
  isExpectedClose?: () => boolean;
}

export class PrimaryPageResolver {
  private current: Page;
  private replacementsCreated = 0;
  private readonly watched = new Set<Page>();
  private readonly unusable = new WeakSet<Page>();
  private readonly listeners = new Map<Page, { onClose: () => void; onCrash: () => void }>();
  private disposed = false;

  constructor(
    private readonly context: BrowserContext,
    initialPage: Page,
    private readonly log: (message: string) => void,
    private readonly options?: PrimaryPageResolverOptions
  ) {
    this.current = initialPage;
    this.watch(initialPage);
  }

  private watch(page: Page): void {
    if (this.disposed || this.watched.has(page)) return;
    this.watched.add(page);

    const onClose = (): void => {
      this.unusable.add(page);
      if (this.disposed || this.options?.isExpectedClose?.()) {
        return;
      }
      this.log('Tab CapCut chính vừa đóng.');
    };

    const onCrash = (): void => {
      this.unusable.add(page);
      if (this.disposed) return;
      this.log('Tab CapCut chính vừa crash.');
    };

    this.listeners.set(page, { onClose, onCrash });
    page.on('close', onClose);
    page.on('crash', onCrash);
  }

  dispose(): void {
    this.disposed = true;
    for (const [page, { onClose, onCrash }] of this.listeners.entries()) {
      try {
        page.off('close', onClose);
        page.off('crash', onCrash);
      } catch {
        // ignore if page already closed or off not supported
      }
    }
    this.listeners.clear();
  }

  private isUsableCapcutPage(page: Page): boolean {
    if (page.isClosed() || this.unusable.has(page)) return false;
    try {
      return new URL(page.url()).origin === 'https://www.capcut.com';
    } catch {
      return false;
    }
  }

  async resolve(stage: string): Promise<Page> {
    if (!this.current.isClosed() && !this.unusable.has(this.current)) {
      return this.current;
    }

    const existing = this.context.pages()
      .filter((page) => this.isUsableCapcutPage(page))
      .at(-1);
    if (existing) {
      this.current = existing;
      this.watch(existing);
      this.log('Khôi phục tab CapCut từ page đang mở tại stage=' + stage + '.');
      return existing;
    }

    if (this.replacementsCreated >= 1) {
      throw new Error('Tab CapCut chính đã đóng lần thứ hai; hết ngân sách phục hồi.');
    }

    const replacement = await this.context.newPage();
    this.replacementsCreated += 1;
    this.current = replacement;
    this.watch(replacement);
    try {
      await replacement.goto(URLS.main, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
    } catch {
      this.unusable.add(replacement);
      throw new Error('Không điều hướng được tab CapCut thay thế.');
    }
    this.log('Đã tạo một tab CapCut thay thế tại stage=' + stage + '.');
    return replacement;
  }
}

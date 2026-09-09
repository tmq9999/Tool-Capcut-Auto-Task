import { expect, it, vi } from 'vitest';
import { HttpMissionStrategy } from '../httpMissionStrategy';

it('reports HTTP capability boundaries without claiming browser-only PWA prerequisites', () => {
  const strategy = new HttpMissionStrategy('account-1', {} as never, {} as never, vi.fn());
  expect(strategy.capabilities).toMatchObject({ taskList: true, designChat: true, creatorGenerate: true, canvasEdit: true, pwa: false, notifications: false });
});

/**
 * =============================================================================
 * URLS — ĐƯỜNG VÀO TỪNG KHU VỰC CỦA CAPCUT
 * =============================================================================
 * Copy nguyên từ `Automation_Capcut/src/missions.ts`. Tách thành file riêng để
 * `missionRunner` không phải kéo theo cả bộ nhiệm vụ chỉ vì cần một đường dẫn
 * (`withTaskPopover` phải sang `/my-edit` khi trang hiện tại không có lối vào
 * nhiệm vụ).
 * =============================================================================
 */

export const URLS = {
  main: 'https://www.capcut.com/my-edit?start_tab=video',
  inspirationFeeds:
    'https://www.capcut.com/my-edit?section=inspiration_feeds&enter_source=web_task_earn_credit',
  inspirationKey: (key: string) => `https://www.capcut.com/my-edit?inspirationKey=${key}`,
  aiDesign: 'https://www.capcut.com/ai-design',
  videoStudio: 'https://www.capcut.com/ai-creator/studio?enter_from=credit_task',
} as const;

import type { Page, BrowserContext, Route } from 'playwright-core';
import { ensurePageUsable } from '../overlays';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

/** Discovery only: never dispatch the canvas generation or its task acknowledgement. */
export async function discoverCanvasRequest(options: {
  page: Page; context: BrowserContext; sampleImage: string;
  persist: (stage: string, state: string, data: unknown) => void;
  report: (data: Record<string,unknown>) => void;
}) {
  const {page,context,persist,report} = options;
  const signal = new AbortController().signal;
  const ui = createDirectUiInteraction(signal);
  let observed: {url:string;headers:Record<string,string>;body:string} | undefined;
  let resolveRequest!: () => void;
  const seen = new Promise<void>(resolve => { resolveRequest=resolve; });
  const intercept = async (route: Route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path === '/lv/v2/intelligence/thread/run/start') {
      const body = req.postData();
      if (body) { observed={url:req.url(),headers:await req.allHeaders(),body}; persist('canvas-discovery','prepared-request',observed); }
      await route.abort('aborted'); resolveRequest(); return;
    }
    if (req.method() === 'POST' && path.endsWith('/task/v1/do_action')) {
      await route.abort('aborted'); return;
    }
    await route.continue();
  };
  await context.route('**/*',intercept);
  try {
    report({stage:'canvas-discovery-step',step:'navigate'});
    await page.setViewportSize({width:1600,height:1000});
    await page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
    await ensurePageUsable(page, () => {}, ui, signal);
    report({stage:'canvas-discovery-ready',mechanism:'ui-discovery',generationBlocked:true});
    report({stage:'canvas-discovery-step',step:'upload'});
    const upload = page.locator('[aria-label="Canvas tools"] [aria-label="Upload image"]');
    const chooser = page.waitForEvent('filechooser',{timeout:20000});
    await upload.click({timeout:30000});
    await (await chooser).setFiles(options.sampleImage);
    const hide = page.locator('[aria-label="Hide chat"]').first();
    if (await hide.isVisible()) await hide.click({timeout:5000});
    report({stage:'canvas-discovery-step',step:'select-canvas'});
    await page.locator('#graphic-editor-render').click({timeout:20000});
    const panel = page.locator('[aria-label="Canvas prompt panel"]');
    report({stage:'canvas-discovery-step',step:'open-prompt'});
    await panel.locator('[aria-label="Open canvas prompt"]').click({timeout:20000});
    const editor = panel.locator('[data-placeholder="Describe your design ideas"]');
    report({stage:'canvas-discovery-step',step:'fill-prompt'});
    await editor.fill('change background color to soft blue',{timeout:15000});
    if (await hide.isVisible()) await hide.click({timeout:5000});
    const send = panel.locator('[class*="expandedWrapper"] [aria-label="Send message"]');
    report({stage:'canvas-discovery-step',step:'send'});
    await send.click({timeout:15000});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([seen,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CANVAS_REQUEST_NOT_OBSERVED')),10000);})]); }
    finally {clearTimeout(timer);}
    if (!observed) throw new Error('CANVAS_REQUEST_BODY_MISSING');
    const body = JSON.parse(observed.body);
    report({stage:'canvas-discovery-prepared',mechanism:'ui-discovery',source:body.source,mode:body.mode,keys:Object.keys(body),contentTypes:body.contents?.map((c:{type:string})=>c.type),generationDispatched:false});
    return observed;
  } finally { await context.unroute('**/*',intercept); }
}

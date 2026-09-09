async function discoverThreadContract({page,context,persist,report}){
 let observed; let resolve;const pending=new Promise(r=>{resolve=r;});
 const handler=async route=>{
  const req=route.request();const url=new URL(req.url());
  if(req.method()==='POST'&&url.origin==='https://edit-api-sg.capcut.com'&&url.pathname==='/lv/v2/intelligence/thread/create'){
   observed={url:req.url(),body:req.postData(),headers:await req.allHeaders()};persist('thread-contract','blocked-request',observed);
   await route.abort('aborted');resolve();return;
  }
  if(req.method()==='POST'&&(url.pathname.endsWith('/thread/run/start')||url.pathname.endsWith('/task/v1/do_action'))){await route.abort('aborted');return;}
  await route.continue();
 };
 await context.route('**/*',handler);
 try{
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
  const panel=page.locator('#ai-design-chat-panel-container');
  await panel.locator('.tiptap.ProseMirror').last().fill('Hello, suggest a simple poster layout.',{timeout:20000});
  await panel.locator('[aria-label="Send message"]').last().click({timeout:15000});
  let timer;try{await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('THREAD_CONTRACT_NOT_OBSERVED')),15000);})]);}finally{clearTimeout(timer);}
  if(!observed?.body)throw new Error('THREAD_CONTRACT_BODY_MISSING');
  const body=JSON.parse(observed.body);
  report({stage:'thread-contract-captured',mechanism:'ui-discovery',serverDispatched:false,keys:Object.keys(body),source:body.source,headerKeys:Object.keys(observed.headers)});
  return observed;
 }finally{await context.unroute('**/*',handler);}
}
module.exports={discoverThreadContract};

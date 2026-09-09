async function discoverCreatorContract({page,context,persist,report}){
 let captured;let resolve;const observed=new Promise(r=>{resolve=r;});
 const handler=async route=>{
  const r=route.request();const url=new URL(r.url());
  if(r.method()==='POST'&&url.origin==='https://edit-api-sg.capcut.com'&&url.pathname==='/storyboard/v1/studio_draft/create_project'){
   captured={url:r.url(),body:r.postData(),headers:await r.allHeaders()};persist('creator-contract','blocked-project',captured);
   await route.abort('aborted');resolve();return;
  }
  if(r.method()==='POST'&&(url.pathname.endsWith('/ai_lab/send_msg')||url.pathname.endsWith('/task/v1/do_action'))){await route.abort('aborted');return;}
  await route.continue();
 };
 await context.route('**/*',handler);
 try{
  await page.goto('https://www.capcut.com/ai-creator/studio?enter_from=credit_task',{waitUntil:'domcontentloaded',timeout:45000});
  report({stage:'creator-discovery-step',step:'fill-prompt',mechanism:'ui-discovery'});
  await page.locator('#studio-chat [contenteditable="true"]').last().fill('Create a realistic image of a small black dog in a sunny garden.',{timeout:20000});
  const buttons=await page.locator('#studio-chat button, #studio-chat [role="button"]').evaluateAll(elements=>elements.map(el=>({tag:el.tagName,cls:el.className,label:el.getAttribute('aria-label'),text:(el.textContent??'').slice(0,80),disabled:el.hasAttribute('disabled'),html:el.outerHTML.slice(0,500)})));
  report({stage:'creator-send-controls',mechanism:'ui-discovery',buttons});
  await page.locator('#studio-chat [contenteditable="true"]').last().press('Enter',{timeout:15000});
  let timer;try{await Promise.race([observed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CREATOR_CONTRACT_NOT_OBSERVED')),15000);})]);}finally{clearTimeout(timer);}
  if(!captured?.body)throw new Error('CREATOR_PROJECT_BODY_MISSING');
  report({stage:'creator-project-contract',mechanism:'ui-discovery',serverDispatched:false,headerKeys:Object.keys(captured.headers),bodyKeys:Object.keys(JSON.parse(captured.body))});
  return captured;
 }catch(error){
  report({stage:'creator-discovery-surface',mechanism:'ui-discovery',path:new URL(page.url()).pathname,text:(await page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,1500).replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi,'<email>')});throw error;
 }finally{await context.unroute('**/*',handler);}
}
module.exports={discoverCreatorContract};

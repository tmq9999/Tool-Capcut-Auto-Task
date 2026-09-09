// Account-scoped, non-secret routing parameters observed on the web client.
function accountApiQuery(rows) {
  const required=['aid','device_platform','region','web_id'];
  for(const row of [...rows].reverse()){
    if(!row.request?.url)continue;
    const url=new URL(row.request.url);
    if(url.origin!=='https://edit-api-sg.capcut.com'||!required.every(k=>url.searchParams.get(k)))continue;
    return new URLSearchParams(required.map(k=>[k,url.searchParams.get(k)]));
  }
  throw new Error('ACCOUNT_API_QUERY_UNAVAILABLE');
}
module.exports={accountApiQuery};

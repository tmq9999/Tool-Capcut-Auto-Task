import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {uploadImagexBytes} from '../imagexUpload';
it('sends the upload address auth, binary bytes and CRC32 without DOM',async()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'imagex-')),'x.png');const bytes=Buffer.from([137,80,78,71,...Array(100).fill(1)]);fs.writeFileSync(file,bytes);const fetch=vi.fn().mockResolvedValue({status:()=>200,ok:()=>true,body:async()=>Buffer.from('{"code":2000,"data":{"crc32":"'+createHash('md5').update(bytes).digest('hex')+'"}}'),dispose:async()=>{}});const report=vi.fn();await uploadImagexBytes({context:{fetch} as never,address:{UploadHosts:['tos-d-alisg16-up.byteoversea.com'],StoreInfos:[{StoreUri:'tos-alisg-i/xasset',Auth:'Auth fresh'}]},file,signal:new AbortController().signal,report}).catch(()=>{});expect(fetch).toHaveBeenCalledWith('https://tos-d-alisg16-up.byteoversea.com/upload/v1/tos-alisg-i/xasset',expect.objectContaining({method:'POST',data:expect.any(Buffer),headers:expect.objectContaining({'Authorization':'Auth fresh','Content-CRC32':expect.any(String)})}));expect(report).toHaveBeenCalled();});

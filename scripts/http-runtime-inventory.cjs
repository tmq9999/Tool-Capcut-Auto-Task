const {app,safeStorage}=require('electron');
const path=require('node:path');
require('tsx/cjs');
const Database=require('better-sqlite3');
const {CredentialRepository}=require('../src/main/repositories/CredentialRepository.ts');
const {CredentialVault}=require('../src/main/security/CredentialVault.ts');
const {MultiloginAuthService}=require('../src/main/services/MultiloginAuthService.ts');
const {MultiloginProvider}=require('../src/main/providers/MultiloginProvider.ts');
const {FetchHttpClient}=require('../src/main/providers/HttpClient.ts');
const {SecretReader}=require('../src/main/services/SecretReader.ts');
const {KiotProxyProvider}=require('../src/main/providers/KiotProxyProvider.ts');
const {createHash}=require('node:crypto');
app.setPath('userData',path.join(app.getPath('appData'),'automanager-desktop'));
let code=1;
app.whenReady().then(async()=>{
 const db=new Database(path.join(app.getPath('userData'),'automanager.db'),{fileMustExist:true});
 try{
  const leases=db.prepare('SELECT id,account_id,acquired_at FROM proxy_leases WHERE released_at IS NULL').all();
  const api=new MultiloginProvider(new FetchHttpClient());
  const auth=new MultiloginAuthService(new CredentialRepository(db),new CredentialVault(safeStorage),api);
  const profiles=await api.getQuickProfileStatuses(await auth.getAccessToken(),10000);
  const release=process.argv.find(a=>a.startsWith('--release-orphan='))?.slice('--release-orphan='.length);
  if(release){
   if(profiles.some(p=>p.status!=='stopped'))throw Error('PROFILE_STILL_ACTIVE');
   const row=db.prepare('SELECT id,key_hash FROM proxy_leases WHERE id=? AND released_at IS NULL').get(release);
   if(!row)throw Error('LEASE_NOT_FOUND');
   const provider=new KiotProxyProvider(new FetchHttpClient());
   const token=new SecretReader(new CredentialRepository(db),new CredentialVault(safeStorage)).readSimpleKey('kiotproxy');
   const keys=await provider.listKeys(token);const key=keys.find(k=>createHash('sha256').update(k.keyValue).digest('hex')===row.key_hash);
   if(!key)throw Error('KEY_NOT_FOUND');await provider.releaseKey(key.keyValue);
   db.prepare("UPDATE proxy_leases SET released_at=datetime('now') WHERE id=? AND released_at IS NULL").run(release);
   console.log(JSON.stringify({releasedLease:release}));code=0;return;
  }
  console.log(JSON.stringify({leases,profiles}));code=0;
 }finally{db.close();}
}).catch(()=>console.error('RUNTIME_INVENTORY_FAILED')).finally(()=>app.exit(code));

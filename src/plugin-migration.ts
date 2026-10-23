import type {DataAdapter} from 'obsidian';

export const LEGACY_PLUGIN_ID='gloss-reader';
export const TARGET_PLUGIN_ID='banana-reader';
interface IdentityOptions {pluginId:string;mobile:boolean;configDir:string;adapter:DataAdapter;legacyActive?:boolean}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function validateStore(value:unknown){
 if(!record(value)||!record(value.settings)||!record(value.documents)||typeof value.version!=='number'||value.version<1||value.version>5)throw new Error('Legacy Reader data is invalid or uses an unsupported format.');
}

/** Run before loadData/saveData. Mobile never writes across plugin identities. */
export async function preparePluginIdentity(options:IdentityOptions){
 if(options.pluginId!==TARGET_PLUGIN_ID)return;
 if(!options.mobile){
  // Keep the published desktop migration's exclusive writes and symlink checks.
  const desktop=await import('./legacy-migration-desktop');
  const adapter=options.adapter as DataAdapter&{getBasePath():string};
  await desktop.migrateLegacyPluginData({vaultRoot:adapter.getBasePath(),configDir:options.configDir,pluginId:options.pluginId,legacyActive:options.legacyActive});return;
 }
 const plugins=options.configDir+'/plugins/',source=plugins+LEGACY_PLUGIN_ID,target=plugins+TARGET_PLUGIN_ID;
 if(!await options.adapter.exists(source+'/data.json'))return;
 if(options.legacyActive!==false)throw new Error('请先停用旧版 Reader，再启用 Banana Reader。旧记录尚未改动。');
 // DataAdapter cannot publish files exclusively. Do the initial copy on desktop;
 // on phones only verify the published receipt and leave both copies untouched.
 if(!await options.adapter.exists(target+'/legacy-migration.json'))throw new Error('检测到旧版 Reader 记录。请先在电脑完成旧版到 Banana Reader 的迁移，再同步到手机；不要删除旧插件数据。');
 const receipt:unknown=JSON.parse(await options.adapter.read(target+'/legacy-migration.json'));
 if(!record(receipt)||receipt.version!==1||receipt.from!==LEGACY_PLUGIN_ID||receipt.to!==TARGET_PLUGIN_ID||!record(receipt.sourceFiles))throw new Error('Reader 迁移凭据无效，请保留两份记录并在电脑检查。');
 const names=['data.json'];
 if(await options.adapter.exists(source+'/indices')){
  const listed=await options.adapter.list(source+'/indices');
  const prefix=source+'/indices/';
  if(listed.folders.length||listed.files.length>10_000||listed.files.some(path=>!path.startsWith(prefix)||!/^[a-f0-9]{64}\.json$/.test(path.slice(prefix.length))))throw new Error('旧版索引包含未识别的文件，请先在电脑检查。');
  names.push(...listed.files.map(path=>path.slice(source.length+1)).sort());
 }
 const inventory:Record<string,string>={};let total=0;
 for(const name of names){
  const path=source+'/'+name,stat=await options.adapter.stat(path);
  if(!stat||stat.type!=='file'||stat.size>120_000_000||(total+=stat.size)>512_000_000)throw new Error('旧版记录过大或格式异常，请先在电脑检查。');
  const bytes=await options.adapter.readBinary(path);
  inventory[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(name==='data.json')validateStore(JSON.parse(new TextDecoder().decode(bytes)));
 }
 const previous=receipt.sourceFiles;
 if(Object.keys(previous).length!==names.length||names.some(name=>(previous[name]??previous[name.replaceAll('/','\\')])!==inventory[name]))throw new Error('旧版 Reader 记录在迁移后有变化，请保留两份记录并在电脑核对。');
 validateStore(JSON.parse(await options.adapter.read(target+'/data.json')));
}

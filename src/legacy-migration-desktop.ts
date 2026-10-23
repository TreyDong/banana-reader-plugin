import {desktopModule} from './agent';
// This module is lazy-loaded on desktop; the loader also refuses native modules
// if mobile transport is active, before any require is performed.
const fs=(desktopModule('node:fs') as typeof import('node:fs')).promises;
const {Buffer}=desktopModule('node:buffer') as typeof import('node:buffer');
type NodeBuffer=ReturnType<typeof Buffer.alloc>;
const {createHash,randomUUID}=desktopModule('node:crypto') as typeof import('node:crypto');
const {dirname,isAbsolute,join,relative,resolve,sep}=desktopModule('node:path') as typeof import('node:path');

export const LEGACY_PLUGIN_ID='gloss-reader';
export const TARGET_PLUGIN_ID='banana-reader';
const RECEIPT='legacy-migration.json';
const MAX_FILE=120_000_000;
const MAX_TOTAL=512_000_000;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const missing=(error:unknown)=>record(error)&&error.code==='ENOENT';

interface MigrationOptions {vaultRoot:string;configDir:string;pluginId:string;legacyActive?:boolean}
interface CopyFile {name:string;bytes:NodeBuffer;sha256:string}
export interface MigrationPlan {source:string;target:string;files:CopyFile[]}
export type MigrationResult={status:'not-applicable'|'no-legacy-data'|'already-migrated'|'migrated';files:number};

async function exists(path:string){try{await fs.lstat(path);return true;}catch(error){if(missing(error))return false;throw error;}}
async function noSymlinks(root:string,path:string){
 if((await fs.lstat(root)).isSymbolicLink())throw new Error('Migration refuses symbolic links.');
 const tail=relative(root,path);if(isAbsolute(tail)||tail==='..'||tail.startsWith('..'+sep))throw new Error('Migration path escapes the vault.');
 let current=root;
 for(const part of tail.split(sep).filter(Boolean)){
  current=join(current,part);
  try{if((await fs.lstat(current)).isSymbolicLink())throw new Error('Migration refuses symbolic links.');}catch(error){if(missing(error))return;throw error;}
 }
}
function validateStore(bytes:NodeBuffer){
 const value:unknown=JSON.parse(bytes.toString('utf8'));
 if(!record(value)||!record(value.settings)||!record(value.documents)||typeof value.version!=='number'||value.version<1||value.version>5)throw new Error('Legacy Reader data is invalid or uses an unsupported format.');
 return value;
}
async function readCopy(root:string,name:string):Promise<CopyFile>{
 const path=join(root,name);await noSymlinks(root,path);const stat=await fs.stat(path);
 if(!stat.isFile()||stat.size>MAX_FILE)throw new Error('Migration source is not a supported regular file.');
 const bytes=await fs.readFile(path);return{name,bytes,sha256:digest(bytes)};
}
async function sourceFiles(source:string){
 const files=[await readCopy(source,'data.json')];validateStore(files[0].bytes);
 let total=files[0].bytes.length;
 if(await exists(join(source,'indices'))){
  await noSymlinks(source,join(source,'indices'));
  const names=(await fs.readdir(join(source,'indices'))).sort();
  if(names.length>10_000)throw new Error('Too many legacy index files to migrate automatically.');
  for(const name of names){
   if(!/^[a-f0-9]{64}\.json$/.test(name))throw new Error('Legacy indices contain an unexpected file; review them before migrating.');
   const file=await readCopy(source,join('indices',name));total+=file.bytes.length;
   if(total>MAX_TOTAL)throw new Error('Legacy data is too large to migrate automatically.');files.push(file);
  }
 }
 return files;
}
const inventory=(files:CopyFile[])=>Object.fromEntries(files.map(file=>[file.name,file.sha256]));
async function unchanged(plan:MigrationPlan){
 const current=await sourceFiles(plan.source);
 if(JSON.stringify(inventory(current))!==JSON.stringify(inventory(plan.files)))throw new Error('Legacy data changed during migration; no data was replaced.');
}
async function emptyDestination(target:string){
 for(const name of ['data.json','indices',RECEIPT])if(await exists(join(target,name)))throw new Error('Reader data already exists at the destination; automatic migration will not overwrite or merge it.');
}

/** Read-only preparation. No vault enumeration, credential access or network calls. */
export async function prepareLegacyMigration(options:MigrationOptions):Promise<MigrationPlan|MigrationResult>{
 if(options.pluginId!==TARGET_PLUGIN_ID)return{status:'not-applicable',files:0};
 if(options.legacyActive!==false)throw new Error('Disable the legacy Reader before migration. Its inactive state must be confirmed.');
 const root=await fs.realpath(options.vaultRoot),plugins=resolve(root,options.configDir,'plugins');await noSymlinks(root,plugins);
 const source=join(plugins,LEGACY_PLUGIN_ID),target=join(plugins,TARGET_PLUGIN_ID);
 await noSymlinks(root,source);await noSymlinks(root,target);
 if(!await exists(join(source,'data.json')))return{status:'no-legacy-data',files:0};
 await noSymlinks(root,join(target,'manifest.json'));
 const manifest:unknown=JSON.parse(await fs.readFile(join(target,'manifest.json'),'utf8'));
 if(!record(manifest)||manifest.id!==TARGET_PLUGIN_ID)throw new Error('Install the new Reader before importing legacy data.');
 const files=await sourceFiles(source);
 if(await exists(join(target,RECEIPT))){
  await noSymlinks(root,join(target,RECEIPT));await noSymlinks(root,join(target,'data.json'));
  const receipt:unknown=JSON.parse(await fs.readFile(join(target,RECEIPT),'utf8'));
  if(!record(receipt)||receipt.version!==1||receipt.from!==LEGACY_PLUGIN_ID||receipt.to!==TARGET_PLUGIN_ID||JSON.stringify(receipt.sourceFiles)!==JSON.stringify(inventory(files)))throw new Error('The migration receipt does not match the legacy data; manual reconciliation is required.');
  validateStore(await fs.readFile(join(target,'data.json')));
  return{status:'already-migrated',files:0};
 }
 await emptyDestination(target);return{source,target,files};
}

/** Copy only. Exclusive hard links prevent replacing concurrent destination data. */
export async function applyLegacyMigration(plan:MigrationPlan):Promise<MigrationResult>{
 await noSymlinks(dirname(plan.source),plan.source);await noSymlinks(dirname(plan.target),plan.target);
 await emptyDestination(plan.target);await unchanged(plan);
 const stage=join(plan.target,'.legacy-migration-'+randomUUID()),created:CopyFile[]=[];let indexDir=false;
 await fs.mkdir(stage);
 try{
  const receipt:CopyFile={name:RECEIPT,bytes:Buffer.from(JSON.stringify({version:1,from:LEGACY_PLUGIN_ID,to:TARGET_PLUGIN_ID,sourceFiles:inventory(plan.files)},null,2)+'\n'),sha256:''};receipt.sha256=digest(receipt.bytes);
  for(const file of [...plan.files,receipt]){const path=join(stage,file.name);await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,file.bytes,{flag:'wx',mode:0o600});if(digest(await fs.readFile(path))!==file.sha256)throw new Error('Staged migration data failed verification.');}
  await unchanged(plan);await emptyDestination(plan.target);
  if(plan.files.some(file=>file.name.startsWith('indices'+sep))){await fs.mkdir(join(plan.target,'indices'));indexDir=true;}
  for(const file of [...plan.files.filter(file=>file.name!=='data.json'),plan.files[0]]){await fs.link(join(stage,file.name),join(plan.target,file.name));created.push(file);}
  await unchanged(plan);
  await fs.link(join(stage,RECEIPT),join(plan.target,RECEIPT));created.push(receipt);
  return{status:'migrated',files:plan.files.length};
 }catch(error){
  for(const file of created.reverse()){
   const path=join(plan.target,file.name);
   // Never remove a file subsequently changed by another process.
   if(await exists(path)&&digest(await fs.readFile(path))===file.sha256)await fs.unlink(path);
  }
  if(indexDir)try{await fs.rmdir(join(plan.target,'indices'));}catch{/* Preserve concurrent files. */}
  throw error;
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}

export async function migrateLegacyPluginData(options:MigrationOptions):Promise<MigrationResult>{
 const plan=await prepareLegacyMigration(options);return 'status' in plan?plan:applyLegacyMigration(plan);
}

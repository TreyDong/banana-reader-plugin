import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareLegacyMigration,applyLegacyMigration,migrateLegacyPluginData} from '../src/legacy-migration-desktop';

const indexName='a'.repeat(64)+'.json';
const store={version:5,settings:{language:'en',services:[{id:'keep-service-id',name:'Custom API',kind:'api'}],taskModels:{default:{serviceId:'keep-service-id',modelId:'model'}},commands:[{id:'mine',name:'My command',prompt:'Do not rewrite'}],translationTarget:'ja',customFutureField:{keep:true}},documents:{'article.md':{progress:.42,draft:'Unsent draft',updated:42,highlights:[{id:'mark',style:'underline',note:'My note',color:'yellow',anchor:{start:1,quote:'source',prefix:'a',suffix:'b'},created:1}],threads:[{id:'question',followupDraft:'Follow up',messages:[{role:'assistant',content:'Answer [¶1]',model:'model',usage:{input:20}}],citations:{'1':{quote:'source',start:1}},created:2}],brief:{hash:'same',title:'Saved brief'}}}};
async function fixture(configDir='.obsidian'){
 const root=await fs.mkdtemp(join(tmpdir(),'banana-reader-id-test-'));const plugins=join(root,configDir,'plugins'),source=join(plugins,'gloss-reader'),target=join(plugins,'banana-reader');
 await fs.mkdir(join(source,'indices'),{recursive:true});await fs.mkdir(target,{recursive:true});
 const bytes=Buffer.from(JSON.stringify(store,null,2)+'\n');await fs.writeFile(join(source,'data.json'),bytes);await fs.writeFile(join(source,'indices',indexName),'opaque synthetic index bytes\n');await fs.writeFile(join(target,'manifest.json'),JSON.stringify({id:'banana-reader'}));await fs.writeFile(join(target,'main.js'),'installed code');
 return{root,source,target,bytes,options:{vaultRoot:root,configDir,pluginId:'banana-reader',legacyActive:false},cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
async function absent(path:string){await assert.rejects(fs.stat(path),{code:'ENOENT'});}

test('legacy ID is a no-op without touching even a nonexistent vault',async()=>{
 assert.deepEqual(await migrateLegacyPluginData({vaultRoot:'/not-a-vault',configDir:'.obsidian',pluginId:'gloss-reader'}),{status:'not-applicable',files:0});
});
test('copies settings, all reading records and indices byte-for-byte without changing source or installed code',async()=>{
 const f=await fixture();try{
  const result=await migrateLegacyPluginData(f.options);assert.deepEqual(result,{status:'migrated',files:2});
  assert.deepEqual(await fs.readFile(join(f.target,'data.json')),f.bytes);assert.deepEqual(await fs.readFile(join(f.source,'data.json')),f.bytes);
  assert.equal(await fs.readFile(join(f.target,'indices',indexName),'utf8'),'opaque synthetic index bytes\n');assert.equal(await fs.readFile(join(f.target,'main.js'),'utf8'),'installed code');
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.target,'data.json'),'utf8')),store);assert.equal((await fs.stat(join(f.target,'data.json'))).mode&0o777,0o600);
 }finally{await f.cleanup();}
});
test('supports a custom Obsidian configuration directory and paths with spaces',async()=>{
 const f=await fixture('custom config');try{assert.equal((await migrateLegacyPluginData(f.options)).status,'migrated');assert.deepEqual(await fs.readFile(join(f.target,'data.json')),f.bytes);}finally{await f.cleanup();}
});
test('repeated startup keeps newer destination edits and never duplicates annotations',async()=>{
 const f=await fixture();try{
  await migrateLegacyPluginData(f.options);const changed=structuredClone(store);changed.documents['article.md'].draft='New destination draft';await fs.writeFile(join(f.target,'data.json'),JSON.stringify(changed));
  assert.deepEqual(await migrateLegacyPluginData(f.options),{status:'already-migrated',files:0});assert.deepEqual(JSON.parse(await fs.readFile(join(f.target,'data.json'),'utf8')),changed);
 }finally{await f.cleanup();}
});
test('refuses an active or unconfirmed old plugin before any migration writes',async()=>{
 const f=await fixture();try{for(const legacyActive of [true,undefined])await assert.rejects(migrateLegacyPluginData({...f.options,legacyActive}),/inactive state must be confirmed/);await absent(join(f.target,'data.json'));}finally{await f.cleanup();}
});
test('never overwrites or merges existing destination data without a receipt',async()=>{
 const f=await fixture();try{const other='{"keep":"existing destination"}';await fs.writeFile(join(f.target,'data.json'),other);await assert.rejects(migrateLegacyPluginData(f.options),/will not overwrite or merge/);assert.equal(await fs.readFile(join(f.target,'data.json'),'utf8'),other);assert.deepEqual(await fs.readFile(join(f.source,'data.json')),f.bytes);}finally{await f.cleanup();}
});
test('refuses existing destination indices and preserves them',async()=>{
 const f=await fixture();try{await fs.mkdir(join(f.target,'indices'));await fs.writeFile(join(f.target,'indices','keep'),'keep');await assert.rejects(migrateLegacyPluginData(f.options),/will not overwrite or merge/);assert.equal(await fs.readFile(join(f.target,'indices','keep'),'utf8'),'keep');await absent(join(f.target,'data.json'));}finally{await f.cleanup();}
});
test('malformed or future-version legacy data fails without creating defaults',async()=>{
 const f=await fixture();try{for(const bad of ['broken JSON','null','{"version":99,"settings":{},"documents":{}}']){await fs.writeFile(join(f.source,'data.json'),bad);await assert.rejects(migrateLegacyPluginData(f.options));await absent(join(f.target,'data.json'));}}finally{await f.cleanup();}
});
test('rejects symlinked legacy data and unexpected index files',async()=>{
 const f=await fixture();try{
  await fs.writeFile(join(f.source,'indices','unexpected.txt'),'keep');await assert.rejects(migrateLegacyPluginData(f.options),/unexpected file/);await fs.unlink(join(f.source,'indices','unexpected.txt'));
  await fs.writeFile(join(f.root,'outside.json'),f.bytes);await fs.unlink(join(f.source,'data.json'));await fs.symlink(join(f.root,'outside.json'),join(f.source,'data.json'));await assert.rejects(migrateLegacyPluginData(f.options),/symbolic links/);await absent(join(f.target,'data.json'));
 }finally{await f.cleanup();}
});
test('a changed old store after planning stops before destination writes',async()=>{
 const f=await fixture();try{const plan=await prepareLegacyMigration(f.options);assert.ok('files' in plan&&!('status' in plan));await fs.writeFile(join(f.source,'data.json'),JSON.stringify({...store,version:4}));await assert.rejects(applyLegacyMigration(plan),/changed during migration/);await absent(join(f.target,'data.json'));}finally{await f.cleanup();}
});
test('destination data created after planning wins without being replaced',async()=>{
 const f=await fixture();try{const plan=await prepareLegacyMigration(f.options);assert.ok(!('status' in plan));await fs.writeFile(join(f.target,'data.json'),'concurrent data');await assert.rejects(applyLegacyMigration(plan),/will not overwrite or merge/);assert.equal(await fs.readFile(join(f.target,'data.json'),'utf8'),'concurrent data');}finally{await f.cleanup();}
});
test('partial copy failure rolls back only new files and leaves the old installation intact',async()=>{
 const f=await fixture(),link=fs.link;let calls=0;
 try{
  fs.link=async(source,destination)=>{if(++calls===2)throw Object.assign(new Error('Synthetic disk failure'),{code:'ENOSPC'});return link(source,destination);};
  await assert.rejects(migrateLegacyPluginData(f.options),/Synthetic disk failure/);await absent(join(f.target,'data.json'));await absent(join(f.target,'indices'));await absent(join(f.target,'legacy-migration.json'));
  assert.deepEqual((await fs.readdir(f.target)).sort(),['main.js','manifest.json']);assert.deepEqual(await fs.readFile(join(f.source,'data.json')),f.bytes);
 }finally{fs.link=link;await f.cleanup();}
});
test('a receipt detects legacy data modified after migration instead of silently reimporting it',async()=>{
 const f=await fixture();try{await migrateLegacyPluginData(f.options);await fs.writeFile(join(f.source,'data.json'),JSON.stringify({...store,version:4}));await assert.rejects(migrateLegacyPluginData(f.options),/manual reconciliation/);assert.deepEqual(await fs.readFile(join(f.target,'data.json')),f.bytes);}finally{await f.cleanup();}
});
test('fresh installations and missing legacy data need no migration',async()=>{
 const f=await fixture();try{await fs.unlink(join(f.source,'data.json'));assert.deepEqual(await migrateLegacyPluginData(f.options),{status:'no-legacy-data',files:0});await absent(join(f.target,'data.json'));}finally{await f.cleanup();}
});

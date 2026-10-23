import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {DataAdapter} from 'obsidian';
import {preparePluginIdentity} from '../src/plugin-migration';

const source='.obsidian/plugins/gloss-reader',target='.obsidian/plugins/banana-reader';
const data=JSON.stringify({version:5,settings:{},documents:{'Book.md':{draft:'Preserve my notes'}}});
function fixture(){
 const files=new Map<string,string>(),writes:string[]=[];
 const adapter={exists:async(path:string)=>files.has(path)||[...files.keys()].some(key=>key.startsWith(path+'/')),stat:async(path:string)=>files.has(path)?{type:'file',size:new TextEncoder().encode(files.get(path)!).length}:null,read:async(path:string)=>{if(!files.has(path))throw new Error('Missing file');return files.get(path)!;},readBinary:async(path:string)=>new TextEncoder().encode(files.get(path)!).buffer,list:async(path:string)=>({files:[...files.keys()].filter(key=>key.startsWith(path+'/')),folders:[]}),write:async(path:string)=>{writes.push(path);throw new Error('Mobile migration must never write');}} as unknown as DataAdapter;
 return{files,writes,options:{pluginId:'banana-reader',mobile:true,configDir:'.obsidian',adapter,legacyActive:false}};
}
function receipt(files:Map<string,string>,windows=false){return JSON.stringify({version:1,from:'gloss-reader',to:'banana-reader',sourceFiles:Object.fromEntries([...files].filter(([name])=>name.startsWith(source+'/')).map(([name,content])=>[windows?name.slice(source.length+1).replaceAll('/','\\'):name.slice(source.length+1),createHash('sha256').update(content).digest('hex')]))});}
test('fresh mobile installation and stable banana-reader installation need no Node or cross-identity writes',async()=>{
 const f=fixture();await preparePluginIdentity(f.options);f.files.set(target+'/data.json',data);await preparePluginIdentity(f.options);assert.deepEqual(f.writes,[]);
});
test('mobile refuses active legacy or initial import before reading or saving defaults and preserves both copies',async()=>{
 const f=fixture();f.files.set(source+'/data.json',data);const before=[...f.files];
 for(const legacyActive of [true,undefined])await assert.rejects(preparePluginIdentity({...f.options,legacyActive}),/请先停用/);
 await assert.rejects(preparePluginIdentity(f.options),/请先在电脑完成/);
 f.files.set(target+'/data.json',data);await assert.rejects(preparePluginIdentity(f.options),/请先在电脑完成/);f.files.delete(target+'/data.json');assert.deepEqual([...f.files],before);assert.deepEqual(f.writes,[]);
});
test('mobile accepts desktop migration receipts from macOS and Windows while preserving newer phone edits',async()=>{
 const f=fixture();f.files.set(source+'/data.json',data);f.files.set(source+'/indices/'+'a'.repeat(64)+'.json','synthetic index');f.files.set(target+'/data.json',JSON.stringify({version:5,settings:{},documents:{'Book.md':{draft:'New phone edit'}}}));
 for(const windows of [false,true]){f.files.set(target+'/legacy-migration.json',receipt(f.files,windows));const before=[...f.files];await preparePluginIdentity(f.options);await preparePluginIdentity(f.options);assert.deepEqual([...f.files],before);assert.deepEqual(f.writes,[]);}
});
test('mobile refuses changed legacy data, unknown indexes, invalid receipts and missing destination data',async()=>{
 const f=fixture();f.files.set(source+'/data.json',data);f.files.set(target+'/data.json',data);f.files.set(target+'/legacy-migration.json',receipt(f.files));
 f.files.set(source+'/data.json',data+' ');await assert.rejects(preparePluginIdentity(f.options),/迁移后有变化/);f.files.set(source+'/data.json',data);
 f.files.set(source+'/indices/unexpected.txt','keep');await assert.rejects(preparePluginIdentity(f.options),/未识别/);f.files.delete(source+'/indices/unexpected.txt');
 f.files.set(target+'/legacy-migration.json','{}');await assert.rejects(preparePluginIdentity(f.options),/凭据无效/);f.files.set(target+'/legacy-migration.json',receipt(f.files));
 f.files.delete(target+'/data.json');await assert.rejects(preparePluginIdentity(f.options),/Missing file/);assert.deepEqual(f.writes,[]);
});

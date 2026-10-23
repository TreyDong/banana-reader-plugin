import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {askAgent,configureMobileTransport,discoverApiModels,discoverCodexModels,discoverPiModels,mobileRequest,type ApiProtocol,type AgentSettings} from '../src/agent';
import {BookIndexCache,chunkSections,embeddingIdentity,embedTexts,hash,type IndexStorage,type BookIndex} from '../src/rag';
import {briefHash} from '../src/brief';
const settings:AgentSettings={provider:'api',codexPath:'',codexModel:'',apiBase:'https://example.test/v1',apiModel:'chat-test',apiKey:'test-key'};
afterEach(()=>configureMobileTransport());
const signal=()=>new AbortController().signal;
for(const protocol of ['openai','responses','anthropic','gemini'] as ApiProtocol[])test('mobile complete JSON answer and actual usage: '+protocol,async()=>{
 let request:any;const replies={openai:{choices:[{message:{content:'Answer [¶1]'}}],usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15}},responses:{status:'completed',output:[{content:[{type:'output_text',text:'Answer [¶1]'}]}],usage:{input_tokens:12,output_tokens:3,total_tokens:15}},anthropic:{content:[{type:'text',text:'Answer [¶1]'}],usage:{input_tokens:12,output_tokens:3}},gemini:{candidates:[{content:{parts:[{text:'Answer [¶1]'}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:3,totalTokenCount:15}}};
 configureMobileTransport(async r=>{request=r;return{status:200,text:JSON.stringify(replies[protocol])};});let text='',usage:any;
 assert.equal(await askAgent({settings:{...settings,apiProtocol:protocol},context:'[¶1] Public fixture',messages:[{role:'user',content:'Explain'}],signal:signal(),onText:s=>text=s,onUsage:u=>usage=u}),'Answer [¶1]');
 assert.equal(text,'Answer [¶1]');assert.equal(usage.total,15);const body=JSON.parse(request.body);assert.equal(request.headers.Accept,'application/json');assert.equal(body.stream_options,undefined);
 if(protocol==='gemini'){assert.match(request.url,/:generateContent$/);assert.equal(request.headers['x-goog-api-key'],'test-key');}else assert.equal(body.stream,false);
 if(protocol==='anthropic')assert.equal(request.headers['x-api-key'],'test-key');
 if(protocol==='openai'||protocol==='responses')assert.equal(request.headers.Authorization,'Bearer test-key');
});
test('mobile stop and timeout settle promptly and discard late callbacks',async()=>{
 let resolve!:(response:{status:number;text:string})=>void;configureMobileTransport(()=>new Promise(r=>resolve=r));let calls=0;const c=new AbortController();
 const answer=askAgent({settings,context:'public',messages:[],signal:c.signal,onText:()=>calls++});c.abort();await assert.rejects(answer,/已停止/);resolve({status:200,text:JSON.stringify({choices:[{message:{content:'late'}}]})});await Promise.resolve();assert.equal(calls,0);
 await assert.rejects(mobileRequest({url:'https://example.test',method:'GET',headers:{}},signal(),5),/请求超时/);
});
test('mobile failures do not echo private response bodies or raw network errors',async()=>{
 for(const response of [{status:403,text:'secret response'},{status:200,text:'not JSON'},{status:200,text:'{"error":{"message":"secret error"}}'},{status:200,text:'{"choices":[]}'}]){
  configureMobileTransport(async()=>response);await assert.rejects(askAgent({settings,context:'private',messages:[],signal:signal(),onText:()=>assert.fail('must not display error payload')}),error=>!String(error).includes('secret'));
 }
 configureMobileTransport(async()=>{throw new Error('private network diagnostics');});await assert.rejects(mobileRequest({url:'https://example.test',method:'GET',headers:{}},signal()),/无法连接服务/);
});
test('mobile model discovery and ordered embedding vectors use the injected transport',async()=>{
 const requests:any[]=[];configureMobileTransport(async r=>{requests.push(r);return{status:200,text:JSON.stringify(r.url.endsWith('/models')?{data:[{id:'model-a'}]}:{data:[{index:1,embedding:[0,3]},{index:0,embedding:[2,0]}],usage:{prompt_tokens:8}})};});
 assert.equal((await discoverApiModels(settings,signal()))[0].id,'model-a');const result=await embedTexts({base:settings.apiBase,model:'vec',dimensions:0,topK:6},'test-key',['one','two'],signal());assert.deepEqual(result,{vectors:[[1,0],[0,1]],inputTokens:8});assert.equal(requests[1].headers.Authorization,'Bearer test-key');
 await assert.rejects(askAgent({settings:{...settings,provider:'codex'},context:'public',messages:[],signal:signal(),onText:()=>{}}),/手机端不支持本机 CLI/);
 assert.deepEqual(await discoverCodexModels(),[]);await assert.rejects(discoverPiModels('',signal()),/手机端不支持本机 CLI/);
});
test('portable SHA-256 exactly retains previous cache filenames, source hashes and embedding identities',()=>{
 for(const text of ['', 'abc','中文路径/📚.epub','a'.repeat(55),'b'.repeat(56),'z'.repeat(128),String.fromCharCode(0xd800),'文'.repeat(10000)]){
  const expected=createHash('sha256').update(text).digest('hex');assert.equal(hash(text),expected);assert.equal(briefHash(text),expected);
 }
 const settings={base:'https://example.test/v1',model:'vec',dimensions:0,topK:6};assert.equal(embeddingIdentity(settings),createHash('sha256').update(JSON.stringify(['https://example.test/v1/embeddings','vec',0])).digest('hex'));
});
function memoryStorage(){
 const files=new Map<string,string>(),directories=new Set<string>();let failPublish=false;
 const storage:IndexStorage={exists:async path=>files.has(path)||directories.has(path),stat:async path=>files.has(path)?{size:files.get(path)!.length}:null,read:async path=>{if(!files.has(path))throw new Error('Missing');return files.get(path)!;},write:async(path,data)=>{files.set(path,data);},mkdir:async path=>{if(directories.has(path))throw new Error('EEXIST');directories.add(path);},rename:async(from,to)=>{if(failPublish&&from.endsWith('.tmp'))throw new Error('Synthetic publish failure');if(files.has(to))throw new Error('Destination already exists');if(!files.has(from))throw new Error('Missing');files.set(to,files.get(from)!);files.delete(from);},remove:async path=>{files.delete(path);}};
 return{files,storage,fail:()=>failPublish=true};
}
function index():BookIndex{return{version:1,stamp:{path:'books/book.epub',mtime:1,size:20},identity:'fixture',created:1,model:'vec',dimensions:2,chunks:chunkSections([{text:'Original source',label:'Chapter'}]).map(c=>({...c,vector:[1,0]})),skippedPages:0};}
test('vault-relative cache reloads, replaces, recovers interrupted writes and clears through a mobile adapter',async()=>{
 const m=memoryStorage(),cache=new BookIndexCache('.obsidian/plugins/gloss-reader/indices',m.storage),book=index();assert.equal(await cache.load(book.stamp.path),null);await cache.save(book);book.created=2;await cache.save(book);assert.equal((await cache.load(book.stamp.path))?.created,2);
 const file=[...m.files.keys()][0];assert.ok(file.endsWith(hash(book.stamp.path)+'.json'));m.files.set(file+'.bak',m.files.get(file)!);m.files.delete(file);assert.equal((await cache.load(book.stamp.path))?.created,2);
 m.fail();book.created=3;await assert.rejects(cache.save(book),/Synthetic publish failure/);assert.equal((await cache.load(book.stamp.path))?.created,2);assert.equal([...m.files.keys()].some(p=>p.endsWith('.tmp')),false);
 await cache.remove(book.stamp.path);assert.equal(await cache.load(book.stamp.path),null);
});
test('bundled plugin loads and initializes without any Node or Electron modules, including legacy configuration',async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../src/main.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',target:'es2022',external:['obsidian','electron'],logLevel:'silent'});
 for(const saved of [null,{version:1,settings:{provider:'codex'},documents:{}}]){
  const views=new Map(),protocols:string[]=[];const m=memoryStorage();const app={vault:{adapter:m.storage,configDir:'.obsidian',on:()=>()=>{}},workspace:{on:()=>()=>{},onLayoutReady:()=>{},getLeavesOfType:()=>[]}};
  class Plugin{app=app;manifest={id:'banana-reader',dir:'.obsidian/plugins/banana-reader'};loadData=async()=>saved;saveData=async()=>{};registerView=(id:string,factory:any)=>views.set(id,factory);registerExtensions(){}addSettingTab(){}registerEvent(){}registerObsidianProtocolHandler(id:string){protocols.push(id);}addRibbonIcon(){return{};}addCommand(){}removeCommand(){}}
  const obsidian={Plugin,Platform:{isMobile:true},TFile:class{},ItemView:class{},FileView:class{},FuzzySuggestModal:class{},Modal:class{},PluginSettingTab:class{},getLanguage:()=>'zh'};
  const context={module:{exports:{}},exports:{},console,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,AbortController,setTimeout,clearTimeout,require:(id:string)=>{assert.equal(id,'obsidian','Mobile attempted to load '+id);return obsidian;}};
  vm.runInNewContext(result.outputFiles[0].text,context);const plugin=new (context.module.exports as any).default();await plugin.onload();assert.equal(views.size,3);assert.deepEqual(protocols,['banana-reader','gloss-reader']);
  const view=views.get('gloss-reader')({});view.article={ownerDocument:{getSelection:()=>({isCollapsed:false,rangeCount:1,getRangeAt:()=>({commonAncestorContainer:{}})})},contains:()=>false};view.pdf={activateRange:()=>assert.fail('A notebook selection must not activate PDF selection')};view.captureSelection();
  plugin.store.settings.services=[{id:'cli',kind:'codex',name:'Desktop',models:[{id:'local',name:'Local'}]},{id:'api',kind:'api',name:'Mobile',models:[{id:'remote',name:'Remote'}]}];assert.equal(view.modelChoices().length,1);assert.equal(view.modelChoices()[0].serviceId,'api');assert.equal(plugin.store.settings.services.length,2);
  await plugin.indexCache.save(index());assert.equal((await plugin.indexCache.load(index().stamp.path)).model,'vec');
  const bytes=new TextEncoder().encode('%PDF-1.4\nfixture').buffer;
  Object.assign(obsidian,{requestUrl:async()=>({status:200,headers:{'content-type':'application/pdf'},arrayBuffer:bytes,get json(){throw new Error('Binary response must not be parsed as JSON');},get text(){throw new Error('Binary response must not be decoded as text');}})});
  const book=await plugin.zlibClient().downloadFile({url:'https://cdn.example.test/book.pdf',description:'Book',author:'QA',extension:'pdf'});assert.equal(book.bytes.byteLength,bytes.byteLength);
  // On mobile revealLeaf can expose a tab without changing the active reader.
  // Reopening a retained article must activate it so selectionchange is handled.
  let active:any;const leaf={view,loadIfDeferred:async()=>{}};view.path='fixture.md';view.toggleFocus=(value:boolean)=>assert.equal(value,true);
  Object.assign(app.workspace,{getLeavesOfType:()=>[leaf],revealLeaf:async()=>{},setActiveLeaf:(target:any,options:any)=>{active=target;assert.equal(options.focus,true);}});
  await plugin.openFile(Object.assign(new obsidian.TFile(),{path:'fixture.md',extension:'md'}));assert.equal(active,leaf);
 }
 const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));assert.equal(manifest.isDesktopOnly,false);assert.equal(manifest.id,'banana-reader');
});

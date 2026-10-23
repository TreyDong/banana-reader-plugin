import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';
import {DOMParser} from '@xmldom/xmldom';
import {bindUi,refreshUi,forwardUiLabel,configureLanguage,t,ENGLISH,normalizeLanguage,resolveLanguage,translate,commandName,relativeTime,receiptText,notebookSummary} from '../src/i18n';

test('language preference follows Obsidian, supports explicit overrides and normalizes old data',()=>{
 for(const value of [undefined,null,'invalid',{},'auto'])assert.equal(normalizeLanguage(value),'auto');
 for(const host of ['zh','zh-CN','zh-TW','zh_Hant','ZH-cn'])assert.equal(resolveLanguage('auto',host),'zh-CN');
 for(const host of ['en','en-US','ja',''])assert.equal(resolveLanguage(undefined,host),'en');
 assert.equal(resolveLanguage('en','zh'),'en');assert.equal(resolveLanguage('zh-CN','en'),'zh-CN');
});
test('UI labels switch languages while placeholders and unknown user values remain literal',()=>{
 assert.equal(translate('zh-CN','模型服务'),'模型服务');assert.equal(translate('en','模型服务'),'Model services');
 assert.equal(translate('en','{0} 分钟阅读 · {1} 个段落',3,8),'3 min read · 8 paragraphs');
 assert.equal(translate('zh-CN','阅读 · {0}','My {1} <book>'),'阅读 · My {1} <book>');
 assert.equal(translate('en','我的自定义名称'),'我的自定义名称');
 assert.ok(translate('en','可用变量：{{selection}} 选中文本 · {{title}} 文档名').includes('{{selection}}'));
});
test('only unedited built-in command names are translated',()=>{
 assert.equal(commandName({id:'explain',name:'解释'},'en'),'Explain');
 assert.equal(commandName({id:'explain',name:'我的解释'},'en'),'我的解释');
 assert.equal(commandName({id:'custom',name:'解释'},'en'),'解释');
 assert.equal(commandName({id:'explain',name:'解释'},'zh-CN'),'解释');
});
test('generated time and usage metadata localize without touching source text',()=>{
 const now=Date.UTC(2026,9,20,12);
 assert.equal(relativeTime(now-10_000,now,'en'),'Just now');
 assert.equal(relativeTime(now-120_000,now,'en'),'2 min ago');
 assert.equal(relativeTime(now-7200_000,now,'zh-CN'),'2 小时前');
 assert.equal(receiptText('1,200 输入 · 30 输出','en'),'1,200 input · 30 output');
 assert.equal(receiptText('用量未返回','en'),'Usage not returned');
 assert.equal(receiptText('用量未返回','zh-CN'),'用量未返回');
 assert.equal(notebookSummary(0,1,'en'),'0 questions, 1 mark');assert.equal(notebookSummary(1,2,'en'),'1 question, 2 marks');
});
test('every explicit UI message has an English catalog entry with matching format slots',async()=>{
 const text=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 const source=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true);let checked=0;
 const slots=(s:string)=>(s.match(/\{\d+\}/g)||[]).sort();
 function visit(n:ts.Node){
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='ui'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])){
   const key=n.arguments[0].text;assert.ok(Object.hasOwn(ENGLISH,key),'Missing English UI message: '+key);
   assert.deepEqual(slots(ENGLISH[key]),slots(key),key);checked++;
  }
  ts.forEachChild(n,visit);
 }
 visit(source);assert.ok(checked>450);
});

async function loadPlugin(saved:unknown,host='zh',identity?:{root:string;id:string;legacyActive:boolean;events:string[]}){
 const output=await build({entryPoints:[fileURLToPath(new URL('../src/main.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',target:'es2022',external:['obsidian','electron'],logLevel:'silent'});
 const views=new Map<string,(leaf:any)=>any>();const commands=new Map<string,{id:string;name:string}>();const writes:any[]=[];const protocols=new Map<string,(params:any)=>Promise<void>>();let failSave=false;let modelCalls=0;
 const source=structuredClone(saved);
 const vault={adapter:{getBasePath:()=>identity?.root||'/synthetic-banana-reader'},configDir:'.obsidian',on:()=>()=>{}};
 class Plugin{
  app={vault,workspace:{on:()=>()=>{},onLayoutReady:()=>{},getLeavesOfType:()=>[] as any[]},secretStorage:{getSecret:()=>''},plugins:{enabledPlugins:new Set(identity?.legacyActive?['gloss-reader']:[])}};
  manifest={id:identity?.id||'gloss-reader',dir:'.obsidian/plugins/'+(identity?.id||'gloss-reader'),version:'0.12.5'};
  async loadData(){if(identity){identity.events.push('load');return JSON.parse(await readFile(join(identity.root,this.manifest.dir,'data.json'),'utf8'));}return structuredClone(source);}
  saveData(value:unknown){identity?.events.push('save');if(failSave)return Promise.reject(new Error('Synthetic save failure'));writes.push(structuredClone(value));return Promise.resolve();}
  registerView(id:string,factory:(leaf:any)=>any){views.set(id,factory);}registerExtensions(){}addSettingTab(){}registerEvent(){}registerObsidianProtocolHandler(id:string,handler:(params:any)=>Promise<void>){protocols.set(id,handler);}
  addRibbonIcon(){return syntheticDom().createEl('button',{});}
  addCommand(command:{id:string;name:string}){commands.set(command.id,command);return command;}
  removeCommand(id:string){commands.delete(id);}
 }
 const nativeRequire=createRequire(import.meta.url);
 const stub={Notice:class{},TFile:class{constructor(public path:string){}},Plugin,ItemView:class{},FileView:class{},FuzzySuggestModal:class{},Modal:class{},PluginSettingTab:class{},getLanguage:()=>host};
 const context={module:{exports:{}},exports:{},crypto:globalThis.crypto,console,URL,AbortController,setTimeout,clearTimeout,require:(id:string)=>{
  if(id==='obsidian')return stub;
  if(['node:child_process','node:http','node:https'].includes(id))return new Proxy({}, {get:()=>()=>{modelCalls++;throw new Error('Language changes must not call a model service');}});
  return nativeRequire(id);
 }};
 vm.runInNewContext(output.outputFiles[0].text,context);
 const Constructor=(context.module.exports as any).default;const plugin=new Constructor();await plugin.onload();
 return{plugin,commands,writes,views,protocols,TFile:stub.TFile,fail:()=>{failSave=true;},modelCalls:()=>modelCalls};
}
const fixture=()=>({version:5,settings:{language:'zh-CN',services:[{id:'local',name:'我的服务',kind:'codex',path:'',protocol:'openai',base:'https://api.openai.com/v1',models:[{id:'model-a',name:'自定义模型',type:'chat'}]}],taskModels:{default:{serviceId:'local',modelId:'model-a'},summary:{serviceId:'local',modelId:'model-a'}},translationEngine:'google',translationTarget:'ja',commands:[{id:'explain',name:'自定解释',prompt:'请保留 {{selection}} 原文。',builtin:true}],taskPrompts:{default:'我的问答提示词',summary:'我的总结提示词'},embedding:{topK:8,autoIndex:false}},documents:{'sample.md':{progress:.42,draft:'尚未发送的问题',updated:1,highlights:[{id:'h',anchor:{start:0,quote:'原文'},note:'我的批注',color:'yellow',created:1}],threads:[{id:'t',messages:[{role:'user',content:'问题'},{role:'assistant',content:'回答',model:'model-a'}],created:1}]}}});
test('real plugin language setting persists and changes commands without rewriting models, prompts or documents',async()=>{
 const run=await loadPlugin(fixture());const before=structuredClone(run.plugin.store);
 assert.equal(run.commands.get('open-reader')?.name,'进入沉浸阅读');
 await run.plugin.changeLanguage('en');
 assert.equal(run.plugin.store.settings.language,'en');assert.equal(run.commands.get('open-reader')?.name,'Enter immersive reading');
 const after=structuredClone(run.plugin.store);after.settings.language=before.settings.language;
 assert.deepEqual(after,before);assert.equal(run.writes.at(-1).settings.language,'en');assert.equal(run.modelCalls(),0);assert.equal(run.commands.size,6);
 const reopened=await loadPlugin(run.writes.at(-1),'zh');assert.equal(reopened.plugin.store.settings.language,'en');assert.equal(reopened.commands.get('open-reader')?.name,'Enter immersive reading');
 await run.plugin.changeLanguage('zh-CN');assert.equal(run.commands.get('open-reader')?.name,'进入沉浸阅读');
});
test('failed language persistence restores the active language and existing command labels',async()=>{
 const run=await loadPlugin(fixture());run.fail();await assert.rejects(run.plugin.changeLanguage('en'),/Synthetic save failure/);
 assert.equal(run.plugin.store.settings.language,'zh-CN');assert.equal(run.commands.get('open-reader')?.name,'进入沉浸阅读');assert.equal(run.modelCalls(),0);
});

test('English UI leaves PDF page identity and active selections intact',async()=>{
 const data=fixture();data.settings.language='en';const run=await loadPlugin(data);
 const view=run.views.get('gloss-reader')!({});view.path='sample.md';
 view.passages=[{source:'PDF 第 1 页'}];view.pdf={blocks:[],text:'Original page',passages:[{source:'PDF 第 1 页'}],page:1};
 view.activeHighlight='h';view.selected={pdfPage:1,start:0,quote:'Original page'};
 view.syncPdfPage();assert.equal(view.activeHighlight,'h');assert.equal(view.selected.quote,'Original page');
});


function syntheticDom(){
 const doc=new DOMParser().parseFromString('<root/>','application/xml');
 function prepare(element:any):any{
  element.querySelectorAll=(selector:string)=>Array.from(element.getElementsByTagName('*')).filter((child:any)=>selector.startsWith('.')?(child.getAttribute('class')||'').split(' ').includes(selector.slice(1)):selector==='[id^="reader-group-"]'?(child.getAttribute('id')||'').startsWith('reader-group-'):selector==='[aria-labelledby]'?child.hasAttribute('aria-labelledby'):child.hasAttribute('data-reader-i18n'));
  element.querySelector=(selector:string)=>element.querySelectorAll(selector)[0]||null;
  element.remove=()=>element.parentNode?.removeChild(element);
  element.createEl=(tag:string,options:any={})=>{const child=prepare(doc.createElement(tag));if(options.text!==undefined)child.appendChild(doc.createTextNode(options.text));if(options.cls)child.setAttribute('class',options.cls);for(const [k,v]of Object.entries(options.attr||{}))child.setAttribute(k,v);element.appendChild(child);return child;};
  element.createSpan=(options:any)=>element.createEl('span',options);element.createDiv=(options:any)=>element.createEl('div',options);
  element.empty=()=>{while(element.firstChild)element.removeChild(element.firstChild);};element.addEventListener=()=>{};
  return element;
 }
 return prepare(doc.documentElement);
}

test('live UI bindings update notebook and question labels without replacing icons, input values or user content',()=>{
 configureLanguage('zh-CN','zh');const root=syntheticDom();
 const notebook=bindUi(root.createSpan({text:t('笔记本')}),{text:()=>t('笔记本')});
 const question=bindUi(root.createEl('button',{text:t('提问')}),{text:()=>t('提问')});const icon=question.createSpan({text:'icon'});
 const marks=bindUi(root.createSpan({text:t('划线')}),{text:()=>t('划线')});
 const input=bindUi(root.createEl('textarea',{attr:{placeholder:t('询问选中文本…')}}),{placeholder:()=>t('询问选中文本…')});input.value='未发送的草稿';
 const customName='笔记本';const content=root.createEl('p',{text:'笔记本 划线 问答 — 用户正文'}),custom=bindUi(root.createSpan({text:'笔记本'}),{text:()=>customName||t('选择问答模型')});
 const changed=bindUi(root.createSpan({text:t('提问')}),{text:()=>t('提问')});changed.textContent='模型产生的新内容';
 const group=bindUi(root.createDiv({attr:{'aria-label':t('阅读笔记本')}}),{'aria-label':()=>t('阅读笔记本')});const sr=root.createSpan({text:t('阅读笔记本')});forwardUiLabel(group,sr);group.removeAttribute('aria-label');
 configureLanguage('en','zh');refreshUi(root);
 assert.equal(notebook.textContent,'Notebook');assert.equal(question.firstChild.textContent,'Ask');assert.equal(question.lastChild,icon);assert.equal(marks.textContent,'Marks');
 assert.equal(input.getAttribute('placeholder'),'Ask about the selection…');assert.equal(input.value,'未发送的草稿');
 assert.equal(content.textContent,'笔记本 划线 问答 — 用户正文');assert.equal(custom.textContent,'笔记本');assert.equal(changed.textContent,'模型产生的新内容');
 assert.equal(sr.textContent,'Reading notebook');assert.equal(group.hasAttribute('aria-label'),false);
 configureLanguage('zh-CN','en');refreshUi(root);assert.equal(notebook.textContent,'笔记本');assert.equal(question.firstChild.textContent,'提问');assert.equal(input.value,'未发送的草稿');
});

test('changing language refreshes the real open notebook while preserving drafts, anchors and every active job',async()=>{
 const run=await loadPlugin(fixture());const view=run.views.get('gloss-reader')!({});view.path='sample.md';
 const root=syntheticDom();view.root=root;view.drawerTabs=root.createDiv({});view.drawerBody=root.createDiv({});view.drawerBody.scrollTop=73;
 view.notebookBadge=root.createSpan({});view.drawerSubtitle=root.createSpan({});view.composer={value:'未发送的问答草稿',placeholder:''};view.lensInput={value:'未保存的批注'};
 view.selected={start:0,quote:'原文',prefix:'',suffix:''};const selected=view.selected;
 const requests=['aborter','retrievalJob','indexJob','suggestionJob','importAborter'];const jobs=requests.map(()=>new AbortController());requests.forEach((name,index)=>view[name]=jobs[index]);
 view.quietNotebook=()=>{};view.refreshModelButtons=()=>{};view.paintWebButton=()=>{};view.scheduleLayout=()=>{};
 run.plugin.app.workspace.getLeavesOfType=()=>[{view}];const before=structuredClone(run.plugin.store.documents);
 await run.plugin.changeLanguage('en');assert.match(view.drawerTabs.textContent,/All.*Q&A.*Marks/);assert.equal(view.drawerSubtitle.textContent,'1 question, 1 mark');
 assert.equal(view.composer.value,'未发送的问答草稿');assert.equal(view.lensInput.value,'未保存的批注');assert.equal(view.selected,selected);assert.equal(view.drawerBody.scrollTop,73);
 requests.forEach((name,index)=>{assert.equal(view[name],jobs[index]);assert.equal(jobs[index].signal.aborted,false);});assert.deepEqual(run.plugin.store.documents,before);assert.equal(run.modelCalls(),0);
 await run.plugin.changeLanguage('zh-CN');assert.match(view.drawerTabs.textContent,/全部.*问答.*划线/);assert.equal(view.composer.value,'未发送的问答草稿');
});

test('English documentation has no untranslated Chinese prose or UI labels',async()=>{
 for(const name of ['README.md','docs/development.md']){const text=await readFile(new URL('../'+name,import.meta.url),'utf8');assert.doesNotMatch(text,/\p{Script=Han}/u,name);}
});


test('dynamic reader metadata and index labels switch both ways without retaining orphaned accessibility text',async()=>{
 const run=await loadPlugin(fixture()),view=run.views.get('gloss-reader')!({}),root=syntheticDom();view.root=root;view.path='sample.md';
 const stats=root.createDiv({cls:'gloss-reading-stats',text:'1 分钟阅读 · 2 个段落'});view.text='A short article';view.blocks=[{tagName:'P'},{tagName:'P'}];
 view.indexButton=root.createEl('button',{});const indexLabel=view.indexButton.createSpan({cls:'gloss-index-label',text:'索引'});
 view.updateIndexStatus('先选择嵌入模型');const stale=root.createSpan({cls:'gloss-sr-only',attr:{id:'reader-group-stale'},text:'问答 0'});
 const live=root.createSpan({cls:'gloss-sr-only',attr:{id:'reader-group-live'},text:'Live label'});root.createEl('button',{attr:{'aria-labelledby':'reader-group-live'}});
 view.refreshModelButtons=()=>{};view.paintWebButton=()=>{};view.scheduleLayout=()=>{};run.plugin.app.workspace.getLeavesOfType=()=>[{view}];
 await run.plugin.changeLanguage('en');assert.equal(stats.textContent,'1 min read · 2 paragraphs');assert.equal(indexLabel.textContent,'Index');assert.equal(view.indexButton.getAttribute('title'),'Choose an embedding model first');assert.equal(stale.parentNode,null);assert.ok(live.parentNode);
 await run.plugin.changeLanguage('zh-CN');assert.equal(stats.textContent,'1 分钟阅读 · 2 个段落');assert.equal(indexLabel.textContent,'索引');assert.equal(view.indexButton.getAttribute('title'),'先选择嵌入模型');assert.equal(run.modelCalls(),0);
});

test('compiled new-ID plugin imports old data before loading settings and registering reader commands',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-id-runtime-')),plugins=join(root,'.obsidian/plugins'),saved=fixture(),bytes=JSON.stringify(saved,null,2)+'\n',events:string[]=[];
 try{
  await mkdir(join(plugins,'gloss-reader'),{recursive:true});await mkdir(join(plugins,'banana-reader'));await writeFile(join(plugins,'gloss-reader/data.json'),bytes);await writeFile(join(plugins,'banana-reader/manifest.json'),JSON.stringify({id:'banana-reader'}));
  const run=await loadPlugin(undefined,'zh',{root,id:'banana-reader',legacyActive:false,events});
  assert.equal(events[0],'load');assert.equal(await readFile(join(plugins,'banana-reader/data.json'),'utf8'),bytes);assert.equal(await readFile(join(plugins,'gloss-reader/data.json'),'utf8'),bytes);
  assert.deepEqual(structuredClone(run.plugin.store.documents),saved.documents);assert.equal(run.plugin.store.settings.taskModels.default.serviceId,'local');assert.equal(run.plugin.store.settings.translationTarget,'ja');assert.equal(run.plugin.store.settings.commands[0].name,'自定解释');assert.equal(run.modelCalls(),0);assert.equal(run.commands.size,6);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('compiled new-ID plugin stops before loadData or saveData if the old plugin is still enabled',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-id-runtime-stop-')),events:string[]=[];
 try{await assert.rejects(loadPlugin(undefined,'zh',{root,id:'banana-reader',legacyActive:true,events}),/inactive state must be confirmed/);assert.deepEqual(events,[]);}finally{await rm(root,{recursive:true,force:true});}
});

test('new and legacy note links resolve the same saved marks and citations without a model request',async()=>{
 const run=await loadPlugin(fixture());assert.deepEqual([...run.protocols.keys()],['banana-reader','gloss-reader']);
 const opened:string[]=[],revealed:any[]=[];const file=new run.TFile('reading/one book.md');
 run.plugin.app.vault.getName=()=> 'synthetic';run.plugin.app.vault.getAbstractFileByPath=(path:string)=>path===file.path?file:null;
 run.plugin.openFile=async(value:any)=>{opened.push(value.path);return{revealSaved:(id:string)=>revealed.push([id]),revealReference:async(id:string,citation:string)=>{revealed.push([id,citation]);}};};
 for(const protocol of ['banana-reader','gloss-reader']){
  await run.protocols.get(protocol)!({vault:'synthetic',path:file.path,anchor:'h'});
  await run.protocols.get(protocol)!({vault:'synthetic',path:file.path,anchor:'t',citation:'2'});
  await run.protocols.get(protocol)!({vault:'other-vault',path:file.path,anchor:'h'});
 }
 assert.deepEqual(opened,Array(4).fill(file.path));assert.deepEqual(revealed,[['h'],['t','2'],['h'],['t','2']]);assert.equal(run.modelCalls(),0);
});

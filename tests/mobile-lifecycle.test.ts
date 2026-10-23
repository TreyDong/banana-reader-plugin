import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {DOMParser} from '@xmldom/xmldom';

const bundle=(await build({entryPoints:[fileURLToPath(new URL('../src/main.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',target:'es2022',external:['obsidian','electron'],logLevel:'silent'})).outputFiles[0].text;
function dom(){
 const doc:any=new DOMParser().parseFromString('<body/>','application/xml');doc.defaultView={innerHeight:844,visualViewport:{height:844}};doc.body=doc.documentElement;
 function prepare(el:any):any{
  el.dataset={};el.style={setProperty(){}};el.clientWidth=390;el.clientHeight=844;el.listeners=new Map();
  el.classList={add:(...names:string[])=>el.setAttribute('class',[el.getAttribute('class')||'',...names].join(' ')),remove:()=>{},contains:(name:string)=>(el.getAttribute('class')||'').split(' ').includes(name),toggle:()=>{}};
  el.addClass=(...names:string[])=>el.classList.add(...names);el.toggleClass=()=>{};el.setCssStyles=()=>{};
  el.contains=(node:any)=>{for(let n=node;n;n=n.parentNode)if(n===el)return true;return false;};
  el.querySelectorAll=()=>[];el.querySelector=()=>null;el.remove=()=>el.parentNode?.removeChild(el);el.empty=()=>{while(el.firstChild)el.removeChild(el.firstChild);};
  el.addEventListener=(name:string,callback:any)=>el.listeners.set(name,callback);el.dispatch=(name:string)=>el.listeners.get(name)?.({preventDefault(){}});
  el.createEl=(tag:string,options:any={})=>{const child=prepare(doc.createElement(tag));if(options.text!==undefined)child.appendChild(doc.createTextNode(options.text));if(options.cls)child.setAttribute('class',options.cls);for(const [key,value]of Object.entries(options.attr||{}))child.setAttribute(key,value);el.appendChild(child);return child;};
  el.createDiv=(options:any={})=>el.createEl('div',options);el.createSpan=(options:any={})=>el.createEl('span',options);return el;
 }
 return prepare(doc.body);
}
async function fixture(){
 const root=dom(),views=new Map();class TFile{path='Mobile.pdf';basename='Mobile';extension='pdf';}
 const file=new TFile(),documents={'Earlier.md':{highlights:[],threads:[],progress:.2,draft:'Old note draft',updated:1},'Mobile.pdf':{highlights:[{id:'keep',anchor:{quote:'PDF source',start:0,prefix:'',suffix:''},created:1,color:'yellow',note:'Keep my annotation'}],threads:[],progress:.4,draft:'PDF draft',updated:2}};
 const app:any={vault:{configDir:'.obsidian',adapter:{exists:async()=>false},getAbstractFileByPath:()=>file,on:()=>()=>{}},workspace:{on:()=>()=>{},onLayoutReady:()=>{},getLeavesOfType:()=>[]},metadataCache:{getFileCache:()=>null}};
 class Plugin{app=app;manifest={id:'banana-reader',dir:'.obsidian/plugins/banana-reader'};loadData=async()=>({version:5,settings:{services:[],mobileTaskModels:{}},documents:structuredClone(documents)});saveData=async()=>{};registerView=(id:string,factory:any)=>views.set(id,factory);registerExtensions(){}addSettingTab(){}registerEvent(){}registerObsidianProtocolHandler(){}addRibbonIcon(){return{};}addCommand(){}removeCommand(){}}
 class ItemView{app=app;contentEl=root.createDiv();addChild(){}removeChild(){}}
 const obsidian={Plugin,ItemView,TFile,Platform:{isMobile:true},FileView:class{},FuzzySuggestModal:class{},Modal:class{},PluginSettingTab:class{},Component:class{},getLanguage:()=>'zh',getFrontMatterInfo:()=>({contentStart:0}),setIcon:()=>{},Notice:class{}};
 const context={module:{exports:{}},exports:{},crypto:globalThis.crypto,TextEncoder,TextDecoder,Error,console,URL,AbortController,setTimeout,clearTimeout,requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},require:(id:string)=>{assert.equal(id,'obsidian','Mobile attempted to load '+id);return obsidian;}};
 vm.runInNewContext(bundle,context);const plugin=new (context.module.exports as any).default();await plugin.onload();const view=views.get('gloss-reader')({});return{plugin,view,file,root,app};
}
test('PDF mount failure is caught by the real loader, exposes retry, and never copies the previous note draft into the PDF',async()=>{
 const f=await fixture(),before=JSON.stringify(f.plugin.store.documents['Mobile.pdf']);f.view.path='Earlier.md';f.view.composer={value:'Latest unsent note draft'};f.view.mountPdfSource=async()=>{throw new Error('Synthetic native PDF unavailable');};
 await f.view.loadDocument(f.file.path);assert.equal(f.view.loadError,'Synthetic native PDF unavailable');assert.equal(f.view.article,undefined);assert.equal(f.view.composer,undefined);assert.ok(f.view.contentEl.textContent.includes('重试'));assert.ok(f.view.contentEl.textContent.includes('选择其他文档'));
 await f.view.flushDraft();assert.equal(JSON.stringify(f.plugin.store.documents['Mobile.pdf']),before);assert.equal(f.plugin.store.documents['Earlier.md'].draft,'Latest unsent note draft');
 const buttons=Array.from(f.view.contentEl.getElementsByTagName('button')) as any[];let retried='',focused=false;f.view.loadDocument=async(path:string)=>{retried=path;f.view.loadError='';};f.view.toggleFocus=(value:boolean)=>focused=value;buttons.find(b=>b.textContent==='重试').dispatch('click');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(retried,'Mobile.pdf');assert.equal(focused,true);
});
test('cancelled or superseded PDF mount leaves the native container in place before any DOM move',async()=>{
 for(const superseded of [false,true]){
  const f=await fixture(),article=f.root.createDiv(),native=f.root.createDiv(),controller=new AbortController();let release!:()=>void;f.view.article=article;
  f.app.workspace.getLeavesOfType=()=>[{view:{file:f.file,containerEl:native},loadIfDeferred:()=>new Promise<void>(resolve=>release=resolve)}];
  const opening=f.view.mountPdfSource(f.file,controller.signal);if(superseded)f.view.article=f.root.createDiv();else controller.abort();release();await assert.rejects(opening,/已取消打开 PDF/);assert.equal(native.parentNode,f.root);assert.equal(article.childNodes.length,0);assert.equal(f.view.pdfSource,undefined);
 }
});

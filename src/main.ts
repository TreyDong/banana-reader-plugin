import {t as ui,bindUi,refreshUi,forwardUiLabel,configureLanguage,normalizeLanguage,commandName,relativeTime,receiptText,notebookSummary,type LanguagePreference} from './i18n';
import { Platform, getLanguage, Setting, Plugin, ItemView, FileView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, Component, PluginSettingTab, ToggleComponent, App, FuzzySuggestModal, Modal, getFrontMatterInfo, normalizePath, requestUrl, setIcon } from 'obsidian';
import { type Anchor, type Thread, type Message, type WebReceipt, regenerationHistory, beginThreadRequest, settleThreadRequest, followupHistory, visibleThreadError, answerReceipt, tokenReceipt, tokenDetails, type Reading, type Passage, type Highlight, freshReading, makeAnchor, resolveAnchor, indexPassages, contextFor, blockedPath, exportReading, MARK_STYLES, markStyle, referenceTokens, uniqueReferences, type MarkStyle } from './core';
import { type AgentSettings, type ApiProtocol, configureMobileTransport, API_DEFAULTS, apiEndpoint, askAgent, discoverCodexModels, discoverApiModels, discoverPiModels, mergeModels, normalizeModels, type ModelOption,type ModelType, SYSTEM, networkSearch, webContext, parseQuestionSuggestions, QUESTION_SUGGESTION_PROMPT, SEARCH_QUERY_PROMPT, parseSearchQuery, webSystemPrompt } from './agent';

import {type ModelService,type ModelRef,type ModelSetup,type ServiceKind,SERVICE_NAMES,SERVICE_ICONS,newService,deviceAssignments,setupForDevice,serviceChoices,resolveModel,serviceSettings,migrateSetup,pruneAssignments,supportsEmbedding,resolveEmbeddingModel,setModelType,migrateEmbeddingModel} from './services';

import {placeMarginItems, compactMarginIds, annotationAnchor, anchorRange, paintMarks, type TextMark, type MarginItem, railMagnification, readingMapMetrics, readingMapViewport, readingMapLines} from './reading-ui';

import {DEFAULT_COMMANDS,MAX_COMMANDS,normalizeCommands,saveCommand,renderCommand,type ReadingCommand} from './prompts';

import {notebookCounts,notebookEntries,recoverInterruptedReading,threadType,type NotebookFilter} from './notebook';

import {briefHash,briefPrompt,briefRanges,parseBrief} from './brief';

import {readEpub,readableExtension,BOOK_LIMITS,type Book} from './formats';
import {NativePdf} from './pdf-ui';
import {googleTranslate,TRANSLATION_LANGUAGES} from './translation';
import {BookIndexCache,normalizeEmbedding,embeddingIdentity,embedTexts,chunkSections,createBookIndex,usableIndex,retrieve,wholeDocumentContext,retrievalContext,retainPriorEvidence,type EmbeddingSettings,type BookIndex,type SourceSection,type ContextInfo} from './rag';
import {ZLIB_DEFAULT_DOMAIN,ZLIB_EXTENSIONS,ZLIB_LANGUAGES,ZLIB_LANGUAGE_LABELS,ZLIB_MIRRORS,ZLIB_ORDERS,normalizeZlibDomain,parseMirrorList,probeMirror,withMirrorFailover,ZLibraryClient,ZlibSessionError,type ZlibFetcher,type ZlibBook,type ZlibCredentials,type ZlibSearchPage} from './zlibrary';
import {shelfBooks,columnsFor,chunkRows,spineStyle,formatShelfProgress,type ShelfBook} from './bookshelf';
import {LEGACY_PLUGIN_ID,TARGET_PLUGIN_ID,preparePluginIdentity} from './plugin-migration';

const VIEW = 'gloss-reader';
const EPUB_VIEW='gloss-epub-file';
const SHELF_VIEW='gloss-bookshelf';
interface RetrievalPreferences {topK:number;autoIndex:boolean}
interface Settings extends AgentSettings, ModelSetup {language:LanguagePreference;embedding:RetrievalPreferences;webSearch:boolean;questionSuggestions:boolean;translationEngine:'google'|'model';translationTarget:string;taskPrompts:Record<string,string>;modelLists:Record<string,ModelOption[]>; markStyle:MarkStyle; customFont:string; theme: string; fontSize: number; font: string; lineHeight: number; context: string; maxContext: number; marker: string; pen: string; measure: number; numbers: boolean; commands:ReadingCommand[]; apiProfiles:Record<string,{base:string;model:string}>;zlibDomain:string;zlibMirrors:string[];zlibFolder:string }
interface Store { version: number; settings: Settings; documents: Record<string, Reading> }
const DEFAULTS: Settings = {language:'auto',questionSuggestions:false,webSearch:false,translationEngine:'google',translationTarget:'zh-CN',taskPrompts:{},embedding:{topK:6,autoIndex:false},services:[],taskModels:{},modelLists:{},markStyle:'highlight',customFont:'',commands:DEFAULT_COMMANDS.map(c=>({...c})),apiProfiles:{},claudePath:'',claudeModel:'',apiProtocol:'openai',provider: 'codex', codexPath: '', codexModel: '', apiBase: 'https://api.openai.com/v1', apiModel: '', apiKey: '', theme: 'paper', fontSize: 20, font: 'serif', lineHeight: 1.64, context: 'nearby', maxContext: 60000, marker: 'yellow', pen: 'vermilion', measure: 32, numbers: false, zlibDomain: ZLIB_DEFAULT_DOMAIN, zlibMirrors: [...ZLIB_MIRRORS], zlibFolder: '收集箱'};
const uid = () => crypto.randomUUID();
const modelKey=(s:AgentSettings,provider=s.provider)=>provider==='api'?'api:'+(s.apiProtocol||'openai'):provider;
const modelId=(s:AgentSettings,provider=s.provider)=>provider==='codex'?s.codexModel:provider==='claude'?s.claudeModel||'':provider==='pi'?s.piModel||'':s.apiModel;
const setModel=(s:AgentSettings,id:string)=>{if(s.provider==='codex')s.codexModel=id;else if(s.provider==='claude')s.claudeModel=id;else s.apiModel=id;};
const providerName=(provider:string)=>({codex:'Codex CLI',claude:'Claude CLI',pi:'Pi',api:'API'}[provider]||provider);
const zlibRequest:ZlibFetcher=async(url,init)=>{
 const binary=init.headers.Accept==='*/*';let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const res=await Promise.race([requestUrl({url,...init,throw:false}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Z-Library 请求超时，请稍后重试。')),binary?120000:20000);})]);
  let json:unknown;if(!binary){try{json=res.json;}catch{/* HTML challenges are classified as mirror failures by the client. */}}
  return{status:res.status,headers:Object.fromEntries(Object.entries(res.headers||{}).map(([key,value])=>[key.toLowerCase(),String(value)])),json,text:binary?'':res.text,arrayBuffer:Promise.resolve(res.arrayBuffer)};
 }finally{clearTimeout(timer);}
};

function button(parent: HTMLElement, text: string, action: () => void | Promise<void>, cls = ''): HTMLButtonElement {
  const b = parent.createEl('button', {text, cls}); b.type = 'button';
  b.addEventListener('click', () => {try {Promise.resolve(action()).catch(showError);} catch(e) {showError(e);}}); return b;
}
function availableChoices(setup:ModelSetup,type:ModelType='chat'){return serviceChoices(setup,type).filter(choice=>!Platform?.isMobile||choice.kind==='api');}
function showError(e: unknown) {new Notice(ui(e instanceof Error ? e.message : String(e)), 6000);}
function passiveEmbeds(md: string): string {
  // Do not expand other notes into the reading/AI context without the user opening them.
  return md.replace(/!\[\[([^\]]+)\]\]/g, (all, target: string) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|mp3|mp4|wav|ogg)(\||$)/i.test(target) ? all : `（嵌入内容需打开原笔记查看：${target.replace(/[<>]/g, '')}）`);
}

function threadLabel(thread:Thread,commands:ReadingCommand[]){
 const label=threadType(thread,commands),command=commands.find(c=>c.id===thread.commandId);
 if(command&&label===command.name)return commandName(command);
 if(thread.label&&!(thread.commandId==='default'&&['提问','全文问答'].includes(label)||thread.commandId==='summary'&&label==='总结'))return label;
 return ui(label);
}

export default class GlossPlugin extends Plugin {
  store!: Store;
  private readerRibbon?:HTMLElement;
  private shelfRibbon?:HTMLElement;
  unloading = false;
  indexCache!:BookIndexCache;
  sessionKeys=new Map<string,string>();
  serviceKey(id:string){return this.app.secretStorage?.getSecret('reader-'+id)||this.sessionKeys.get(id)||'';}
  saveServiceKey(id:string,key:string){if(this.app.secretStorage)this.app.secretStorage.setSecret('reader-'+id,key);else this.sessionKeys.set(id,key);}
  zlibCredentials():ZlibCredentials{const raw=String(this.app.secretStorage?.getSecret('zlib-remix')||this.sessionKeys.get('zlib')||'');try{const value=JSON.parse(raw||'{}') as {userId?:unknown;userKey?:unknown};return{userId:String(value.userId||''),userKey:String(value.userKey||'')};}catch{return{userId:'',userKey:''};}}
  saveZlibCredentials(value:ZlibCredentials){const raw=value.userId&&value.userKey?JSON.stringify(value):'';if(this.app.secretStorage)this.app.secretStorage.setSecret('zlib-remix',raw);else this.sessionKeys.set('zlib',raw);}
  zlibClient(credentials:ZlibCredentials=this.zlibCredentials(),domain=this.store.settings.zlibDomain){return new ZLibraryClient(domain,credentials,zlibRequest,Platform?.isMobile?BOOK_LIMITS.file:200*1024*1024);}
  private saveQueue: Promise<void> = Promise.resolve();
  async onload() {
    configureMobileTransport(Platform?.isMobile?async request=>{const response=await requestUrl({...request,throw:false});return{status:response.status,text:response.text};}:undefined);
    try{await preparePluginIdentity({pluginId:this.manifest.id,mobile:!!Platform?.isMobile,configDir:this.app.vault.configDir,adapter:this.app.vault.adapter,legacyActive:(this.app as any).plugins?.enabledPlugins?.has(LEGACY_PLUGIN_ID)});}catch(error){showError(error);throw error;}
    const saved = await this.loadData();
    this.store = {version: 5, settings: {...DEFAULTS, ...saved?.settings, apiKey: ''}, documents: saved?.documents || {}};
    let recoveredRequests=false;for(const reading of Object.values(this.store.documents))if(recoverInterruptedReading(reading))recoveredRequests=true;
    this.store.settings.language=normalizeLanguage(saved?.settings?.language);configureLanguage(this.store.settings.language,getLanguage());
    this.store.settings.zlibMirrors=parseMirrorList(Array.isArray(saved?.settings?.zlibMirrors)?saved.settings.zlibMirrors.filter(item=>typeof item==='string').join('\n'):'');if(!this.store.settings.zlibMirrors.length)this.store.settings.zlibMirrors=[...ZLIB_MIRRORS];this.store.settings.zlibDomain=normalizeZlibDomain(saved?.settings?.zlibDomain||'')||this.store.settings.zlibMirrors[0]!;this.store.settings.zlibFolder=typeof saved?.settings?.zlibFolder==='string'&&saved.settings.zlibFolder.trim()?saved.settings.zlibFolder.trim().slice(0,200):'收集箱';
    const legacyEmbedding=normalizeEmbedding(saved?.settings?.embedding);this.store.settings.embedding={topK:legacyEmbedding.topK,autoIndex:saved?.settings?.embedding?.autoIndex===true};
    this.indexCache=new BookIndexCache((this.manifest.dir||this.app.vault.configDir+'/plugins/'+this.manifest.id)+'/indices',this.app.vault.adapter);
    this.store.settings.commands=normalizeCommands(saved?.settings?.commands).map(command=>{const original=DEFAULT_COMMANDS.find(c=>c.id===command.id);return original&&command.prompt===original.prompt.replaceAll('选中文本','选文')?{...command,prompt:original.prompt}:command;});this.store.settings.webSearch=saved?.settings?.webSearch===true;this.store.settings.questionSuggestions=saved?.settings?.questionSuggestions===true;this.store.settings.translationEngine=saved?.settings?.translationEngine==='model'?'model':'google';this.store.settings.translationTarget=TRANSLATION_LANGUAGES[saved?.settings?.translationTarget]?saved.settings.translationTarget:'zh-CN';this.store.settings.taskPrompts={};for(const task of ['default','summary']){const value=saved?.settings?.taskPrompts?.[task];if(typeof value==='string')this.store.settings.taskPrompts[task]=value.slice(0,8000);}
    const settings=this.store.settings;settings.markStyle=markStyle(settings.markStyle);settings.modelLists={...(saved?.settings?.modelLists||{})};
    if(saved?.settings&&!Array.isArray(saved.settings.services)){
    const local=Platform?.isMobile?[]:await discoverCodexModels();settings.modelLists.codex=settings.modelLists.codex===undefined?local:normalizeModels(settings.modelLists.codex);
    settings.modelLists.claude=settings.modelLists.claude===undefined?[{id:'sonnet',name:'Claude Sonnet'},{id:'opus',name:'Claude Opus'},{id:'haiku',name:'Claude Haiku'}]:normalizeModels(settings.modelLists.claude);
    for(const provider of ['codex','claude','api']){const key=modelKey(settings,provider),id=modelId(settings,provider);settings.modelLists[key]=mergeModels(normalizeModels(settings.modelLists[key]),id?[{id,name:id}]:[]);if(!id&&settings.modelLists[key].length){const previous=settings.provider;settings.provider=provider;setModel(settings,settings.modelLists[key][0].id);settings.provider=previous;}}

    }
    Object.assign(settings,migrateSetup({...settings,services:saved?.settings?saved.settings.services:[]}));
    const migratedEmbedding=migrateEmbeddingModel(settings,legacyEmbedding,service=>this.serviceKey(service.id)===this.serviceKey('embedding'));if(migratedEmbedding?.created)this.saveServiceKey(migratedEmbedding.service.id,this.serviceKey('embedding'));
    if((saved?.version||0)<5)delete settings.taskModels.translate;
    const initializeMobile=!!Platform?.isMobile&&!saved?.settings?.mobileTaskModels;if(Platform?.isMobile)this.taskModels();
    if(!Array.isArray(saved?.settings?.services)||(saved?.version||0)<5||migratedEmbedding||initializeMobile||recoveredRequests)await this.persist();

    if (saved && (saved.version || 1) < 2) {
      if (saved.settings?.fontSize === 19) this.store.settings.fontSize = 20;
      if (saved.settings?.lineHeight === 1.95) this.store.settings.lineHeight = 1.64;
    }
    this.registerView(VIEW, leaf => new GlossView(leaf, this));
    this.registerView(EPUB_VIEW,leaf=>new EpubFileView(leaf,this));
    this.registerView(SHELF_VIEW,leaf=>new BookshelfView(leaf,this));
    try{this.registerExtensions(['epub'],EPUB_VIEW);}catch{/* Keep any existing EPUB plugin's file association. */}
    this.addSettingTab(new GlossSettings(this.app, this));

    // Reader tabs are opt-in sessions; restored workspaces return to native files.
    this.app.workspace.onLayoutReady(()=>{const restored=this.app.workspace.getLeavesOfType(VIEW);requestAnimationFrame(()=>{if(this.unloading)return;for(const leaf of restored){const path=leaf.getViewState().state?.path;if(typeof path==='string'&&this.app.vault.getAbstractFileByPath(path) instanceof TFile)void leaf.openFile(this.app.vault.getAbstractFileByPath(path) as TFile,{active:false}).catch(showError);}});});
    this.readerRibbon=this.addRibbonIcon('book-open-text', ui("打开 Banana Reader"), () => {void this.openCurrent().catch(showError);});
    this.shelfRibbon=this.addRibbonIcon('library', ui("打开书架"), () => {void this.openShelf().catch(showError);});
    this.registerReaderCommands();
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {if (file instanceof TFile && readableExtension(file.extension) && !blockedPath(file.path)) menu.addItem(i => i.setTitle(ui("用 Banana Reader 阅读")).setIcon('book-open-text').onClick(() => {void this.openFile(file).catch(showError);}));}));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      // A rename moves the same document state; do not silently overwrite an existing record.
      for (const key of Object.keys(this.store.documents)) {
        if (key !== oldPath && !key.startsWith(oldPath + '/')) continue;
        const next = file.path + key.slice(oldPath.length);
        if (this.store.documents[next]) {new Notice(ui("新路径已有批注，已保留两份记录。")); continue;}
        this.store.documents[next] = this.store.documents[key]; delete this.store.documents[key];
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if ((leaf.view as GlossView).path === key) (leaf.view as GlossView).path = next;
      }
      void this.persist().catch(showError);
    }));
    for(const protocol of [TARGET_PLUGIN_ID,LEGACY_PLUGIN_ID])this.registerObsidianProtocolHandler(protocol, async params => {
      if (params.vault && params.vault !== this.app.vault.getName()) return;
      const file = this.app.vault.getAbstractFileByPath(params.path || '');
      if (!(file instanceof TFile)) {new Notice(ui("原文已移动或不存在，请手动打开。")); return;}
      try {const v = await this.openFile(file); if(params.anchor&&params.citation)await v.revealReference(params.anchor,params.citation);else if(params.anchor)v.revealSaved(params.anchor);} catch(e) {showError(e);}
    });
  }
  private registerReaderCommands(){
    for(const id of ['open-reader','toggle-question','choose-document','toggle-focus','zlibrary-search','open-bookshelf'])this.removeCommand(id);
    this.addCommand({id: 'open-reader', name: ui("进入沉浸阅读"), callback: () => {void this.openCurrent().catch(showError);}});
    this.addCommand({id:'toggle-question',name:ui("显示 / 收起提问框"),checkCallback:checking=>{const v=this.app.workspace.getActiveViewOfType(GlossView);if(!v)return false;if(!checking)v.toggleComposer();return true;}});
    this.addCommand({id: 'choose-document', name: ui("选择文档开始阅读"), callback: () => this.choose()});
    this.addCommand({id: 'toggle-focus', name: ui("切换沉浸式阅读"), checkCallback: checking => {const v = this.app.workspace.getActiveViewOfType(GlossView); if (!v) return false; if (!checking) void v.exitReader().catch(showError); return true;}});
    this.addCommand({id:'zlibrary-search',name:ui("从 Z-Library 找书"),callback:()=>new ZLibraryModal(this.app,this).open()});
    this.addCommand({id:'open-bookshelf',name:ui("打开书架"),callback:()=>{void this.openShelf().catch(showError);}});
  }
  async changeLanguage(value:unknown){
    const previous=this.store.settings.language;
    this.store.settings.language=normalizeLanguage(value);configureLanguage(this.store.settings.language,getLanguage());
    try{await this.persist();}catch(error){this.store.settings.language=previous;configureLanguage(previous,getLanguage());throw error;}
    this.registerReaderCommands();if(this.readerRibbon)bindUi(this.readerRibbon, {'aria-label':()=>ui('打开 Banana Reader')});if(this.shelfRibbon)bindUi(this.shelfRibbon, {'aria-label':()=>ui('打开书架')});
    for(const leaf of this.app.workspace.getLeavesOfType(VIEW))if(leaf.view instanceof GlossView)await leaf.view.refreshLanguage();
  }
  taskModels(){return deviceAssignments(this.store.settings,!!Platform?.isMobile);}
  modelSetup(){return setupForDevice(this.store.settings,!!Platform?.isMobile);}
  embeddingConnection(){const {service,model}=resolveEmbeddingModel(this.modelSetup());return{service,settings:{...this.store.settings.embedding,base:service.base,model:model.id,dimensions:0} as EmbeddingSettings,key:this.serviceKey(service.id)};}
  read(path: string): Reading {return this.store.documents[path] ||= freshReading();}
  persist(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.store));
    delete snapshot.settings.apiKey;
    const next = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    this.saveQueue = next; return next;
  }
  choose() {new DocumentPicker(this.app, file => {void this.openFile(file).catch(showError);}).open();}
  async openShelf(){
    const existing=this.app.workspace.getLeavesOfType(SHELF_VIEW)[0]||this.app.workspace.getLeaf('tab');
    await existing.setViewState({type:SHELF_VIEW,active:true});
    await this.app.workspace.revealLeaf(existing);
  }
  async openCurrent() {
    const current=this.app.workspace.getActiveViewOfType(GlossView);if(current?.root?.classList.contains('gloss-focus')){await current.exitReader();return;}
    const file = current?.path ? this.app.vault.getAbstractFileByPath(current.path) : this.app.workspace.getActiveFile();
    if (file instanceof TFile && readableExtension(file.extension) && !blockedPath(file.path)) await this.openFile(file);
    else this.choose();
  }
  async openFile(file: TFile): Promise<GlossView> {
    for (const l of this.app.workspace.getLeavesOfType(VIEW)) if ((l.view as GlossView).path !== file.path && (l.view as GlossView).root?.classList.contains('gloss-focus')) (l.view as GlossView).toggleFocus(false);
    if (!readableExtension(file.extension)) throw new Error('支持 Markdown、PDF 和 EPUB。');
    if (blockedPath(file.path)) throw new Error('此目录受隐私边界保护，请使用原生阅读视图。');
    let leaf = this.app.workspace.getLeavesOfType(VIEW).find(l => (l.view as GlossView).path === file.path || l.getViewState().state?.path === file.path);
    if (!leaf) {leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({type: VIEW, state: {path: file.path}, active: true});}
    await leaf.loadIfDeferred();
    if (!(leaf.view instanceof GlossView)) await leaf.open(new GlossView(leaf, this));
    await this.app.workspace.revealLeaf(leaf);
    const v = leaf.view as GlossView; if (v.path !== file.path || (!v.article&&!v.loadError)) await v.loadDocument(file.path);
    this.app.workspace.setActiveLeaf(leaf,{focus:true});
    if(!v.loadError)v.toggleFocus(true); return v;
  }
  onunload() {this.unloading=true;for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof GlossView){leaf.view.stop();leaf.view.cancelIndex();leaf.view.releaseChrome();}}
}

class DocumentPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private pick: (file: TFile) => void) {super(app); this.setPlaceholder(ui("选择 Markdown、PDF 或 EPUB…"));}
  getItems() {return this.app.vault.getFiles().filter(f=>readableExtension(f.extension)).filter(f => !blockedPath(f.path));}
  getItemText(file: TFile) {return file.path;}
  onChooseItem(file: TFile) {this.pick(file);}
}
class EpubFileView extends FileView {
 constructor(leaf:WorkspaceLeaf,private plugin:GlossPlugin){super(leaf);}
 getViewType(){return EPUB_VIEW;}getDisplayText(){return this.file?.basename||ui("EPUB 电子书");}getIcon(){return 'book-open-text';}canAcceptExtension(ext:string){return ext.toLowerCase()==='epub';}
 async onLoadFile(file:TFile){this.contentEl.empty();const pane=this.contentEl.createDiv({cls:'gloss-import-state'});pane.createEl('h2',{text:file.basename});bindUi(pane.createEl('p',{text:ui("EPUB 电子书")}), {"text":()=>ui("EPUB 电子书")});bindUi(button(pane,ui("用 Banana Reader 阅读"),()=>this.plugin.openFile(file).then(()=>{}),'mod-cta'), {"text":()=>ui("用 Banana Reader 阅读")});}
 async onUnloadFile(){this.contentEl.empty();}
}
class ZLibraryModal extends Modal {
 private credentials:ZlibCredentials;
 private client:ZLibraryClient;
 private busy=false;
 private page=1;private totalPages=1;
 private queryEl?:HTMLInputElement;private extensionEl?:HTMLSelectElement;private languageEl?:HTMLSelectElement;private orderEl?:HTMLSelectElement;
 private searchStatus?:HTMLElement;private results?:HTMLElement;private pagerInfo?:HTMLElement;private prev?:HTMLButtonElement;private next?:HTMLButtonElement;
 constructor(app:App,private plugin:GlossPlugin){super(app);this.credentials=plugin.zlibCredentials();this.client=plugin.zlibClient(this.credentials);}
 onOpen(){this.setTitle(ui("从 Z-Library 找书"));this.modalEl.addClass('gr-model-dialog');this.contentEl.addClass('gr-model-modal','gr-zlib-modal');if(this.credentials.userId&&this.credentials.userKey)this.renderSearch();else this.renderLogin();}
 onClose(){this.contentEl.empty();}
 private rebuild(credentials:ZlibCredentials){this.plugin.saveZlibCredentials(credentials);this.credentials=credentials;this.client=this.plugin.zlibClient(credentials);}
 /** Runs a request with automatic mirror failover; the first mirror that answers becomes the saved active domain. */
 private async via<T>(op:(client:ZLibraryClient)=>Promise<T>):Promise<T>{
  const settings=this.plugin.store.settings,result=await withMirrorFailover(settings.zlibMirrors,this.client.domain,domain=>this.plugin.zlibClient(this.credentials,domain),op);
  if(result.domain!==this.client.domain){settings.zlibDomain=result.domain;await this.plugin.persist().catch(showError);}
  this.client=this.plugin.zlibClient(this.credentials,result.domain);
  return result.value;
 }
 private renderLogin(){
  this.contentEl.empty();
  this.contentEl.createEl('p',{cls:'gr-zlib-intro',text:ui("需要 Z-Library 账号。输入邮箱密码登录；若登录接口拒绝账号，可在浏览器登录后粘贴 Cookie。")});
  const field=(label:string,type:string)=>{const wrap=this.contentEl.createDiv({cls:'gr-connection-row'});wrap.createEl('label',{text:label});const input=wrap.createEl('input',{cls:'gr-settings-input',attr:{'aria-label':label,type}});input.autocomplete='off';input.spellcheck=false;return input;};
  const email=field(ui("邮箱"),'email'),password=field(ui("密码"),'password');
  const status=this.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'status'}});
  const footer=this.contentEl.createDiv({cls:'gr-settings-footer'});
  bindUi(button(footer,ui("使用 Cookie 登录"),()=>this.renderCookieLogin(),'gr-settings-button'), {"text":()=>ui("使用 Cookie 登录")});
  const signIn=bindUi(button(footer,ui("登录"),async()=>{
   if(this.busy)return;this.busy=true;signIn.disabled=true;status.textContent=ui("正在登录…");
   try{this.rebuild(await this.via(client=>client.login(email.value.trim(),password.value)));this.renderSearch();}
   catch(error){status.textContent=ui(error instanceof Error?error.message:String(error));}
   finally{this.busy=false;signIn.disabled=false;}
  },'gr-settings-button is-primary'), {"text":()=>ui("登录")});
  password.addEventListener('keydown',e=>{if(!e.isComposing&&e.keyCode!==229&&e.key==='Enter'){e.preventDefault();signIn.click();}});
  email.focus();
 }
 private renderCookieLogin(){
  this.contentEl.empty();
  bindUi(this.contentEl.createEl('p',{cls:'gr-zlib-intro',text:ui("在浏览器登录 Z-Library 后，从开发者工具复制 remix_userid 与 remix_userkey。")}), {"text":()=>ui("在浏览器登录 Z-Library 后，从开发者工具复制 remix_userid 与 remix_userkey。")});
  const field=(label:string)=>{const wrap=this.contentEl.createDiv({cls:'gr-connection-row'});wrap.createEl('label',{text:label});const input=wrap.createEl('input',{cls:'gr-settings-input',attr:{'aria-label':label,type:'text'}});input.autocomplete='off';input.spellcheck=false;return input;};
  const userId=field('remix_userid'),userKey=field('remix_userkey');
  const status=this.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'status'}});
  const footer=this.contentEl.createDiv({cls:'gr-settings-footer'});
  bindUi(button(footer,ui("返回"),()=>this.renderLogin(),'gr-settings-button'), {"text":()=>ui("返回")});
  bindUi(button(footer,ui("保存并继续"),()=>{
   const id=userId.value.trim(),key=userKey.value.trim();
   if(!id||!key){status.textContent=ui("请输入完整的 remix_userid 与 remix_userkey。");return;}
   this.rebuild({userId:id,userKey:key});this.renderSearch();
  },'gr-settings-button is-primary'), {"text":()=>ui("保存并继续")});
  userId.focus();
 }
 private renderSearch(){
  this.contentEl.empty();
  const toolbar=this.contentEl.createDiv({cls:'gr-zlib-toolbar'}),query=this.queryEl=toolbar.createEl('input',{cls:'gr-settings-input gr-zlib-query',attr:{type:'search','aria-label':ui("搜索词"),placeholder:ui("书名、作者或关键词…")}});
  bindUi(button(toolbar,ui("搜索"),()=>void this.runSearch(1).catch(showError),'gr-settings-button is-primary'), {"text":()=>ui("搜索")});
  const filters=this.contentEl.createDiv({cls:'gr-zlib-filters'});
  const select=(label:string,entries:Record<string,string>)=>{const el=filters.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':label}});for(const [value,text] of Object.entries(entries))el.createEl('option',{value,text});return el;};
  this.extensionEl=select(ui("格式"),{'':ui("不限"),...Object.fromEntries(ZLIB_EXTENSIONS.map(item=>[item,item.toUpperCase()]))});
  this.languageEl=select(ui("语言"),{'':ui("不限"),...Object.fromEntries(ZLIB_LANGUAGES.map(item=>[item,ui(ZLIB_LANGUAGE_LABELS[item]||item)]))});
  this.orderEl=select(ui("排序"),Object.fromEntries(Object.entries(ZLIB_ORDERS).map(([value,key])=>[value,ui(key)])));
  this.searchStatus=this.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'status'}});
  this.results=this.contentEl.createDiv({cls:'gr-zlib-results'});
  const pager=this.contentEl.createDiv({cls:'gr-zlib-pager'});this.pagerInfo=pager.createSpan({cls:'gr-zlib-pager-info'});
  this.prev=bindUi(button(pager,ui("上一页"),()=>void this.runSearch(this.page-1).catch(showError),'gr-settings-button'), {"text":()=>ui("上一页")});
  this.next=bindUi(button(pager,ui("下一页"),()=>void this.runSearch(this.page+1).catch(showError),'gr-settings-button'), {"text":()=>ui("下一页")});
  const foot=this.contentEl.createDiv({cls:'gr-zlib-foot'}),quota=foot.createSpan({cls:'gr-zlib-quota'});
  bindUi(button(foot,ui("退出登录"),()=>{this.rebuild({userId:'',userKey:''});this.renderLogin();},'gr-settings-button'), {"text":()=>ui("退出登录")});
  query.addEventListener('keydown',e=>{if(!e.isComposing&&e.keyCode!==229&&e.key==='Enter'){e.preventDefault();void this.runSearch(1).catch(showError);}});
  this.pagerInfo.textContent='';this.prev.disabled=true;this.next.disabled=true;
  void this.refreshQuota(quota).catch(()=>{});
  query.focus();
 }
 private paintBusy(){const busy=this.busy;this.contentEl.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=busy);if(!busy&&this.results){if(this.prev)this.prev.disabled=this.page<=1;if(this.next)this.next.disabled=this.page>=this.totalPages;}}
 private async runSearch(page:number){
  if(this.busy||!this.results)return;
  const query=(this.queryEl?.value||'').trim();if(!query){if(this.searchStatus)this.searchStatus.textContent=ui("请输入搜索词。");return;}
  this.busy=true;this.paintBusy();if(this.searchStatus)this.searchStatus.textContent=ui("正在搜索…");this.results.empty();
  try{
   const result=await this.via(client=>client.search(query,{page,limit:20,extensions:this.extensionEl?.value?[this.extensionEl.value]:[],languages:this.languageEl?.value?[this.languageEl.value]:[],order:this.orderEl?.value||undefined}));
   this.page=result.page;this.totalPages=result.totalPages;this.paintResults(result);
   if(this.searchStatus)this.searchStatus.textContent=result.books.length?'':ui("没有找到相关书籍。");
  }catch(error){
   if(error instanceof ZlibSessionError){this.rebuild({userId:'',userKey:''});this.renderLogin();new Notice(ui(error.message),7000);return;}
   if(this.searchStatus)this.searchStatus.textContent=ui(error instanceof Error?error.message:String(error));
  }finally{this.busy=false;this.paintBusy();}
 }
 private paintResults(result:ZlibSearchPage){
  if(!this.results)return;
  for(const book of result.books){
   const row=this.results.createDiv({cls:'gr-zlib-row'}),copy=row.createDiv({cls:'gr-zlib-copy'});
   copy.createDiv({cls:'gr-zlib-title',text:book.title});
   copy.createDiv({cls:'gr-zlib-meta',text:[book.authors.join('、'),book.year,book.language,book.extension.toUpperCase(),book.size].filter(Boolean).join(' · ')});
   const downloadButton=button(row,ui("下载"),()=>void this.download(book,downloadButton).catch(showError),'gr-settings-button');
  }
  if(!result.books.length)this.results.createDiv({cls:'gr-zlib-empty',text:ui("没有找到相关书籍。")});
  if(this.pagerInfo)this.pagerInfo.textContent=ui("第 {0} / {1} 页",this.page,this.totalPages);
 }
 private async download(book:ZlibBook,buttonEl:HTMLButtonElement){
  if(this.busy)return;this.busy=true;this.paintBusy();
  const label=buttonEl.textContent;buttonEl.textContent=ui("正在下载…");buttonEl.disabled=false;
  if(this.searchStatus)this.searchStatus.textContent=ui("正在下载…");
  try{
   const ticket=await this.via(client=>client.ticket(book.id,book.hash)),file=await this.client.downloadFile(ticket),saved=await this.saveBook(file.bytes,file.filename);
   if(this.searchStatus)this.searchStatus.textContent='';
   const readable=readableExtension(saved.extension),fragment=this.contentEl.ownerDocument.createDocumentFragment();
   fragment.append(ui("已保存到 ")+saved.path);
   if(readable){fragment.append(' ');const open=this.contentEl.ownerDocument.createElement('button');open.textContent=ui("打开");open.addEventListener('click',()=>{void this.plugin.openFile(saved).then(()=>this.close()).catch(showError);});fragment.append(open);}
   new Notice(fragment,9000);
  }catch(error){if(this.searchStatus)this.searchStatus.textContent='';showError(error);}
  finally{this.busy=false;this.paintBusy();buttonEl.textContent=label||ui("下载");}
 }
 private async saveBook(bytes:ArrayBuffer,filename:string):Promise<TFile>{
  const raw=(this.plugin.store.settings.zlibFolder||'收集箱').replace(/^\/+|\/+$/g,''),folder=raw?normalizePath(raw):'',stem=filename.replace(/\.[A-Za-z0-9]{1,8}$/,''),extension=filename.slice(stem.length);
  let path=(folder?folder+'/':'')+filename,n=2;
  while(this.app.vault.getAbstractFileByPath(path))path=(folder?folder+'/':'')+stem+' ('+n+++')'+extension;
  if(blockedPath(path))throw new Error('下载目录位于隐私边界内，请在设置中更改。');
  const parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
  if(parent&&!this.app.vault.getAbstractFileByPath(parent))await this.app.vault.createFolder(parent);
  return await this.app.vault.createBinary(path,bytes);
 }
 private async refreshQuota(target:HTMLElement){try{const profile=await this.via(client=>client.profile());target.textContent=[profile.name||profile.email,profile.remaining!=null?ui("今日剩余下载：{0}",profile.remaining):''].filter(Boolean).join(' · ');}catch{target.textContent='';}}
}
class BookshelfView extends ItemView {
 private grid?:HTMLElement;private count?:HTMLElement;private tip?:HTMLElement;
 private resizeObserver?:ResizeObserver;private renderTimer?:ReturnType<typeof setTimeout>;private signature='';
 constructor(leaf:WorkspaceLeaf,readonly plugin:GlossPlugin){super(leaf);}
 getViewType(){return SHELF_VIEW;}getIcon(){return 'library';}
 getDisplayText(){return ui("书架");}
 async onOpen(){
  this.contentEl.addClass('gr-shelf-host');
  const head=this.contentEl.createDiv({cls:'gr-shelf-head'});
  bindUi(head.createEl('h2',{cls:'gr-shelf-title',text:ui("书架")}), {"text":()=>ui("书架")});
  this.count=head.createSpan({cls:'gr-shelf-count'});
  bindUi(button(head,ui("从 Z-Library 找书"),()=>new ZLibraryModal(this.app,this.plugin).open(),'gr-settings-button'), {"text":()=>ui("从 Z-Library 找书")});
  bindUi(button(head,ui("选择阅读文档"),()=>this.plugin.choose(),'gr-settings-button'), {"text":()=>ui("选择阅读文档")});
  this.grid=this.contentEl.createDiv({cls:'gr-shelf'});
  this.resizeObserver=new ResizeObserver(()=>{clearTimeout(this.renderTimer);this.renderTimer=setTimeout(()=>this.renderShelf(),120);});
  this.resizeObserver.observe(this.contentEl);
  this.renderShelf();
  const refresh=()=>{clearTimeout(this.renderTimer);this.renderTimer=setTimeout(()=>this.renderShelf(),300);};
  this.registerEvent(this.app.vault.on('create',refresh));
  this.registerEvent(this.app.vault.on('delete',refresh));
  this.registerEvent(this.app.vault.on('rename',refresh));
  this.registerEvent(this.app.vault.on('modify',file=>{if(file.path.endsWith(this.plugin.manifest.id+'/data.json'))refresh();}));
 }
 async onClose(){this.resizeObserver?.disconnect();clearTimeout(this.renderTimer);this.contentEl.empty();}
 private shelf(){return shelfBooks(this.app.vault.getFiles().filter(f=>readableExtension(f.extension)&&!blockedPath(f.path)).map(f=>({path:f.path,basename:f.basename,extension:f.extension})),this.plugin.store.documents);}
 private renderShelf(){
  if(!this.grid||!this.grid.isConnected)return;
  const books=this.shelf(),signature=books.map(b=>b.path+':'+b.progress).join('|');
  if(this.count)this.count.textContent=ui("共 {0} 本",books.length);
  if(signature===this.signature&&this.grid.childElementCount)return;
  this.signature=signature;this.grid.empty();this.hideTip();
  if(!books.length){
   const empty=this.grid.createDiv({cls:'gr-shelf-empty'});setIcon(empty.createSpan(),'library');
   bindUi(empty.createEl('p',{text:ui("书架空空如也。")}), {"text":()=>ui("书架空空如也。")});
   bindUi(empty.createEl('p',{cls:'gr-shelf-empty-sub',text:ui("从 Z-Library 找一本书，或选择库内的文档开始阅读。")}), {"text":()=>ui("从 Z-Library 找一本书，或选择库内的文档开始阅读。")});
   bindUi(button(empty,ui("从 Z-Library 找书"),()=>new ZLibraryModal(this.app,this.plugin).open(),'gr-settings-button is-primary'), {"text":()=>ui("从 Z-Library 找书")});
   return;
  }
  const rows=chunkRows(books,columnsFor(Math.max(320,this.grid.clientWidth||1000)));let index=0;
  for(const row of rows){
   const shelf=this.grid.createDiv({cls:'gr-shelf-row'});
   for(const book of row){
    const style=spineStyle(book.title),file=this.app.vault.getAbstractFileByPath(book.path),pct=formatShelfProgress(book.progress);
    const spine=shelf.createEl('button',{cls:'gr-shelf-book',attr:{type:'button','aria-label':book.title}});
    spine.style.setProperty('--spine-color',style.color);spine.style.setProperty('--spine-dark',style.dark);spine.style.setProperty('--spine-h',style.height+'px');spine.style.setProperty('--i',String(index++));
    if(book.progress>0)spine.createDiv({cls:'gr-shelf-ribbon'}).style.setProperty('--ribbon-h',Math.max(10,Math.round(book.progress*52))+'px');
    spine.createSpan({cls:'gr-shelf-spine-title',text:book.title});
    spine.createSpan({cls:'gr-shelf-badge',text:book.extension.toUpperCase()});
    spine.addEventListener('click',()=>{if(file instanceof TFile)void this.plugin.openFile(file).catch(showError);});
    spine.addEventListener('mouseenter',()=>this.showTip(book,spine));
    spine.addEventListener('mouseleave',()=>this.hideTip());
   }
   this.grid.createDiv({cls:'gr-shelf-plank'});
  }
 }
 private showTip(book:ShelfBook,target:HTMLElement){
  if(!this.tip){this.tip=this.contentEl.createDiv({cls:'gr-shelf-tip'});this.tip.hidden=true;}
  this.tip.empty();
  this.tip.createDiv({cls:'gr-shelf-tip-title',text:book.title});
  this.tip.createDiv({cls:'gr-shelf-tip-meta',text:[book.extension.toUpperCase(),book.progress>0?ui("读到 {0}%",formatShelfProgress(book.progress)):ui("未读")].join(' · ')});
  this.tip.hidden=false;
  const host=this.contentEl.getBoundingClientRect(),rect=target.getBoundingClientRect();
  const left=Math.max(8,Math.min(host.width-this.tip.offsetWidth-8,rect.left-host.left+rect.width/2-this.tip.offsetWidth/2));
  this.tip.style.left=left+'px';this.tip.style.top=Math.max(4,rect.top-host.top-this.tip.offsetHeight-10)+'px';
 }
 private hideTip(){if(this.tip)this.tip.hidden=true;}
}
class NoteModal extends Modal {
  constructor(app: App, private initial: string, private save: (s: string) => Promise<void>) {super(app);}
  onOpen() {
    this.setTitle(ui("留下你的理解"));
    const field = bindUi(this.contentEl.createEl('textarea', {cls: 'gloss-note-input', attr: {'aria-label': ui("批注内容"), placeholder: ui("这段话让你想到什么？")}}), {"aria-label":()=>ui("批注内容"),"placeholder":()=>ui("这段话让你想到什么？")}); field.value = this.initial;
    const row = this.contentEl.createDiv({cls: 'gloss-note-actions'});
    bindUi(button(row, ui("取消"), () => this.close()), {"text":()=>ui("取消")});
    bindUi(button(row, ui("保存批注"), async () => {await this.save(field.value); this.close();}, 'mod-cta'), {"text":()=>ui("保存批注")}); field.focus();
  }
  onClose() {this.contentEl.empty();}
}

class GlossView extends ItemView {
  path = '';
  root!: HTMLElement;
  article!: HTMLElement;
  private scroller!: HTMLElement;
  private grid!: HTMLElement;
  private page!: HTMLElement;
  private margin!: HTMLElement;
  private drawer!: HTMLElement;
  private drawerBody!: HTMLElement;
  private drawerSubtitle!:HTMLElement;
  private drawerTabs!:HTMLElement;
  private notebookBadge!:HTMLElement;
  private notebookFilter:NotebookFilter='all';
  private notebookAnswers=new Set<string>();
  private rail!: HTMLElement;
  private railWindow!: HTMLElement;
  private railTimer?:ReturnType<typeof setTimeout>;
  private railFocus?:number;
  private selectionPreview?:any;private referencePreview?:any;
  private readingModel?:ModelRef;
  private modelMenu?:HTMLElement;
  private modelMenuTrigger?:HTMLButtonElement;
  private railGeometry: {top:number;height:number;heading:boolean;lines:{top:number;width:number}[]}[]=[];
  private composer!: HTMLTextAreaElement;
  private composerWrap!: HTMLElement;
  private questionButton!: HTMLButtonElement;
  private webError='';private webButton?:HTMLButtonElement;private suggestionHost?:HTMLElement;private suggestionJob?:AbortController;private suggestionKey='';private suggestionCache=new Map<string,string[]>();
  private composeLabel!: HTMLElement;
  private sendButton!: HTMLButtonElement;
  private hoverThread?:string;private referenceFocus?:{threadId:string;anchor:Anchor};private runningThread?:string;private answerStage='';private wholeBookCache?:{stamp:string;sections:SourceSection[];skipped:number};private selectionChip?:HTMLElement;
  private briefHost!:HTMLElement;
  private briefCollapsed=false;
  private briefError='';
  private briefJob?:{controller:AbortController;revision:number};
  private focusButton!: HTMLButtonElement;
  private lens!: HTMLElement;
  private lensMode: 'actions'|'ask'|'note' = 'actions';
  private lensInput?: HTMLTextAreaElement;
  private appearance!: HTMLElement;
  private selected?: Anchor;
  private activeThread?: string;
  private activeHighlight?: string;
  private fresh?: string;
  private focus = false;
  private notebookOpen = false;
  private narrow = false;
  private selectionTimer?:ReturnType<typeof setTimeout>;
  private revision = 0;
  private restoring = false;
  private pendingProgress?: number;
  private text = '';
  private blocks: HTMLElement[] = [];
  private passages: Passage[] = [];
  private cards = new Map<string, HTMLElement>();
  private previousPositions = new Map<string,string>();
  private markdown?: Component;
  private marginRender?: Component;
  private aborter?: AbortController;
  private resizeObserver?: ResizeObserver;
  private marginObserver?: ResizeObserver;
  private progressTimer?: ReturnType<typeof setTimeout>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private frame = 0;
  private leader?:SVGSVGElement;
  private leaderFrame=0;
  private chromeDocument?:Document;
  private chromeOwner=uid();
  private pdf?:NativePdf;
  private readingScope:'selection'|'page'|'whole'|'rag'='page';
  private retrievalJob?:AbortController;
  private indexJob?:AbortController;
  private indexAutomatic=false;private indexAttempt='';private indexStatus='';private indexStatusLabel?:(()=>string);private indexReady=false;private indexConnection='';private indexButton?:HTMLButtonElement;private indexListeners=new Set<()=>void>();
  private pdfSource?:{leaf:WorkspaceLeaf;container:HTMLElement;placeholder:Comment};
  private book?:Book;
  private bookUrls:string[]=[];
  private importAborter?:AbortController;
  loadError='';
  constructor(leaf: WorkspaceLeaf, readonly plugin: GlossPlugin) {super(leaf);}
  getViewType() {return VIEW;}
  getDisplayText() {return this.path ? ui("阅读 · {0}",this.path.split('/').pop()?.replace(/\.md$/, '')) : 'Banana Reader';}
  getIcon() {return 'book-open-text';}
  getState() {return {path:this.path};}
  async setState(state:{path?:string}, result:any) {if(state?.path)await this.loadDocument(state.path);await super.setState(state,result);}
  async onOpen() {
    this.contentEl.addClass('gloss-host');
    if(Platform?.isMobile){
      this.registerDomEvent(this.containerEl.ownerDocument,'selectionchange',()=>{
        clearTimeout(this.selectionTimer);
        if(!this.root?.isConnected||this.app.workspace.getActiveViewOfType(GlossView)!==this||this.lensMode==='note'&&!this.lens?.hidden)return;
        this.selectionTimer=setTimeout(()=>{if(this.article?.isConnected)this.captureSelection();},280);
      });
      const viewport=this.containerEl.ownerDocument.defaultView?.visualViewport;
      const resize=()=>this.updateMobileViewport();
      if(viewport){viewport.addEventListener('resize',resize);viewport.addEventListener('scroll',resize);this.register(()=>{viewport.removeEventListener('resize',resize);viewport.removeEventListener('scroll',resize);});}
      this.register(()=>clearTimeout(this.selectionTimer));
      this.registerDomEvent(this.containerEl.ownerDocument,'visibilitychange',()=>{if(this.containerEl.ownerDocument.visibilityState==='hidden'&&this.root?.isConnected){this.captureProgress();void this.flushDraft().catch(showError);}});
    }
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf&&leaf!==this.leaf&&this.focus)this.toggleFocus(false);}));
    this.registerDomEvent(this.containerEl.ownerDocument,'keydown',e=>{
      const target=e.target as HTMLElement;
      if(e.defaultPrevented||e.composedPath().some(n=>n instanceof HTMLElement&&n.classList.contains('modal-container'))||target.closest?.('.modal-container')||(!this.focus&&this.app.workspace.getActiveViewOfType(GlossView)!==this))return;
      if(this.loadError)return;
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Escape') {
        if(this.modelMenu){e.preventDefault();e.stopImmediatePropagation();this.closeModelMenu(true);return;}
        if(this.lens&&!this.lens.hidden){e.preventDefault();e.stopImmediatePropagation();this.closeLens();return;}
        if(this.appearance&&!this.appearance.hidden){e.preventDefault();e.stopImmediatePropagation();this.appearance.hidden=true;return;}
        if(this.notebookOpen){e.preventDefault();e.stopImmediatePropagation();this.toggleNotebook(false);return;}
        if(this.activeThread){e.preventDefault();e.stopImmediatePropagation();this.collapseThread();return;}
        if(this.composerWrap&&!this.composerWrap.hidden){e.preventDefault();e.stopImmediatePropagation();this.toggleComposer(false);return;}
        if(this.focus){e.preventDefault();e.stopImmediatePropagation();void this.exitReader().catch(showError);}return;
      }
      if(target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(target.closest?.('button,a,[role="button"]')&&(e.key==='Enter'||e.key===' '))return;
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      if(e.key==='/'){e.preventDefault();e.stopImmediatePropagation();this.selected=undefined;this.activeHighlight=undefined;this.readingScope='whole';this.closeLens();this.toggleComposer(true);return;}
      if(e.key==='?'){e.preventDefault();e.stopImmediatePropagation();this.showKeys();return;}
      if(this.selected&&this.composerWrap&&!this.composerWrap.hidden&&e.key.length===1){e.preventDefault();e.stopImmediatePropagation();this.showLens('ask',e.key);return;}
      if(e.key==='j'||e.key==='k'){e.preventDefault();e.stopImmediatePropagation();this.movePassage(e.key==='j'?1:-1);return;}
      if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();if(!this.selected){const i=this.keyboardPassage??this.currentPassage(),p=this.passages[i];if(p)this.selected=this.makeReadingAnchor(p.start,p.end);}this.toggleComposer(true);return;}
      if(e.key==='['||e.key===']'){e.preventDefault();e.stopImmediatePropagation();this.moveAnnotation(e.key===']'?1:-1);return;}
      if(e.key.toLowerCase()==='n'){e.preventDefault();e.stopImmediatePropagation();this.toggleNotebook();return;}
      if(e.key.toLowerCase()==='b'&&!this.pdf){e.preventDefault();e.stopImmediatePropagation();if(this.data.brief){this.briefCollapsed=!this.briefCollapsed;this.renderBrief();}else void this.generateBrief().catch(showError);return;}
      if(e.key.toLowerCase()==='f'){e.preventDefault();e.stopImmediatePropagation();if(this.focus)void this.exitReader().catch(showError);else this.toggleFocus(true);}
    },{capture:true});
    this.registerEvent(this.app.vault.on('modify',f=>{if(f.path!==this.path)return;clearTimeout(this.reloadTimer);this.reloadTimer=setTimeout(()=>void this.loadDocument(this.path,true).catch(showError),500);}));
    this.registerEvent(this.app.vault.on('delete',f=>{if(f.path===this.path){this.stop();new Notice(ui("原文已移除，批注仍保留。"));}}));
  }
  private iconButton(parent:HTMLElement,name:string,label:string,action:()=>void|Promise<void>,cls='') {
    const b=button(parent,'',action,`gloss-icon ${cls}`);setIcon(b,name);const id='reader-label-'+uid();b.createSpan({cls:'gloss-sr-only',text:label,attr:{id}});b.setAttribute('aria-labelledby',id);return b;
  }
  private answerStop(parent:HTMLElement,cls=''){const b=bindUi(this.iconButton(parent,'square',ui("停止回答"),()=>this.stop(),cls), {"label":()=>ui("停止回答")});b.addEventListener('pointerdown',e=>{e.preventDefault();this.stop();});return b;}
  private quietLabels(scope:HTMLElement,includeControls=false){for(const el of [scope,...Array.from(scope.querySelectorAll<HTMLElement>('[aria-label]'))]){if(!el.hasAttribute('aria-label')||el.closest('.gloss-native-pdf')||(!includeControls&&el.matches('button,input,textarea,select,[role=option],[role=tab]')))continue;const label=el.getAttribute('aria-label')!,id='reader-group-'+uid();const caption=this.root.createSpan({cls:'gloss-sr-only',text:label,attr:{id}});forwardUiLabel(el,caption);el.removeAttribute('aria-label');el.setAttribute('aria-labelledby',id);}}
  private get data(){return this.plugin.read(this.path);}
  private get threads(){return this.data.threads.filter(t=>!t.removed&&(!this.pdf||!t.anchor||t.anchor.pdfPage===this.pdf.page||!!t.contextInfo?.embeddingModel||t.id===this.referenceFocus?.threadId));}
  async loadDocument(path:string,retainPosition=false) {
    if(blockedPath(path))throw new Error('此目录受隐私边界保护。');
    const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw new Error('找不到这篇文档。');
    this.cancelSuggestions();this.indexJob?.abort();this.retrievalJob?.abort();this.stop();if(this.briefJob){this.aborter=undefined;this.briefJob=undefined;}this.captureProgress();await this.flushDraft();
    this.importAborter?.abort();const opening=new AbortController();this.importAborter=opening;const token=++this.revision,extension=file.extension.toLowerCase();let raw='',book:Book|undefined;
    let status:HTMLElement|undefined;if(!this.root?.isConnected)status=bindUi(this.contentEl.createDiv({cls:'gloss-import-state',text:ui("正在打开文档…")}), {"text":()=>ui("正在打开文档…")});
    try{if(extension==='md')raw=await this.app.vault.cachedRead(file);else if(extension==='epub'){if(file.stat.size>BOOK_LIMITS.file)throw new Error('电子书超过 40 MB，请使用较小的文件。');const bytes=new Uint8Array(await this.app.vault.readBinary(file));book=await readEpub(bytes,text=>new DOMParser().parseFromString(text,'application/xml'),opening.signal,message=>{if(status)status.textContent=message;});}}
    catch(e){if(token!==this.revision||opening.signal.aborted)return;this.showDocumentLoadError(file,e);return;}
    if(token!==this.revision||opening.signal.aborted)return;this.loadError='';this.pdf?.destroy();this.releasePdfSource();this.pdf=undefined;this.bookUrls.forEach(url=>URL.revokeObjectURL(url));this.bookUrls=[];this.book=book;status?.remove();
    const progress=this.plugin.read(path).progress;
    this.closeModelMenu();this.clearSelectionPreview();this.clearReferencePreview();if(this.path!==path){this.notebookFilter='all';this.notebookAnswers.clear();}this.path=path;this.wholeBookCache=undefined;this.indexAttempt='';this.indexStatus='';this.indexReady=false;this.referenceFocus=undefined;this.hoverThread=undefined;this.readingModel=undefined;this.keyboardPassage=undefined;this.selected=undefined;this.activeThread=undefined;this.activeHighlight=undefined;this.restoring=true;this.pendingProgress=progress;this.readingScope='whole';
    this.resizeObserver?.disconnect();this.marginObserver?.disconnect();cancelAnimationFrame(this.leaderFrame);this.leader=undefined;
    if(this.markdown){this.removeChild(this.markdown);this.markdown.unload();}this.markdown=new Component();this.addChild(this.markdown);
    this.root?.remove();this.contentEl.empty();
    this.root=this.contentEl.createDiv({cls:'gloss-root banana-reader'});this.root.toggleClass('gloss-pdf',extension==='pdf');this.root.toggleClass('gloss-mobile',Platform?.isMobile);this.narrow=Platform?.isMobile||this.root.clientWidth<1080;this.updateMobileViewport();this.applyAppearance();
    const top=this.root.createEl('header',{cls:'gloss-toolbar'});
    this.focusButton=bindUi(this.iconButton(top,'arrow-left',ui("返回文档"),()=>this.exitReader(),'gloss-back'), {"label":()=>ui("返回文档")});
    bindUi(this.iconButton(top,'folder-open',ui("选择阅读文档"),()=>this.plugin.choose(),'gloss-document-picker'), {"label":()=>ui("选择阅读文档")});
    const titleBtn=button(top,file.basename,()=>this.scroller.scrollTo({top:0,behavior:'smooth'}),'gloss-top-title');
    const tools=bindUi(top.createEl('nav',{cls:'gloss-tools',attr:{'aria-label':ui("阅读工具")}}), {"aria-label":()=>ui("阅读工具")});
    bindUi(this.iconButton(tools,'list',ui("文档目录"),()=>this.showContents()), {"label":()=>ui("文档目录")});
    bindUi(button(tools,'Aa',()=>this.toggleAppearance(),'gloss-aa'), {"aria-label":()=>ui("外观配置")});
    this.questionButton=bindUi(this.iconButton(tools,'message-circle',ui("提问 · /"),()=>this.toggleComposer()), {"label":()=>ui("提问 · /")});this.questionButton.setAttribute('aria-expanded','false');
    bindUi(this.iconButton(tools,'keyboard',ui("快捷键"),()=>this.showKeys()), {"label":()=>ui("快捷键")});
    const notebook=button(tools,'',()=>this.toggleNotebook(),'gloss-notebook-button');setIcon(notebook,'notebook-pen');bindUi(notebook.createSpan({text:ui("笔记本")}), {"text":()=>ui("笔记本")});this.notebookBadge=notebook.createSpan({cls:'gloss-notebook-count'});bindUi(notebook, {"aria-label":()=>ui("阅读笔记本")});
    this.indexButton=button(tools,'',()=>this.showBookIndex(),'gloss-notebook-button');setIcon(this.indexButton.createSpan(),'database');bindUi(this.indexButton.createSpan({cls:'gloss-index-label',text:ui("索引")}), {"text":()=>ui("索引")});bindUi(this.indexButton, {"aria-label":()=>ui("本书检索索引")});this.indexButton.hidden=!this.focus;
    bindUi(this.iconButton(tools,'settings-2',ui("Agent 服务设置"),()=>{(this.app as any).setting.open();(this.app as any).setting.openTabById(this.plugin.manifest.id);}), {"label":()=>ui("Agent 服务设置")});
    this.scroller=this.root.createDiv({cls:'gloss-scroll'});
    this.grid=this.scroller.createDiv({cls:'gloss-reader-grid'});
    this.rail=bindUi(this.grid.createDiv({cls:'gloss-rail',attr:{'aria-label':ui("文档导航")}}), {"aria-label":()=>ui("文档导航")});
    this.page=this.grid.createDiv({cls:'gloss-page'});
    const fm=book?{title:book.title||file.basename,author:book.author,source_label:'EPUB'}:this.app.metadataCache.getFileCache(file)?.frontmatter||{};
    let body=raw.slice(getFrontMatterInfo(raw).contentStart);
    const firstHeading=body.match(/^\s*# ([^\n]+)\s*\n/);
    const title=String(fm.title||firstHeading?.[1]||file.basename);
    if(firstHeading)body=body.slice(firstHeading[0].length);
    const header=this.page.createEl('header',{cls:'gloss-document-header'});
    const source=header.createDiv({cls:'gloss-document-source'});source.createSpan({cls:'gloss-source-dot'});bindUi(source.createSpan({text:String(fm.source_label||file.parent?.name||ui("当前文档"))}), {"text":()=>String(fm.source_label||file.parent?.name||ui("当前文档"))});
    header.createEl('h1',{cls:'gloss-document-title',text:title});
    if(fm.description||fm.dek)header.createEl('p',{cls:'gloss-document-dek',text:String(fm.description||fm.dek)});
    const meta=header.createDiv({cls:'gloss-document-meta'}),byline=meta.createDiv();
    if(fm.author){const by=byline.createDiv({cls:'gloss-byline',text:String(fm.author)});if(fm.published||fm.date)by.createSpan({cls:'gloss-published',text:' · '+String(fm.published||fm.date)});}
    byline.createDiv({cls:'gloss-reading-stats'});
    const sourceBtn=button(meta,'',()=>this.app.workspace.openLinkText(path,'',true),'gloss-original');setIcon(sourceBtn,'arrow-up-right');bindUi(sourceBtn.createSpan({text:ui("原文")}), {"text":()=>ui("原文")});
    this.briefHost=header.createDiv({cls:'gloss-brief-host'});this.briefError='';
    this.article=bindUi(this.page.createEl('article',{cls:'gloss-article markdown-rendered',attr:{'aria-label':ui("阅读正文")}}), {"aria-label":()=>ui("阅读正文")});
    try{if(extension==='pdf'){
      await this.mountPdfSource(file,opening.signal);
      if(token!==this.revision||opening.signal.aborted)return;
      this.pdf=new NativePdf(this.article,()=>this.syncPdfPage(),()=>{this.paintHighlights();this.scheduleLayout();if(this.lens&&!this.lens.hidden)this.placeLens();});
    }else if(book)this.renderBook(book);else await MarkdownRenderer.render(this.app,passiveEmbeds(body),this.article,path,this.markdown);}catch(e){if(token!==this.revision||opening.signal.aborted)return;this.showDocumentLoadError(file,e);return;}if(token!==this.revision||opening.signal.aborted)return;
    const selector='p,h1,h2,h3,h4,h5,h6,li,pre,table';
    this.blocks=extension==='pdf'?[]:Array.from(this.article.querySelectorAll<HTMLElement>(selector)).filter(el=>{if(el.closest('.internal-embed,.external-embed'))return false;const a=el.parentElement?.closest(selector);return(!a||!this.article.contains(a))&&!!el.textContent?.trim();});
    if(extension!=='pdf'&&!this.blocks.length&&this.article.textContent?.trim())this.blocks=[this.article];
    const index=indexPassages(this.blocks.map(el=>el.textContent||''));this.text=index.text;this.passages=index.passages;this.passages.forEach((p,i)=>{p.source=this.blocks[i]?.closest<HTMLElement>('[data-book-source]')?.dataset.bookSource;});
    this.blocks.forEach((el,i)=>{el.addClass('gloss-passage');el.dataset.glossParagraph=String(i+1);});
    const first=this.blocks.find(el=>el.tagName==='P');if(first){first.addClass('gloss-first-paragraph');if(/^[A-Za-z]/.test(first.textContent||''))first.addClass('gloss-dropcap');}
    this.refreshReadingStats();
    bindUi(this.page.createDiv({cls:'gloss-end',text:ui("读到这里，留下一个属于你的想法。")}), {"text":()=>ui("读到这里，留下一个属于你的想法。")});
    this.margin=bindUi(this.grid.createEl('aside',{cls:'gloss-margin-column',attr:{'aria-label':ui("页边批注")}}), {"aria-label":()=>ui("页边批注")});this.margin.addEventListener('scroll',()=>this.updateLeader(),{passive:true});
    this.buildRail();
    const compose=this.composerWrap=bindUi(this.root.createDiv({cls:'gloss-composer',attr:{role:'group','aria-label':ui("文档提问")}}), {"aria-label":()=>ui("文档提问")});compose.hidden=true;
    this.suggestionHost=bindUi(compose.createDiv({cls:'gloss-question-suggestions',attr:{'aria-label':ui("模型生成的问题建议")}}), {"aria-label":()=>ui("模型生成的问题建议")});this.suggestionHost.hidden=true;
    this.composeLabel=compose.createDiv({cls:'gloss-compose-context'});this.selectionChip=compose.createDiv({cls:'gloss-compose-selection'});this.selectionChip.hidden=true;
    const inputRow=compose.createDiv({cls:'gloss-compose-input'});
    this.composer=bindUi(inputRow.createEl('textarea',{cls:'gloss-question',attr:{'aria-label':ui("向 Agent 提问"),placeholder:ui("询问这篇文章…"),rows:'1',wrap:Platform?.isMobile?'soft':'off'}}), {"aria-label":()=>ui("向 Agent 提问"),"placeholder":()=>ui("询问这篇文章…")});this.composer.value=this.data.draft||'';
    this.composer.addEventListener('input',()=>{this.rememberDraft();this.resizeQuestion();this.syncSuggestionVisibility();if(this.composer.value.trim())this.cancelSuggestions();else void this.generateSuggestions();});this.protectInput(this.composer);this.composer.addEventListener('focus',()=>{this.closeModelMenu();this.closeLens();});this.composer.addEventListener('keydown',e=>{if(!e.isComposing&&e.keyCode!==229&&e.key==='Enter'&&!e.shiftKey&&!Platform?.isMobile){e.preventDefault();void this.send().catch(showError);}});
    const row=inputRow;row.addClass('gloss-compose-row');button(row,'/',()=>this.showKeys(),'gloss-key-hint');const modelRow=row.createDiv({cls:'gloss-compose-model-row'});this.modelPicker(modelRow,()=>ui("模型"));
    const web=this.webButton=button(row,'',async()=>{if(this.aborter||this.retrievalJob)return;this.plugin.store.settings.webSearch=!this.plugin.store.settings.webSearch;this.webError='';this.paintWebButton();this.updateContext();await this.plugin.persist();},'gloss-web-toggle');setIcon(web.createSpan(),'globe');bindUi(web.createSpan({text:ui("联网")}), {"text":()=>ui("联网")});this.paintWebButton();
    this.sendButton=bindUi(this.iconButton(row,'arrow-up',ui("发送问题"),()=>this.send(),'gloss-send'), {"label":()=>ui("发送问题")});
    this.drawer=bindUi(this.root.createEl('aside',{cls:'gloss-notebook',attr:{'aria-label':ui("阅读笔记本")}}), {"aria-label":()=>ui("阅读笔记本")});this.drawer.hidden=!this.notebookOpen;this.root.toggleClass('gloss-notebook-open',this.notebookOpen);
    const drawerHead=this.drawer.createDiv({cls:'gloss-notebook-head'}),heading=drawerHead.createDiv({cls:'gloss-notebook-heading'});bindUi(heading.createEl('h2',{text:ui("笔记本")}), {"text":()=>ui("笔记本")});this.drawerSubtitle=heading.createEl('p',{cls:'gloss-notebook-subtitle'});
    bindUi(this.iconButton(drawerHead,'copy',ui("复制 Markdown 笔记"),async()=>{await navigator.clipboard.writeText(exportReading(this.path,this.data,this.app.vault.getName()));new Notice(ui("已复制阅读笔记"));}), {"label":()=>ui("复制 Markdown 笔记")});bindUi(this.iconButton(drawerHead,'download',ui("导出 Markdown 笔记"),()=>this.exportNotes()), {"label":()=>ui("导出 Markdown 笔记")});drawerHead.createSpan({cls:'gloss-notebook-head-divider'});bindUi(this.iconButton(drawerHead,'x',ui("收起笔记本"),()=>this.toggleNotebook(false)), {"label":()=>ui("收起笔记本")});
    this.drawerTabs=bindUi(this.drawer.createDiv({cls:'gloss-notebook-tabs',attr:{role:'tablist','aria-label':ui("笔记本分类")}}), {"aria-label":()=>ui("笔记本分类")});
    this.drawerBody=this.drawer.createDiv({cls:'gloss-notebook-body'});
    this.lens=this.root.createDiv({cls:'gloss-lens',attr:{role:'toolbar'}});this.lens.hidden=true;
    this.lens.addEventListener('mousedown',e=>{if(!(e.target as HTMLElement).closest('textarea,input'))e.preventDefault();});
    this.appearance=this.root.createDiv({cls:'gloss-appearance'});this.appearance.hidden=true;
    this.appearance.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopImmediatePropagation();this.appearance.hidden=true;this.root.querySelector<HTMLButtonElement>('.gloss-aa')?.focus();}});
    this.article.addEventListener('wheel',()=>{this.keyboardPassage=undefined;},{passive:true});
    this.article.addEventListener('pointerdown',()=>{this.keyboardPassage=undefined;});
    this.article.addEventListener('mouseup',()=>{if(!Platform?.isMobile)this.captureSelection();});this.article.addEventListener('keyup',e=>{if(e.key.startsWith('Arrow')||e.key==='Shift')this.captureSelection();});
    this.article.addEventListener('click',e=>{
      const selection=this.article.ownerDocument.getSelection();if(selection&&!selection.isCollapsed&&this.article.contains(selection.anchorNode))return;
      if(this.pdf){const id=this.pdf.hit(e.clientX,e.clientY),t=this.threads.find(t=>t.id===id),h=this.data.highlights.find(h=>h.id===id&&!h.removed);if(t){this.activateThread(t);this.selected=t.anchor;this.toggleComposer(true,false);return;}if(h){this.activateNote(h);this.showLens('actions');return;}}
      const el=(e.target as HTMLElement).closest<HTMLElement>('[data-h],[data-g]');if(!el)return;
      if(el.dataset.g){const t=this.threads.find(t=>t.id===el.dataset.g?.split(' ')[0]);if(t){this.activateThread(t);this.selected=t.anchor;this.toggleComposer(true,false);return;}}
      if(el.dataset.h){const h=this.data.highlights.find(h=>h.id===el.dataset.h?.split(' ')[0]);if(h){this.selected=h.anchor;this.activeHighlight=h.id;this.activeThread=undefined;this.toggleComposer(true,false);this.paintHighlights();this.showLens('actions');this.updateContext();}}
    });
    this.article.addEventListener('mouseover',e=>{const g=(e.target as HTMLElement).closest<HTMLElement>('[data-g]')?.dataset.g;this.setHover(g?.split(' ')[0]);});
    this.article.addEventListener('mouseleave',()=>this.setHover());
    this.root.addEventListener('pointerdown',e=>{const target=e.target as HTMLElement;if(this.modelMenu&&!this.modelMenu.contains(target)&&!target.closest('.gloss-model-picker'))this.closeModelMenu();if(!this.lens.contains(target)&&!target.closest('[data-h]'))this.closeLens();if(!this.appearance.contains(target)&&!target.closest('.gloss-aa'))this.appearance.hidden=true;});
    this.root.addEventListener('click',e=>{const a=(e.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link');if(a){e.preventDefault();void this.app.workspace.openLinkText(a.dataset.href||a.getAttribute('href')||'',path,true);}});
    this.scroller.addEventListener('scroll',()=>{if(this.restoring)return;this.closeModelMenu();this.captureProgress();this.pulseRail();this.updateRail();if(!this.lens.hidden)this.placeLens();top.toggleClass('is-scrolled',this.scroller.scrollTop>180);clearTimeout(this.progressTimer);this.progressTimer=setTimeout(()=>void this.plugin.persist().catch(showError),700);},{passive:true});
    if(this.pdf){void this.pdf.ready(opening.signal).then(()=>{if(token!==this.revision||opening.signal.aborted)return;this.loadError='';this.syncPdfPage();this.restorePosition();this.scheduleLayout();void this.maybeAutoIndex();}).catch(e=>{if(token===this.revision&&!opening.signal.aborted){this.loadError=e instanceof Error?e.message:ui("PDF 打开失败。");new Notice(this.loadError,7000);}});}if(token!==this.revision||opening.signal.aborted)return;this.renderBrief();this.paintHighlights();this.refreshSettings();await this.renderMargin();this.toggleFocus(this.focus);
    this.resizeObserver=new ResizeObserver(()=>{this.narrow=Platform?.isMobile||this.root.clientWidth<1080;this.root.toggleClass('gloss-narrow',this.narrow);this.restorePosition();this.scheduleLayout();if(!this.lens.hidden)this.placeLens();});
    this.resizeObserver.observe(this.root);this.resizeObserver.observe(this.scroller);this.resizeObserver.observe(this.page);
    requestAnimationFrame(()=>{if(token===this.revision){this.restorePosition();this.scheduleLayout();}});
    this.quietLabels(this.root);this.app.workspace.requestSaveLayout();
  }
  private showDocumentLoadError(file:TFile,cause:unknown){
    this.loadError=cause instanceof Error?cause.message:ui("无法打开文件。");this.pdf?.destroy();this.releasePdfSource();this.pdf=undefined;this.bookUrls.forEach(url=>URL.revokeObjectURL(url));this.bookUrls=[];this.resizeObserver?.disconnect();this.marginObserver?.disconnect();this.article=undefined;this.path=file.path;this.toggleFocus(false);this.root?.remove();this.composer=undefined;this.contentEl.empty();
    const error=this.contentEl.createDiv({cls:'gloss-import-state'});bindUi(error.createEl('h2',{text:ui("无法打开 ")+file.basename}), {"text":()=>ui("无法打开 ")+file.basename});bindUi(error.createEl('p',{text:ui(this.loadError)}), {"text":()=>ui(this.loadError)});bindUi(button(error,ui("重试"),async()=>{await this.loadDocument(file.path);if(!this.loadError)this.toggleFocus(true);}), {"text":()=>ui("重试")});bindUi(button(error,ui("选择其他文档"),()=>this.plugin.choose()), {"text":()=>ui("选择其他文档")});
  }
  private async mountPdfSource(file:TFile,signal:AbortSignal){
    const article=this.article;
    let leaf=this.app.workspace.getLeavesOfType('pdf').find(l=>(l.view as FileView).file?.path===file.path);if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file,{active:false});}await leaf.loadIfDeferred();if(signal.aborted||this.article!==article)throw new Error('已取消打开 PDF。');const container=leaf.view.containerEl,parent=container.parentNode;if(!parent)throw new Error('PDF 原生视图尚未就绪。');const placeholder=container.ownerDocument.createComment(ui("沉浸阅读 PDF 视图原位置"));parent.insertBefore(placeholder,container);this.pdfSource={leaf,container,placeholder};container.classList.add('gloss-native-pdf');this.article.append(container);await this.app.workspace.revealLeaf(this.leaf);
  }
  private releasePdfSource(){const source=this.pdfSource;if(!source)return;this.pdfSource=undefined;source.container.classList.remove('gloss-native-pdf');if(source.placeholder.parentNode){source.placeholder.replaceWith(source.container);requestAnimationFrame(()=>source.leaf.view.onResize());}else source.container.remove();}
  private makeReadingAnchor(start:number,end:number):Anchor{const a=makeAnchor(this.text,start,end);if(this.pdf){a.pdfPage=this.pdf.page;a.pdfOffset=a.start;}return a;}
  private syncPdfPage(){if(!this.pdf)return;if(this.pdf.blocks.length)this.loadError='';const changed=this.passages[0]?.source!=="PDF 第 "+this.pdf.page+" 页";this.blocks=this.pdf.blocks;this.text=this.pdf.text;this.passages=this.pdf.passages;if(changed){this.keyboardPassage=undefined;const active=this.data.threads.find(t=>t.id===this.activeThread);if(active?.anchor?.pdfPage&&active.anchor.pdfPage!==this.pdf.page&&!active.contextInfo?.embeddingModel&&active.id!==this.referenceFocus?.threadId)this.activeThread=undefined;this.activeHighlight=undefined;if(this.selected?.pdfPage!==this.pdf.page)this.selected=undefined;if(this.lens)this.closeLens();}if(!this.composer?.isConnected)return;this.paintHighlights();this.updateContext();this.captureProgress();void this.renderMargin().catch(showError);clearTimeout(this.progressTimer);this.progressTimer=setTimeout(()=>void this.plugin.persist().catch(showError),700);}
  private renderBook(book:Book){
    for(const section of book.sections){const el=this.article.createEl('section',{cls:'gloss-book-section'});el.dataset.bookSource=section.title;el.createEl('h2',{text:section.title});for(const block of section.blocks){if(block.kind==='image'){const image=book.images[block.image||''];if(image){const url=URL.createObjectURL(new Blob([new Uint8Array(image.bytes).buffer],{type:image.mime}));this.bookUrls.push(url);el.createEl('img',{attr:{src:url,alt:block.text,loading:'lazy'}});}continue;}if(block.kind==='pre')el.createEl('pre').createEl('code',{text:block.text});else el.createEl(block.kind==='heading'?'h'+Math.min(6,Math.max(3,block.level||3)) as 'h3':'p',{text:block.text});}}if(book.warnings.length)this.article.createDiv({cls:'gloss-book-warning',text:book.warnings.join(' ')});
  }
  private renderBrief(){
    if(!this.briefHost)return;this.briefHost.hidden=!!this.pdf;if(this.pdf)return;const host=this.briefHost;host.empty();const saved=this.data.brief,busy=!!this.briefJob&&this.briefJob.controller===this.aborter&&this.briefJob.revision===this.revision;
    if(!saved){const open=button(host,'',()=>this.generateBrief(),'gloss-brief');open.disabled=!!this.aborter;const title=bindUi(open.createSpan({cls:'gloss-brief-title',text:busy?ui("正在解读文章…"):ui("解读这篇文章")}), {"text":()=>busy?ui("正在解读文章…"):ui("解读这篇文章")});setIcon(title.createSpan(),busy?'loader-circle':'arrow-right');bindUi(open.createSpan({cls:'gloss-brief-description',text:busy?ui("正在通读全文、梳理论点和段落地图"):ui("要旨、关键论点与段落地图")}), {"text":()=>busy?ui("正在通读全文、梳理论点和段落地图"):ui("要旨、关键论点与段落地图")});open.createSpan({cls:'gloss-brief-key',text:'B'});}
    else{
      const stale=saved.sourceHash!==briefHash(this.text),card=bindUi(host.createEl('section',{cls:'gloss-brief-panel',attr:{'aria-label':ui("文章解读")}}), {"aria-label":()=>ui("文章解读")});
      const head=button(card,'',()=>{this.briefCollapsed=!this.briefCollapsed;this.renderBrief();this.scheduleLayout();},'gloss-brief-head');head.setAttribute('aria-expanded',String(!this.briefCollapsed));bindUi(head.createSpan({cls:'gloss-brief-name',text:ui("文章解读")}), {"text":()=>ui("文章解读")});bindUi(head.createSpan({cls:'gloss-brief-counts',text:ui("{0} 个部分 · {1} 个论点 · {2} 条提醒",saved.data.sections.length,saved.data.claims.length,saved.data.caveats.length)}), {"text":()=>ui("{0} 个部分 · {1} 个论点 · {2} 条提醒",saved.data.sections.length,saved.data.claims.length,saved.data.caveats.length)});const chevron=head.createSpan({cls:'gloss-brief-chevron'});setIcon(chevron,this.briefCollapsed?'chevron-down':'chevron-up');
      const body=card.createDiv({cls:'gloss-brief-body'});body.hidden=this.briefCollapsed;
      if(stale)bindUi(body.createEl('p',{cls:'gloss-brief-status',text:ui("原文已更新，请重新生成解读以更新段落引用。")}), {"text":()=>ui("原文已更新，请重新生成解读以更新段落引用。")});
      body.createEl('p',{cls:'gloss-brief-gist',text:saved.data.gist});
      const cite=(parent:HTMLElement,n:number)=>{const passage=this.passages[n-1],b=button(parent,'¶'+n,()=>{if(!stale&&passage)this.jump(this.makeReadingAnchor(passage.start,passage.end));},'gloss-citation');b.disabled=stale||!passage;b.title=stale?ui("原文已更新，请重新生成"):passage?.text||ui("未提供的原文段落");};
      const points=(label:string,items:{text:string;cite:number}[],kind:string)=>{if(!items.length)return;body.createEl('h3',{cls:'gloss-brief-section-label',text:label});const list=body.createEl(kind==='claims'?'ol':'ul',{cls:'gloss-brief-points gloss-brief-'+kind});items.forEach((point,i)=>{const row=list.createEl('li');row.createSpan({cls:'gloss-brief-index',text:kind==='claims'?String(i+1):'•'});const text=row.createDiv();text.append(point.text+' ');cite(text,point.cite);});};
      points(ui("关键论点"),saved.data.claims,'claims');points(ui("阅读提醒"),saved.data.caveats,'caveats');
      bindUi(body.createEl('h3',{cls:'gloss-brief-section-label',text:ui("段落地图")}), {"text":()=>ui("段落地图")});const map=body.createEl('ol',{cls:'gloss-brief-map'});
      briefRanges(saved.data,this.passages.length).forEach((section,i)=>{const li=map.createEl('li'),row=button(li,'',()=>{const p=this.passages[section.start-1];if(!stale&&p)this.jump(this.makeReadingAnchor(p.start,p.end));},'gloss-brief-map-row');row.disabled=stale;row.title=section.title;row.createSpan({cls:'gloss-brief-index',text:String(i+1)});row.createSpan({cls:'gloss-brief-map-title',text:section.title});row.createSpan({cls:'gloss-brief-map-range',text:'¶'+section.start+(section.end>section.start?'–'+section.end:'')});});
      const footer=body.createDiv({cls:'gloss-brief-footer'}),receipt=footer.createDiv({cls:'gloss-brief-receipt'});bindUi(receipt.createSpan({text:saved.model||ui("模型未记录")}), {"text":()=>saved.model||ui("模型未记录")});receipt.createSpan({cls:'gloss-brief-receipt-divider',text:'/'});const tokens=bindUi(receipt.createSpan({text:receiptText(tokenReceipt(saved.usage))}), {"text":()=>receiptText(tokenReceipt(saved.usage))});tokens.title=receiptText(tokenDetails(saved.usage));receipt.title=[saved.provider,saved.model].filter(Boolean).join(' · ');
      const redo=button(footer,'',()=>this.generateBrief(),'gloss-brief-redo');redo.disabled=!!this.aborter;setIcon(redo.createSpan(),'rotate-ccw');bindUi(redo.createSpan({text:busy?ui("正在重新生成…"):ui("重新生成")}), {"text":()=>busy?ui("正在重新生成…"):ui("重新生成")});
    }
    if(busy){const status=host.createDiv({cls:'gloss-brief-state',attr:{role:'status'}});bindUi(status.createSpan({text:ui("正在使用总结模型生成解读")}), {"text":()=>ui("正在使用总结模型生成解读")});const stop=bindUi(this.iconButton(status,'square',ui("停止解读"),()=>this.stop()), {"label":()=>ui("停止解读")});stop.disabled=false;}
    if(this.briefError)host.createEl('p',{cls:'gloss-brief-error',text:this.briefError,attr:{role:'status'}});
    this.scheduleLayout();
  }
  private async generateBrief(){
    if(this.aborter)return;this.cancelSuggestions();if(blockedPath(this.path))throw new Error('此文档不能发送给模型。');if(!(this.app.vault.getAbstractFileByPath(this.path)instanceof TFile))throw new Error('原文已移除。');
    const settings=this.modelSettings('summary'),path=this.path,data=this.data,revision=this.revision,sourceHash=briefHash(this.text),count=this.passages.length;
    const context=contextFor(this.passages,undefined,this.text,true,settings.maxContext);if(!count)throw new Error('文档没有可解读的正文。');
    const controller=new AbortController();this.aborter=controller;this.briefJob={controller,revision};this.briefError='';this.closeModelMenu();this.briefCollapsed=false;
    this.syncComposerBusy();this.root.querySelectorAll<HTMLButtonElement>('.gloss-model-picker').forEach(b=>b.disabled=true);this.renderBrief();
    let usage:Message['usage'];
    try{await this.renderMargin();const answer=await askAgent({settings,context,messages:[{role:'user',content:briefPrompt(count)+(settings.taskPrompts.summary?'\n补充要求（仍须遵守上面的 JSON 结构和引用规则）：\n'+settings.taskPrompts.summary:'')}],signal:controller.signal,onText:()=>{},onUsage:value=>{usage=value;}});
      if(controller.signal.aborted||this.revision!==revision||this.path!==path)return;
      const result=parseBrief(answer,count);data.brief={data:result,sourceHash,model:modelId(settings),provider:settings.serviceName||settings.provider,serviceId:settings.serviceId,usage,created:Date.now()};data.updated=Date.now();await this.plugin.persist();
    }catch(error){if(this.revision===revision&&this.path===path)this.briefError=(error instanceof Error?error.message:ui("文章解读失败。"))+(data.brief?ui("（已保留原解读）"):'');}
    finally{if(this.aborter===controller){this.aborter=undefined;this.briefJob=undefined;if(this.path===path&&this.revision===revision&&this.root.isConnected){this.syncComposerBusy();this.root.querySelectorAll<HTMLButtonElement>('.gloss-model-picker').forEach(b=>b.disabled=false);this.renderBrief();await this.renderMargin();}}}
  }
  applyAppearance(){if(!this.root)return;const s=this.plugin.store.settings;this.root.dataset.theme=s.theme==='auto'?(this.root.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches?'night':'paper'):({light:'snow',dark:'night'}[s.theme]||s.theme);this.root.dataset.font=s.font;this.root.dataset.pen=s.pen||'vermilion';this.root.style.setProperty('--read-size',s.fontSize+'px');this.root.style.setProperty('--leading',String(s.lineHeight));this.root.style.setProperty('--measure-k',String(s.measure||32));this.root.style.setProperty('--reader-custom-font',s.customFont||'var(--font-serif)');this.root.toggleClass('gloss-show-numbers',!!s.numbers);this.syncChrome();this.scheduleLayout();}
  private updateMobileViewport(){
    if(!Platform?.isMobile||!this.root)return;
    const viewport=this.root.ownerDocument.defaultView?.visualViewport;
    this.root.style.setProperty('--mobile-viewport-height',(viewport?.height||this.root.ownerDocument.defaultView?.innerHeight||this.root.clientHeight)+'px');
    this.root.style.setProperty('--mobile-viewport-top',(viewport?.offsetTop||0)+'px');
    if(this.composer?.isConnected)this.resizeQuestion();
    for(const input of Array.from(this.root.querySelectorAll<HTMLTextAreaElement>('textarea.gloss-followup-input')))this.resizeMobileInput(input);
    const active=this.root.ownerDocument.activeElement,form=active?.closest('.gloss-followup');
    if(form&&this.root.contains(form))requestAnimationFrame(()=>{if(form.isConnected&&form.contains(form.ownerDocument.activeElement))form.scrollIntoView({block:'nearest',inline:'nearest'});});
  }
  private syncChrome(){
    if(Platform?.isMobile)return;
    const doc=this.root?.ownerDocument;if(this.chromeDocument&&(!this.focus||this.chromeDocument!==doc))this.releaseChrome();
    if(!this.focus||!this.root?.isConnected||!doc?.defaultView)return;
    const style=doc.defaultView.getComputedStyle(this.root),body=doc.body;body.dataset.glossChromeOwner=this.chromeOwner;body.classList.add('gloss-reading-chrome');
    for(const [name,token]of [['bg','--bg'],['raised','--bg-raised'],['hover','--bg-sunk'],['ink','--ink'],['muted','--ink-3'],['rule','--rule']])body.style.setProperty('--gloss-chrome-'+name,style.getPropertyValue(token).trim());
    body.style.setProperty('--gloss-chrome-scheme',style.colorScheme);this.chromeDocument=doc;
  }
  releaseChrome(){const body=this.chromeDocument?.body;if(body?.dataset.glossChromeOwner===this.chromeOwner){body.classList.remove('gloss-reading-chrome');delete body.dataset.glossChromeOwner;for(const name of ['bg','raised','hover','ink','muted','rule','scheme'])body.style.removeProperty('--gloss-chrome-'+name);}this.chromeDocument=undefined;}
  private refreshReadingStats(){
    const stats=this.root?.querySelector<HTMLElement>('.gloss-reading-stats');if(!stats)return;
    const minutes=Math.max(1,Math.round(this.text.split(/\s+/).length/240+(this.text.match(/[\u3400-\u9fff]/g)||[]).length/450));
    stats.textContent=ui("{0} 分钟阅读 · {1} 个段落",minutes,this.blocks.filter(el=>!/^H/.test(el.tagName)).length);
  }
  private pruneUiLabels(){
    const active=new Set(Array.from(this.root.querySelectorAll<HTMLElement>('[aria-labelledby]')).flatMap(el=>(el.getAttribute('aria-labelledby')||'').split(/\s+/)));
    for(const caption of Array.from(this.root.querySelectorAll<HTMLElement>('[id^="reader-group-"]')))if(!active.has(caption.getAttribute('id')||''))caption.remove();
  }
  async refreshLanguage(){
    if(!this.root)return;
    refreshUi(this.root);
    if(this.composer)this.composer.placeholder=this.selected?ui('询问选中文本…'):ui('询问整篇文档…');
    this.refreshModelButtons();this.paintWebButton();this.refreshReadingStats();this.paintIndexStatus();
    if(this.appearance&&!this.appearance.hidden){this.appearance.hidden=true;this.toggleAppearance();}
    if(this.lens&&!this.lens.hidden&&this.lensMode==='actions')this.showLens('actions');
    if(this.drawerTabs)await this.renderNotebook();
    this.pruneUiLabels();this.scheduleLayout();
  }
  refreshSettings(){this.applyAppearance();void this.maybeAutoIndex();if(!this.root)return;const scope=this.root.querySelector('.gloss-scope');if(scope)scope.textContent=this.scopeLabel();this.updateContext();this.closeModelMenu();this.refreshModelButtons();if(this.selected&&this.lens&&!this.lens.hidden&&this.lensMode==='actions')this.showLens('actions');}
  async exitReader(){this.indexJob?.abort();this.retrievalJob?.abort();this.captureProgress();this.restoring=true;this.importAborter?.abort();this.pdf?.destroy();this.releasePdfSource();await this.flushDraft();this.toggleFocus(false);const file=this.app.vault.getAbstractFileByPath(this.path);const existing=this.app.workspace.getLeavesOfType(file instanceof TFile&&file.extension==='pdf'?'pdf':file instanceof TFile&&file.extension==='epub'?EPUB_VIEW:'markdown').find(l=>l.getViewState().state?.file===this.path);if(existing){await this.app.workspace.revealLeaf(existing);this.leaf.detach();}else if(file instanceof TFile)await this.leaf.openFile(file,{active:true});}
  toggleFocus(next=!this.focus){const changing=next!==this.focus,max=this.scroller?this.scroller.scrollHeight-this.scroller.clientHeight:0,ratio=max>0?this.scroller.scrollTop/max:0;this.focus=next;if(this.indexButton)this.indexButton.hidden=!next;if(!next)this.cancelSuggestions();if(this.root){if(next&&this.root.parentElement!==this.root.ownerDocument.body)this.root.ownerDocument.body.appendChild(this.root);else if(!next&&this.root.parentElement!==this.contentEl)this.contentEl.appendChild(this.root);this.root.toggleClass('gloss-focus',next);this.updateMobileViewport();if(!next){this.closeModelMenu();this.clearSelectionPreview();this.clearReferencePreview();}}this.syncChrome();if(changing)requestAnimationFrame(()=>{this.scroller?.scrollTo({top:Math.max(0,this.scroller.scrollHeight-this.scroller.clientHeight)*ratio,behavior:'instant'});this.restorePosition();this.scheduleLayout();if(next)void this.maybeAutoIndex();});}
  private toggleNotebook(next=!this.notebookOpen){this.notebookOpen=next;this.drawer.hidden=!next;this.root.toggleClass('gloss-notebook-open',next);this.root.querySelector('.gloss-notebook-button')?.setAttribute('aria-expanded',String(next));if(next){this.composer?.blur();void this.renderNotebook().catch(showError);}this.scheduleLayout();}
  private showContents(){if(this.pdf){const modal=new Modal(this.app);modal.setTitle(ui("PDF 页码"));for(let n=1;n<=this.pdf.total;n++)bindUi(button(modal.contentEl,ui("第 ")+n+ui(" 页"),async()=>{modal.close();await this.pdf?.go(n);},'gloss-contents-item'), {"text":()=>ui("第 ")+n+ui(" 页")});modal.open();return;}const modal=new Modal(this.app);modal.setTitle(ui("文档目录"));let count=0;this.blocks.forEach(el=>{if(/^H[1-6]$/.test(el.tagName)){button(modal.contentEl,el.textContent||'',()=>{modal.close();el.scrollIntoView({behavior:'smooth',block:'start'});},'gloss-contents-item');count++;}});if(!count)bindUi(modal.contentEl.createEl('p',{text:ui("这篇文档没有分节标题。")}), {"text":()=>ui("这篇文档没有分节标题。")});modal.open();}
  private toggleAppearance(){if(!this.appearance.hidden){this.appearance.hidden=true;return;}this.appearance.empty();const s=this.plugin.store.settings;bindUi(this.appearance.createDiv({cls:'gloss-pop-title',text:ui("外观配置")}), {"text":()=>ui("外观配置")});const themes=this.appearance.createDiv({cls:'gloss-theme-swatches'});for(const [key,label] of [['auto',ui("跟随系统")],['paper',ui("纸张")],['sepia',ui("暖黄")],['snow',ui("雪白")],['night',ui("夜读")],['ink',ui("墨蓝")]]){const b=button(themes,label,()=>{s.theme=key;this.applyAppearance();themes.querySelectorAll<HTMLButtonElement>('.gloss-theme-swatch').forEach(choice=>{const selected=choice.dataset.theme===key;choice.classList.toggle('is-selected',selected);choice.setAttribute('aria-pressed',String(selected));});void this.plugin.persist().catch(showError);},'gloss-theme-swatch');b.dataset.theme=key;b.classList.toggle('is-selected',s.theme===key);b.setAttribute('aria-pressed',String(s.theme===key));}
    if(!this.pdf){const faces=this.appearance.createDiv({cls:'gloss-pop-row'});for(const [key,label] of [['serif','Newsreader'],['sans','Schibsted'],['song',ui("宋体")],['system',ui("系统")]])button(faces,label,()=>{s.font=key;this.applyAppearance();void this.plugin.persist().catch(showError);});
    const size=this.appearance.createDiv({cls:'gloss-pop-row'});bindUi(this.iconButton(size,'minus',ui("减小字号"),()=>{s.fontSize=Math.max(15,s.fontSize-1);this.applyAppearance();size.querySelector('.gloss-size-value')!.textContent=String(s.fontSize);void this.plugin.persist().catch(showError);}), {"label":()=>ui("减小字号")});size.createSpan({cls:'gloss-size-value',text:String(s.fontSize)});bindUi(this.iconButton(size,'plus',ui("增大字号"),()=>{s.fontSize=Math.min(28,s.fontSize+1);this.applyAppearance();size.querySelector('.gloss-size-value')!.textContent=String(s.fontSize);void this.plugin.persist().catch(showError);}), {"label":()=>ui("增大字号")});
    const leading=this.appearance.createDiv({cls:'gloss-pop-row'});for(const [label,value]of [[ui("紧凑"),1.5],[ui("标准"),1.64],[ui("宽松"),1.82]]as const)button(leading,label,()=>{s.lineHeight=value;this.applyAppearance();void this.plugin.persist().catch(showError);});
    const widths=this.appearance.createDiv({cls:'gloss-pop-row'});for(const [label,value]of [[ui("窄"),28],[ui("适中"),32],[ui("宽"),37]]as const)button(widths,label,()=>{s.measure=value;this.applyAppearance();void this.plugin.persist().catch(showError);});
    }const pens=this.appearance.createDiv({cls:'gloss-pop-row'});bindUi(pens.createSpan({text:ui("批注笔色")}), {"text":()=>ui("批注笔色")});for(const [pen,label]of [['vermilion',ui("朱红")],['cobalt',ui("钴蓝")],['moss',ui("苔绿")],['graphite',ui("石墨")]]){const b=button(pens,'',()=>{s.pen=pen;this.applyAppearance();void this.plugin.persist().catch(showError);},'gloss-pen-swatch');b.dataset.pen=pen;b.title=label;bindUi(b, {"aria-label":()=>label+ui("批注笔")});}
    if(!this.pdf)bindUi(button(this.appearance,s.numbers?ui("隐藏段落编号"):ui("显示段落编号"),()=>{s.numbers=!s.numbers;this.applyAppearance();void this.plugin.persist().catch(showError);this.appearance.hidden=true;},'gloss-pop-number'), {"text":()=>s.numbers?ui("隐藏段落编号"):ui("显示段落编号")});this.appearance.hidden=false;}
  private buildRail(){
    this.rail.empty();this.rail.setAttribute('role','slider');bindUi(this.rail, {"aria-label":()=>ui("阅读位置")});this.rail.setAttribute('aria-valuemin','0');this.rail.setAttribute('aria-valuemax','100');
    const lines=this.rail.createDiv({cls:'gloss-rail-lines'});
    for(const p of this.passages){const b=bindUi(lines.createEl('button',{cls:'gloss-rail-line',attr:{type:'button','aria-label':ui("跳到第 ")+p.number+ui(" 段")}}), {"aria-label":()=>ui("跳到第 ")+p.number+ui(" 段")});b.dataset.paragraph=String(p.number);b.addEventListener('click',e=>{if(e.detail===0)this.blocks[p.number-1].scrollIntoView({behavior:'smooth',block:'start'});});}
    this.railWindow=this.rail.createDiv({cls:'gloss-rail-window'});this.railWindow.setAttribute('aria-hidden','true');
    let drag=false;
    const travel=(clientY:number,instant=false)=>{const rect=this.rail.getBoundingClientRect(),y=Math.max(0,Math.min(rect.height,clientY-rect.top)),article=this.article.getBoundingClientRect(),scroller=this.scroller.getBoundingClientRect();this.scroller.scrollTo({top:this.scroller.scrollTop+article.top-scroller.top+y/Math.max(1,rect.height)*article.height-this.scroller.clientHeight*.3,behavior:instant?'instant':'smooth'});};
    this.rail.addEventListener('pointerdown',e=>{e.preventDefault();this.rail.setPointerCapture(e.pointerId);travel(e.clientY);drag=true;});this.rail.addEventListener('pointermove',e=>{this.railFocus=e.clientY-this.rail.getBoundingClientRect().top;this.magnifyRail();if(drag&&e.buttons)travel(e.clientY,true);});this.rail.addEventListener('pointerleave',()=>{this.railFocus=undefined;this.magnifyRail();});this.rail.addEventListener('pointerup',()=>drag=false);this.rail.addEventListener('pointercancel',()=>drag=false);this.updateRail(true);
  }
  private updateRail(measure=false){
    if(!this.railWindow||!this.scroller)return;
    const article=this.article.getBoundingClientRect(),leading=parseFloat(getComputedStyle(this.article).lineHeight)||32;
    const {height,scale:k}=readingMapMetrics(article.height,this.scroller.clientHeight,leading);this.rail.style.height=height+'px';
    if(measure||this.railGeometry.length!==this.blocks.length)this.railGeometry=this.blocks.map(b=>{
      const r=b.getBoundingClientRect(),range=b.ownerDocument.createRange();range.selectNodeContents(b);
      return {top:r.top-article.top,height:r.height,heading:/^H/.test(b.tagName),lines:readingMapLines(Array.from(range.getClientRects()),r)};
    });
    this.rail.querySelectorAll<HTMLElement>('.gloss-rail-line').forEach((el,i)=>{
      const g=this.railGeometry[i];if(!g)return;el.style.top=g.top*k+'px';el.style.height=Math.max(2,g.height*k)+'px';el.setCssStyles({width:'22px'});el.classList.toggle('is-heading',g.heading);
      if(measure||!el.childElementCount){
        el.empty();let last=-2;
        for(const line of g.lines){const y=line.top*k;if(y-last<1.6)continue;last=y;const stroke=el.createSpan({cls:'gloss-rail-stroke'});stroke.style.top=y+'px';stroke.style.width=line.width+'px';}
      }
    });
    this.rail.querySelectorAll('.gloss-rail-tick,.gloss-rail-gloss').forEach(el=>el.remove());
    const at=(a:Anchor)=>{const start=resolveAnchor(this.text,a);if(start===null)return null;const i=this.passages.findIndex(p=>p.end>start);return this.railGeometry[i]?.top*k;};
    for(const h of this.data.highlights.filter(h=>!h.removed)){const top=at(h.anchor);if(top===null||top===undefined)continue;const tick=this.rail.createSpan({cls:'gloss-rail-tick'});tick.dataset.color=h.color;tick.style.top=top+'px';}
    for(const t of this.threads){if(!t.anchor)continue;const top=at(t.anchor);if(top===null||top===undefined)continue;const tick=this.rail.createSpan({cls:'gloss-rail-gloss'});tick.style.top=top+'px';}
    const visibleTop=this.scroller.getBoundingClientRect().top-article.top,window=readingMapViewport(visibleTop,this.scroller.clientHeight,article.height,k);
    this.railWindow.style.top=window.top+'px';this.railWindow.style.height=window.height+'px';this.magnifyRail(window.top+window.height/2);
    this.rail.setAttribute('aria-valuenow',String(Math.round(Math.max(0,Math.min(1,(visibleTop+this.scroller.clientHeight*.3)/Math.max(1,article.height)))*100)));
  }
  private pulseRail(){this.rail.classList.add('is-scrolling');clearTimeout(this.railTimer);this.railTimer=setTimeout(()=>{if(!this.rail)return;this.rail.classList.remove('is-scrolling');this.magnifyRail();},800);}
  private magnifyRail(visibleCenter?:number){if(!this.rail)return;const focus=this.railFocus??(this.rail.classList.contains('is-scrolling')?(visibleCenter??parseFloat(this.railWindow.style.top)+parseFloat(this.railWindow.style.height)/2):undefined);this.rail.querySelectorAll<HTMLElement>('.gloss-rail-line').forEach(el=>{const scale=focus===undefined?1:railMagnification(parseFloat(el.style.top)+parseFloat(el.style.height)/2-focus);el.style.transform=`scaleX(${scale}) scaleY(1)`;el.classList.toggle('is-magnified',scale>1.2);});}
  private rememberDraft(){if(!this.path||!this.composer)return;this.data.draft=this.composer.value;clearTimeout(this.draftTimer);this.draftTimer=setTimeout(()=>void this.plugin.persist().catch(showError),500);}
  private async flushDraft(){if(this.path&&this.composer){this.data.draft=this.composer.value;await this.plugin.persist();}}
  onResize(){this.restorePosition();this.scheduleLayout();}
  private restorePosition(){if(this.path.toLowerCase().endsWith('.pdf')){if(this.pdf&&this.focus&&this.restoring&&this.pendingProgress!==undefined&&this.pdf.loaded&&this.pdf.total){const n=Math.max(1,Math.min(this.pdf.total,this.data.pdfPage||Math.round(this.pendingProgress*Math.max(1,this.pdf.total-1))+1));this.pendingProgress=undefined;const pdf=this.pdf;void pdf.go(n).then(()=>{if(this.pdf===pdf){this.restoring=false;this.captureProgress();}}).catch(e=>{if(this.pdf===pdf)this.restoring=false;showError(e);});}return;}if(!this.restoring||this.pendingProgress===undefined||!this.scroller?.isConnected||!this.scroller.clientHeight||!this.scroller.clientWidth)return;if(this.root.clientHeight>(this.root.ownerDocument.defaultView?.innerHeight||window.innerHeight)+1)return;this.scroller.scrollTo({top:Math.max(0,this.scroller.scrollHeight-this.scroller.clientHeight)*this.pendingProgress,behavior:'instant'});this.pendingProgress=undefined;this.restoring=false;this.captureProgress();this.updateRail();}
  private captureProgress(){if(this.path.toLowerCase().endsWith('.pdf')){if(this.pdf&&!this.plugin.unloading&&!this.restoring&&this.path){this.data.progress=(this.pdf.page-1)/Math.max(1,this.pdf.total-1);this.data.pdfPage=this.pdf.page;}return;}if(this.plugin.unloading||this.restoring||!this.scroller?.isConnected||!this.scroller.clientHeight||!this.path||this.root.clientHeight>(this.root.ownerDocument.defaultView?.innerHeight||window.innerHeight)+1)return;const max=this.scroller.scrollHeight-this.scroller.clientHeight;this.data.progress=max>0?Math.max(0,Math.min(1,this.scroller.scrollTop/max)):0;}
  private globalPoint(node:Node,offset:number){const block=this.blocks.find(el=>el.contains(node));if(!block)return null;const r=this.article.ownerDocument.createRange();r.selectNodeContents(block);r.setEnd(node,offset);return this.passages[this.blocks.indexOf(block)].start+r.toString().length;}
  captureSelection(){const s=this.article.ownerDocument.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;const r=s.getRangeAt(0);if(!this.article.contains(r.commonAncestorContainer))return;if(this.pdf&&!this.pdf.activateRange(r)){new Notice(ui("请在 PDF 同一页内选择文字。"));return;}let start=this.globalPoint(r.startContainer,r.startOffset),end=this.globalPoint(r.endContainer,r.endOffset);if(start===null||end===null){const touched=this.blocks.filter(b=>r.intersectsNode(b));if(!touched.length)return;if(start===null)start=this.passages[this.blocks.indexOf(touched[0])].start;if(end===null)end=this.passages[this.blocks.indexOf(touched.at(-1)!)].end;}if(end<=start)return;const a=this.makeReadingAnchor(start,end);if(!a.quote.trim())return;if(Platform?.isMobile&&this.selected?.start===a.start&&this.selected?.quote===a.quote&&!this.lens.hidden)return;this.selected=a;this.activeThread=undefined;this.activeHighlight=undefined;this.updateContext();this.toggleComposer(true,false);this.showLens('actions');}
  private modelSettings(task='default'):Settings{const s=this.plugin.store.settings,{service,model}=resolveModel(this.plugin.modelSetup(),task,task==='translate'?undefined:task==='default'||!this.plugin.taskModels()[task]?this.readingModel:undefined);if(Platform?.isMobile&&service.kind!=='api')throw new Error('手机端不支持本机 CLI，请选择自定义 API 服务。');return{...s,...serviceSettings(service,model.id,this.plugin.serviceKey(service.id)),systemPrompt:s.taskPrompts.default||SYSTEM};}
  private modelChoices(){return availableChoices(this.plugin.store.settings);}
  private modelPicker(parent:HTMLElement,label:()=>string){
    const trigger=bindUi(button(parent,'',()=>this.openModelMenu(trigger),'gloss-model-picker'),{'aria-label':label});trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('pointerdown',e=>e.stopPropagation());trigger.addEventListener('mousedown',e=>{e.stopPropagation();e.preventDefault();});this.paintModelButton(trigger);return trigger;
  }
  private paintModelButton(trigger:HTMLButtonElement){
    const s=this.plugin.store.settings,ref=this.readingModel||this.plugin.taskModels().default,choice=this.modelChoices().find(m=>m.serviceId===ref?.serviceId&&m.id===ref?.modelId);trigger.empty();const icon=trigger.createSpan({cls:'gloss-model-provider-icon'});setIcon(icon,choice?SERVICE_ICONS[choice.kind]:'sliders-horizontal');bindUi(trigger.createSpan({cls:'gloss-model-button-label',text:choice?.name||ui("选择问答模型")}), {"text":()=>choice?.name||ui("选择问答模型")});setIcon(trigger.createSpan({cls:'gloss-model-chevron'}),'chevron-down');trigger.title=choice?choice.serviceName+' · '+choice.id:ui("先添加服务并配置模型");trigger.disabled=!!this.aborter||!!this.retrievalJob;
  }
  private refreshModelButtons(){this.root?.querySelectorAll<HTMLButtonElement>('.gloss-model-picker').forEach(trigger=>this.paintModelButton(trigger));}
  private closeModelMenu(focus=false){const trigger=this.modelMenuTrigger;this.modelMenu?.remove();this.modelMenu=undefined;this.modelMenuTrigger=undefined;trigger?.setAttribute('aria-expanded','false');if(focus&&trigger?.isConnected)trigger.focus({preventScroll:true});}
  private openModelMenu(trigger:HTMLButtonElement){
    if(this.modelMenuTrigger===trigger){this.closeModelMenu();return;}this.closeModelMenu();if(this.aborter||this.retrievalJob)return;this.modelMenuTrigger=trigger;trigger.setAttribute('aria-expanded','true');
    const menu=this.modelMenu=bindUi(this.root.createDiv({cls:'gloss-model-menu',attr:{role:'dialog','aria-label':ui("选择阅读模型")}}), {"aria-label":()=>ui("选择阅读模型")});menu.addEventListener('pointerdown',e=>e.stopPropagation());menu.addEventListener('mousedown',e=>e.stopPropagation());
    const searchRow=menu.createDiv({cls:'gloss-model-search'});setIcon(searchRow.createSpan(),'search');const search=bindUi(searchRow.createEl('input',{attr:{type:'search','aria-label':ui("搜索阅读模型"),placeholder:ui("搜索模型或服务…")}}), {"aria-label":()=>ui("搜索阅读模型"),"placeholder":()=>ui("搜索模型或服务…")});this.protectInput(search);
    const list=bindUi(menu.createDiv({cls:'gloss-model-results',attr:{role:'listbox','aria-label':ui("可用阅读模型")}}), {"aria-label":()=>ui("可用阅读模型")}),choices=this.modelChoices();let buttons:HTMLButtonElement[]=[],active=0;
    const updateActive=()=>{buttons.forEach((b,i)=>b.classList.toggle('is-focused',i===active));buttons[active]?.scrollIntoView({block:'nearest'});};
    const draw=()=>{list.empty();buttons=[];const q=search.value.trim().toLowerCase(),s=this.plugin.store.settings,current=this.readingModel||this.plugin.taskModels().default;
      for(const service of s.services){const filtered=choices.filter(m=>m.serviceId===service.id&&[m.id,m.name,service.name].some(value=>value.toLowerCase().includes(q)));if(!filtered.length)continue;list.createDiv({cls:'gloss-model-group',text:service.name});
        for(const model of filtered){const selected=current?.serviceId===service.id&&current?.modelId===model.id,b=button(list,'',()=>{this.readingModel={serviceId:service.id,modelId:model.id};this.closeModelMenu();this.refreshModelButtons();this.cancelSuggestions();this.suggestionKey='';if(!this.composerWrap.hidden)void this.generateSuggestions();const field=this.lensInput||(!this.composerWrap.hidden?this.composer:undefined);if(field)this.focusInput(field);},'gloss-model-option');b.setAttribute('role','option');b.setAttribute('aria-selected',String(selected));b.setAttribute('aria-label',service.name+' '+model.name);const copy=b.createSpan({cls:'gloss-model-option-copy'});copy.createSpan({cls:'gloss-model-option-name',text:model.name});if(model.name!==model.id)copy.createSpan({cls:'gloss-model-option-id',text:model.id});if(this.plugin.taskModels().default?.serviceId===service.id&&this.plugin.taskModels().default.modelId===model.id)bindUi(b.createSpan({cls:'gloss-model-default',text:ui("默认")}), {"text":()=>ui("默认")});const check=b.createSpan({cls:'gloss-model-option-check'});if(selected)setIcon(check,'check');buttons.push(b);}}
      if(!buttons.length){bindUi(list.createDiv({cls:'gloss-model-empty',text:ui("请在设置中添加服务和模型")}), {"text":()=>ui("请在设置中添加服务和模型")});bindUi(button(list,ui("打开模型服务"),()=>{this.closeModelMenu();(this.app as any).setting.open();(this.app as any).setting.openTabById(this.plugin.manifest.id);},'gloss-model-option'), {"text":()=>ui("打开模型服务")});}active=Math.max(0,buttons.findIndex(b=>b.getAttribute('aria-selected')==='true'));buttons.forEach((b,i)=>b.addEventListener('pointermove',()=>{active=i;buttons.forEach((el,j)=>el.classList.toggle('is-focused',i===j));}));buttons[active]?.classList.add('is-focused');};
    search.addEventListener('input',draw);menu.addEventListener('keydown',e=>{e.stopPropagation();if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();this.closeModelMenu(true);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=buttons.length?(active+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length:0;updateActive();}else if(e.key==='Enter'&&e.target===search){e.preventDefault();buttons[active]?.click();}},true);
    bindUi(menu.createDiv({cls:'gloss-model-menu-foot',text:ui("本次问答模型 · 指令优先使用提示词中指定的模型")}), {"text":()=>ui("本次问答模型 · 指令优先使用提示词中指定的模型")});draw();
    const root=this.root.getBoundingClientRect(),box=trigger.getBoundingClientRect(),width=Math.min(340,this.root.clientWidth-24);menu.style.width=width+'px';menu.style.maxHeight=Math.max(140,this.root.clientHeight-90)+'px';const height=Math.min(menu.offsetHeight,this.root.clientHeight-90),left=Math.max(12,Math.min(this.root.clientWidth-width-12,box.left-root.left));menu.style.left=left+'px';menu.style.top=Math.max(66,Math.min(this.root.clientHeight-height-12,box.bottom-root.top+8+height>this.root.clientHeight?box.top-root.top-height-8:box.bottom-root.top+8))+'px';this.quietLabels(menu);this.focusInput(search);
  }
  private clearSelectionPreview(){const registry=(this.root?.ownerDocument.defaultView as any)?.CSS?.highlights;if(this.selectionPreview&&registry?.get('gloss-selection')===this.selectionPreview)registry.delete('gloss-selection');this.selectionPreview=undefined;}
  private updateSelectionPreview(){
    this.clearSelectionPreview();if(!this.selected||!this.article)return;const keep=(this.lens&&!this.lens.hidden&&this.lensMode!=='actions')||(this.composerWrap&&!this.composerWrap.hidden);if(!keep)return;
    const range=anchorRange(this.blocks,this.passages,this.text,this.selected),win=this.article.ownerDocument.defaultView as any;if(range&&win?.CSS?.highlights&&win.Highlight){this.selectionPreview=new win.Highlight(range);win.CSS.highlights.set('gloss-selection',this.selectionPreview);}
  }
  private protectInput(input:HTMLInputElement|HTMLTextAreaElement){
    for(const event of ['pointerdown','mousedown','click','paste','cut','copy'] as const)input.addEventListener(event,e=>e.stopPropagation());
    input.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.key!=='Escape'||e.isComposing||e.keyCode===229)e.stopPropagation();});
  }
  private focusInput(input:HTMLInputElement|HTMLTextAreaElement){
    input.focus({preventScroll:true});
    // Pointer activation and workspace handlers may finish after the button callback.
    requestAnimationFrame(()=>{if(input.isConnected&&!input.closest('[hidden]'))input.focus({preventScroll:true});});
  }
  toggleComposer(next=this.composerWrap.hidden,focus=true){
    this.composerWrap.hidden=!next;this.questionButton.setAttribute('aria-expanded',String(next));this.questionButton.toggleClass('is-active',next);
    if(next){if(focus)this.closeLens();this.updateContext();this.layoutMargin();this.resizeQuestion();if(focus)this.focusInput(this.composer);void this.generateSuggestions();}else this.cancelSuggestions();
    if(!next&&this.composer===this.composer.ownerDocument.activeElement)this.composer.blur();
    this.updateSelectionPreview();
  }
  private closeLens(){if(this.lens){this.lens.hidden=true;this.lensInput=undefined;}this.updateSelectionPreview();}
  private showLens(mode:'actions'|'ask'|'note',initial=''){
    if(!this.selected)return;if(mode==='ask'){this.toggleComposer(true);this.composer.value=initial;this.rememberDraft();this.syncSuggestionVisibility();return;}if(mode!=='actions')this.toggleComposer(false);this.lensMode=mode;this.lensInput=undefined;this.lens.empty();this.lens.hidden=false;this.lens.classList.toggle('is-editor',mode!=='actions');
    if(mode==='actions'){
      const ask=bindUi(button(this.lens,ui("提问"),()=>this.showLens('ask'),'gloss-lens-action gloss-lens-ask'), {"text":()=>ui("提问")});ask.createSpan({cls:'gloss-lens-caret'});this.lens.createSpan({cls:'gloss-lens-divider'});
      for(const command of this.plugin.store.settings.commands)button(this.lens,commandName(command),()=>this.runCommand(command),'gloss-lens-action gloss-command-action');
      this.lens.createSpan({cls:'gloss-lens-divider'});
      bindUi(this.iconButton(this.lens,'pen-line',ui("写批注"),()=>this.showLens('note'),'gloss-lens-action'), {"label":()=>ui("写批注")});
      bindUi(this.iconButton(this.lens,'copy',ui("复制选中文本"),async()=>{if(this.selected)await navigator.clipboard.writeText(this.selected.quote);this.closeLens();},'gloss-lens-action'), {"label":()=>ui("复制选中文本")});
      bindUi(this.iconButton(this.lens,'settings-2',ui("管理选中文本指令"),()=>{(this.app as any).setting.open();(this.app as any).setting.openTabById(this.plugin.manifest.id);const tab=(this.app as any).setting.activeTab;if(tab instanceof GlossSettings){tab.tab='commands';tab.display();}},'gloss-lens-action'), {"label":()=>ui("管理选中文本指令")});
      if(this.activeHighlight)bindUi(this.iconButton(this.lens,'eraser',ui("移除这条标记"),()=>this.removeHighlight(this.activeHighlight!),'gloss-lens-action'), {"label":()=>ui("移除这条标记")});
      this.lens.createSpan({cls:'gloss-lens-divider'});
      const styles=this.lens.createDiv({cls:'gloss-mark-styles'});
      for(const [style,icon]of [['underline','underline'],['wavy','spline'],['highlight','highlighter']] as const){const b=bindUi(this.iconButton(styles,icon,ui(MARK_STYLES[style]),()=>this.highlight(this.plugin.store.settings.marker||'yellow',style),'gloss-lens-action'), {"label":()=>ui(MARK_STYLES[style])});b.dataset.markStyle=style;}
      const colors=bindUi(this.lens.createDiv({cls:'gloss-marker-colors',attr:{role:'group','aria-label':ui("标记颜色")}}), {"aria-label":()=>ui("标记颜色")});
      for(const[color,label]of [['yellow',ui("黄色")],['green',ui("绿色")],['blue',ui("蓝色")],['pink',ui("粉色")]]){const b=button(colors,'',()=>this.highlight(color,this.plugin.store.settings.markStyle),'gloss-marker-dot');b.dataset.color=color;bindUi(b, {"aria-label":()=>label+ui("标记")});b.title=label;b.classList.toggle('is-on',color===this.plugin.store.settings.marker);}
    }else{
      const head=this.lens.createDiv({cls:'gloss-lens-editor-head'});bindUi(head.createSpan({text:ui("用自己的话记下来")}), {"text":()=>ui("用自己的话记下来")});bindUi(this.iconButton(head,'x',ui("关闭选中文本输入"),()=>this.closeLens(),'gloss-lens-action'), {"label":()=>ui("关闭选中文本输入")});
      this.lensInput=bindUi(this.lens.createEl('textarea',{cls:'gloss-lens-input',attr:{'aria-label':ui("选中文本批注"),placeholder:ui("这段话让你想到了什么？"),rows:'3'}}), {"aria-label":()=>ui("选中文本批注"),"placeholder":()=>ui("这段话让你想到了什么？")});
      const existing=this.data.highlights.find(h=>h.id===this.activeHighlight);this.lensInput.value=mode==='note'?existing?.note||'':initial;
      const footer=this.lens.createDiv({cls:'gloss-lens-editor-footer'});bindUi(button(footer,ui("保存批注"),()=>this.saveLensNote(),'gloss-lens-save'), {"text":()=>ui("保存批注")});
      this.protectInput(this.lensInput);this.lensInput.addEventListener('focus',()=>this.closeModelMenu());
      this.lensInput.addEventListener('keydown',e=>{if(!e.isComposing&&e.keyCode!==229&&e.key==='Enter'&&!e.shiftKey&&(e.metaKey||e.ctrlKey)){e.preventDefault();void this.saveLensNote().catch(showError);}});
      // The anchor is already stored; release the document selection before editing.
      this.article.ownerDocument.getSelection()?.removeAllRanges();
    }
    this.quietLabels(this.lens);this.placeLens();this.updateSelectionPreview();
    if(this.lensInput){this.focusInput(this.lensInput);this.lensInput.setSelectionRange(this.lensInput.value.length,this.lensInput.value.length);}
  }
  private async runCommand(command:ReadingCommand){if(!this.selected)return;if(command.id==='translate'){if(this.plugin.store.settings.translationEngine==='google'){await this.translateSelection();return;}await this.send(renderCommand(command.prompt,this.selected.quote,this.path.split('/').pop()||'')+'\n目标语言：'+TRANSLATION_LANGUAGES[this.plugin.store.settings.translationTarget]+'；如原文已是目标语言，中文改译英语，其他语言改译中文。',false,'translate');return;}await this.send(renderCommand(command.prompt,this.selected.quote,this.path.split('/').pop()?.replace(/\.md$/,'')||''),false,command.id);}
  private placeLens(){if(!this.selected||this.lens.hidden)return;if(Platform?.isMobile){this.lens.style.removeProperty('left');this.lens.style.removeProperty('top');return;}const r=anchorRange(this.blocks,this.passages,this.text,this.selected);if(!r)return;const rects=Array.from(r.getClientRects()).filter(r=>r.width>0);if(!rects.length)return;const first=rects[0],last=rects.at(-1)!,box=this.root.getBoundingClientRect(),w=this.lens.offsetWidth,h=this.lens.offsetHeight,center=(Math.min(...rects.map(r=>r.left))+Math.max(...rects.map(r=>r.right)))/2;const x=Math.max(12,Math.min(this.root.clientWidth-w-12,center-box.left-w/2));const above=first.top-box.top-h-12>=66;const y=above?first.top-box.top-h-12:last.bottom-box.top+12;this.lens.style.left=x+'px';this.lens.style.top=Math.max(66,Math.min(this.root.clientHeight-h-12,y))+'px';this.lens.style.setProperty('--gloss-arrow',Math.max(18,Math.min(w-18,(above?first.left+Math.min(40,first.width/2):(last.left+last.right)/2)-box.left-x))+'px');this.lens.classList.toggle('is-below',!above);}
  private updateContext(){if(!this.composer)return;this.updateSelectionPreview();if(!this.plugin.store.settings.questionSuggestions)this.cancelSuggestions();else if(!this.composerWrap.hidden&&!this.aborter&&!this.retrievalJob)void this.generateSuggestions();
    this.syncComposerBusy();if(this.selectionChip){this.selectionChip.empty();this.selectionChip.hidden=!this.selected;this.composerWrap.toggleClass('has-selection',!!this.selected);if(this.selected){bindUi(this.selectionChip.createSpan({text:ui("选中文本 · ")+this.selected.quote.replace(/\s+/g,' ').slice(0,20)}), {"text":()=>ui("选中文本 · ")+this.selected.quote.replace(/\s+/g,' ').slice(0,20)});bindUi(this.iconButton(this.selectionChip,'x',ui("改为整篇文档提问"),()=>{this.selected=undefined;this.activeHighlight=undefined;this.closeLens();this.updateContext();this.focusInput(this.composer);}), {"label":()=>ui("改为整篇文档提问")});}}this.composeLabel.textContent=this.webError;this.composeLabel.hidden=!this.webError;this.composer.placeholder=this.selected?ui("询问选中文本…"):ui("询问整篇文档…");}
  private paintHighlights(){if(!this.article)return;if(this.pdf){this.pdf.paint([...this.data.highlights.filter(h=>!h.removed).map(h=>({id:h.id,anchor:h.anchor,kind:'highlight' as const,color:h.color,style:markStyle(h.style),active:h.id===this.activeHighlight})),...this.data.threads.filter(t=>!t.removed&&t.anchor&&t.selection!==false).map(t=>({id:t.id,anchor:t.anchor!,kind:'thread' as const,active:t.id===this.activeThread}))]);this.updateSelectionPreview();return;}const marks:TextMark[]=[];for(const h of this.data.highlights.filter(h=>!h.removed)){const start=resolveAnchor(this.text,h.anchor);if(start!==null)marks.push({id:h.id,start,end:start+h.anchor.quote.length,kind:'highlight',color:h.color,note:!!h.note,style:markStyle(h.style)});}for(const t of this.threads){if(!t.anchor)continue;const start=resolveAnchor(this.text,t.anchor);if(start!==null)marks.push({id:t.id,start,end:start+t.anchor.quote.length,kind:'thread'});}paintMarks(this.article,this.blocks,this.passages,marks,this.activeThread||this.activeHighlight,this.fresh);this.updateSelectionPreview();this.rail?.querySelectorAll<HTMLElement>('.gloss-rail-line').forEach(el=>{const p=this.passages[Number(el.dataset.paragraph)-1],h=marks.find(m=>m.kind==='highlight'&&m.end>p.start&&m.start<p.end),t=marks.some(m=>m.kind==='thread'&&m.end>p.start&&m.start<p.end);el.dataset.color=h?.color||'';el.classList.toggle('has-gloss',t);});}
  private matchedHighlight(){if(!this.selected)return;const at=resolveAnchor(this.text,this.selected);return this.data.highlights.find(h=>!h.removed&&h.anchor.quote===this.selected!.quote&&resolveAnchor(this.text,h.anchor)===at);}
  private async highlight(color:string,style:MarkStyle=this.plugin.store.settings.markStyle){if(!this.selected)return;let h=this.matchedHighlight();if(h){h.color=color;h.style=style;}else{h={id:uid(),anchor:{...this.selected},color,style,note:'',created:Date.now()};this.data.highlights.push(h);}this.plugin.store.settings.marker=color;this.plugin.store.settings.markStyle=style;this.activeHighlight=undefined;this.fresh=h.id;this.data.updated=Date.now();await this.plugin.persist();this.article.ownerDocument.getSelection()?.removeAllRanges();this.closeLens();this.toggleComposer(true,false);this.paintHighlights();await this.renderMargin();const id=h.id;setTimeout(()=>{if(this.fresh===id){this.fresh=undefined;this.article.querySelectorAll('.is-new').forEach(el=>el.removeClass('is-new'));}},750);}
  private async saveLensNote(){if(!this.selected||!this.lensInput)return;let h=this.matchedHighlight();const note=this.lensInput.value.trim();if(h)h.note=note;else{if(!note){this.closeLens();return;}h={id:uid(),anchor:{...this.selected},color:this.plugin.store.settings.marker||'yellow',style:this.plugin.store.settings.markStyle,note,created:Date.now()};this.data.highlights.push(h);}this.activeHighlight=h.id;this.fresh=h.id;this.data.updated=Date.now();await this.plugin.persist();this.closeLens();this.paintHighlights();await this.renderMargin();if(this.narrow)this.toggleNotebook(true);}
  private async removeHighlight(id:string){const h=this.data.highlights.find(h=>h.id===id);if(!h)return;h.removed=true;await this.plugin.persist();this.closeLens();this.activeHighlight=undefined;this.paintHighlights();await this.renderMargin();new Notice(ui("高亮已移除。"));}
  private jump(anchor:Anchor){if(this.pdf&&anchor.pdfPage&&anchor.pdfPage!==this.pdf.page){void this.pdf.go(anchor.pdfPage).then(()=>this.jump(anchor)).catch(showError);return;}let r=anchorRange(this.blocks,this.passages,this.text,anchor);if(!r&&this.pdf){const needle=anchor.quote.replace(/\s/g,''),positions:number[]=[],chars:string[]=[];for(let n=0;n<this.text.length;n++)if(!/\s/.test(this.text[n])){positions.push(n);chars.push(this.text[n]);}const flat=chars.join(''),at=flat.indexOf(needle);if(needle&&at>=0&&flat.indexOf(needle,at+1)<0){anchor={...this.makeReadingAnchor(positions[at],positions[at+needle.length-1]+1)};r=anchorRange(this.blocks,this.passages,this.text,anchor);}}if(!r){new Notice(this.pdf?ui("已定位原书页；该片段无法精确匹配到文字层。"):ui("原文已变化，无法可靠定位；摘录仍完整保留。"));return;}const start=resolveAnchor(this.text,anchor)!,i=this.passages.findIndex(p=>p.end>start),b=this.blocks[i];if(this.pdf)this.pdf.reveal(anchor);else b.scrollIntoView({behavior:'smooth',block:'center'});b.addClass('gloss-jump');setTimeout(()=>b.removeClass('gloss-jump'),1800);}
  private activateThread(t:Thread){if(this.pdf&&t.anchor?.pdfPage&&t.anchor.pdfPage!==this.pdf.page){void this.pdf.go(t.anchor.pdfPage).then(()=>this.activateThread(t)).catch(showError);return;}this.referenceFocus=undefined;this.activeThread=t.id;this.activeHighlight=undefined;this.selected=undefined;this.paintHighlights();this.updateContext();if(this.narrow)this.toggleNotebook(true);void this.renderMargin();}
  async revealReference(threadId:string,id:string){const anchor=this.data.threads.find(t=>t.id===threadId&&!t.removed)?.citations?.[id];if(!anchor)throw new Error('此原文引用不存在。');if(this.pdf&&!this.pdf.loaded)await this.pdf.ready(this.importAborter?.signal);const thread=this.data.threads.find(t=>t.id===threadId&&!t.removed);if(thread)this.focusReference(thread,anchor);}
  revealSaved(id:string){const h=this.data.highlights.find(h=>h.id===id),t=this.data.threads.find(t=>t.id===id&&!t.removed);const a=h?.anchor||t?.anchor;if(this.pdf&&a?.pdfPage&&a.pdfPage!==this.pdf.page){void this.pdf.go(a.pdfPage).then(()=>this.revealSaved(id)).catch(showError);return;}if(h){this.activeThread=undefined;this.activeHighlight=h.id;this.selected=h.anchor;this.jump(h.anchor);if(h.note){void this.renderMargin();if(this.narrow)this.toggleNotebook(true);}else this.showLens('actions');}if(t){this.activateThread(t);if(t.anchor)this.jump(t.anchor);}}
  private collapseThread(){this.activeThread=undefined;this.referenceFocus=undefined;this.hoverThread=undefined;this.paintHighlights();this.updateAssociatedParagraphs();this.updateContext();void this.renderMargin().catch(showError);}
  private clearReferencePreview(){const registry=(this.root?.ownerDocument.defaultView as any)?.CSS?.highlights;if(this.referencePreview&&registry?.get('gloss-reference')===this.referencePreview)registry.delete('gloss-reference');this.referencePreview=undefined;}
  private updateAssociatedParagraphs(){
    this.blocks.forEach(b=>b.classList.remove('gloss-associated'));this.clearReferencePreview();
    const id=this.hoverThread||this.activeThread,anchor=annotationAnchor(this.threads,id,this.referenceFocus);
    if(!anchor)return;if(this.referenceFocus?.threadId===id){const range=this.pdf?this.pdf.range(anchor):anchorRange(this.blocks,this.passages,this.text,anchor),win=this.article.ownerDocument.defaultView as any;if(range&&win?.CSS?.highlights&&win.Highlight){this.referencePreview=new win.Highlight(range);win.CSS.highlights.set('gloss-reference',this.referencePreview);}}
    if(this.pdf)return;const at=resolveAnchor(this.text,anchor);if(at===null)return;this.blocks.forEach((b,i)=>{const p=this.passages[i];b.classList.toggle('gloss-associated',!!p&&p.end>at&&p.start<at+anchor.quote.length);});
  }
  private setHover(id?:string){this.hoverThread=id;this.article.querySelectorAll<HTMLElement>('[data-g]').forEach(el=>el.classList.toggle('is-hover',!!id&&el.dataset.g!.split(' ').includes(id)));for(const [key,card]of this.cards)card.classList.toggle('is-hover',id===key);this.updateAssociatedParagraphs();}
  private focusReference(thread:Thread,anchor:Anchor){this.activeThread=thread.id;this.activeHighlight=undefined;this.referenceFocus={threadId:thread.id,anchor};if(this.notebookOpen)this.toggleNotebook(false);this.jump(anchor);this.paintHighlights();this.updateAssociatedParagraphs();void this.renderMargin().catch(showError);this.scheduleLayout();this.trackLeader();}
  private citeButtons(parent:HTMLElement,t:Thread){
    const walker=parent.ownerDocument.createTreeWalker(parent,4),nodes:Text[]=[];while(walker.nextNode()){const n=walker.currentNode as Text;if(referenceTokens(n.data).length&&!n.parentElement?.closest('pre,code,a,button'))nodes.push(n);}
    for(const n of nodes){const fragment=parent.ownerDocument.createDocumentFragment();let end=0;for(const token of referenceTokens(n.data)){fragment.append(n.data.slice(end,token.start));for(const {id,anchor,label} of uniqueReferences(token.ids,t.citations)){const b=parent.ownerDocument.createElement('button');b.className='gloss-citation';b.textContent=anchor.pdfPage?'p.'+anchor.pdfPage:label;b.onclick=()=>this.focusReference(t,anchor);fragment.append(b);}end=token.end;}fragment.append(n.data.slice(end));n.replaceWith(fragment);}
  }
  private async renderThread(parent:HTMLElement,t:Thread,component:Component,notebook=false){
    const active=t.id===this.activeThread,streaming=!!this.aborter&&this.runningThread===t.id,card=parent.createEl('article',{cls:'gloss-margin-card gloss-thread-card'});card.dataset.threadId=t.id;card.dataset.cardId=t.id;card.toggleClass('is-active',active);card.toggleClass('is-collapsed',!active);
    if(!notebook){this.cards.set(t.id,card);const prior=this.previousPositions.get(t.id);if(prior){card.style.transform=prior;card.setCssStyles({visibility:'visible'});card.dataset.placed='true';}}
    const follow=Math.max(0,t.messages.filter(m=>m.role==='user').length-1),number=t.anchor?this.paragraphNumber(t.anchor):null,source=t.anchor?.pdfPage?'p.'+t.anchor.pdfPage:number?'¶'+number:t.selection===false?ui("整篇"):'',kind=t.selection===false&&(!t.commandId||t.commandId==='default')?ui("整篇"):threadLabel(t,this.plugin.store.settings.commands),first=t.messages.find(m=>m.role==='user');
    if(!active){
      const row=card.createDiv({cls:'gloss-collapsed-row'}),open=button(row,'',()=>this.activateThread(t),'gloss-collapsed-open');open.setAttribute('aria-expanded','false');
      if(t.commandId&&t.commandId!=='default'){open.createSpan({cls:'gloss-collapsed-kind',text:kind});open.createSpan({cls:'gloss-collapsed-text',text:(t.anchor?.quote||first?.content||kind).replace(/\s+/g,' ')});}else bindUi(open.createSpan({cls:'gloss-collapsed-text is-question',text:first?.content||ui("关于这篇文档")}), {"text":()=>first?.content||ui("关于这篇文档")});
      if(follow){const counter=row.createSpan({cls:'gloss-collapsed-follow',text:'+'+follow});counter.title=follow+ui(" 次追问");bindUi(counter, {"aria-label":()=>follow+ui(" 次追问")});}
      if(source&&t.anchor){const cite=button(row,source,()=>this.focusReference(t,t.anchor!),'gloss-citation gloss-collapsed-source');bindUi(cite, {"aria-label":()=>ui("定位原文 ")+source});}else if(source)row.createSpan({cls:'gloss-collapsed-source',text:source});
      const answer=t.messages.find(m=>m.role==='assistant'&&m.content.trim()),preview=card.createDiv({cls:'gloss-card-preview gloss-answer markdown-rendered'});if(answer){await MarkdownRenderer.render(this.app,passiveEmbeds(answer.content),preview,this.path,component);if(component!==this.marginRender)return;this.citeButtons(preview,t);}else if(streaming)bindUi(preview.createDiv({cls:'gloss-writing',attr:{role:'status','aria-label':ui("正在回答")}}), {"aria-label":()=>ui("正在回答")});else if(visibleThreadError(t))bindUi(preview.createSpan({text:ui(visibleThreadError(t)||'')}), {"text":()=>ui(visibleThreadError(t)||'')});else preview.hidden=true;
      preview.addEventListener('click',e=>{if(!(e.target as Element).closest('button,a')&&preview.ownerDocument.getSelection()?.isCollapsed)this.activateThread(t);});if(streaming)this.answerStop(card,'gloss-collapsed-stop');
    }else{
      const head=card.createDiv({cls:'gloss-card-heading'});head.createSpan({cls:'gloss-card-kind',text:kind});
      if(source&&source!==ui("整篇"))button(head,source,()=>{if(t.anchor)this.focusReference(t,t.anchor);},'gloss-citation');
      if(follow)bindUi(head.createSpan({cls:'gloss-followup-count',text:follow+ui(" 次追问")}), {"text":()=>follow+ui(" 次追问")});if(streaming)this.answerStop(head,'gloss-answer-stop');bindUi(this.iconButton(head,'chevrons-down-up',ui("收起回答 · Esc"),()=>this.collapseThread(),'gloss-collapse'), {"label":()=>ui("收起回答 · Esc")});
      if(t.anchor&&t.selection!==false)button(card,t.anchor.quote,()=>this.focusReference(t,t.anchor!),'gloss-thread-quote');
      for(const [index,m]of t.messages.entries()){if(index===0&&m.role==='user'&&t.commandId&&t.commandId!=='default')continue;
        const message=card.createDiv({cls:'gloss-message '+(m.role==='user'?'is-user':'is-assistant')});bindUi(message.createSpan({cls:'gloss-sr-only',text:m.role==='user'?ui("问题"):ui("回答")}), {"text":()=>m.role==='user'?ui("问题"):ui("回答")});
        if(m.role==='user')message.createEl('p',{cls:'gloss-card-question',text:m.content});
        else{const body=message.createDiv({cls:'gloss-answer markdown-rendered'});if(!m.content&&streaming)bindUi(body.createDiv({cls:'gloss-writing',attr:{role:'status','aria-label':ui("正在回答")}}), {"aria-label":()=>ui("正在回答")});else{await MarkdownRenderer.render(this.app,passiveEmbeds(m.content),body,this.path,component);if(component!==this.marginRender)return;this.citeButtons(body,t);}}
      }
      const error=visibleThreadError(t);if(error)bindUi(card.createDiv({cls:'gloss-error',text:ui(error)}), {"text":()=>ui(error)});this.answerFooter(card,t);this.renderFollowup(card,t);
    }
    card.addEventListener('mouseenter',()=>this.setHover(t.id));card.addEventListener('mouseleave',()=>this.setHover());return card;
  }
  private renderFollowup(card:HTMLElement,thread:Thread){
    let mobileModelMissing=false;
    if(Platform?.isMobile){
      const route=thread.mobileModel,setup=this.plugin.modelSetup();let label=ui('选择手机版模型');
      try{const settings=this.regenerationSettings(thread);label=setup.services.find(service=>service.id===settings.serviceId)?.models.find(model=>model.id===settings.apiModel)?.name||settings.apiModel;}catch{mobileModelMissing=true;}
      const pick=button(card,ui('此对话的手机模型：')+label,()=>new ModelAssignmentPicker(this.app,setup,false,async ref=>{if(!ref)return;thread.mobileModel={...ref};await this.plugin.persist();await this.renderMargin();},route).open(),'gloss-thread-model');
      pick.disabled=!!this.aborter||!!this.retrievalJob;
      if(mobileModelMissing)bindUi(card.createDiv({cls:'gloss-thread-model-hint',text:ui('这条对话的原模型在手机上不可用，请先选择 API 模型。')}),{text:()=>ui('这条对话的原模型在手机上不可用，请先选择 API 模型。')});
    }
    const form=card.createEl('form',{cls:'gloss-followup'}),field=Platform?.isMobile?form.createEl('textarea',{attr:{rows:'1'}}):form.createEl('input',{attr:{type:'text'}}),input=bindUi(field,{"placeholder":()=>ui("继续追问…"),"aria-label":()=>ui("继续追问当前回答")});input.addClass('gloss-followup-input');input.value=thread.followupDraft||'';input.disabled=!!this.aborter||!!this.retrievalJob||mobileModelMissing;
    const resize=()=>{if(Platform?.isMobile)this.resizeMobileInput(input as HTMLTextAreaElement);};requestAnimationFrame(resize);
    const submit=async()=>{const question=input.value.trim();if(!question||this.aborter||this.retrievalJob)return;await this.send(question,false,'default',undefined,thread);};
    const send=bindUi(this.iconButton(form,'arrow-up',ui("发送追问"),submit,'gloss-followup-send'), {"label":()=>ui("发送追问")});send.disabled=input.disabled||!input.value.trim();
    input.addEventListener('input',()=>{thread.followupDraft=input.value;resize();send.disabled=!!this.aborter||!!this.retrievalJob||!input.value.trim();clearTimeout(this.draftTimer);this.draftTimer=setTimeout(()=>void this.plugin.persist().catch(showError),500);});
    this.protectInput(input);input.addEventListener('focus',()=>this.closeModelMenu());form.addEventListener('submit',e=>{e.preventDefault();void submit().catch(showError);});input.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(!e.isComposing&&e.keyCode!==229&&e.key==='Enter'&&!Platform?.isMobile){e.preventDefault();void submit().catch(showError);}});
  }
  private paragraphNumber(a:Anchor){if(this.pdf&&a.pdfPage!==this.pdf.page)return null;const start=resolveAnchor(this.text,a);return start===null?null:this.passages.find(p=>p.end>start)?.number;}
  private activateNote(h:Highlight){if(this.pdf&&h.anchor.pdfPage&&h.anchor.pdfPage!==this.pdf.page){void this.pdf.go(h.anchor.pdfPage).then(()=>this.activateNote(h)).catch(showError);return;}this.activeHighlight=h.id;this.activeThread=undefined;this.selected=h.anchor;this.toggleComposer(true,false);this.paintHighlights();this.updateContext();void this.renderMargin().catch(showError);}
  private renderNote(parent:HTMLElement,h:Highlight,notebook=false){const card=parent.createEl('article',{cls:'gloss-margin-card gloss-personal-card'});card.dataset.cardId=h.id;card.dataset.color=h.color;if(!notebook){this.cards.set(h.id,card);const prior=this.previousPositions.get(h.id);if(prior){card.style.transform=prior;card.setCssStyles({visibility:'visible'});card.dataset.placed='true';}}card.toggleClass('is-active',h.id===this.activeHighlight);const head=card.createDiv({cls:'gloss-card-heading'});head.createSpan({cls:'gloss-note-color',attr:{'data-color':h.color}});bindUi(head.createSpan({text:ui("我的批注")}), {"text":()=>ui("我的批注")});const number=this.paragraphNumber(h.anchor);if(number)button(head,'¶'+number,()=>{this.activateNote(h);this.jump(h.anchor);},'gloss-citation');button(card,h.anchor.quote,()=>{this.activateNote(h);this.showLens('actions');this.jump(h.anchor);},'gloss-note-quote');if(h.note)card.createEl('p',{cls:'gloss-personal-note',text:h.note});if(number===null&&!h.anchor.pdfPage)bindUi(card.createDiv({cls:'gloss-stale',text:ui("原文已变更 · 摘录仍保留")}), {"text":()=>ui("原文已变更 · 摘录仍保留")});const actions=card.createDiv({cls:'gloss-note-actions'});bindUi(this.iconButton(actions,'pen-line',ui("编辑批注"),()=>{this.activateNote(h);this.showLens('note');}), {"label":()=>ui("编辑批注")});bindUi(this.iconButton(actions,'message-circle',ui("讨论这段"),()=>{this.activateNote(h);this.showLens('ask');}), {"label":()=>ui("讨论这段")});bindUi(this.iconButton(actions,'eraser',ui("移除高亮"),()=>this.removeHighlight(h.id)), {"label":()=>ui("移除高亮")});card.addEventListener('click',e=>{if((e.target as Element).closest('button,a,input,textarea,select,[contenteditable="true"]')||!card.ownerDocument.getSelection()?.isCollapsed)return;if(this.activeHighlight!==h.id)this.activateNote(h);});return card;}
  private regenerationSettings(thread:Thread):Settings{
    if(Platform?.isMobile&&thread.mobileModel){const {service,model}=resolveModel(this.plugin.modelSetup(),'default',thread.mobileModel);return{...this.plugin.store.settings,...serviceSettings(service,model.id,this.plugin.serviceKey(service.id)),systemPrompt:this.plugin.store.settings.taskPrompts.default||SYSTEM};}
    const previous=thread.messages.filter(m=>m.role==='assistant').at(-1),s=this.plugin.store.settings;
    if(previous?.provider==='Google Translate')return this.modelSettings('default');if(!previous?.model)return this.modelSettings(thread.commandId||'default');
    const candidates=s.services.filter(service=>(previous.serviceId?service.id===previous.serviceId:!previous.provider||[service.name,service.kind,providerName(service.kind)].includes(previous.provider))&&service.models.some(model=>model.id===previous.model));
    if(candidates.length!==1)throw new Error('原回答的模型服务已变更，请先在设置中配置该模型。');
    const service=candidates[0];if(Platform?.isMobile&&service.kind!=='api')throw new Error('手机端不支持本机 CLI，请选择自定义 API 服务。');return{...s,...serviceSettings(service,previous.model,this.plugin.serviceKey(service.id)),systemPrompt:s.taskPrompts.default||SYSTEM};
  }
  private async regenerateThread(thread:Thread){if(this.aborter||thread.removed)return;if(thread.messages.filter(m=>m.role==='user').length===1&&(thread.messages.filter(m=>m.role==='assistant').at(-1)?.provider==='Google Translate'||(!thread.messages.some(m=>m.role==='assistant')&&thread.commandId==='translate'&&this.plugin.store.settings.translationEngine==='google'))){if(this.pdf&&thread.anchor?.pdfPage&&thread.anchor.pdfPage!==this.pdf.page)await this.pdf.go(thread.anchor.pdfPage);await this.translateSelection(thread);return;}if(this.pdf&&thread.anchor?.pdfPage!==this.pdf.page&&thread.anchor?.pdfPage)await this.pdf.go(thread.anchor.pdfPage);regenerationHistory(thread);this.activeThread=thread.id;this.selected=thread.anchor;await this.send(undefined,false,thread.commandId||'default',thread);}
  private async deleteThread(thread:Thread){if(thread.removed)return;if(this.runningThread===thread.id)this.stop();thread.removed=true;thread.removedAt=Date.now();if(this.activeThread===thread.id){this.activeThread=undefined;this.selected=undefined;}await this.plugin.persist();this.paintHighlights();this.updateContext();await this.renderMargin();const fragment=this.root.ownerDocument.createDocumentFragment();fragment.append(ui("已删除问答 "));const undo=this.root.ownerDocument.createElement('button');undo.textContent=ui("撤销");undo.onclick=()=>{thread.removed=false;delete thread.removedAt;void this.plugin.persist().then(()=>{this.paintHighlights();return this.renderMargin();}).catch(showError);};fragment.append(undo);new Notice(fragment,8000);}
  private answerFooter(card:HTMLElement,thread:Thread,notebook=false){
    if(this.aborter&&this.runningThread===thread.id){if(notebook){const foot=card.createDiv({cls:'gloss-answer-controls'});this.answerStop(foot);}return;}
    if(thread.messages.at(-1)?.role!=='assistant'||!thread.messages.at(-1)!.content.trim()){const foot=card.createDiv({cls:'gloss-answer-controls'});bindUi(this.iconButton(foot,'rotate-ccw',ui("重试回答"),()=>this.regenerateThread(thread)), {"label":()=>ui("重试回答")});bindUi(this.iconButton(foot,'trash-2',ui("删除这条问答"),()=>this.deleteThread(thread)), {"label":()=>ui("删除这条问答")});return foot;}
    const foot=card.createDiv({cls:'gloss-card-footer gloss-answer-controls'}),last=thread.messages.at(-1)!,receipt=foot.createSpan({cls:'gloss-answer-receipt'}),service=this.plugin.store.settings.services.find(s=>s.id===last.serviceId),saved=answerReceipt(last,service?.models.find(m=>m.id===last.model)?.name);bindUi(receipt.createSpan({cls:'gloss-receipt-model',text:last.model?saved.model:ui(saved.model)}), {"text":()=>last.model?saved.model:ui(saved.model)});if(saved.usage){receipt.createSpan({cls:'gloss-receipt-divider',text:'/'});bindUi(receipt.createSpan({cls:'gloss-receipt-tokens',text:receiptText(saved.usage)}), {"text":()=>receiptText(saved.usage)});}receipt.title=last.provider==='Google Translate'?ui(saved.detail):[last.provider,last.model,last.usage?receiptText(tokenDetails(last.usage)):ui(last.model?'服务未返回本轮用量':'这条历史记录没有保存模型或用量，无法补算。')].filter(Boolean).join(' · ');
    const regenerate=bindUi(this.iconButton(foot,'rotate-ccw',ui("重新生成回答"),()=>this.regenerateThread(thread)), {"label":()=>ui("重新生成回答")});regenerate.disabled=!!this.aborter||!thread.messages.some(m=>m.role==='user');
    bindUi(this.iconButton(foot,'copy',ui("复制完整对话"),async()=>{await navigator.clipboard.writeText((thread.anchor?'引用原文：\n'+thread.anchor.quote+'\n\n':'')+thread.messages.map(m=>(m.role==='user'?'我的问题':'回答'+(m.model?' · '+m.model:'')+(m.usage?' / '+tokenReceipt(m.usage):''))+'：\n'+m.content).join('\n\n'));new Notice(ui("已复制对话与引用"));}), {"label":()=>ui("复制完整对话")});
    bindUi(this.iconButton(foot,'trash-2',ui("删除这条问答"),()=>this.deleteThread(thread)), {"label":()=>ui("删除这条问答")});return foot;
  }
  private notebookRender?:Component;
  private notebookMeta(parent:HTMLElement,anchor:Anchor|undefined,label:string,created:number){const head=parent.createDiv({cls:'gloss-notebook-meta'}),n=anchor?this.paragraphNumber(anchor):null;if(anchor?.pdfPage)bindUi(head.createSpan({cls:'gloss-citation gloss-notebook-paragraph',text:ui("第 ")+anchor.pdfPage+ui(" 页")}), {"text":()=>ui("第 ")+anchor.pdfPage+ui(" 页")});else if(n)head.createSpan({cls:'gloss-citation gloss-notebook-paragraph',text:'¶'+n});head.createSpan({cls:'gloss-notebook-type',text:label});bindUi(head.createSpan({cls:'gloss-notebook-time',text:relativeTime(created)}), {"text":()=>relativeTime(created)});return head;}
  private notebookGo(t:Thread){this.toggleNotebook(false);this.activateThread(t);if(t.anchor)this.focusReference(t,t.anchor);else this.scroller.scrollTo({top:0,behavior:'smooth'});requestAnimationFrame(()=>{const card=this.cards.get(t.id);if(!card)return;if(this.pdf)this.margin.scrollTo({top:this.margin.scrollTop+card.getBoundingClientRect().top-this.margin.getBoundingClientRect().top,behavior:'smooth'});else card.scrollIntoView({block:'nearest',behavior:'smooth'});});}
  private quietNotebook(){this.quietLabels(this.drawer,true);for(const el of [this.drawer,...Array.from(this.drawer.querySelectorAll<HTMLElement>('[title],[data-tooltip],[data-tip]'))])for(const attr of ['title','data-tooltip','data-tip'])el.removeAttribute(attr);}
  private async renderNotebook(){
    const counts=notebookCounts(this.data);this.notebookBadge.textContent=String(counts.all);this.notebookBadge.hidden=!counts.all;this.drawerSubtitle.textContent=counts.all?notebookSummary(counts.questions,counts.highlights):ui("还没有阅读笔记");this.drawerTabs.empty();
    for(const [key,label]of [['all',ui("全部")],['questions',ui("问答")],['highlights',ui("划线")]]as const){const b=button(this.drawerTabs,'',()=>{this.notebookFilter=key;void this.renderNotebook().catch(showError);},'gloss-notebook-tab');b.createSpan({text:label});b.createSpan({cls:'gloss-notebook-tab-count',text:String(counts[key])});b.setAttribute('role','tab');b.setAttribute('aria-label',label+' '+counts[key]);b.setAttribute('aria-selected',String(this.notebookFilter===key));}
    const scroll=this.drawerBody.scrollTop;this.drawerBody.empty();if(this.notebookRender){this.removeChild(this.notebookRender);this.notebookRender.unload();this.notebookRender=undefined;}if(!this.notebookOpen){this.quietNotebook();return;}
    const component=new Component();this.notebookRender=component;this.addChild(component);const entries=notebookEntries(this.data,this.notebookFilter,this.text),list=this.drawerBody.createEl('ol',{cls:'gloss-notebook-list'});
    for(const entry of entries){const item=list.createEl('li');if(entry.kind==='highlight'){const h=entry.value,card=bindUi(item.createEl('article',{cls:'gloss-notebook-entry gloss-notebook-highlight',attr:{'aria-label':(h.note?ui("批注"):ui("划线"))+' · '+h.anchor.quote.slice(0,30)}}), {"aria-label":()=>(h.note?ui("批注"):ui("划线"))+' · '+h.anchor.quote.slice(0,30)});card.dataset.entryKind='highlight';card.dataset.entryId=h.id;
        const go=button(card,'',()=>{this.toggleNotebook(false);this.activateNote(h);this.jump(h.anchor);},'gloss-notebook-entry-go');this.notebookMeta(go,h.anchor,h.note?ui("批注"):ui(MARK_STYLES[markStyle(h.style)]),h.created);const quote=go.createSpan({cls:'gloss-notebook-highlight-quote'}),mark=quote.createEl('mark',{cls:'m-hl',text:h.anchor.quote});mark.dataset.c=h.color;mark.dataset.fill=String(markStyle(h.style)==='highlight');if(markStyle(h.style)!=='highlight'){mark.dataset.line=markStyle(h.style);mark.dataset.lc=h.color;}if(h.note)go.createSpan({cls:'gloss-notebook-personal-note',text:h.note});bindUi(this.iconButton(card,'x',ui("移除这处划线"),()=>this.removeHighlight(h.id),'gloss-notebook-entry-remove'), {"label":()=>ui("移除这处划线")});
      }else{const t=entry.value,card=bindUi(item.createEl('article',{cls:'gloss-notebook-entry gloss-notebook-question',attr:{'aria-label':threadLabel(t,this.plugin.store.settings.commands)+' · '+(t.messages.find(m=>m.role==='user')?.content||ui("全文问答"))}}), {"aria-label":()=>threadLabel(t,this.plugin.store.settings.commands)+' · '+(t.messages.find(m=>m.role==='user')?.content||ui("全文问答"))});card.dataset.entryKind='question';card.dataset.entryId=t.id;
        const go=button(card,'',()=>this.notebookGo(t),'gloss-notebook-entry-go');this.notebookMeta(go,t.anchor,threadLabel(t,this.plugin.store.settings.commands),t.created);if(t.anchor)go.createSpan({cls:'gloss-notebook-source',text:t.anchor.quote});
        let pair:HTMLElement|undefined;for(const [index,message]of t.messages.entries()){if(message.role==='user'){pair=card.createDiv({cls:'gloss-notebook-pair'});const question=pair.createDiv({cls:'gloss-notebook-qa is-question'});bindUi(question.createSpan({cls:'gloss-notebook-qa-label',text:'Q',attr:{'aria-label':ui("问题")}}), {"aria-label":()=>ui("问题")});question.createEl('p',{text:message.content});}else{pair||=card.createDiv({cls:'gloss-notebook-pair'});const answer=pair.createDiv({cls:'gloss-notebook-qa is-answer'});bindUi(answer.createSpan({cls:'gloss-notebook-qa-label',text:'A',attr:{'aria-label':ui("回答")}}), {"aria-label":()=>ui("回答")});const copy=answer.createDiv({cls:'gloss-notebook-answer-content'}),body=copy.createDiv({cls:'gloss-answer gloss-notebook-clamp markdown-rendered'}),key=t.id+':'+index,expanded=this.notebookAnswers.has(key);body.classList.toggle('is-expanded',expanded);
            if(!message.content&&this.runningThread===t.id&&this.aborter)bindUi(body.createDiv({cls:'gloss-writing',attr:{role:'status','aria-label':ui("正在回答")}}), {"aria-label":()=>ui("正在回答")});else if(message.content){await MarkdownRenderer.render(this.app,passiveEmbeds(message.content),body,this.path,component);if(component!==this.notebookRender)return;this.citeButtons(body,t);}else bindUi(body.createSpan({cls:'gloss-notebook-unanswered',text:ui(visibleThreadError(t)||'')}), {"text":()=>ui(visibleThreadError(t)||'')});
            const more=bindUi(button(copy,expanded?ui("收起"):ui("展开"),()=>{const open=!body.classList.contains('is-expanded');body.classList.toggle('is-expanded',open);body.classList.toggle('is-over',!open);if(open)this.notebookAnswers.add(key);else this.notebookAnswers.delete(key);more.textContent=open?ui("收起"):ui("展开");},'gloss-notebook-read-more'), {"text":()=>expanded?ui("收起"):ui("展开")});more.hidden=!expanded;requestAnimationFrame(()=>{if(component!==this.notebookRender||!body.isConnected)return;const over=body.scrollHeight>body.clientHeight+2;body.classList.toggle('is-over',!expanded&&over);more.hidden=!expanded&&!over;});
          }}if(t.messages.at(-1)?.role==='user'){const status=bindUi(card.createDiv({cls:'gloss-notebook-unanswered',text:ui(visibleThreadError(t)||'')}), {"text":()=>ui(visibleThreadError(t)||'')});status.setAttribute('role','status');}if(visibleThreadError(t)&&t.messages.at(-1)?.role==='assistant')bindUi(card.createDiv({cls:'gloss-error',text:ui(visibleThreadError(t)||'')}), {"text":()=>ui(visibleThreadError(t)||'')});this.answerFooter(card,t,true);if(this.narrow&&t.messages.at(-1)?.provider!=='Google Translate')this.renderFollowup(card,t);
      }}
    if(!entries.length){const empty=this.drawerBody.createDiv({cls:'gloss-notebook-empty'});setIcon(empty.createSpan(),'notebook-pen');bindUi(empty.createEl('p',{text:this.notebookFilter==='questions'?ui("还没有问答"):this.notebookFilter==='highlights'?ui("还没有划线"):ui("选中一句话，留下问题或划线。")}), {"text":()=>this.notebookFilter==='questions'?ui("还没有问答"):this.notebookFilter==='highlights'?ui("还没有划线"):ui("选中一句话，留下问题或划线。")});}
    this.quietNotebook();
    this.drawerBody.scrollTop=scroll;
  }
  private async renderMargin(){if(!this.margin)return;if(this.marginRender){this.removeChild(this.marginRender);this.marginRender.unload();}this.marginObserver?.disconnect();const component=new Component();this.marginRender=component;this.addChild(component);for(const[id,card]of this.cards)this.previousPositions.set(id,card.style.transform);this.margin.empty();this.leader?.remove();this.leader=undefined;cancelAnimationFrame(this.leaderFrame);this.cards.clear();
    const notes=this.data.highlights.filter(h=>!h.removed&&h.note&&(!this.pdf||h.anchor.pdfPage===this.pdf.page));
    for(const t of this.threads){await this.renderThread(this.margin,t,component);if(component!==this.marginRender)return;}
    for(const h of notes)this.renderNote(this.margin,h);

    await this.renderNotebook();if(component!==this.marginRender)return;
    this.marginObserver=new ResizeObserver(()=>this.scheduleLayout());for(const card of this.cards.values())this.marginObserver.observe(card);this.scheduleLayout();}
  private scheduleLayout(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.layoutMargin());}
  private layoutMargin(){if(!this.margin?.isConnected)return;const compose=this.root.querySelector<HTMLElement>('.gloss-composer');if(compose){const r=this.page.getBoundingClientRect(),root=this.root.getBoundingClientRect();compose.style.setProperty('--composer-center',(r.left-root.left+r.width/2)+'px');}const base=this.margin.getBoundingClientRect().top,items:MarginItem[]=[];
    for(const t of this.threads){const card=this.cards.get(t.id);if(!card)continue;const rect=t.anchor?anchorRange(this.blocks,this.passages,this.text,t.anchor)?.getClientRects()[0]:this.article.getBoundingClientRect();const desired=rect?rect.top-base-6:0;items.push({id:t.id,desired:Math.max(0,desired),sourceY:rect?desired:NaN,height:card.offsetHeight||64,created:t.created});}
    for(const h of this.data.highlights.filter(h=>!h.removed&&h.note)){const card=this.cards.get(h.id);if(!card)continue;const rect=anchorRange(this.blocks,this.passages,this.text,h.anchor)?.getClientRects()[0];items.push({id:h.id,desired:Math.max(0,rect?rect.top-base-6:0),height:card.offsetHeight||48,created:h.created,note:true,sourceY:rect?rect.top-base-6:NaN});}
    const mini=compactMarginIds(items,this.activeThread||this.activeHighlight);for(const item of items){item.mini=mini.has(item.id);const card=this.cards.get(item.id)!;card.classList.toggle('is-mini',item.mini);item.height=card.offsetHeight||item.height;}
    if(this.pdf)for(const item of items)item.desired=Math.min(item.desired,Math.max(0,this.margin.clientHeight-item.height));
    items.sort((a,b)=>a.desired-b.desired||a.created-b.created);const positions=placeMarginItems(items,this.activeThread||this.activeHighlight);let bottom=0,moving=false;for(const item of items){const card=this.cards.get(item.id)!;const first=!card.dataset.placed;if(first)card.setCssStyles({transition:'none'});const transform=`translateY(${Math.round(positions[item.id])}px)`;if(!first&&card.style.transform!==transform)moving=true;card.style.transform=transform;card.dataset.placed='true';card.setCssStyles({visibility:'visible'});bottom=Math.max(bottom,positions[item.id]+item.height);if(first)requestAnimationFrame(()=>card.style.removeProperty('transition'));}
    this.margin.style.minHeight=Math.max(this.page.offsetHeight,bottom+100)+'px';const hint=this.margin.querySelector<HTMLElement>('.gloss-margin-hint');if(hint)hint.style.transform=`translateY(${Math.max(0,this.article.getBoundingClientRect().top-base)}px)`;this.updateAssociatedParagraphs();this.updateRail(true);this.updateLeader();if(moving)this.trackLeader();}
  private updateLeader(){
    if(!this.margin?.isConnected)return;
    if(!this.leader){this.leader=this.margin.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');this.leader.setAttribute('class','gloss-margin-leader');this.leader.setAttribute('aria-hidden','true');(this.pdf?this.root:this.margin).prepend(this.leader);}
    const svg=this.leader,id=this.activeThread||this.activeHighlight,card=id?this.cards.get(id):undefined;
    const anchor=this.activeThread?annotationAnchor(this.threads,id,this.referenceFocus):this.data.highlights.find(h=>h.id===id&&!h.removed)?.anchor;
    const source=anchor?(this.pdf?this.pdf.range(anchor):anchorRange(this.blocks,this.passages,this.text,anchor))?.getClientRects()[0]:undefined,margin=this.margin.getBoundingClientRect(),gap=margin.left-this.page.getBoundingClientRect().right;
    if(!card||!source||!this.margin.offsetWidth||gap<16){svg.replaceChildren();svg.removeAttribute('data-annotation-id');return;}
    const y0=source.top+source.height/2-margin.top,y1=card.getBoundingClientRect().top+17-margin.top,x0=8,x1=gap-1;if(this.pdf&&(y0<42||y0>margin.height||y1<0||y1>margin.height)){svg.replaceChildren();return;}
    svg.style.left=(this.pdf?margin.left-this.root.getBoundingClientRect().left-gap:-gap)+'px';svg.style.top=(this.pdf?margin.top-this.root.getBoundingClientRect().top:0)+'px';svg.setAttribute('width',String(gap));svg.setAttribute('height',String(Math.max(1,y0+4,y1+4)));svg.setAttribute('data-annotation-id',id!);
    let path=svg.querySelector('path'),dot=svg.querySelector('circle');if(!path){path=svg.ownerDocument.createElementNS(svg.namespaceURI,'path') as SVGPathElement;svg.append(path);}if(!dot){dot=svg.ownerDocument.createElementNS(svg.namespaceURI,'circle') as SVGCircleElement;dot.setAttribute('r','2.2');svg.append(dot);}
    path.setAttribute('d',`M ${x0} ${y0} C ${x0+gap*.5} ${y0}, ${x1-gap*.5} ${y1}, ${x1} ${y1}`);dot.setAttribute('cx',String(x0));dot.setAttribute('cy',String(y0));
  }
  private trackLeader(){cancelAnimationFrame(this.leaderFrame);const until=performance.now()+460,tick=()=>{if(!this.root?.isConnected)return;this.updateLeader();if(performance.now()<until)this.leaderFrame=requestAnimationFrame(tick);else this.leaderFrame=0;};this.leaderFrame=requestAnimationFrame(tick);}

  private currentPassage(){const box=(this.pdf?this.article:this.scroller).getBoundingClientRect(),y=box.top+Math.min(150,box.height*.25);let best=0,distance=Infinity;this.blocks.forEach((b,i)=>{const r=b.getBoundingClientRect(),d=r.bottom>=y?Math.abs(r.top-y):Infinity;if(d<distance){best=i;distance=d;}});return best;}
  private keyboardPassage?:number;
  private movePassage(step:number){if(!this.passages.length)return;const next=(this.keyboardPassage??this.currentPassage())+step;if(this.pdf&&(next<0||next>=this.passages.length)){const page=this.pdf.page+step;if(page>=1&&page<=this.pdf.total){this.keyboardPassage=undefined;void this.pdf.go(page).catch(showError);}return;}const i=Math.max(0,Math.min(this.passages.length-1,next));this.keyboardPassage=i;this.selected=undefined;this.blocks.forEach((b,n)=>b.classList.toggle('is-keyboard-passage',n===i));const p=this.passages[i];this.jump(this.makeReadingAnchor(p.start,p.end));}
  private moveAnnotation(step:number){const items=[...this.data.threads.filter(t=>!t.removed).map(t=>({id:t.id,anchor:t.anchor})),...this.data.highlights.filter(h=>!h.removed).map(h=>({id:h.id,anchor:h.anchor}))].sort((a,b)=>(a.anchor?.pdfPage||0)-(b.anchor?.pdfPage||0)||(a.anchor?.start||0)-(b.anchor?.start||0));if(!items.length)return;const at=items.findIndex(item=>item.id===(this.activeThread||this.activeHighlight)),index=at<0?(step>0?0:items.length-1):(at+step+items.length)%items.length;this.revealSaved(items[index].id);}
  private showKeys(){const modal=new Modal(this.app);modal.setTitle(ui("快捷键"));modal.modalEl.addClass('gloss-keys-modal');modal.contentEl.addClass('gloss-keys');const theme=this.root.dataset.theme;if(theme)modal.modalEl.dataset.theme=theme;const palette=getComputedStyle(this.root);for(const key of ['--bg-raised','--ink','--ink-3','--rule'])modal.modalEl.style.setProperty(key,palette.getPropertyValue(key));
    for(const [keys,description] of [[ui("选择文字后输入"),ui("询问选中文本")],['/',ui("新建文档问题")],['J  K',ui("下一段 / 上一段")],['Enter',ui("询问当前段落")],['[  ]',ui("上一条 / 下一条批注")],['B',ui("文章解读 · Markdown / EPUB")],['N',ui("笔记本")],['F',ui("进入 / 退出沉浸阅读")],['Esc',ui("关闭或返回")],['?',ui("快捷键列表")]]){const row=modal.contentEl.createDiv({cls:'gloss-key-row'}),key=row.createSpan();for(const k of keys.split('  '))key.createEl('kbd',{text:k});row.createSpan({text:description});}modal.open();}

  private scopeLabel(){return this.readingScope==='rag'?ui("整书检索"):this.readingScope==='page'?ui("当前页"):this.readingScope==='whole'?ui("全文"):this.selected?ui("选中文本及附近"):this.pdf?ui("当前页"):ui("全文");}
  private chooseReadingScope(){
    if(this.aborter||this.retrievalJob)return;const modal=new Modal(this.app);modal.setTitle(ui("问答范围"));modal.contentEl.addClass('gr-scope-modal');
    const choices:[typeof this.readingScope,string,string][]=[['selection',ui("选中文本及附近"),ui("只阅读选中文本和相邻段落")],...(this.pdf?[['page',ui("当前页"),ui("使用当前 PDF 页文字")] as [typeof this.readingScope,string,string]]:[['whole',ui("当前文档全文"),ui("使用全文，超过上下文上限时提示")] as [typeof this.readingScope,string,string]]),['rag',ui("整书检索"),ui("按问题查找本书原文，回答带来源")]];
    for(const [scope,label,desc]of choices){const b=button(modal.contentEl,'',()=>{this.readingScope=scope;this.activeThread=undefined;this.refreshSettings();modal.close();},'gr-scope-choice');b.createSpan({text:label});b.createSpan({text:desc});b.classList.toggle('is-selected',scope===this.readingScope);}
    bindUi(button(modal.contentEl,ui("管理本书索引"),()=>{modal.close();return this.showBookIndex();},'gr-settings-button'), {"text":()=>ui("管理本书索引")});modal.open();
  }
  private stamp(){const f=this.app.vault.getAbstractFileByPath(this.path);if(!(f instanceof TFile)||blockedPath(this.path))throw new Error('当前文档不可用于检索。');return{path:f.path,mtime:f.stat.mtime,size:f.stat.size};}
  private async indexSections(signal:AbortSignal,status:(text:()=>string)=>void):Promise<{sections:SourceSection[];skipped:number}>{
    const sections:SourceSection[]=[];let skipped=0;
    if(this.pdf){const doc=(this.pdfSource?.leaf.view as any)?.viewer?.child?.pdfViewer?.pdfViewer?.pdfDocument;if(!doc)throw new Error('PDF 尚未加载完成，请稍后再试。');if(doc.numPages>3000)throw new Error('本版索引最多支持 3,000 页。');let chars=0;for(let n=1;n<=doc.numPages;n++){if(signal.aborted)throw new Error('已停止');status(()=>ui("读取原文 · ")+n+' / '+doc.numPages+ui(" 页"));const page=await doc.getPage(n),content=await page.getTextContent(),texts=content.items.filter((i:any)=>typeof i.str==='string'&&i.str.trim()).map((i:any)=>i.str);const text=indexPassages(texts).text;chars+=text.length;if(chars>5_000_000)throw new Error('本书超过 500 万字符，请按章节处理。');if(text.trim())sections.push({text,label:"PDF 第 "+n+" 页",pdfPage:n});else skipped++;await new Promise(r=>setTimeout(r,0));}}
    else{let current:SourceSection|undefined;for(const p of this.passages){const label=p.source||ui("当前文档");if(!current||current.label!==label){current={text:p.text,label,offset:p.start};sections.push(current);}else current.text+='\n\n'+p.text;}}
    return{sections,skipped};
  }

  cancelIndex(){this.indexJob?.abort();}
  private paintIndexStatus(){
    if(!this.indexButton)return;if(this.indexStatusLabel)this.indexStatus=this.indexStatusLabel();
    const label=this.indexButton.querySelector<HTMLElement>('.gloss-index-label');if(label)label.textContent=this.indexJob?ui("索引中…"):this.indexReady?ui("已索引"):ui("索引");
    bindUi(this.indexButton,{title:()=>ui(this.indexStatus)||ui("本书检索索引")});this.indexButton.setAttribute('aria-busy',String(!!this.indexJob));
  }
  private updateIndexStatus(text:string|(()=>string)=this.indexStatusLabel||this.indexStatus){this.indexStatusLabel=typeof text==='function'?text:undefined;this.indexStatus=typeof text==='function'?text():text;this.paintIndexStatus();for(const refresh of this.indexListeners)refresh();}
  private async maybeAutoIndex(){
    if(!this.article?.isConnected||!this.path||!this.focus||this.plugin.unloading)return;const prefs=this.plugin.store.settings.embedding;if(!prefs.autoIndex){this.indexAttempt='';if(this.indexAutomatic)this.cancelIndex();}
    let connection:ReturnType<GlossPlugin['embeddingConnection']>;try{connection=this.plugin.embeddingConnection();}catch{this.indexReady=false;if(this.indexAutomatic)this.cancelIndex();this.updateIndexStatus(()=>ui("先选择嵌入模型"));return;}
    const identity=embeddingIdentity(connection.settings);if(this.indexJob){if(this.indexConnection!==identity)this.cancelIndex();return;}
    const stamp=this.stamp(),revision=this.revision,attempt=JSON.stringify([stamp,identity]);try{const cached=await this.plugin.indexCache.load(stamp.path);if(revision!==this.revision||!this.focus||this.plugin.unloading)return;const current=this.plugin.embeddingConnection();if(embeddingIdentity(current.settings)!==identity)return;this.indexReady=!!cached&&usableIndex(cached,stamp,current.settings);this.updateIndexStatus(()=>this.indexReady?ui("索引可用 · ")+cached!.chunks.length+ui(" 个片段"):ui("尚未建立或需要更新索引"));if(this.indexReady||!this.plugin.store.settings.embedding.autoIndex||this.indexAttempt===attempt||this.indexJob||this.aborter||this.retrievalJob)return;if(this.pdf&&!this.pdf.loaded)return;this.indexAttempt=attempt;await this.buildBookIndex(true);}catch(e){if(revision===this.revision){this.indexAttempt=attempt;this.updateIndexStatus((e as Error).message);if(!/已停止|已切换/.test((e as Error).message))new Notice(ui("自动索引未完成：")+(e as Error).message);}}
  }
  private async buildBookIndex(automatic=false){
    if(this.indexJob)throw new Error('本书索引正在建立。');const path=this.path,stamp=this.stamp(),connection=this.plugin.embeddingConnection(),settings={...connection.settings},controller=new AbortController();this.indexJob=controller;this.indexAutomatic=automatic;this.indexConnection=embeddingIdentity(settings);this.indexAttempt=JSON.stringify([stamp,this.indexConnection]);this.indexReady=false;this.updateIndexStatus(()=>ui("正在读取本书原文…"));
    try{const {sections,skipped}=await this.indexSections(controller.signal,t=>this.updateIndexStatus(t));if(path!==this.path)throw new Error('已切换文档，索引已停止。');this.updateIndexStatus(()=>ui("正在生成嵌入向量…"));const result=await createBookIndex(stamp,sections,settings,connection.key,controller.signal,(done,total)=>this.updateIndexStatus(()=>ui("建立索引 · ")+done+' / '+total),skipped);if(controller.signal.aborted)throw new Error('已停止');const current=this.stamp(),selected=this.plugin.embeddingConnection();if(current.path!==path||current.mtime!==stamp.mtime||current.size!==stamp.size||embeddingIdentity(selected.settings)!==embeddingIdentity(settings))throw new Error('文档或模型配置已变化，请重新建立索引。');await this.plugin.indexCache.save(result);this.indexReady=true;this.updateIndexStatus(()=>ui("索引可用 · ")+result.chunks.length+ui(" 个片段"));return result;}catch(e){if(path===this.path)this.updateIndexStatus((e as Error).message);throw e;}finally{if(this.indexJob===controller){this.indexJob=undefined;this.indexAutomatic=false;this.updateIndexStatus();try{if(this.path!==path||embeddingIdentity(this.plugin.embeddingConnection().settings)!==embeddingIdentity(settings))void this.maybeAutoIndex();}catch{}}}
  }
  async showBookIndex(){
    const path=this.path,stamp=this.stamp(),modal=new Modal(this.app);modal.setTitle(ui("本书检索"));modal.contentEl.addClass('gr-index-modal');modal.contentEl.createDiv({cls:'gr-index-title',text:path.split('/').pop()||''});const status=modal.contentEl.createDiv({cls:'gr-index-status',attr:{role:'status'}}),detail=modal.contentEl.createDiv({cls:'gr-settings-description'}),note=modal.contentEl.createDiv({cls:'gr-index-notice'}),actions=modal.contentEl.createDiv({cls:'gr-settings-footer'});let index:BookIndex|null=null,initiatedHere=false,buildError='';try{index=await this.plugin.indexCache.load(path);}catch(e){this.indexStatus=(e as Error).message;}
    const stop=bindUi(button(actions,ui("停止"),()=>this.cancelIndex(),'gr-settings-button'), {"text":()=>ui("停止")}),build=bindUi(button(actions,ui("建立索引"),async()=>{try{this.plugin.embeddingConnection();}catch{(this.app as any).setting.open();(this.app as any).setting.openTabById(this.plugin.manifest.id);return;}initiatedHere=true;buildError='';try{index=await this.buildBookIndex()||null;}catch(e){buildError=(e as Error).message;}finally{initiatedHere=false;draw();}},'gr-settings-button is-primary'), {"text":()=>ui("建立索引")}),remove=bindUi(button(actions,ui("清除本书索引"),async()=>{await this.plugin.indexCache.remove(path);index=null;this.indexReady=false;this.updateIndexStatus(()=>ui("本书索引已清除"));draw();},'gr-settings-button'), {"text":()=>ui("清除本书索引")});
    const draw=()=>{const busy=!!this.indexJob;let connection:ReturnType<GlossPlugin['embeddingConnection']>|undefined;try{connection=this.plugin.embeddingConnection();}catch{}stop.hidden=!busy;build.disabled=busy;remove.disabled=busy||!index;build.textContent=!connection?ui("选择嵌入模型"):index?ui("重新建立索引"):ui("建立索引");status.textContent=busy?this.indexStatus:buildError?buildError:index&&connection?(usableIndex(index,stamp,connection.settings)?ui("索引可用 · ")+index.chunks.length+ui(" 个片段"):ui("索引已过期，请重新建立")):this.indexStatus||ui("尚未建立索引");detail.textContent=index?'Embedding · '+index.model+(index.inputTokens!==undefined?' · '+index.inputTokens.toLocaleString()+' tokens':'')+(index.skippedPages?' · '+index.skippedPages+ui(" 页没有文字，未索引"):''):ui("仅处理当前书籍，索引保存在本地。");note.textContent=connection?ui("本书文字将发送至 ")+connection.service.name+ui("，使用 ")+connection.settings.model+'。':ui("在模型服务中添加并标记嵌入模型，在下方嵌入选择。");};
    bindUi(button(actions,ui("整书提问"),()=>{this.readingScope='rag';this.selected=undefined;modal.close();this.toggleComposer(true);},'gr-settings-button'), {"text":()=>ui("整书提问")});
    let updating=false;const refresh=()=>{draw();if(!this.indexJob&&!updating){updating=true;void this.plugin.indexCache.load(path).then(value=>{index=value;draw();}).catch(()=>{}).finally(()=>updating=false);}};this.indexListeners.add(refresh);const priorClose=modal.onClose.bind(modal);modal.onClose=()=>{this.indexListeners.delete(refresh);if(initiatedHere)this.cancelIndex();priorClose();};draw();modal.open();
  }
  private syncComposerBusy(){if(this.sendButton)this.sendButton.disabled=!!this.aborter||!!this.retrievalJob;if(this.composer)this.composer.disabled=false;}
  private setAnswerStage(text:string){this.answerStage=text;this.margin?.querySelectorAll<HTMLElement>('.gloss-answer-stage').forEach(el=>el.textContent=text);}
  private async prepareQuestionContext(question:string,target:Thread|undefined,forceWhole:boolean,regenerate:boolean,anchor?:Anchor,scope=this.readingScope):Promise<{context:string;citations:Record<string,Anchor>;info?:ContextInfo}>{
    const legacyPage=!!this.pdf&&target?.selection===false&&target.contextInfo?.label.startsWith(ui("当前页"));
    if(regenerate&&target?.context&&!legacyPage)return{context:target.context,citations:target.citations||{},info:target.contextInfo};
    const selected=forceWhole?undefined:anchor;
    const rag=!selected&&(scope==='rag'||this.indexReady);
    if(rag){const stamp=this.stamp(),connection=this.plugin.embeddingConnection(),settings={...connection.settings};const index=await this.plugin.indexCache.load(this.path);if(!index||!usableIndex(index,stamp,settings))throw new Error('本书索引尚未就绪或已过期，请重新建立索引。');
      const controller=this.aborter||new AbortController();this.retrievalJob=controller;this.setAnswerStage(ui("正在检索全书…"));this.syncComposerBusy();
      try{const result=await embedTexts(settings,connection.key,[question.slice(0,3500)],controller.signal);if(controller.signal.aborted)throw new Error('已停止');if(!usableIndex(index,this.stamp(),this.plugin.embeddingConnection().settings))throw new Error('检索期间文档或模型已变化，请重试。');const hits=retrieve(index,question,result.vectors[0],settings.topK),bundle=retrievalContext(hits,Math.min(this.plugin.store.settings.maxContext,16000)-160);return{...bundle,info:{label:"整书检索 · "+bundle.sources.length+" 处原文"+(index.skippedPages?" · 有 "+index.skippedPages+" 页未索引":''),embeddingModel:index.model,inputTokens:result.inputTokens,sources:bundle.sources}};}finally{if(this.retrievalJob===controller)this.retrievalJob=undefined;this.syncComposerBusy();}
    }
    if(!selected){
      if(this.pdf){const controller=this.aborter||new AbortController(),stamp=JSON.stringify(this.stamp());this.setAnswerStage(ui("正在读取全书文字…"));let book=this.wholeBookCache;if(!book||book.stamp!==stamp){const result=await this.indexSections(controller.signal,text=>this.setAnswerStage(text()));if(controller.signal.aborted)throw new Error('已停止');book={stamp,...result};this.wholeBookCache=book;}if(controller.signal.aborted)throw new Error('已停止');const result=wholeDocumentContext(book.sections,question,Math.max(1000,this.plugin.store.settings.maxContext-(this.plugin.store.settings.webSearch?8000:1000)));if(book.skipped)result.info.label+=' · '+book.skipped+ui(" 页无文字");return result;}
      try{const context=contextFor(this.passages,undefined,this.text,true,this.plugin.store.settings.maxContext-(this.plugin.store.settings.webSearch?8000:1000)),citations:Record<string,Anchor>={};for(const p of this.passages)citations[String(p.number)]=this.makeReadingAnchor(p.start,p.end);return{context:'本轮针对整篇文档提问，没有选中文本。\n\n'+context,citations,info:{label:"整篇文档 · 全文",sources:[]}};}catch(e){if(!String(e).includes('超过'))throw e;const book=await this.indexSections(this.aborter!.signal,()=>{});return wholeDocumentContext(book.sections,question,Math.max(1000,this.plugin.store.settings.maxContext-(this.plugin.store.settings.webSearch?8000:1000)));}
    }
    const context=contextFor(this.passages,selected,this.text,false,this.plugin.store.settings.maxContext),citations:Record<string,Anchor>={};for(const p of this.passages)if(context.includes(`[¶${p.number}] `))citations[String(p.number)]=this.makeReadingAnchor(p.start,p.end);return{context,citations,info:{label:"选中文本及附近"+(this.pdf?" · PDF 第 "+selected.pdfPage+" 页":''),sources:[]}};
  }

  private resizeMobileInput(input:HTMLTextAreaElement){const win=input.ownerDocument.defaultView,limit=Math.max(44,Math.min(132,(win?.visualViewport?.height||win?.innerHeight||660)*.2));input.setCssStyles({height:'44px'});input.setCssStyles({height:Math.max(44,Math.min(limit,input.scrollHeight))+'px'});}
  private resizeQuestion(){if(!this.composer)return;if(Platform?.isMobile)this.resizeMobileInput(this.composer);else this.composer.setCssStyles({height:'36px'});}
  private paintWebButton(){if(!this.webButton)return;const enabled=this.plugin.store.settings.webSearch;bindUi(this.webButton, {"aria-label":()=>ui("网络搜索")});this.webButton.setAttribute('aria-pressed',String(enabled));this.webButton.classList.toggle('is-active',enabled);this.webButton.disabled=!!this.aborter||!!this.retrievalJob;this.webButton.title=enabled?ui("已启用 · 向 DuckDuckGo 发送检索关键词"):ui("启用网络搜索");}
  private cancelSuggestions(){this.suggestionJob?.abort();this.suggestionJob=undefined;if(this.suggestionHost)this.suggestionHost.hidden=true;}
  private syncSuggestionVisibility(){if(this.suggestionHost)this.suggestionHost.hidden=!this.plugin.store.settings.questionSuggestions||this.composerWrap.hidden||!!this.composer.value.trim()||!!this.aborter||!!this.retrievalJob||!this.suggestionHost.childElementCount;}
  private async generateSuggestions(force=false){
    if(!this.plugin.store.settings.questionSuggestions||this.composerWrap.hidden||this.composer.value.trim()||this.aborter||this.retrievalJob||!this.focus||blockedPath(this.path))return;let settings:Settings;try{settings=this.modelSettings();}catch{return;}const source=(this.selected?.quote||this.text).slice(0,4500),last=this.threads.find(t=>t.id===this.activeThread)?.messages.filter(m=>m.role==='assistant').at(-1)?.content.slice(0,1200)||'';if(!source.trim())return;const key=briefHash(JSON.stringify([this.path,this.pdf?.page,source,last,settings.serviceId,modelId(settings)]));if(this.suggestionJob&&this.suggestionKey===key&&!force)return;this.cancelSuggestions();this.suggestionKey=key;const host=this.suggestionHost!;
    const draw=(questions:string[])=>{host.empty();const head=host.createDiv({cls:'gloss-suggestion-heading'});bindUi(head.createSpan({text:ui("可以这样问")}), {"text":()=>ui("可以这样问")});bindUi(this.iconButton(head,'refresh-cw',ui("换一组问题"),()=>this.generateSuggestions(true)), {"label":()=>ui("换一组问题")});for(const q of questions)button(host,q,()=>{this.composer.value=q;this.rememberDraft();this.resizeQuestion();this.syncSuggestionVisibility();this.focusInput(this.composer);},'gloss-suggestion-chip');this.syncSuggestionVisibility();};const cached=this.suggestionCache.get(key);if(cached&&!force){draw(cached);return;}const controller=this.suggestionJob=new AbortController(),revision=this.revision;host.empty();bindUi(host.createDiv({cls:'gloss-suggestion-loading',text:ui("正在想几个问题…"),attr:{role:'status'}}), {"text":()=>ui("正在想几个问题…")});this.syncSuggestionVisibility();
    try{const answer=await askAgent({settings:{...settings,systemPrompt:QUESTION_SUGGESTION_PROMPT},context:source+(last?'\n已讨论的回答：\n'+last:''),messages:[{role:'user',content:QUESTION_SUGGESTION_PROMPT}],signal:controller.signal,onText:()=>{}});if(controller.signal.aborted||revision!==this.revision||this.suggestionKey!==key)return;const questions=parseQuestionSuggestions(answer);this.suggestionCache.set(key,questions);if(this.suggestionCache.size>24)this.suggestionCache.delete(this.suggestionCache.keys().next().value!);draw(questions);}catch(e){if(controller.signal.aborted||revision!==this.revision)return;host.empty();const retry=bindUi(button(host,ui("问题建议暂不可用 · 点击重试"),()=>this.generateSuggestions(true),'gloss-suggestion-chip'), {"text":()=>ui("问题建议暂不可用 · 点击重试")});retry.title=(e as Error).message;this.syncSuggestionVisibility();}finally{if(this.suggestionJob===controller)this.suggestionJob=undefined;}
  }
  private async searchForAnswer(question:string,settings:Settings,anchor?:Anchor):Promise<WebReceipt>{
    this.webError='';const controller=this.retrievalJob=this.aborter||new AbortController();this.paintWebButton();this.syncComposerBusy();this.setAnswerStage(ui("正在搜索网络…"));
    try{const quote=anchor?.quote.slice(0,240)||'',file=this.app.vault.getAbstractFileByPath(this.path),fm=file instanceof TFile?this.app.metadataCache.getFileCache(file)?.frontmatter:undefined;this.setAnswerStage(ui("正在整理搜索问题…"));const planned=await askAgent({settings:{...settings,systemPrompt:SEARCH_QUERY_PROMPT},context:JSON.stringify({title:this.page.querySelector('.gloss-document-title')?.textContent||this.path.split('/').pop(),author:fm?.author||'',selection:quote}),messages:[{role:'user',content:question}],signal:controller.signal,onText:()=>{}}),query=parseSearchQuery(planned);this.setAnswerStage(ui("正在搜索网络…"));return await networkSearch(query,controller.signal,async url=>{const result=await requestUrl({url,method:'GET',headers:{'User-Agent':'Mozilla/5.0',Accept:'text/html'},throw:false});if(result.status<200||result.status>=300)throw new Error('网络请求失败。');return result.text;});}catch(e){this.webError=(e as Error).message;throw e;}finally{if(this.retrievalJob===controller){this.retrievalJob=undefined;this.syncComposerBusy();this.paintWebButton();this.updateContext();}}
  }
  private async translateSelection(regenerate?:Thread){
    if(this.aborter||this.retrievalJob)return;const anchor=regenerate?.anchor||this.selected;if(!anchor||!anchor.quote.trim())throw new Error('请先选择需要翻译的文字。');if(blockedPath(this.path)||!(this.app.vault.getAbstractFileByPath(this.path)instanceof TFile))throw new Error('当前文档不能用于翻译。');const path=this.path,data=this.data,controller=new AbortController(),prior=regenerate?.messages;
    const target=regenerate?.translationTarget||this.plugin.store.settings.translationTarget;const thread:Thread=regenerate||{id:uid(),commandId:'translate',label:"翻译",anchor:{...anchor},selection:true,created:Date.now(),messages:[{role:'user' as const,content:'翻译这段选中文本'}],context:anchor.quote,citations:{}};if(!regenerate)data.threads.push(thread);const response:Message={role:'assistant',content:'',provider:'Google Translate',model:'Google Translate'};beginThreadRequest(thread,!!regenerate);delete thread.interrupted;thread.messages=[...(regenerate?regenerationHistory(thread):thread.messages),response];delete thread.error;this.activeThread=thread.id;this.selected=undefined;this.aborter=controller;this.runningThread=thread.id;this.closeLens();this.composer.value='';data.draft='';this.toggleComposer(true);this.syncComposerBusy();this.paintHighlights();this.updateContext();
    try{await this.plugin.persist();await this.renderMargin();const result=await googleTranslate(anchor.quote,target,controller.signal,async(url,signal)=>{if(signal.aborted)throw new Error('已停止');const res=await requestUrl({url,method:'GET',throw:false});if([429,503].includes(res.status))throw new Error('谷歌翻译请求过于频繁，请稍后重试。');if(res.status<200||res.status>=300)throw new Error('谷歌翻译连接失败。');return res.json;});response.content=result.text;response.model='Google Translate · '+TRANSLATION_LANGUAGES[result.target];thread.translationTarget=result.target;}catch(e){if(controller.signal.aborted){thread.interrupted=true;delete thread.error;}else thread.error=(e as Error).message;if(prior){thread.messages=prior;if(thread.error)thread.error+="（已保留原译文）";}else if(!response.content)thread.messages.pop();}finally{settleThreadRequest(thread);data.updated=Date.now();try{await this.plugin.persist();}catch(e){showError(e);}if(this.aborter===controller){this.aborter=undefined;this.runningThread=undefined;this.paintWebButton();if(this.path===path&&this.root.isConnected){this.syncComposerBusy();this.refreshModelButtons();await this.renderMargin();}}}
  }
  async send(override?:string,forceWhole=false,task='default',regenerate?:Thread,followup?:Thread){
    this.closeModelMenu();if(this.aborter||this.retrievalJob)return;
    const question=(regenerate?regenerationHistory(regenerate).at(-1)!.content:override??this.composer.value).trim();if(!question){this.toggleComposer(true);return;}
    if(followup?.removed)throw new Error('这条问答已删除。');if(blockedPath(this.path))throw new Error('此文档不能发送给模型。');if(!(this.app.vault.getAbstractFileByPath(this.path)instanceof TFile))throw new Error('原文已移除。');
    const path=this.path,data=this.data,settings=regenerate||followup?this.regenerationSettings((regenerate||followup)!):this.modelSettings(task),legacyPage=!!this.pdf&&regenerate?.selection===false&&regenerate.contextInfo?.label.startsWith(ui("当前页")),submittedAnchor=followup?(followup.selection===false?undefined:followup.anchor):forceWhole||legacyPage?undefined:regenerate?(regenerate.selection===false?undefined:regenerate.anchor):this.selected?{...this.selected}:undefined,scope=this.readingScope;
    const thread:Thread=regenerate||followup||{id:uid(),commandId:task,label:task==='summary'?"总结":settings.commands.find(c=>c.id===task)?.name||"提问",anchor:submittedAnchor,selection:!!submittedAnchor,messages:[{role:'user',content:question}],created:Date.now()};
    const previous=regenerate?thread.messages:undefined,previousState=regenerate?{context:thread.context,citations:thread.citations,contextInfo:thread.contextInfo,anchor:thread.anchor,selection:thread.selection}:undefined,previousWeb=(previous||followup?.messages)?.filter(m=>m.role==='assistant').at(-1)?.web,history=regenerate?regenerationHistory(thread):followup?followupHistory(thread,question):thread.messages.map(m=>({...m})),response:Message={role:'assistant',content:'',provider:settings.serviceName||settings.provider,model:modelId(settings),serviceId:settings.serviceId};
    if(!regenerate&&!followup)data.threads.push(thread);beginThreadRequest(thread,!!regenerate);thread.messages=[...history,response];delete thread.error;delete thread.interrupted;if(followup)thread.followupDraft='';this.activeThread=thread.id;this.activeHighlight=undefined;
    const controller=new AbortController();this.aborter=controller;this.runningThread=thread.id;this.setAnswerStage(ui("正在准备原文…"));this.cancelSuggestions();this.webError='';
    if(!regenerate&&!followup){this.referenceFocus=undefined;this.hoverThread=undefined;data.draft='';this.composer.value='';this.selected=undefined;this.article.ownerDocument.getSelection()?.removeAllRanges();this.closeLens();}
    this.composerWrap.hidden=false;this.questionButton.setAttribute('aria-expanded','true');this.questionButton.toggleClass('is-active',true);this.syncComposerBusy();this.refreshModelButtons();this.paintWebButton();this.paintHighlights();this.updateContext();if(this.narrow)this.toggleNotebook(true);
    try{
      await this.plugin.persist();await this.renderMargin();
      const bundle=followup?.context?{context:followup.context,citations:followup.citations||{},info:followup.contextInfo}:task==='translate'&&submittedAnchor&&!regenerate?{context:'仅翻译以下选中文本：\n'+submittedAnchor.quote,citations:{} as Record<string,Anchor>,info:{label:'选中文本翻译',sources:[]}}:await this.prepareQuestionContext(question,regenerate,forceWhole,!!regenerate,submittedAnchor,scope);
      if(controller.signal.aborted||path!==this.path)throw new Error('已停止');let context=bundle.context;let web=previousWeb;
      if(!regenerate&&!followup&&task!=='translate'&&settings.webSearch){web=await this.searchForAnswer(question,settings,submittedAnchor);if(controller.signal.aborted||path!==this.path)throw new Error('已停止');context+=webContext(web);}
      if(context.length+history.reduce((n,m)=>n+m.content.length,0)>settings.maxContext)throw new Error('本轮原文与对话超过上下文上限，请新建问题或提高上限。');if(web)settings.systemPrompt=webSystemPrompt(settings.systemPrompt||SYSTEM);
      response.web=web;thread.context=context;thread.citations=bundle.citations;thread.contextInfo=bundle.info;if(legacyPage){delete thread.anchor;thread.selection=false;}
      this.setAnswerStage(ui("正在回答…"));await this.renderMargin();
      response.content=await askAgent({settings,context,quote:submittedAnchor?.quote,messages:history,signal:controller.signal,onUsage:usage=>{response.usage=usage;},onText:text=>{response.content=text;if(this.path!==path||this.aborter!==controller)return;clearTimeout(this.renderTimer);this.renderTimer=setTimeout(()=>void this.renderMargin().catch(showError),100);}});
    }catch(e){if(controller.signal.aborted){thread.interrupted=true;delete thread.error;}else thread.error=e instanceof Error?e.message:ui("回答失败，请重试。");if(previous){thread.messages=previous;Object.assign(thread,previousState);if(thread.error)thread.error+="（已保留原回答）";}else if(!response.content)thread.messages.pop();}
    finally{settleThreadRequest(thread);clearTimeout(this.renderTimer);data.updated=Date.now();if(this.aborter===controller){this.aborter=undefined;this.runningThread=undefined;this.answerStage='';}try{await this.plugin.persist();}catch(e){showError(e);}if(this.path===path&&this.root.isConnected){this.syncComposerBusy();this.refreshModelButtons();this.paintWebButton();this.fresh=undefined;this.renderBrief();this.paintHighlights();await this.renderMargin();if(task!=='translate'&&!thread.error&&!this.composerWrap.hidden)void this.generateSuggestions();}}
  }
  stop(){this.cancelSuggestions();this.retrievalJob?.abort();this.aborter?.abort();}
  private async exportNotes(){const data=this.data;if(!data.highlights.some(h=>!h.removed)&&!data.threads.some(t=>!t.removed)){new Notice(ui("先留下一条划线、批注或对话。"));return;}const folder='收集箱';if(!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);const title=this.path.split('/').pop()!.replace(/\.md$/,'').replace(/[\\/:*?"<>|\[\]#^]/g,'-'),stamp=new Date().toISOString().replace(/[:.]/g,'-');let path=normalizePath(`${folder}/${title}-阅读笔记-${stamp}.md`);if(this.app.vault.getAbstractFileByPath(path))path=normalizePath(`${folder}/${title}-阅读笔记-${stamp}-${uid().slice(0,6)}.md`);await this.app.vault.create(path,exportReading(this.path,data,this.app.vault.getName()));new Notice(ui("阅读笔记已保存到 ")+path);}
  async onClose(){clearTimeout(this.selectionTimer);this.indexJob?.abort();this.retrievalJob?.abort();this.importAborter?.abort();this.pdf?.destroy();this.releasePdfSource();this.bookUrls.forEach(url=>URL.revokeObjectURL(url));this.releaseChrome();this.notebookRender?.unload();this.revision++;this.stop();this.resizeObserver?.disconnect();this.marginObserver?.disconnect();cancelAnimationFrame(this.frame);cancelAnimationFrame(this.leaderFrame);clearTimeout(this.progressTimer);clearTimeout(this.draftTimer);clearTimeout(this.renderTimer);clearTimeout(this.reloadTimer);this.closeModelMenu();this.clearSelectionPreview();this.clearReferencePreview();clearTimeout(this.railTimer);this.root?.remove();await this.flushDraft();}
}

type ModelChoice=ReturnType<typeof serviceChoices>[number];
class ModelAssignmentPicker extends FuzzySuggestModal<ModelChoice|null>{
  constructor(app:App,private setup:ModelSetup,private inherit:boolean,private pick:(ref:ModelRef|null)=>Promise<void>,private current?:ModelRef|null,private modelType:ModelType='chat'){super(app);this.setPlaceholder(modelType==='embedding'?ui("选择已添加的嵌入模型…"):ui("搜索服务或模型…"));}
  getItems(){return this.inherit?[null,...availableChoices(this.setup,this.modelType)]:availableChoices(this.setup,this.modelType);}
  getItemText(item:ModelChoice|null){return item?item.name+' '+item.serviceName+' '+item.id:ui("默认");}
  renderSuggestion(result:any,el:HTMLElement){const item=result.item as ModelChoice|null;el.addClass('gr-model-suggestion');const copy=el.createDiv();bindUi(copy.createDiv({cls:'gr-model-name',text:item?.name||ui("默认")}), {"text":()=>item?.name||ui("默认")});bindUi(copy.createDiv({cls:'gr-model-id',text:item?item.serviceName+' · '+item.id:ui("使用默认问答中指定的服务与模型")}), {"text":()=>item?item.serviceName+' · '+item.id:ui("使用默认问答中指定的服务与模型")});if(item?this.current?.serviceId===item.serviceId&&this.current.modelId===item.id:!this.current)setIcon(el.createSpan({cls:'gr-model-suggestion-check'}),'check');}
  onChooseItem(item:ModelChoice|null){void this.pick(item?{serviceId:item.serviceId,modelId:item.id}:null).catch(showError);}
}

class GlossSettings extends PluginSettingTab {
  private heading(parent:HTMLElement,text:string,cls?:string){const heading=new Setting(parent).setName(text).setHeading();heading.settingEl.addClass('gr-native-heading');if(cls)heading.settingEl.addClass(cls);return heading.nameEl;}
  tab='reading';
  private test?:AbortController;
  constructor(app:App,private plugin:GlossPlugin){super(app,plugin);}
  hide(){this.test?.abort();this.test=undefined;}
  private async save(){await this.plugin.persist();for(const l of this.app.workspace.getLeavesOfType(VIEW))if(l.view instanceof GlossView)l.view.refreshSettings();}
  display(){
    this.test?.abort();this.test=undefined;
    const el=this.containerEl;el.empty();el.addClass('gr-settings');const s=this.plugin.store.settings;
    const head=el.createDiv({cls:'gr-settings-head'}),identity=head.createDiv({cls:'gr-settings-identity'});
    identity.createSpan({cls:'gr-settings-name',text:'Banana Reader'});identity.createSpan({cls:'gr-settings-version',text:'v'+this.plugin.manifest.version});
    const tabs=bindUi(head.createDiv({cls:'gr-settings-tabs',attr:{role:'tablist','aria-label':ui("Banana Reader 设置")}}), {"aria-label":()=>ui("Banana Reader 设置")});
    for(const[key,label,icon]of [['reading',ui("外观配置"),'book-open'],['models',ui("模型服务"),'plug'],['commands',ui("指令配置"),'wand-sparkles'],['sources',ui("书籍来源"),'library']]){
      const b=button(tabs,'',()=>{this.tab=key;this.display();},'gr-settings-tab');const mark=b.createSpan();setIcon(mark,icon);b.createSpan({text:label});b.classList.toggle('is-active',this.tab===key);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(this.tab===key));b.id='gr-tab-'+key;b.setAttribute('aria-controls','gr-settings-panel');
    }
    const body=el.createDiv({cls:'gr-settings-body',attr:{id:'gr-settings-panel',role:'tabpanel','aria-labelledby':'gr-tab-'+this.tab}});
    let group=body;const section=(title:string)=>{const card=body.createEl('section',{cls:'gr-settings-group'});this.heading(card,title,'gr-settings-section');group=card.createDiv({cls:'gr-settings-group-body'});return group;};
    const row=(label:string,description='')=>{const r=group.createDiv({cls:'gr-settings-row'}),info=r.createDiv({cls:'gr-settings-info'});info.createDiv({cls:'gr-settings-label',text:label});if(description)info.createDiv({cls:'gr-settings-description',text:description});return r.createDiv({cls:'gr-settings-controls'});};
    const select=(label:string,description:string,value:string,options:Record<string,string>,change:(v:string)=>void)=>{const d=row(label,description).createEl('select',{cls:'gr-settings-input',attr:{'aria-label':label}});for(const[k,t]of Object.entries(options))d.createEl('option',{value:k,text:t});d.value=value;d.onchange=()=>{change(d.value);void this.save().catch(showError);};};
    const input=(label:string,desc:string,value:string,placeholder:string,change:(v:string)=>void,type='text')=>{const t=row(label,desc).createEl('input',{cls:'gr-settings-input',attr:{'aria-label':label,type,placeholder}});t.value=value;t.autocomplete='off';t.spellcheck=false;t.onchange=()=>{change(t.value.trim());void this.save().catch(showError);};return t;};
    if(this.tab==='models'){
      this.renderModelsPage(body);this.renderIndexSettings(body);
    }else if(this.tab==='commands'){this.renderCommands(body);
    }else if(this.tab==='sources'){this.renderZlibSource(body);
    }else if(this.tab==='reading'){
      section(ui('界面语言'));
      const language=bindUi(row(ui('语言'),ui('设置页和已打开的阅读页立即切换，保留选区、草稿和正在进行的问答。不会更改提示词或翻译目标语言。')).createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui('界面语言')}}), {"aria-label":()=>ui('界面语言')});
      for(const [value,label]of [['auto',ui('跟随 Obsidian')],['zh-CN',ui('中文（简体）')],['en','English']])language.createEl('option',{value,text:label});language.value=s.language;
      language.onchange=()=>{language.disabled=true;void this.plugin.changeLanguage(language.value).then(()=>this.display()).catch(error=>{language.value=s.language;language.disabled=false;showError(error);});};
      const appearance=section(ui("默认阅读外观"));
      const preview=appearance.createDiv({cls:'gloss-root gr-reading-preview'});preview.dataset.theme=s.theme==='auto'?'paper':s.theme;preview.dataset.font=s.font;preview.style.setProperty('--reader-custom-font',s.customFont||'var(--font-serif)');bindUi(preview.createDiv({cls:'gr-preview-kicker',text:ui("READING / 阅读预览")}), {"text":()=>ui("READING / 阅读预览")});bindUi(preview.createEl('p',{text:ui("阅读时，让问题自然发生。")}), {"text":()=>ui("阅读时，让问题自然发生。")});bindUi(preview.createSpan({text:ui("选中一句话，留下你的理解。")}), {"text":()=>ui("选中一句话，留下你的理解。")});
      const papers=row(ui("默认背景")).createDiv({cls:'gr-paper-choices'});for(const [key,label]of [['auto',ui("跟随系统")],['paper',ui("纸张")],['sepia',ui("暖黄")],['snow',ui("雪白")],['night',ui("夜读")],['ink',ui("墨蓝")]]){const b=button(papers,label,async()=>{s.theme=key;await this.save();this.display();},'gr-paper-choice');b.dataset.theme=key;b.classList.toggle('is-active',s.theme===key);b.setAttribute('aria-pressed',String(s.theme===key));}
      select(ui("默认字体"),'',s.font,{serif:ui("Newsreader · 书籍衬线"),sans:ui("Schibsted · 清晰无衬线"),song:ui("宋体 · 中文长文"),kai:ui("楷体 · 中文阅读"),system:ui("系统字体"),custom:ui("自定义字体")},v=>{s.font=v;this.display();});
      if(s.font==='custom')input(ui("字体名称"),'',s.customFont,ui("例如：LXGW WenKai"),v=>{s.customFont=v;this.display();});
      select(ui("字号"),'',String(s.fontSize),Object.fromEntries(Array.from({length:14},(_,i)=>[String(i+15),(i+15)+' px'])),v=>s.fontSize=Number(v));
      select(ui("行距"),'',String(s.lineHeight),{'1.5':ui("紧凑 · 1.5"),'1.64':ui("标准 · 1.64"),'1.82':ui("宽松 · 1.82"),[String(s.lineHeight)]:String(s.lineHeight)},v=>s.lineHeight=Number(v));
      select(ui("正文宽度"),'',String(s.measure),{'28':ui("窄"),'32':ui("适中"),'37':ui("宽")},v=>s.measure=Number(v));
      select(ui("段落编号"),'',String(s.numbers),{false:ui("隐藏"),true:ui("显示")},v=>s.numbers=v==='true');
      section(ui("默认标记"));select(ui("标记样式"),'',s.markStyle,{highlight:ui("荧光笔"),underline:ui("直线"),wavy:ui("波浪线")},v=>s.markStyle=v as MarkStyle);
      select(ui("标记颜色"),'',s.marker,{yellow:ui("黄色"),green:ui("绿色"),blue:ui("蓝色"),pink:ui("粉色")},v=>s.marker=v);
      select(ui("问答批注笔色"),'',s.pen,{vermilion:ui("朱红"),cobalt:ui("钴蓝"),moss:ui("苔绿"),graphite:ui("石墨")},v=>s.pen=v);
      section(ui("问答"));new ToggleComponent(row(ui("问题建议"))).setTooltip(ui("问题建议")).setValue(s.questionSuggestions).onChange(async value=>{s.questionSuggestions=value;await this.save();});
      section(ui("问答范围"));select(ui("新问题默认范围"),'',s.context,{nearby:ui("选中文本及相邻段落"),whole:ui("当前文档全文")},v=>s.context=v);
      const limit=input(ui("上下文上限"),'',String(s.maxContext),'60000',()=>{} ,'number');limit.min='1000';limit.max='300000';limit.onchange=()=>{const n=Number(limit.value);if(Number.isInteger(n)&&n>=1000&&n<=300000){s.maxContext=n;void this.save().catch(showError);}else{limit.value=String(s.maxContext);new Notice(ui("请输入1,000–300,000之间的整数。"));}};
    }
  }
  private activeService?:string;
  private renderZlibSource(body:HTMLElement){
    const s=this.plugin.store.settings,section=body.createEl('section',{cls:'gr-settings-group'});bindUi(this.heading(section,ui("书籍来源 · Z-Library"),'gr-settings-section'), {"text":()=>ui("书籍来源 · Z-Library")});
    const group=section.createDiv({cls:'gr-settings-group-body'});
    const field=(label:string,description:string,value:string,placeholder:string,change:(value:string)=>void)=>{const r=group.createDiv({cls:'gr-settings-row'}),info=r.createDiv({cls:'gr-settings-info'});info.createDiv({cls:'gr-settings-label',text:label});info.createDiv({cls:'gr-settings-description',text:description});const t=r.createDiv({cls:'gr-settings-controls'}).createEl('input',{cls:'gr-settings-input',attr:{'aria-label':label,type:'text',placeholder}});t.value=value;t.autocomplete='off';t.spellcheck=false;t.onchange=()=>{change(t.value.trim());void this.save().catch(showError);};};
    const mirrorRow=group.createDiv({cls:'gr-settings-row'}),mirrorInfo=mirrorRow.createDiv({cls:'gr-settings-info'});
    bindUi(mirrorInfo.createDiv({cls:'gr-settings-label',text:ui("镜像列表")}), {"text":()=>ui("镜像列表")});
    bindUi(mirrorInfo.createDiv({cls:'gr-settings-description',text:ui("每行一个镜像地址（支持不带 https:// 的裸域名）；请求失败时自动按顺序切换，可用下方探测选最快镜像。")}), {"text":()=>ui("每行一个镜像地址（支持不带 https:// 的裸域名）；请求失败时自动按顺序切换，可用下方探测选最快镜像。")});
    const mirrors=mirrorRow.createDiv({cls:'gr-settings-controls'}).createEl('textarea',{cls:'gr-settings-input gr-zlib-mirrors',attr:{'aria-label':ui("镜像列表"),rows:'5',spellcheck:'false'}});
    mirrors.value=s.zlibMirrors.join('\n');
    mirrors.addEventListener('change',()=>{const list=parseMirrorList(mirrors.value);if(!list.length){new Notice(ui("至少保留一个有效的镜像地址。"));mirrors.value=s.zlibMirrors.join('\n');return;}s.zlibMirrors=list;void this.save().catch(showError);});
    const activeRow=group.createDiv({cls:'gr-settings-row'}),activeInfo=activeRow.createDiv({cls:'gr-settings-info'});
    bindUi(activeInfo.createDiv({cls:'gr-settings-label',text:ui("当前镜像")}), {"text":()=>ui("当前镜像")});
    const activeValue=bindUi(activeInfo.createDiv({cls:'gr-settings-description',text:s.zlibDomain}), {"text":()=>this.plugin.store.settings.zlibDomain});
    const probeStatus=group.createDiv({cls:'gr-settings-description gr-zlib-probe-status'});probeStatus.hidden=true;
    const probeControls=activeRow.createDiv({cls:'gr-settings-controls'}),probeButton=bindUi(button(probeControls,ui("探测镜像"),async()=>{
     probeButton.disabled=true;probeStatus.hidden=false;probeStatus.textContent=ui("正在探测…");
     const probes=await Promise.all(this.plugin.store.settings.zlibMirrors.map(domain=>probeMirror(domain,zlibRequest)));
     const best=probes.filter(item=>item.ok).sort((a,b)=>a.ms-b.ms)[0];
     if(best){this.plugin.store.settings.zlibDomain=best.domain;await this.save().catch(showError);this.display();return;}
     probeStatus.textContent=probes.map(item=>item.domain.replace(/^https:\/\//,'')+' · '+(item.ok?ui("可用")+' · '+item.ms+' ms':ui("失败")+(item.error?' · '+item.error:''))).join('\n');
     probeButton.disabled=false;
    },'gr-settings-button'), {"text":()=>ui("探测镜像")});
    field(ui("下载目录"),ui("下载的书籍保存到库内此文件夹；隐私目录仍不进入阅读器。"),s.zlibFolder,'收集箱',v=>{s.zlibFolder=v||'收集箱';});
    const credentialRow=group.createDiv({cls:'gr-settings-row'}),credentialInfo=credentialRow.createDiv({cls:'gr-settings-info'});
    bindUi(credentialInfo.createDiv({cls:'gr-settings-label',text:ui("Z-Library 登录")}), {"text":()=>ui("Z-Library 登录")});
    bindUi(credentialInfo.createDiv({cls:'gr-settings-description',text:ui("登录凭据保存在 Obsidian 密钥存储，不会写入插件数据文件。")}), {"text":()=>ui("登录凭据保存在 Obsidian 密钥存储，不会写入插件数据文件。")});
    const controls=credentialRow.createDiv({cls:'gr-settings-controls gr-zlib-credential'}),statusSpan=controls.createSpan({cls:'gr-zlib-credential-status',text:this.plugin.zlibCredentials().userId?ui("已登录"):ui("未登录")});
    bindUi(statusSpan, {"text":()=>this.plugin.zlibCredentials().userId?ui("已登录"):ui("未登录")});
    bindUi(button(controls,ui("账号登录"),()=>new ZLibraryModal(this.app,this.plugin).open(),'gr-settings-button'), {"text":()=>ui("账号登录")});
    bindUi(button(controls,ui("清除登录"),()=>{this.plugin.saveZlibCredentials({userId:'',userKey:''});statusSpan.textContent=ui("未登录");},'gr-settings-button'), {"text":()=>ui("清除登录")});
    bindUi(section.createDiv({cls:'gr-settings-description',text:ui("搜索词与下载请求会发送到你配置的 Z-Library 镜像站点；下载结果保存到上面的目录。请仅获取你有权获取的资源。")}), {"text":()=>ui("搜索词与下载请求会发送到你配置的 Z-Library 镜像站点；下载结果保存到上面的目录。请仅获取你有权获取的资源。")});
  }
  private renderModelsPage(body:HTMLElement){
    if(Platform?.isMobile)bindUi(body.createEl('p',{cls:'gr-settings-description',text:ui('手机端使用自定义 API；本机 CLI 仅桌面可用。回答完成后显示，停止会忽略尚未返回的结果。')}),{'text':()=>ui('手机端使用自定义 API；本机 CLI 仅桌面可用。回答完成后显示，停止会忽略尚未返回的结果。')});
    const s=this.plugin.store.settings,services=s.services.filter(service=>!Platform?.isMobile||service.kind==='api'),card=body.createEl('section',{cls:'gr-settings-group gr-services-group'}),head=card.createDiv({cls:'gr-page-title gr-settings-card-heading'});bindUi(this.heading(head,ui("模型服务")), {"text":()=>ui("模型服务")});body=card.createDiv({cls:'gr-settings-group-body'});const add=button(head,'',()=>this.editService(),'gr-settings-button is-primary');setIcon(add.createSpan(),'plus');bindUi(add.createSpan({text:ui("添加服务")}), {"text":()=>ui("添加服务")});
    if(Platform?.isMobile){const assignments=this.plugin.taskModels(),choices=availableChoices(s);const row=new Setting(body).setName(ui('手机问答模型')).setDesc(ui('仅用于手机版，不改变电脑上的模型分配。'));row.addDropdown(dropdown=>{dropdown.selectEl.setAttribute('aria-label',ui('手机问答模型'));dropdown.addOption('',ui('请选择 API 模型'));for(const choice of choices)dropdown.addOption(JSON.stringify([choice.serviceId,choice.id]),choice.serviceName+' · '+choice.name);const ref=assignments.default;dropdown.setValue(ref?JSON.stringify([ref.serviceId,ref.modelId]):'');dropdown.setDisabled(!choices.length);dropdown.onChange(value=>{if(value){const [serviceId,modelId]=JSON.parse(value);assignments.default={serviceId,modelId};}else delete assignments.default;void this.save().then(()=>this.display()).catch(showError);});});row.addButton(control=>{control.setButtonText(ui('测试连接')).setDisabled(!assignments.default);control.onClick(()=>{void(async()=>{this.test?.abort();const controller=this.test=new AbortController();control.setDisabled(true);try{const {service,model}=resolveModel(this.plugin.modelSetup());await askAgent({settings:serviceSettings(service,model.id,this.plugin.serviceKey(service.id)),context:'这是用户主动发起的连接测试，没有文档内容。',messages:[{role:'user',content:'请只回复 OK。'}],signal:controller.signal,onText:()=>{}});if(!controller.signal.aborted)new Notice(ui('问答模型连接成功'));}catch(error){if(!controller.signal.aborted)showError(error);}finally{control.setDisabled(!this.plugin.taskModels().default);if(this.test===controller)this.test=undefined;}})();});});}
    if(!services.length){const empty=body.createDiv({cls:'gr-service-empty'});setIcon(empty.createSpan(),'plug');bindUi(this.heading(empty,ui("添加你的第一个模型服务")), {"text":()=>ui("添加你的第一个模型服务")});bindUi(empty.createEl('p',{text:ui(Platform?.isMobile?'自定义 API':'Codex、Claude、Pi 或自定义 API')}), {"text":()=>ui(Platform?.isMobile?'自定义 API':'Codex、Claude、Pi 或自定义 API')});bindUi(button(empty,ui("添加服务"),()=>this.editService(),'gr-settings-button'), {"text":()=>ui("添加服务")});return;}
    if(!services.some(service=>service.id===this.activeService))this.activeService=services[0].id;
    const layout=body.createDiv({cls:'gr-service-workspace'}),nav=bindUi(layout.createDiv({cls:'gr-service-nav',attr:{role:'tablist','aria-label':ui("已添加服务")}}), {"aria-label":()=>ui("已添加服务")});
    for(const service of services){const b=button(nav,'',()=>{this.activeService=service.id;this.display();},'gr-service-nav-item');b.classList.toggle('is-active',service.id===this.activeService);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(service.id===this.activeService));bindUi(b, {"aria-label":()=>service.name+ui(" 服务")});setIcon(b.createSpan({cls:'gr-service-symbol'}),SERVICE_ICONS[service.kind]);const copy=b.createSpan({cls:'gr-service-nav-copy'});copy.createSpan({text:service.name});bindUi(copy.createSpan({cls:'gr-service-nav-meta',text:ui(SERVICE_NAMES[service.kind])+' · '+service.models.length+ui(" 模型")}), {"text":()=>ui(SERVICE_NAMES[service.kind])+' · '+service.models.length+ui(" 模型")});}
    const service=services.find(service=>service.id===this.activeService)!,panel=bindUi(layout.createDiv({cls:'gr-service-detail',attr:{role:'tabpanel','aria-label':service.name+ui(" 服务配置")}}), {"aria-label":()=>service.name+ui(" 服务配置")}),header=panel.createDiv({cls:'gr-service-detail-head'}),title=header.createDiv();this.heading(title,service.name);bindUi(title.createSpan({cls:'gr-service-kind',text:service.kind==='api'?({openai:ui("OpenAI 兼容"),responses:'Responses',anthropic:'Anthropic',gemini:'Gemini'}[service.protocol]):ui(SERVICE_NAMES[service.kind])+' CLI'}), {"text":()=>service.kind==='api'?({openai:ui("OpenAI 兼容"),responses:'Responses',anthropic:'Anthropic',gemini:'Gemini'}[service.protocol]):ui(SERVICE_NAMES[service.kind])+' CLI'});const actions=header.createDiv({cls:'gr-service-head-actions'});this.settingsIcon(actions,'settings-2',ui("编辑 ")+service.name,()=>this.editService(service));this.settingsIcon(actions,'trash-2',ui("删除 ")+service.name,()=>this.removeService(service));
    const connection=panel.createDiv({cls:'gr-service-connection'});setIcon(connection.createSpan(),service.kind==='api'?'link':'terminal');bindUi(connection.createSpan({text:service.kind==='api'?service.base:service.path||ui("自动查找本机 ")+SERVICE_NAMES[service.kind]}), {"text":()=>service.kind==='api'?service.base:service.path||ui("自动查找本机 ")+SERVICE_NAMES[service.kind]});
    const modelsHead=panel.createDiv({cls:'gr-service-model-head'});bindUi(modelsHead.createSpan({text:ui("已添加模型")}), {"text":()=>ui("已添加模型")});bindUi(button(modelsHead,ui("获取模型"),()=>this.manageServiceModels(service,true),'gr-settings-button'), {"text":()=>ui("获取模型")});
    const list=panel.createDiv({cls:'gr-service-models'});
    if(!service.models.length){const empty=list.createDiv({cls:'gr-service-model-empty'});bindUi(empty.createSpan({text:ui("还没有添加模型")}), {"text":()=>ui("还没有添加模型")});bindUi(button(empty,ui("获取并选择模型"),()=>this.manageServiceModels(service,true),'gr-settings-button gr-ghost'), {"text":()=>ui("获取并选择模型")});}
    for(const model of service.models){const row=list.createDiv({cls:'gr-saved-model'});setIcon(row.createSpan({cls:'gr-saved-model-icon'}),'box');const copy=row.createDiv({cls:'gr-saved-model-copy'});copy.createSpan({cls:'gr-model-name',text:model.name});bindUi(copy.createSpan({cls:'gr-model-id',text:model.id+' · '+(model.type==='embedding'?ui("嵌入"):ui("聊天"))}), {"text":()=>model.id+' · '+(model.type==='embedding'?ui("嵌入"):ui("聊天"))});const uses=Object.entries(this.plugin.taskModels()).filter(([key,ref])=>(key!=='translate'||s.translationEngine==='model')&&ref?.serviceId===service.id&&ref.modelId===model.id).map(([key])=>({default:ui("问答"),translate:ui("翻译"),summary:ui("总结"),embedding:ui("嵌入")}[key]||s.commands.find(c=>c.id===key)?.name||ui("指令")));if(uses.length)row.createSpan({cls:'gr-model-use-badge',text:uses.join(' · ')});this.settingsIcon(row,'pencil',ui("编辑模型 ")+model.name,()=>this.renameServiceModel(service,model));this.settingsIcon(row,'x',ui("移除 ")+model.name,async()=>{service.models=service.models.filter(m=>m.id!==model.id);pruneAssignments(s);await this.save();this.display();});}
    const footer=panel.createDiv({cls:'gr-service-model-footer'});bindUi(button(footer,ui("手动添加模型"),()=>this.manageServiceModels(service,false),'gr-settings-button gr-ghost'), {"text":()=>ui("手动添加模型")});
  }
  private renderIndexSettings(body:HTMLElement){
    const s=this.plugin.store.settings,e=s.embedding,section=body.createEl('section',{cls:'gr-settings-group gr-index-settings'});section.setCssStyles({marginTop:'28px'});bindUi(this.heading(section,ui("嵌入"),'gr-settings-section'), {"text":()=>ui("嵌入")});const group=section.createDiv({cls:'gr-settings-group-body'});
    const row=(label:string)=>{const r=group.createDiv({cls:'gr-settings-row'}),info=r.createDiv({cls:'gr-settings-info'});info.createDiv({cls:'gr-settings-label',text:label});return r.createDiv({cls:'gr-settings-controls'});};
    const model=bindUi(row(ui("索引模型")).createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("索引模型")}}), {"aria-label":()=>ui("索引模型")}),choices=availableChoices(s,'embedding');model.createEl('option',{value:'',text:''});for(const choice of choices)model.createEl('option',{value:JSON.stringify([choice.serviceId,choice.id]),text:choice.serviceName+' · '+choice.name});const ref=this.plugin.taskModels().embedding;model.value=ref?JSON.stringify([ref.serviceId,ref.modelId]):'';model.onchange=()=>{if(model.value){const [serviceId,modelId]=JSON.parse(model.value);this.plugin.taskModels().embedding={serviceId,modelId};}else delete this.plugin.taskModels().embedding;void this.save().then(()=>this.display()).catch(showError);};
    const auto=new ToggleComponent(row(ui("自动建立索引")));auto.setValue(e.autoIndex).onChange(value=>{e.autoIndex=value;void this.save().catch(showError);});bindUi(auto.toggleEl, {"aria-label":()=>ui("自动建立索引")});
    const top=bindUi(row(ui("参考片段")).createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("参考片段")}}), {"aria-label":()=>ui("参考片段")});for(const count of [4,6,8,12])bindUi(top.createEl('option',{value:String(count),text:count+ui(" 处")}), {"text":()=>count+ui(" 处")});top.value=String(e.topK);top.onchange=()=>{e.topK=Number(top.value);void this.save().catch(showError);};
    const test=bindUi(button(row(ui("连接")),ui("测试连接"),async()=>{test.disabled=true;const controller=this.test=new AbortController();try{const connection=this.plugin.embeddingConnection();await embedTexts(connection.settings,connection.key,['阅读检索连接测试'],controller.signal);if(!controller.signal.aborted)new Notice(ui("嵌入模型连接成功"));}finally{test.disabled=!this.plugin.taskModels().embedding;}},'gr-settings-button'), {"text":()=>ui("测试连接")});test.disabled=!choices.some(c=>c.serviceId===ref?.serviceId&&c.id===ref?.modelId);
    bindUi(section.createDiv({cls:'gr-settings-description',text:ui("自动索引仅处理当前沉浸阅读文档，文字会发送至所选服务。也可点击 PDF 或阅读顶部的索引按钮。")}), {"text":()=>ui("自动索引仅处理当前沉浸阅读文档，文字会发送至所选服务。也可点击 PDF 或阅读顶部的索引按钮。")});
  }
  private settingsIcon(parent:HTMLElement,icon:string,label:string,action:()=>void|Promise<void>){const b=button(parent,'',action,'gr-settings-icon');setIcon(b,icon);const id='reader-label-'+uid();b.createSpan({cls:'gloss-sr-only',text:label,attr:{id}});b.setAttribute('aria-labelledby',id);return b;}
  private editService(existing?:ModelService){
    const draft:ModelService=existing?{...existing,models:[...existing.models]}:newService(Platform?.isMobile?'api':'codex',uid()),modal=new Modal(this.app);modal.setTitle(existing?ui("编辑服务"):ui("添加模型服务"));modal.modalEl.addClass('gr-model-dialog','gr-service-dialog');modal.contentEl.addClass('gr-model-modal','gr-service-editor');
    const kinds=modal.contentEl.createDiv({cls:'gr-service-types'}),form=modal.contentEl.createDiv();let kind=draft.kind;const drafts=new Map<ServiceKind,{name:string;path:string;base:string;protocol:ApiProtocol;key:string}>();let collect:()=>void=()=>{};
    const draw=()=>{kinds.empty();form.empty();const values=drafts.get(kind)||{name:existing?.name||ui(SERVICE_NAMES[kind]),path:draft.path,base:kind==='api'?draft.base:'',protocol:draft.protocol,key:existing?this.plugin.serviceKey(existing.id):''};
      for(const value of (Platform?.isMobile?['api']:['codex','claude','pi','api'])as ServiceKind[]){const b=button(kinds,'',()=>{collect();kind=value;draw();},'gr-service-type');setIcon(b.createSpan(),SERVICE_ICONS[value]);bindUi(b.createSpan({text:ui(SERVICE_NAMES[value])}), {"text":()=>ui(SERVICE_NAMES[value])});b.classList.toggle('is-active',value===kind);b.setAttribute('aria-pressed',String(value===kind));b.disabled=!!existing||(Platform?.isMobile&&value!=='api');}
      const field=(label:string,value:string,placeholder='',type='text')=>{const row=form.createDiv({cls:'gr-connection-row'});row.createEl('label',{text:label});const input=row.createEl('input',{cls:'gr-settings-input',attr:{'aria-label':label,type,placeholder}});input.value=value;input.autocomplete='off';input.spellcheck=false;return input;};
      const name=field(ui("服务名称"),values.name,ui("例如：我的 ")+SERVICE_NAMES[kind]);name.maxLength=80;let path:HTMLInputElement|undefined,base:HTMLInputElement|undefined,key:HTMLInputElement|undefined,protocol:HTMLSelectElement|undefined;
      if(kind==='api'){const row=form.createDiv({cls:'gr-connection-row'});bindUi(row.createEl('label',{text:ui("接口协议")}), {"text":()=>ui("接口协议")});protocol=bindUi(row.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("接口协议")}}), {"aria-label":()=>ui("接口协议")});for(const [id,label]of Object.entries({openai:ui("OpenAI 兼容"),responses:'OpenAI Responses',anthropic:'Anthropic Messages',gemini:'Google Gemini'}))protocol.createEl('option',{value:id,text:label});protocol.value=values.protocol;base=field(ui("API 地址"),values.base||API_DEFAULTS[values.protocol],'https://…/v1');key=field('API Key',values.key,ui("保存在 Obsidian 密钥存储"),'password');let old=values.protocol;protocol.onchange=()=>{if(base!.value===API_DEFAULTS[old])base!.value=API_DEFAULTS[protocol!.value as ApiProtocol];old=protocol!.value as ApiProtocol;};}
      else path=field(ui("可执行文件路径"),values.path,ui("自动查找，无需填写"));
      if(Platform?.isMobile&&kind==='api')bindUi(form.createDiv({cls:'gr-settings-description',text:ui('API 地址需要手机可以访问；127.0.0.1 指手机自身。密钥需在本设备配置。')}),{text:()=>ui('API 地址需要手机可以访问；127.0.0.1 指手机自身。密钥需在本设备配置。')});
      collect=()=>{drafts.set(kind,{name:name.value.trim(),path:path?.value.trim()||'',base:base?.value.trim()||API_DEFAULTS.openai,protocol:(protocol?.value||'openai')as ApiProtocol,key:key?.value||''});};
    };draw();const error=modal.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'alert'}}),footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});const save=bindUi(button(footer,existing?ui("保存服务"):ui("添加并获取模型"),async()=>{collect();const values=drafts.get(kind)!;if(!values.name){error.textContent=ui("请输入服务名称");return;}if(kind==='api'){try{new URL(values.base);apiEndpoint(values.base,values.protocol,'test');}catch{error.textContent=ui("请输入有效的 API 基础地址");return;}}
      save.disabled=true;const service:ModelService={...draft,kind,name:values.name,path:values.path,base:values.base,protocol:values.protocol};try{if(kind==='api')this.plugin.saveServiceKey(service.id,values.key);const s=this.plugin.store.settings;if(existing)s.services=s.services.map(item=>item.id===existing.id?service:item);else s.services.push(service);pruneAssignments(s);this.activeService=service.id;await this.save();modal.close();this.display();if(!existing)this.manageServiceModels(service,true);}catch(e){error.textContent=ui(e instanceof Error?e.message:'保存失败');save.disabled=false;}},'gr-settings-button is-primary'), {"text":()=>existing?ui("保存服务"):ui("添加并获取模型")});modal.open();
  }
  private removeService(service:ModelService){const modal=new Modal(this.app);modal.setTitle(ui("删除“")+service.name+'”？');modal.modalEl.addClass('gr-model-dialog');modal.contentEl.addClass('gr-model-modal');const refs=[...Object.values(this.plugin.store.settings.taskModels),...Object.values(this.plugin.store.settings.mobileTaskModels||{})].filter(ref=>ref?.serviceId===service.id).length;bindUi(modal.contentEl.createEl('p',{text:ui("将移除该服务的 ")+service.models.length+ui(" 个模型")+(refs?ui("，并清除 ")+refs+ui(" 项模型分配"):'')+ui("。已有阅读对话会保留。")}), {"text":()=>ui("将移除该服务的 ")+service.models.length+ui(" 个模型")+(refs?ui("，并清除 ")+refs+ui(" 项模型分配"):'')+ui("。已有阅读对话会保留。")});const footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});bindUi(button(footer,ui("删除服务"),async()=>{const s=this.plugin.store.settings;s.services=s.services.filter(item=>item.id!==service.id);pruneAssignments(s);this.plugin.saveServiceKey(service.id,'');await this.save();modal.close();this.display();},'gr-settings-button is-danger'), {"text":()=>ui("删除服务")});modal.open();}
  private renameServiceModel(service:ModelService,model:ModelOption){const modal=new Modal(this.app);modal.setTitle(ui("编辑模型"));modal.modalEl.addClass('gr-model-dialog');modal.contentEl.addClass('gr-model-modal');bindUi(modal.contentEl.createEl('label',{text:ui("显示名称")}), {"text":()=>ui("显示名称")});const field=bindUi(modal.contentEl.createEl('input',{cls:'gr-settings-input',attr:{'aria-label':ui("模型显示名称"),maxlength:'100'}}), {"aria-label":()=>ui("模型显示名称")});field.value=model.name;bindUi(modal.contentEl.createEl('label',{text:ui("模型类型")}), {"text":()=>ui("模型类型")});const type=bindUi(modal.contentEl.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("模型类型")}}), {"aria-label":()=>ui("模型类型")});bindUi(type.createEl('option',{value:'chat',text:ui("聊天模型")}), {"text":()=>ui("聊天模型")});bindUi(type.createEl('option',{value:'embedding',text:ui("嵌入模型"),attr:supportsEmbedding(service)?{}:{disabled:''}}), {"text":()=>ui("嵌入模型")});type.value=model.type||'chat';if(!supportsEmbedding(service))bindUi(modal.contentEl.createEl('p',{cls:'gr-settings-description',text:ui("嵌入类型需要 OpenAI 兼容 API 服务。")}), {"text":()=>ui("嵌入类型需要 OpenAI 兼容 API 服务。")});const footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});bindUi(button(footer,ui("保存"),async()=>{setModelType(this.plugin.store.settings,service,model,type.value as ModelType);model.name=field.value.trim()||model.id;await this.save();modal.close();this.display();},'gr-settings-button is-primary'), {"text":()=>ui("保存")});modal.open();field.focus();}
  private manageServiceModels(service:ModelService,fetchNow:boolean){
    if(Platform?.isMobile&&service.kind!=='api'){new Notice(ui('手机端不支持本机 CLI，请选择自定义 API 服务。'));return;}
    const modal=new Modal(this.app);modal.setTitle(service.name+ui(" · 添加模型"));modal.modalEl.addClass('gr-model-dialog');modal.contentEl.addClass('gr-model-modal');let controller:AbortController|undefined,closed=false;modal.onClose=()=>{closed=true;controller?.abort();};let available=service.models.map(m=>({...m})),selected=new Set(service.models.map(m=>m.id));
    const toolbar=modal.contentEl.createDiv({cls:'gr-model-toolbar'}),search=bindUi(toolbar.createEl('input',{attr:{type:'search','aria-label':ui("搜索服务模型"),placeholder:ui("搜索模型…")}}), {"aria-label":()=>ui("搜索服务模型"),"placeholder":()=>ui("搜索模型…")}),fetch=bindUi(button(toolbar,ui("获取模型"),async()=>{controller?.abort();controller=new AbortController();const c=controller;fetch.disabled=true;status.textContent=ui("正在获取…");try{const found=service.kind==='codex'?await discoverCodexModels():service.kind==='claude'?[{id:'sonnet',name:'Claude Sonnet'},{id:'opus',name:'Claude Opus'},{id:'haiku',name:'Claude Haiku'}]:service.kind==='pi'?await discoverPiModels(service.path,c.signal):await discoverApiModels(serviceSettings(service,'',this.plugin.serviceKey(service.id)),c.signal);if(c.signal.aborted||closed)return;available=mergeModels(available,found);status.textContent=service.kind==='claude'?ui("Claude CLI 常用别名；实际可用性由账户决定"):found.length?ui("已获取 ")+found.length+ui(" 个模型"):ui("暂无模型，可手动添加");draw();}catch(e){if(!c.signal.aborted&&!closed)status.textContent=ui(e instanceof Error?e.message:'获取失败');}finally{fetch.disabled=false;}},'gr-settings-button'), {"text":()=>ui("获取模型")});
    const status=modal.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'status'}}),tools=modal.contentEl.createDiv({cls:'gr-model-selection-tools'}),count=tools.createSpan();bindUi(button(tools,ui("全选当前结果"),()=>{for(const m of matches())selected.add(m.id);draw();},'gr-settings-button gr-ghost'), {"text":()=>ui("全选当前结果")});bindUi(button(tools,ui("清空选择"),()=>{selected.clear();draw();},'gr-settings-button gr-ghost'), {"text":()=>ui("清空选择")});const list=modal.contentEl.createDiv({cls:'gr-model-browser'}),matches=()=>{const q=search.value.trim().toLowerCase();return available.filter(m=>(m.name+' '+m.id).toLowerCase().includes(q));};
    const draw=()=>{list.empty();count.textContent=ui("已选 ")+selected.size;for(const model of matches()){const row=list.createDiv({cls:'gr-model-browser-row'}),check=bindUi(row.createEl('input',{attr:{type:'checkbox','aria-label':ui("添加模型 ")+model.id}}), {"aria-label":()=>ui("添加模型 ")+model.id});check.checked=selected.has(model.id);check.onchange=()=>{if(check.checked)selected.add(model.id);else selected.delete(model.id);count.textContent=ui("已选 ")+selected.size;};const copy=row.createSpan({cls:'gr-model-choice-info'});copy.createSpan({cls:'gr-model-name',text:model.name});copy.createSpan({cls:'gr-model-id',text:model.id});if(supportsEmbedding(service)){const type=bindUi(row.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("模型类型 ")+model.id}}), {"aria-label":()=>ui("模型类型 ")+model.id});type.setCssStyles({width:'100px',flex:'none'});bindUi(type.createEl('option',{value:'chat',text:ui("聊天")}), {"text":()=>ui("聊天")});bindUi(type.createEl('option',{value:'embedding',text:ui("嵌入")}), {"text":()=>ui("嵌入")});type.value=model.type||'chat';type.onchange=()=>model.type=type.value as ModelType;}}if(!matches().length)bindUi(list.createDiv({cls:'gr-service-model-empty',text:ui("没有匹配的模型")}), {"text":()=>ui("没有匹配的模型")});};search.oninput=draw;
    const manual=modal.contentEl.createDiv({cls:'gr-model-toolbar'}),id=bindUi(manual.createEl('input',{attr:{'aria-label':ui("手动模型 ID"),placeholder:service.kind==='pi'?'provider/model-id':ui("手动输入模型 ID")}}), {"aria-label":()=>ui("手动模型 ID"),"placeholder":()=>service.kind==='pi'?'provider/model-id':ui("手动输入模型 ID")});bindUi(button(manual,ui("添加"),()=>{const model=normalizeModels([id.value.trim()])[0];if(!model){status.textContent=ui("请输入不含空格的模型 ID");return;}available=mergeModels(available,[model]);selected.add(model.id);id.value='';search.value='';draw();},'gr-settings-button'), {"text":()=>ui("添加")});
    const footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});bindUi(button(footer,ui("添加所选模型"),async()=>{const s=this.plugin.store.settings;service.models=available.filter(m=>selected.has(m.id));pruneAssignments(s);await this.save();modal.close();this.display();},'gr-settings-button is-primary'), {"text":()=>ui("添加所选模型")});modal.open();draw();if(fetchNow)fetch.click();else id.focus();
  }
  private modelLabel(ref:ModelRef|null|undefined){if(!ref)return ui("默认");const service=this.plugin.store.settings.services.find(s=>s.id===ref.serviceId),model=service?.models.find(m=>m.id===ref.modelId);return model?model.name:ui("重新选择模型");}
  private chooseTaskModel(task:string,done:()=>void){const s=this.plugin.store.settings;new ModelAssignmentPicker(this.app,this.plugin.modelSetup(),task!=='default',async ref=>{if(ref)this.plugin.taskModels()[task]=ref;else delete this.plugin.taskModels()[task];await this.save();done();},this.plugin.taskModels()[task]).open();}
  private renderCommands(body:HTMLElement){
    const s=this.plugin.store.settings;const base=body.createEl('section',{cls:'gr-settings-group'});bindUi(this.heading(base,ui("阅读提示词"),'gr-settings-section'), {"text":()=>ui("阅读提示词")});const prompts=base.createDiv({cls:'gr-settings-group-body'});for(const [id,name,description]of [['default',ui("默认问答"),ui("阅读提问与追问")],['summary',ui("文章解读"),ui("全文概览、论点与段落地图")]]){const row=prompts.createDiv({cls:'gr-command-row'}),copy=row.createDiv({cls:'gr-command-copy'});copy.createDiv({cls:'gr-settings-label',text:name});bindUi(copy.createDiv({cls:'gr-command-preview',text:description+' · '+(this.plugin.taskModels()[id]?this.modelLabel(this.plugin.taskModels()[id]):id==='default'?ui("选择模型"):ui("默认"))}), {"text":()=>description+' · '+(this.plugin.taskModels()[id]?this.modelLabel(this.plugin.taskModels()[id]):id==='default'?ui("选择模型"):ui("默认"))});bindUi(button(row,ui("编辑"),()=>this.editCommand({id,name,prompt:s.taskPrompts[id]||(id==='default'?SYSTEM:'请概述文章要旨、关键论点与阅读提醒。')},true),'gr-settings-button'), {"text":()=>ui("编辑")});}
    const card=body.createEl('section',{cls:'gr-settings-group gr-commands-group'}),head=card.createDiv({cls:'gr-command-heading'});body=card;bindUi(this.heading(head,ui("选中文本指令 {0} / {1}",s.commands.length,MAX_COMMANDS),'gr-settings-section'), {"text":()=>ui("选中文本指令 {0} / {1}",s.commands.length,MAX_COMMANDS)});
    const add=bindUi(button(head,ui("添加指令"),()=>this.editCommand(),'gr-settings-button is-primary'), {"text":()=>ui("添加指令")});add.disabled=s.commands.length>=MAX_COMMANDS;
    const list=body.createDiv({cls:'gr-command-list'});if(!s.commands.length)bindUi(list.createDiv({cls:'gr-settings-description',text:ui("还没有选中文本指令")}), {"text":()=>ui("还没有选中文本指令")});
    s.commands.forEach((c,i)=>{const row=list.createDiv({cls:'gr-command-row'}),copy=row.createDiv({cls:'gr-command-copy'});copy.createDiv({cls:'gr-settings-label',text:commandName(c)});bindUi(copy.createDiv({cls:'gr-command-preview',text:c.id==='translate'?(s.translationEngine==='google'?ui("谷歌翻译 · 内置"):this.modelLabel(this.plugin.taskModels().translate)+ui(" · 模型翻译"))+' · '+ui(TRANSLATION_LANGUAGES[s.translationTarget]):c.prompt+' · '+this.modelLabel(this.plugin.taskModels()[c.id])}), {"text":()=>c.id==='translate'?(s.translationEngine==='google'?ui("谷歌翻译 · 内置"):this.modelLabel(this.plugin.taskModels().translate)+ui(" · 模型翻译"))+' · '+ui(TRANSLATION_LANGUAGES[s.translationTarget]):c.prompt+' · '+this.modelLabel(this.plugin.taskModels()[c.id])});const actions=row.createDiv({cls:'gr-command-actions'});
      const move=async(delta:number)=>{const j=i+delta;if(j<0||j>=s.commands.length)return;[s.commands[i],s.commands[j]]=[s.commands[j],s.commands[i]];await this.save();this.display();};
      for(const[icon,label,delta]of [['arrow-up',ui("上移"),-1],['arrow-down',ui("下移"),1]]as const){const b=button(actions,'',()=>move(delta),'gr-settings-button');setIcon(b,icon);b.setAttribute('aria-label',label+' '+commandName(c));b.disabled=i+delta<0||i+delta>=s.commands.length;}
      bindUi(button(actions,ui("编辑"),()=>this.editCommand(c),'gr-settings-button'), {"text":()=>ui("编辑")});bindUi(button(actions,ui("删除"),async()=>{s.commands=s.commands.filter(x=>x.id!==c.id);delete s.taskModels[c.id];if(s.mobileTaskModels)delete s.mobileTaskModels[c.id];await this.save();this.display();},'gr-settings-button'), {"text":()=>ui("删除")});
    });
    const missing=DEFAULT_COMMANDS.filter(d=>!s.commands.some(c=>c.id===d.id));if(missing.length){const footer=body.createDiv({cls:'gr-command-restore'});for(const d of missing){const b=bindUi(button(footer,ui("恢复“")+commandName(d)+'”',async()=>{s.commands=saveCommand(s.commands,{...d});await this.save();this.display();},'gr-settings-button'), {"text":()=>ui("恢复“")+commandName(d)+'”'});b.disabled=s.commands.length>=MAX_COMMANDS;}}
  }
  private editTranslation(){const s=this.plugin.store.settings,modal=new Modal(this.app);modal.setTitle(ui("翻译"));modal.modalEl.addClass('gr-model-dialog');modal.contentEl.addClass('gr-model-modal');let engine=s.translationEngine,ref=this.plugin.taskModels().translate||null;const body=modal.contentEl.createDiv();const draw=()=>{body.empty();bindUi(body.createEl('label',{text:ui("翻译方式")}), {"text":()=>ui("翻译方式")});const mode=bindUi(body.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("翻译方式")}}), {"aria-label":()=>ui("翻译方式")});bindUi(mode.createEl('option',{value:'google',text:ui("谷歌翻译 · 内置")}), {"text":()=>ui("谷歌翻译 · 内置")});bindUi(mode.createEl('option',{value:'model',text:ui("模型翻译")}), {"text":()=>ui("模型翻译")});mode.value=engine;mode.onchange=()=>{engine=mode.value as 'google'|'model';draw();};if(engine==='model'){const row=body.createDiv({cls:'gr-command-model-row'});bindUi(row.createSpan({text:ui("使用模型")}), {"text":()=>ui("使用模型")});const picker=button(row,this.modelLabel(ref),()=>new ModelAssignmentPicker(this.app,this.plugin.modelSetup(),true,async value=>{ref=value;picker.textContent=this.modelLabel(ref);},ref).open(),'gr-settings-button');}else bindUi(body.createDiv({cls:'gr-settings-description',text:ui("仅将选中文本发送至 Google。")}), {"text":()=>ui("仅将选中文本发送至 Google。")});};draw();bindUi(modal.contentEl.createEl('label',{text:ui("目标语言")}), {"text":()=>ui("目标语言")});const target=bindUi(modal.contentEl.createEl('select',{cls:'gr-settings-input',attr:{'aria-label':ui("翻译目标语言")}}), {"aria-label":()=>ui("翻译目标语言")});for(const [code,label]of Object.entries(TRANSLATION_LANGUAGES))bindUi(target.createEl('option',{value:code,text:ui(label)}), {"text":()=>ui(label)});target.value=s.translationTarget;bindUi(modal.contentEl.createEl('label',{text:ui("翻译提示词")}), {"text":()=>ui("翻译提示词")});const prompt=bindUi(modal.contentEl.createEl('textarea',{cls:'gr-settings-input',attr:{'aria-label':ui("翻译提示词"),rows:'4'}}), {"aria-label":()=>ui("翻译提示词")});prompt.setCssStyles({height:'110px'});prompt.value=s.commands.find(c=>c.id==='translate')?.prompt||'请翻译选中文本。';const footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});bindUi(button(footer,ui("保存"),async()=>{if(!prompt.value.trim()||prompt.value.length>8000)throw new Error('Prompt 需为1–8,000个字符。');s.translationEngine=engine;s.translationTarget=target.value;const command=s.commands.find(c=>c.id==='translate');if(command)command.prompt=prompt.value.trim();if(ref)this.plugin.taskModels().translate=ref;else delete this.plugin.taskModels().translate;await this.save();modal.close();this.display();},'gr-settings-button is-primary'), {"text":()=>ui("保存")});modal.open();}
  private editCommand(command?:ReadingCommand,taskPrompt=false){
    if(command?.id==='translate'&&!taskPrompt){this.editTranslation();return;}
    const modal=new Modal(this.app);modal.setTitle(command?ui("编辑指令"):ui("添加指令"));modal.contentEl.addClass('gr-command-editor');
    bindUi(modal.contentEl.createEl('label',{text:ui("名称"),attr:{for:'gr-command-name'}}), {"text":()=>ui("名称")});const name=bindUi(modal.contentEl.createEl('input',{attr:{id:'gr-command-name','aria-label':ui("指令名称"),maxlength:'16',placeholder:ui("指令名称")}}), {"aria-label":()=>ui("指令名称"),"placeholder":()=>ui("指令名称")});name.value=command?.name||'';name.disabled=taskPrompt;
    modal.contentEl.createEl('label',{text:'Prompt',attr:{for:'gr-command-prompt'}});const prompt=bindUi(modal.contentEl.createEl('textarea',{attr:{id:'gr-command-prompt','aria-label':ui("指令 Prompt"),maxlength:'8000',rows:'9',placeholder:ui("输入对选中文本执行的指令…")}}), {"aria-label":()=>ui("指令 Prompt"),"placeholder":()=>ui("输入对选中文本执行的指令…")});prompt.value=command?.prompt||'';
    if(!taskPrompt)bindUi(modal.contentEl.createDiv({cls:'gr-settings-description',text:ui("可用变量：{{selection}} 选中文本 · {{title}} 文档名")}), {"text":()=>ui("可用变量：{{selection}} 选中文本 · {{title}} 文档名")});
    const commandId=command?.id||uid();let modelRef=this.plugin.taskModels()[commandId]||null;const modelRow=modal.contentEl.createDiv({cls:'gr-command-model-row'});bindUi(modelRow.createSpan({text:ui("使用模型")}), {"text":()=>ui("使用模型")});const modelButton=bindUi(button(modelRow,commandId==='default'&&!modelRef?ui("默认"):this.modelLabel(modelRef),()=>new ModelAssignmentPicker(this.app,this.plugin.modelSetup(),commandId!=='default',async ref=>{modelRef=ref;modelButton.textContent=this.modelLabel(ref);},modelRef).open(),'gr-settings-button'), {"text":()=>commandId==='default'&&!modelRef?ui("默认"):this.modelLabel(modelRef)});
    const error=modal.contentEl.createDiv({cls:'gr-settings-message',attr:{role:'alert'}}),footer=modal.contentEl.createDiv({cls:'gr-settings-footer'});
    const original=taskPrompt?{name:command!.name,prompt:command!.id==='default'?SYSTEM:'请概述文章要旨、关键论点与阅读提醒。'}:DEFAULT_COMMANDS.find(d=>d.id===command?.id);if(original)bindUi(button(footer,ui("恢复默认"),()=>{name.value=original.name;prompt.value=original.prompt;},'gr-settings-button'), {"text":()=>ui("恢复默认")});
    bindUi(button(footer,ui("取消"),()=>modal.close(),'gr-settings-button'), {"text":()=>ui("取消")});bindUi(button(footer,ui("保存"),async()=>{try{if(taskPrompt){if(!prompt.value.trim()||prompt.value.length>8000)throw new Error('Prompt 需为1–8,000个字符。');this.plugin.store.settings.taskPrompts[commandId]=prompt.value.trim();}else this.plugin.store.settings.commands=saveCommand(this.plugin.store.settings.commands,{...command,id:commandId,name:name.value,prompt:prompt.value});if(modelRef)this.plugin.taskModels()[commandId]=modelRef;else delete this.plugin.taskModels()[commandId];await this.save();modal.close();this.display();}catch(e){error.textContent=ui(e instanceof Error?e.message:'保存失败');}},'gr-settings-button is-primary'), {"text":()=>ui("保存")});modal.open();name.focus();
  }
}

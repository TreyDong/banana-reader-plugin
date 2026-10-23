import {desktopModule,hasMobileTransport,mobileRequest} from './agent';
import {makeAnchor,blockedPath,referenceTokens,type Anchor,type Thread} from './core';

export interface EmbeddingSettings {base:string;model:string;dimensions:number;topK:number}
export const EMBEDDING_DEFAULTS:EmbeddingSettings={base:'https://api.openai.com/v1',model:'',dimensions:0,topK:6};
export interface SourceSection {text:string;label:string;pdfPage?:number;offset?:number}
export interface BookChunk {id:string;text:string;label:string;anchor:Anchor;vector?:number[]}
export interface BookStamp {path:string;mtime:number;size:number}
export interface BookIndex {version:1;stamp:BookStamp;identity:string;created:number;model:string;dimensions:number;chunks:BookChunk[];skippedPages:number;inputTokens?:number}
export interface ContextInfo {label:string;embeddingModel?:string;inputTokens?:number;sources:{id:string;label:string}[]}
/** SHA-256 keeps existing cache filenames and identities without Node crypto. */
export function hash(value:string):string{
 const bytes=new TextEncoder().encode(value),length=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(length);data.set(bytes);data[bytes.length]=128;
 const view=new DataView(data.buffer),bits=bytes.length*8;view.setUint32(length-8,Math.floor(bits/0x100000000));view.setUint32(length-4,bits>>>0);
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const rotate=(n:number,b:number)=>(n>>>b)|(n<<(32-b)),w=new Uint32Array(64);
 for(let offset=0;offset<length;offset+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,z].forEach((n,i)=>h[i]=(h[i]+n)>>>0);
 }
 return h.map(n=>n.toString(16).padStart(8,'0')).join('');
}
export function embeddingEndpoint(base:string){let url:URL;try{url=new URL(base.trim().replace(/\/+$/,'')+'/embeddings');}catch{throw new Error('Embedding API 地址无效。');}if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Embedding 地址须使用 HTTPS；本机服务可使用 HTTP。');return url;}
export function embeddingIdentity(s:EmbeddingSettings){return hash(JSON.stringify([embeddingEndpoint(s.base).href,s.model.trim(),s.dimensions||0]));}
export function normalizeEmbedding(s:Partial<EmbeddingSettings>|undefined):EmbeddingSettings{return{base:typeof s?.base==='string'?s.base:EMBEDDING_DEFAULTS.base,model:typeof s?.model==='string'?s.model:'',dimensions:Number.isInteger(s?.dimensions)&&s!.dimensions!>=0&&s!.dimensions!<=8192?s!.dimensions!:0,topK:Number.isInteger(s?.topK)&&s!.topK!>=2&&s!.topK!<=12?s!.topK!:6};}
function check(signal:AbortSignal){if(signal.aborted)throw new Error('已停止');}
export function unitVector(value:unknown,dimensions?:number):number[]{if(!Array.isArray(value)||!value.length||value.length>8192||dimensions&&value.length!==dimensions||value.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('Embedding 返回的向量维度或数值无效。');const norm=Math.sqrt(value.reduce((s,n)=>s+n*n,0));if(!Number.isFinite(norm)||norm===0)throw new Error('Embedding 返回了无效的零向量。');return value.map(n=>n/norm);}
export async function embedTexts(settings:EmbeddingSettings,key:string,input:string[],signal:AbortSignal):Promise<{vectors:number[][];inputTokens?:number}>{
 check(signal);const model=settings.model.trim();if(!model||model.length>200||/[\r\n]/.test(model))throw new Error('请先配置 Embedding 模型。');if(!input.length||input.length>32||input.some(t=>!t.trim()||t.length>4000))throw new Error('Embedding 输入超过单批限制。');
 const url=embeddingEndpoint(settings.base),body={model,input,encoding_format:'float',...(settings.dimensions?{dimensions:settings.dimensions}:{})};
 if(hasMobileTransport()){
  const raw=await mobileRequest({url:url.href,method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)},signal);
  try{
   const value=JSON.parse(raw);if(!Array.isArray(value.data)||value.data.length!==input.length)throw new Error();
   const vectors:number[][]=new Array(input.length);for(const item of value.data){if(!Number.isInteger(item.index)||item.index<0||item.index>=input.length||vectors[item.index])throw new Error();vectors[item.index]=unitVector(item.embedding,settings.dimensions||vectors.find(Boolean)?.length);}
   if(vectors.filter(Boolean).length!==input.length)throw new Error();const reported=value.usage?.prompt_tokens;return{vectors,inputTokens:Number.isInteger(reported)&&reported>=0?reported:undefined};
  }catch{throw new Error('Embedding 返回格式或向量维度无效，请检查兼容接口。');}
 }
 const https=desktopModule('node:https') as typeof import('node:https'),http=desktopModule('node:http') as typeof import('node:http');
 return new Promise((resolve,reject)=>{let done=false,data='';const finish=(err?:Error,result?:{vectors:number[][];inputTokens?:number})=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(err){req.destroy();reject(err);}else resolve(result!);};const abort=()=>finish(new Error('已停止'));const req=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...(key?{Authorization:'Bearer '+key}:{})}},res=>{
  if(res.statusCode!==200){res.resume();finish(new Error('Embedding 服务返回 HTTP '+res.statusCode+'，请检查地址、模型和额度。'));return;}res.setEncoding('utf8');res.on('data',chunk=>{data+=chunk;if(data.length>16000000)finish(new Error('Embedding 返回数据过大。'));});res.on('error',()=>finish(new Error('Embedding 连接中断。')));res.on('aborted',()=>finish(new Error('Embedding 连接中断。')));res.on('end',()=>{if(done)return;try{const value=JSON.parse(data);if(!Array.isArray(value.data)||value.data.length!==input.length)throw new Error();const vectors:number[][]=new Array(input.length);for(const item of value.data){if(!Number.isInteger(item.index)||item.index<0||item.index>=input.length||vectors[item.index])throw new Error();vectors[item.index]=unitVector(item.embedding,settings.dimensions||vectors.find(Boolean)?.length);}if(vectors.some(v=>!v))throw new Error();const reported=value.usage?.prompt_tokens;finish(undefined,{vectors,inputTokens:Number.isInteger(reported)&&reported>=0?reported:undefined});}catch{finish(new Error('Embedding 返回格式或向量维度无效，请检查兼容接口。'));}});
 });const timer=setTimeout(()=>finish(new Error('Embedding 请求超时。')),60000);req.on('error',()=>finish(new Error('无法连接 Embedding 服务，请检查配置。')));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}req.end(JSON.stringify(body));});
}
/** Chunks never cross page/chapter boundaries; anchors refer to the unchanged source. */
export function chunkSections(sections:SourceSection[],size=1000,overlap=120):BookChunk[]{
 const out:BookChunk[]=[];let total=0;
 for(const section of sections){const text=section.text;total+=text.length;if(total>5_000_000)throw new Error('本书超过 500 万字符，请按章节处理。');for(let start=0;start<text.length;){let end=Math.min(text.length,start+size);if(end<text.length){const tail=text.slice(start,end),boundary=Math.max(tail.lastIndexOf('\n\n'),tail.lastIndexOf('。'),tail.lastIndexOf('. '));if(boundary>size*.6)end=start+boundary+1;if(/[\uDC00-\uDFFF]/.test(text[end]))end--;}
 const anchor=makeAnchor(text,start,end);if(anchor.quote){const local=anchor.start;anchor.start+=(section.offset||0);if(section.pdfPage){anchor.pdfPage=section.pdfPage;anchor.pdfOffset=local;}out.push({id:hash(section.label+'\0'+anchor.start+'\0'+anchor.quote).slice(0,24),text:anchor.quote,label:section.label,anchor});}if(out.length>8000)throw new Error('本书片段过多，请按章节处理。');if(end===text.length)break;start=Math.max(start+1,end-overlap);if(/[\uDC00-\uDFFF]/.test(text[start]))start++;}}
 return out;
}
export async function createBookIndex(stamp:BookStamp,sections:SourceSection[],settings:EmbeddingSettings,key:string,signal:AbortSignal,progress:(done:number,total:number)=>void,skippedPages=0):Promise<BookIndex>{
 if(blockedPath(stamp.path))throw new Error('受保护目录不能建立检索索引。');const identity=embeddingIdentity(settings),chunks=chunkSections(sections);if(!chunks.length)throw new Error('没有可建立索引的文字；扫描 PDF 需要 OCR。');let tokens:number|undefined,dimensions=0;
 for(let i=0;i<chunks.length;i+=16){check(signal);const batch=chunks.slice(i,i+16);const result=await embedTexts(settings,key,batch.map(c=>c.label+'\n'+c.text),signal);result.vectors.forEach((vector,j)=>{if(dimensions&&vector.length!==dimensions)throw new Error('Embedding 服务在不同批次返回了不同维度，请重新配置。');dimensions=vector.length;if(dimensions*chunks.length>3_000_000)throw new Error('本书向量索引超过本版容量，请降低维度或拆分文档。');batch[j].vector=vector;});if(result.inputTokens!==undefined)tokens=(tokens||0)+result.inputTokens;progress(Math.min(chunks.length,i+batch.length),chunks.length);}
 check(signal);return{version:1,stamp:{...stamp},identity,created:Date.now(),model:settings.model,dimensions,chunks,skippedPages,inputTokens:tokens};
}
export function usableIndex(index:BookIndex,stamp:BookStamp,settings:EmbeddingSettings){return index.version===1&&index.stamp.path===stamp.path&&index.stamp.mtime===stamp.mtime&&index.stamp.size===stamp.size&&index.identity===embeddingIdentity(settings);}
function terms(text:string){const clean=text.toLowerCase(),words=clean.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]+/g)||[];return [...new Set(words.flatMap(w=>/^[\u3400-\u9fff]+$/.test(w)?(w.length===1?[w]:Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2))):[w]))];}
/** Reciprocal rank fusion of lexical and vector ranks; suppress overlapping copies. */
export function retrieve(index:BookIndex,query:string,vector:number[],topK:number){
 const q=unitVector(vector,index.dimensions),tokens=terms(query).slice(0,128),n=index.chunks.length,docs=index.chunks.map(c=>new Set(terms(c.text))),df=new Map(tokens.map(t=>[t,docs.filter(d=>d.has(t)).length]));
 const semantic=index.chunks.map((c,i)=>({i,score:c.vector!.reduce((sum,v,j)=>sum+v*q[j],0)})).sort((a,b)=>b.score-a.score),lexical=index.chunks.map((c,i)=>({i,score:tokens.reduce((s,t)=>s+(docs[i].has(t)?Math.log(1+(n-(df.get(t)||0)+.5)/((df.get(t)||0)+.5)):0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score),scores=new Map<number,number>();
 for(const ranked of [semantic,lexical])ranked.forEach((r,rank)=>scores.set(r.i,(scores.get(r.i)||0)+1/(60+rank+1)));
 const hits:BookChunk[]=[];for(const [i]of [...scores].sort((a,b)=>b[1]-a[1])){const c=index.chunks[i];if(hits.some(h=>h.label===c.label&&Math.abs(h.anchor.start-c.anchor.start)<Math.min(h.text.length,c.text.length)*.65))continue;hits.push(c);if(hits.length>=topK)break;}return hits;
}
export function retrievalContext(hits:BookChunk[],budget:number,firstId=1,existing:Record<string,Anchor>={}){let context='以下是本书按问题检索的原文片段，并非全书。只根据这些证据回答；资料不足时明确说明。\n\n';const citations:Record<string,Anchor>={},sources:ContextInfo['sources']=[];
 for(const hit of hits){const prior=Object.entries(existing).find(([,a])=>a.pdfPage===hit.anchor.pdfPage&&a.start===hit.anchor.start&&a.quote===hit.anchor.quote),id=prior?.[0]||String(firstId+sources.length),part=`[¶${id}] （${hit.label}）${hit.text}\n\n`;if(context.length+part.length>budget)continue;context+=part;citations[id]={...hit.anchor};sources.push({id,label:hit.label});}if(!sources.length)throw new Error('上下文预算不足以容纳检索片段，请提高上限。');return{context,citations,sources};}
/** Keep evidence already cited in this conversation; old IDs never become invalid simply because a query changed. */
export function retainPriorEvidence(bundle:ReturnType<typeof retrievalContext>,thread:Thread|undefined,budget:number){
 if(!thread)return bundle;let context=bundle.context;const citations={...bundle.citations},sources=[...bundle.sources];const used=[...new Set([...thread.messages].reverse().filter(m=>m.role==='assistant').flatMap(m=>referenceTokens(m.content).flatMap(t=>t.ids)))];
 const heading='\n先前回答引用过的原文（原编号仍有效）：\n';let added=false;for(const id of used){if(citations[id])continue;const a=thread.citations?.[id];if(!a)continue;const label=a.pdfPage?'PDF 第 '+a.pdfPage+' 页':thread.contextInfo?.sources.find(s=>s.id===id)?.label||'原文片段',part=`[¶${id}] （${label}）${a.quote}\n\n`;if(context.length+part.length+heading.length+120>budget)continue;if(!added){context+=heading;added=true;}context+=part;citations[id]={...a};sources.push({id,label:'历史 · '+label});}
 context+='\n历史回答可能引用本轮未附带的旧片段，不能仅因此判定旧引用错误。本轮依据不足时说明需要补充原文。';return{context,citations,sources};
}
export interface IndexStorage {
 exists(path:string):Promise<boolean>;
 stat(path:string):Promise<{size:number}|null>;
 read(path:string):Promise<string>;
 write(path:string,data:string):Promise<unknown>;
 mkdir(path:string):Promise<unknown>;
 rename(from:string,to:string):Promise<unknown>;
 remove(path:string):Promise<unknown>;
}
/** The plugin injects Vault.adapter; the Node fallback is only for standalone desktop callers. */
function nodeIndexStorage():IndexStorage{
 const fs=desktopModule('node:fs').promises as typeof import('node:fs').promises;
 return{exists:async path=>{try{await fs.stat(path);return true;}catch(error:any){if(error?.code==='ENOENT')return false;throw error;}},stat:path=>fs.stat(path),read:path=>fs.readFile(path,'utf8'),write:(path,data)=>fs.writeFile(path,data,{mode:0o600}),mkdir:path=>fs.mkdir(path,{recursive:true}),rename:(from,to)=>fs.rename(from,to),remove:path=>fs.rm(path,{force:true})};
}
export class BookIndexCache {
 private storage:IndexStorage;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(readonly dir:string,storage?:IndexStorage){this.storage=storage||nodeIndexStorage();}
 private file(path:string){return this.dir.replace(/\/$/,'')+'/'+hash(path)+'.json';}
 private serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.queue.catch(()=>{}).then(action);this.queue=next;return next;}
 load(path:string):Promise<BookIndex|null>{return this.serial(()=>this.readIndex(path));}
 private async readIndex(path:string):Promise<BookIndex|null>{try{const file=this.file(path),backup=file+'.bak';
  // Recover an interrupted mobile rename before reading the cache.
  if(!await this.storage.exists(file)){if(await this.storage.exists(backup))await this.storage.rename(backup,file);else return null;}
  const stat=await this.storage.stat(file);if(!stat||stat.size>120_000_000)throw new Error();
  const index=JSON.parse(await this.storage.read(file)) as BookIndex;if(index.version!==1||index.stamp.path!==path||!Array.isArray(index.chunks)||index.chunks.length>8000||!Number.isInteger(index.dimensions)||index.dimensions<1||index.dimensions>8192)throw new Error();for(const c of index.chunks){if(typeof c.text!=='string'||c.text.length>4000||!c.anchor||typeof c.anchor.quote!=='string')throw new Error();c.vector=unitVector(c.vector,index.dimensions);}return index;
 }catch{throw new Error('本书索引损坏或不可读，请重新建立索引。');}}
 save(index:BookIndex){return this.serial(async()=>{
  if(!await this.storage.exists(this.dir))await this.storage.mkdir(this.dir);const file=this.file(index.stamp.path),tmp=file+'.'+Date.now().toString(36)+Math.random().toString(36).slice(2)+'.tmp',backup=file+'.bak';let moved=false;
  try{
   await this.storage.write(tmp,JSON.stringify(index));
   if(await this.storage.exists(file)){if(await this.storage.exists(backup))await this.storage.remove(backup);await this.storage.rename(file,backup);moved=true;}
   await this.storage.rename(tmp,file);
  }catch(error){if(moved&&!await this.storage.exists(file))await this.storage.rename(backup,file);throw error;}
  finally{if(await this.storage.exists(tmp))await this.storage.remove(tmp);}
  if(await this.storage.exists(backup))await this.storage.remove(backup);
 });}
 remove(path:string){return this.serial(async()=>{const file=this.file(path);for(const target of [file,file+'.bak'])if(await this.storage.exists(target))await this.storage.remove(target);});}
}

/** Bounded whole-document evidence without embeddings. Display remains the original PDF. */
export function wholeDocumentContext(sections:SourceSection[],question:string,budget:number){
 const compact=(text:string)=>text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1');
 const chunks=chunkSections(sections,1500,100);if(!chunks.length)throw new Error('文档没有可用于问答的文字；扫描 PDF 需要 OCR。');
 const fullHeading='本轮针对整篇文档提问，没有选中文本。以下是完整文档的文字内容，请围绕文档整体回答。\n\n';
 const fullSize=chunks.reduce((n,c)=>n+compact(c.text).length+c.label.length+35,fullHeading.length);
 const partial=fullSize>budget,heading=partial?'本轮针对整篇文档提问，没有选中文本。以下从全书本地文字中选取问题相关证据，并覆盖开头、结尾及不同位置的概览片段；不是全部正文。请回答文档整体的问题，不要把某个片段当作用户选区，也不能声称已通读全书；证据不足时明确说明。\n\n':fullHeading;
 let candidates=chunks;
 if(partial){const tokens=terms(question).filter(t=>!['什么','这本','本书','内容','核心','文档','文章','一下','总结','主要'].includes(t)),ranked=chunks.map((c,i)=>({i,score:tokens.reduce((n,t)=>n+(compact(c.text).toLowerCase().includes(t)?1:0),0)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score),ids=new Set<number>();
  // Interleave overview and relevant passages so a small budget still spans the book.
  const broad=[0,1,2,3,...Array.from({length:12},(_,i)=>Math.round(i*(chunks.length-1)/11)),chunks.length-1];
  for(let i=0;i<Math.max(broad.length,Math.min(10,ranked.length));i++){if(i<broad.length)ids.add(Math.min(chunks.length-1,broad[i]));if(i<10&&ranked[i])ids.add(ranked[i].i);}candidates=[...ids].map(i=>chunks[i]);
 }
 let used=heading.length;const chosen:BookChunk[]=[];for(const c of candidates){const cost=compact(c.text).length+c.label.length+35;if(used+cost>budget)continue;chosen.push(c);used+=cost;}
 if(!chosen.length)throw new Error('上下文上限不足以容纳文档片段，请提高上限。');chosen.sort((a,b)=>chunks.indexOf(a)-chunks.indexOf(b));
 let context=heading;const citations:Record<string,Anchor>={},sources:ContextInfo['sources']=[];
 chosen.forEach((c,i)=>{const id=String(i+1);context+=`[¶${id}] （${c.label}）${compact(c.text)}\n\n`;citations[id]={...c.anchor};sources.push({id,label:c.label});});
 return{context,citations,info:{label:partial?'整篇文档 · 全书检索与概览':'整篇文档 · 全文',sources} as ContextInfo};
}

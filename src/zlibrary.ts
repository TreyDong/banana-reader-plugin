/**
 * Unofficial Z-Library mobile EAPI client. The upstream has no stable contract;
 * endpoints were cross-checked against heartleo/zlib and bipinkrish/Zlibrary-API
 * (see notes/zlibrary-integration-research.md) and may change at any time.
 * All network access goes through an injected fetcher so the logic stays testable.
 */
export type ZlibFetcher=(url:string,init:{method:'GET'|'POST';headers:Record<string,string>;body?:string})=>Promise<{status:number;headers:Record<string,string>;json:unknown;text:string;arrayBuffer:Promise<ArrayBuffer>}>;
export interface ZlibCredentials{userId:string;userKey:string}
export interface ZlibBook{id:string;hash:string;title:string;authors:string[];year:string;publisher:string;language:string;extension:string;size:string;description:string}
export interface ZlibSearchPage{books:ZlibBook[];page:number;totalPages:number}
export interface ZlibTicket{url:string;description:string;author:string;extension:string}
export interface ZlibProfile{name:string;email:string;remaining:number|null}
export interface ZlibSearchOptions{page?:number;limit?:number;extensions?:string[];languages?:string[];order?:string}
export const ZLIB_DEFAULT_DOMAIN='https://z-lib.gd';
/** Mirrors verified reachable in 2026-09 (heartleo/zlib docs/eapi.md); availability rotates, probe before relying on one. */
export const ZLIB_MIRRORS=['https://z-lib.gd','https://z-lib.gl','https://z-library.ec','https://article.sk','https://articles.sk','https://zlib.bz'];
export const ZLIB_EXTENSIONS=['pdf','epub','mobi','azw3','txt'];
export const ZLIB_LANGUAGES=['chinese','english','russian','japanese','german','french','spanish'];
export const ZLIB_LANGUAGE_LABELS:Record<string,string>={chinese:'中文',english:'英语',russian:'俄语',japanese:'日语',german:'德语',french:'法语',spanish:'西班牙语'};
export const ZLIB_ORDERS:Record<string,string>={bestmatch:'相关度',popular:'热门',date_updated:'最近更新',year:'出版年',filesize:'文件大小'};
export class ZlibSessionError extends Error{constructor(){super('Z-Library 登录已失效，请重新登录。');}}
/** The server answered with a success:0 envelope: switching mirrors would not change the answer. */
export class ZlibApiError extends Error{}
/** No usable JSON envelope came back: blocked by bot protection, gateway failure or unreachable mirror. */
export class ZlibMirrorError extends Error{constructor(){super('Z-Library 镜像无法访问或返回异常。');}}
const str=(value:unknown):string=>value==null||typeof value==='object'?'':String(value);
const envelopeError=(body:unknown,fallback:string):string=>{const error=(body as {error?:unknown} | undefined)?.error;return typeof error==='string'&&error.trim()?error.trim():fallback;};

/** Accepts bare HTTPS origins only: no path, query, hash or embedded credentials. */
export function normalizeZlibDomain(value:string):string|null{
 const raw=(value||'').trim();if(!raw)return null;let url:URL;try{url=new URL(raw);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;
 if(url.pathname!=='/'&&url.pathname!=='')return null;
 return url.origin;
}

/** A filename may come from server-controlled headers or metadata: never trust it as a path. */
export function sanitizeZlibFilename(name:string):string{
 let base=(name||'').replace(/[\\/]/g,' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e]/g,'').replace(/[<>:"|?*]/g,'_').replace(/^[.\s]+/,'').replace(/[.\s]+$/,'').replace(/\s+/g,' ').trim();
 return base||'download';
}

/** Prefers Content-Disposition, falls back to ticket metadata, strips mirror suffixes, guarantees an extension. */
export function downloadFileName(ticket:ZlibTicket,disposition:string):string{
 let name='';for(const part of (disposition||'').split(';')){const [field,...rest]=part.trim().split('=');if(/^filename$/i.test(field.trim())&&rest.length){name=rest.join('=').replace(/^"+|"+$/g,'').trim();break;}}
 if(!name)name=(ticket.description?ticket.description+(ticket.author?' ('+ticket.author+')':''):'download');
 name=sanitizeZlibFilename(name);
 const extension=(name.match(/\.([A-Za-z0-9]{1,8})$/)||[])[1],stem=name.replace(/\.[A-Za-z0-9]{1,8}$/,'');
 const mirror=/\s*\([^()]*((?:z-?lib)|1lib|b-ok|booksc)[^()]*\)\s*$/i.exec(stem);
 return (mirror?stem.slice(0,mirror.index):stem).trim()+'.'+(extension||ticket.extension||'bin').toLowerCase();
}

export function parseSearchResponse(body:unknown,requestedPage=1):ZlibSearchPage{
 const envelope=body as {success?:unknown;books?:unknown;pagination?:{current?:unknown;total_pages?:unknown}}|undefined;
 if(!envelope||envelope.success!==1)throw new Error('Z-Library：'+envelopeError(body,'搜索被拒绝。'));
 const books=Array.isArray(envelope.books)?envelope.books:[];
 return{books:books.map((item):ZlibBook=>{const b=(item||{}) as Record<string,unknown>;return{id:str(b.id),hash:str(b.hash),title:str(b.title)||'（无标题）',authors:[str(b.author)].filter(Boolean),year:str(b.year),publisher:str(b.publisher),language:str(b.language),extension:str(b.extension).toLowerCase(),size:str(b.filesizeString)||str(b.filesize),description:str(b.description)};}),
  page:Number(envelope.pagination?.current)||requestedPage,totalPages:Number(envelope.pagination?.total_pages)||requestedPage};
}

export function parseTicketResponse(body:unknown):ZlibTicket{
 const envelope=body as {success?:unknown;file?:Record<string,unknown>;downloadLink?:unknown;url?:unknown;link?:unknown}|undefined;
 if(!envelope||envelope.success!==1)throw new Error('Z-Library：'+envelopeError(body,'获取下载链接被拒绝。'));
 const file=envelope.file||{},url=str(file.downloadLink)||str(envelope.downloadLink)||str(envelope.url)||str(envelope.link);
 if(!url)throw new Error('Z-Library 未返回可用的下载链接。');
 return{url,description:str(file.description),author:str(file.author),extension:str(file.extension).toLowerCase()};
}

const remainingKeys=['dailyRemain','daily_remain','downloadsLeft','downloads_left','downloadsRemaining','downloads_remaining'];
export function parseProfile(body:unknown):ZlibProfile{
 const envelope=body as {success?:unknown;user?:Record<string,unknown>}|undefined;
 if(!envelope||envelope.success!==1)throw new Error('Z-Library：'+envelopeError(body,'获取账号信息被拒绝。'));
 const user=envelope.user||{};let remaining:number|null=null;
 for(const key of remainingKeys){const value=Number(user[key]);if(user[key]!=null&&Number.isFinite(value)&&value>=0){remaining=value;break;}}
 return{name:str(user.name),email:str(user.email),remaining};
}

const SESSION_REJECTIONS=['invalid credentials','please login'];
export class ZLibraryClient{
 constructor(readonly domain:string,private credentials:ZlibCredentials,private fetcher:ZlibFetcher,private maxDownloadBytes=200*1024*1024){}
 private cookie():string{return this.credentials.userId&&this.credentials.userKey?`remix_userid=${encodeURIComponent(this.credentials.userId)}; remix_userkey=${encodeURIComponent(this.credentials.userKey)}`:'';}
 private async eapi(method:'GET'|'POST',path:string,form:Record<string,string|string[]>){
  const headers:Record<string,string>={'Accept':'application/json','User-Agent':'BananaReader'},cookie=this.cookie();
  if(cookie){headers['Cookie']=cookie;headers['remix-userid']=this.credentials.userId;headers['remix-userkey']=this.credentials.userKey;}
  const params=new URLSearchParams();for(const [key,value] of Object.entries(form))for(const item of Array.isArray(value)?value:[value])if(item!=='')params.append(key,item);
  let url=this.domain+path,body:string|undefined;
  if(method==='POST'){headers['Content-Type']='application/x-www-form-urlencoded';body=params.toString();}
  else if(params.size)url+='?'+params.toString();
  const response=await this.fetcher(url,{method,headers,body});
  const envelope=await Promise.resolve(response.json).catch(()=>undefined) as {success?:unknown;error?:unknown;user?:Record<string,unknown>}|undefined;
  if(!envelope||typeof envelope.success==='undefined')throw new ZlibMirrorError();
  if(envelope.success!==1){
   const message=envelopeError(envelope,'请求被拒绝。');
   if(path!=='/eapi/user/login'&&cookie&&SESSION_REJECTIONS.includes(message.toLowerCase()))throw new ZlibSessionError();
   throw new ZlibApiError('Z-Library：'+message);
  }
  return envelope;
 }
 async login(email:string,password:string):Promise<ZlibCredentials>{
  const envelope=await this.eapi('POST','/eapi/user/login',{email,password}).catch(error=>{
   if(error instanceof Error&&/Authorization failed/i.test(error.message))throw new Error('Z-Library 登录接口拒绝了该账号，可在浏览器登录后复制 remix_userid 与 remix_userkey 粘贴登录。');throw error;});
  const user=envelope.user||{},userId=str(user.id),userKey=str(user.remix_userkey)||str(user.remix_user_key);
  if(!userId||!userKey)throw new Error('Z-Library 登录响应缺少凭据。');
  return{userId,userKey};
 }
 search(query:string,options:ZlibSearchOptions={}):Promise<ZlibSearchPage>{
  const page=Math.max(1,options.page||1),form:Record<string,string|string[]>= {message:query,page:String(page),limit:String(Math.min(50,Math.max(1,options.limit||20)))};
  if(options.extensions?.length)form['extensions[]']=options.extensions.map(item=>item.toLowerCase());
  if(options.languages?.length)form['languages[]']=options.languages.map(item=>item.toLowerCase());
  if(options.order)form.order=options.order;
  return this.eapi('POST','/eapi/book/search',form).then(body=>parseSearchResponse(body,page));
 }
 profile():Promise<ZlibProfile>{return this.eapi('GET','/eapi/user/profile',{}).then(parseProfile);}
 ticket(id:string,hash:string):Promise<ZlibTicket>{return this.eapi('GET',`/eapi/book/${encodeURIComponent(id)}/${encodeURIComponent(hash)}/file`,{}).then(parseTicketResponse);}
 /** Downloads from the signed CDN link: account credentials must never leave the mirror origin. */
 async downloadFile(ticket:ZlibTicket):Promise<{bytes:ArrayBuffer;filename:string}>{
  const limit=this.maxDownloadBytes;
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('无效的下载大小限制。');
  const response=await this.fetcher(ticket.url,{method:'GET',headers:{'Accept':'*/*','User-Agent':'BananaReader','Referer':this.domain+'/',Range:'bytes=0-'+(limit-1)}});
  if(response.status!==200&&response.status!==206)throw new Error('Z-Library 文件下载失败，请稍后重试。');
  const range=response.headers['content-range']?.match(/^bytes 0-(\d+)\/(\d+)$/i),reported=Number(response.headers['content-length']||0);
  if(reported>limit||range&&Number(range[2])>limit)throw new Error('Z-Library 文件超过本设备的下载大小限制，请选择较小的版本。');
  if(response.status===206&&(!range||Number(range[1])+1!==Number(range[2])))throw new Error('Z-Library 文件下载不完整，请重试。');
  const bytes=await response.arrayBuffer;
  if(bytes.byteLength>limit)throw new Error('Z-Library 文件超过本设备的下载大小限制，请选择较小的版本。');
  if(!bytes.byteLength||range&&bytes.byteLength!==Number(range[2]))throw new Error('Z-Library 文件下载不完整，请重试。');
  return{bytes,filename:downloadFileName(ticket,response.headers['content-disposition']||'')};
 }
}

/** Splits user-entered mirror lines (or comma/semicolon lists) into normalized unique origins, order preserved. */
export function parseMirrorList(value:string):string[]{
 const seen=new Set<string>(),result:string[]=[];
 for(const item of (value||'').split(/[\n,;]+/)){const bare=item.trim();if(!bare)continue;const domain=normalizeZlibDomain(/^[a-z][a-z\d+.-]*:\/\//i.test(bare)?bare:'https://'+bare);if(domain&&!seen.has(domain)){seen.add(domain);result.push(domain);}}
 return result;
}

export interface ZlibProbe{domain:string;ok:boolean;ms:number;error?:string}
/** Cheap unauthenticated health check against /eapi/info/domains with an abandon-after timeout. */
export async function probeMirror(domain:string,fetcher:ZlibFetcher,timeoutMs=8000):Promise<ZlibProbe>{
 const started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const response=await Promise.race([
   fetcher(domain+'/eapi/info/domains',{method:'GET',headers:{'Accept':'application/json','User-Agent':'BananaReader'}}),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('超时')),timeoutMs);})]);
  const envelope=await Promise.resolve(response.json).catch(()=>undefined) as {success?:unknown}|undefined;
  if(!envelope||typeof envelope.success==='undefined')return{domain,ok:false,ms:Date.now()-started,error:'响应异常'};
  return{domain,ok:envelope.success===1,ms:Date.now()-started,error:envelope.success===1?undefined:'被拒绝'};
 }catch(error){return{domain,ok:false,ms:Date.now()-started,error:error instanceof Error?error.message:'网络错误'};}finally{clearTimeout(timer);}
}

/** Runs op against the active mirror and fails over down the list on mirror-level failures only. */
export async function withMirrorFailover<T>(domains:string[],startWith:string,make:(domain:string)=>ZLibraryClient,op:(client:ZLibraryClient)=>Promise<T>):Promise<{value:T;domain:string}>{
 let lastError:unknown;
 for(const domain of [startWith,...domains.filter(item=>item!==startWith)]){
  try{return{value:await op(make(domain)),domain};}
  catch(error){lastError=error;if(error instanceof ZlibApiError||error instanceof ZlibSessionError)throw error;}
 }
 throw lastError;
}

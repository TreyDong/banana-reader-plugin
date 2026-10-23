import {unzipSync,strFromU8} from 'fflate/browser';
export type BookBlock={kind:'p'|'heading'|'pre'|'image';text:string;level?:number;image?:string};
export interface BookSection {title:string;page?:number;blocks:BookBlock[]}
export interface Book {kind:'pdf'|'epub';title:string;author?:string;sections:BookSection[];images:Record<string,{bytes:Uint8Array;mime:string}>;warnings:string[]}
export const BOOK_LIMITS={file:40*1024*1024,unpacked:64*1024*1024,entry:12*1024*1024,entries:4000,pages:600,chapters:600,text:2000000};
export const readableExtension=(extension:string)=>['md','pdf','epub'].includes(extension.toLowerCase());
function abort(signal?:AbortSignal){if(signal?.aborted)throw new Error('已取消打开文档。');}
export function bookPath(base:string,href:string):string|null{
 const resource=href.replace(/[?#].*$/,'');
 if(resource.length===0)return base;
 let local:string;try{local=decodeURIComponent(resource);}catch{return null;}
 if(/[\\\0]/.test(local)||local.startsWith('/')||/^[a-z][a-z\d+.-]*:/i.test(local))return null;
 const directory=base.substring(0,base.lastIndexOf('/')+1);
 const parts:string[]=[];for(const part of (directory+local).split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
 const resolved=parts.join('/');
 if(resolved==='..'||resolved.startsWith('../'))return null;
 return resolved==='.'?'':resolved;
}
export function epubEntries(bytes:Uint8Array){
 if(bytes.byteLength>BOOK_LIMITS.file)throw new Error('电子书超过 40 MB，请使用较小的文件。');let count=0,total=0;
 try{return unzipSync(bytes,{filter:entry=>{if(++count>BOOK_LIMITS.entries||entry.originalSize>BOOK_LIMITS.entry||(total+=entry.originalSize)>BOOK_LIMITS.unpacked)throw new Error('电子书解压后过大。');if(!bookPath('',entry.name)||entry.name.startsWith('../'))throw new Error('电子书包含无效的资源路径。');return !entry.name.endsWith('/')&&!/\.(?:woff2?|ttf|otf|mp[34]|m4a|ogg|wav)$/i.test(entry.name);}});}catch(e){throw new Error(e instanceof Error&&e.message.startsWith('电子书')?e.message:'无法读取 EPUB 压缩包，文件可能已损坏或加密。');}
}
const children=(el:Element)=>Array.from(el.childNodes).filter((n):n is Element=>n.nodeType===1);
const elements=(el:Document|Element,name:string)=>Array.from(el.getElementsByTagName('*')).filter(e=>e.localName===name);
const plain=(el:Element)=>{
 const skip=new Set(['script','style','iframe','object','embed','svg','math','noscript','form','input','button','audio','video']);
 const text=(n:Node):string=>n.nodeType===3?n.textContent||'':n.nodeType!==1?'':skip.has((n as Element).localName)?'':(n as Element).localName==='br'?'\n':Array.from(n.childNodes).map(text).join('');
 return text(el).replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').trim();
};
export async function readEpub(bytes:Uint8Array,parse:(text:string,html?:boolean)=>Document,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<Book>{
 abort(signal);const files=epubEntries(bytes),xml=(path:string,html=false)=>{const data=files[path];if(!data)throw new Error('EPUB 缺少必需的文件：'+path);if(data.length>4*1024*1024)throw new Error('EPUB 章节过大。');const d=parse(strFromU8(data),html);if(elements(d,'parsererror').length)throw new Error('EPUB 的章节或目录格式无效。');return d;};
 const container=xml('META-INF/container.xml'),root=elements(container,'rootfile')[0]?.getAttribute('full-path'),opfPath=root?bookPath('',root):null;if(!opfPath)throw new Error('EPUB 缺少有效的内容清单。');const opf=xml(opfPath);
 if(files['META-INF/encryption.xml']){const encryption=xml('META-INF/encryption.xml');if(elements(encryption,'EncryptionMethod').some(e=>!['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'].includes(e.getAttribute('Algorithm')||'')))throw new Error('这本 EPUB 的正文受到 DRM 加密，暂不支持读取。');}
 const title=elements(opf,'title')[0]?.textContent?.trim()||'',author=elements(opf,'creator').map(e=>e.textContent?.trim()).filter(Boolean).join('、'),manifest=new Map(elements(opf,'item').map(el=>[el.getAttribute('id')||'',el]));
 const spine=elements(opf,'itemref').filter(el=>el.getAttribute('linear')!=='no').map(el=>manifest.get(el.getAttribute('idref')||''));if(!spine.length||spine.some(el=>!el))throw new Error('EPUB 的章节顺序清单不完整。');if(spine.length>BOOK_LIMITS.chapters)throw new Error('EPUB 超过 600 个章节文件。');
 const labels=new Map<string,string>();const nav=[...manifest.values()].find(el=>(el.getAttribute('properties')||'').split(/\s+/).includes('nav'));
 if(nav){const path=bookPath(opfPath,nav.getAttribute('href')||'');if(path){const d=xml(path,true),toc=elements(d,'nav').find(el=>(el.getAttribute('epub:type')||el.getAttribute('role')||'').includes('toc'))||elements(d,'nav')[0];if(toc)for(const a of elements(toc,'a')){const target=bookPath(path,a.getAttribute('href')||'');if(target&&!labels.has(target)&&plain(a))labels.set(target,plain(a));}}}
 if(!labels.size){const ncx=[...manifest.values()].find(el=>el.getAttribute('media-type')==='application/x-dtbncx+xml');if(ncx){const path=bookPath(opfPath,ncx.getAttribute('href')||'');if(path)for(const point of elements(xml(path),'navPoint')){const content=elements(point,'content')[0],text=elements(point,'text')[0],target=content?bookPath(path,content.getAttribute('src')||''):null;if(target&&text&&!labels.has(target))labels.set(target,plain(text));}}}
 const book:Book={kind:'epub',title,author,sections:[],images:{},warnings:[]};let chars=0,hasBody=false;
 const forbidden=new Set(['head','script','style','iframe','object','embed','svg','math','noscript','nav','form','input','button','audio','video','link','meta']);
 const blocks=new Set(['p','li','blockquote','pre','h1','h2','h3','h4','h5','h6','td','th','figcaption']);
 for(let i=0;i<spine.length;i++){
  abort(signal);onProgress?.(`正在读取 EPUB · ${i+1} / ${spine.length} 章`);const item=spine[i]!,path=bookPath(opfPath,item.getAttribute('href')||'');if(!path||!['application/xhtml+xml','text/html'].includes(item.getAttribute('media-type')||''))throw new Error('EPUB 包含暂不支持的正文格式。');
  const d=xml(path,true),body=elements(d,'body')[0];if(!body)throw new Error('EPUB 章节没有正文。');const section:BookSection={title:labels.get(path)||(elements(body,'h1')[0]||elements(body,'h2')[0]?plain((elements(body,'h1')[0]||elements(body,'h2')[0])).slice(0,80):'第 '+(i+1)+' 章'),blocks:[]};
  const image=(el:Element)=>{const ref=bookPath(path,el.getAttribute('src')||''),mime=ref?({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif'}[ref.split('.').pop()!.toLowerCase()]):undefined;if(!ref||!mime||!files[ref])return;book.images[ref]||={bytes:files[ref],mime};section.blocks.push({kind:'image',text:el.getAttribute('alt')||'',image:ref});};
  const visit=(node:Node)=>{if(node.nodeType===3){const text=node.textContent?.trim();if(text){section.blocks.push({kind:'p',text});hasBody=true;chars+=text.length;}return;}if(node.nodeType!==1)return;const el=node as Element,tag=el.localName.toLowerCase();if(forbidden.has(tag)||el.getAttribute('hidden')!==null||el.getAttribute('aria-hidden')==='true')return;if(tag==='img'){image(el);return;}
   if(blocks.has(tag)&&!Array.from(el.getElementsByTagName('*')).some(e=>blocks.has(e.localName))){const text=plain(el);if(text){section.blocks.push({kind:/^h[1-6]$/.test(tag)?'heading':tag==='pre'?'pre':'p',text,level:/^h/.test(tag)?Number(tag[1]):undefined});chars+=text.length;if(!/^h/.test(tag))hasBody=true;}for(const img of elements(el,'img'))image(img);return;}for(const child of Array.from(el.childNodes))visit(child);
  };visit(body);if(chars>BOOK_LIMITS.text)throw new Error('电子书正文超过 200 万字符，请按章节拆分后阅读。');if(section.blocks[0]?.kind==='heading'&&section.blocks[0].text===section.title)section.blocks.shift();if(section.blocks.length)book.sections.push(section);await new Promise(r=>setTimeout(r,0));
 }
 if(!hasBody)throw new Error('这本 EPUB 没有可提取的文字正文，暂不支持纯图片或加密电子书。');
 if(elements(opf,'meta').some(e=>e.getAttribute('property')==='rendition:layout'&&e.textContent?.trim()==='pre-paginated'))book.warnings.push('固定版式已转为文字重排，排版请以原文件为准。');return book;
}

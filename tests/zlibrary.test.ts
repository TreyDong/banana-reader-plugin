import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeZlibDomain,sanitizeZlibFilename,downloadFileName,parseSearchResponse,parseTicketResponse,parseProfile,parseMirrorList,probeMirror,withMirrorFailover,ZLibraryClient,ZlibSessionError,ZlibApiError,ZlibMirrorError,type ZlibFetcher,type ZlibTicket} from '../src/zlibrary';

interface RecordedCall{url:string;method:string;headers:Record<string,string>;body?:string}
function fetcherOf(handler:(call:RecordedCall)=>{status?:number;headers?:Record<string,string>;json?:unknown;bytes?:Uint8Array}|undefined){
 const calls:RecordedCall[]=[];
 const fetcher:ZlibFetcher=async(url,init)=>{const call={...init,url};calls.push(call);const response=handler(call)||{};
  return{status:response.status??200,headers:response.headers||{},json:response.json??null,text:'',arrayBuffer:Promise.resolve(response.bytes?response.bytes.buffer.slice(response.bytes.byteOffset,response.bytes.byteOffset+response.bytes.byteLength) as ArrayBuffer:new ArrayBuffer(0))};};
 return{calls,fetcher};
}
const credentials={userId:'42',userKey:'secret-key'};
test('bounded downloads accept a complete ranged response and reject partial or oversized books',async()=>{
 const ticket={url:'https://cdn.example/book',description:'Book',author:'QA',extension:'pdf'};
 const complete=fetcherOf(()=>({status:206,headers:{'content-range':'bytes 0-2/3'},bytes:new Uint8Array([1,2,3])}));
 const file=await new ZLibraryClient('https://z-lib.gd',credentials,complete.fetcher,4).downloadFile(ticket);assert.equal(file.bytes.byteLength,3);assert.equal(complete.calls[0].headers.Range,'bytes=0-3');assert.equal(complete.calls[0].headers.Cookie,undefined);
 for(const response of [{status:206,headers:{'content-range':'bytes 0-3/20'},bytes:new Uint8Array(4)},{headers:{'content-length':'20'},bytes:new Uint8Array(1)},{bytes:new Uint8Array(5)}]){const f=fetcherOf(()=>response);await assert.rejects(new ZLibraryClient('https://z-lib.gd',credentials,f.fetcher,4).downloadFile(ticket),/大小限制/);}
 for(const response of [{status:206,headers:{'content-range':'bytes 0-1/3'},bytes:new Uint8Array(2)},{status:206,headers:{'content-range':'bytes 1-2/3'},bytes:new Uint8Array(2)},{status:206,headers:{'content-range':'bytes 0-2/3'},bytes:new Uint8Array(2)},{bytes:new Uint8Array(0)}]){const f=fetcherOf(()=>response);await assert.rejects(new ZLibraryClient('https://z-lib.gd',credentials,f.fetcher,4).downloadFile(ticket),/不完整/);}
});

test('mirror domains must be bare HTTPS origins',()=>{
 assert.equal(normalizeZlibDomain('https://z-lib.gd/'),'https://z-lib.gd');
 assert.equal(normalizeZlibDomain(' https://Z-LIB.gd '),'https://z-lib.gd');
 for(const bad of ['','http://z-lib.gd','https://z-lib.gd/eapi','https://z-lib.gd/?x=1','https://user:pass@z-lib.gd','z-lib.gd','https://'])assert.equal(normalizeZlibDomain(bad),null);
});

test('download filenames survive traversal, control characters and Windows reserved characters',()=>{
 assert.equal(sanitizeZlibFilename('../../etc/passwd'),'etc passwd');
 assert.equal(sanitizeZlibFilename('书\t名\n'), '书 名');
 assert.equal(sanitizeZlibFilename('A:B|C?.epub'),'A_B_C_.epub');
 assert.equal(sanitizeZlibFilename(''),'download');
 assert.equal(sanitizeZlibFilename('   '), 'download');
 assert.equal(sanitizeZlibFilename('\u202eevil.epub'),'evil.epub');
});

test('download filenames prefer headers, strip mirror suffixes and keep an extension',()=>{
 const ticket:ZlibTicket={url:'https://cdn.example/file',description:'钱的第四维',author:'温铁军',extension:'pdf'};
 assert.equal(downloadFileName(ticket,'attachment; filename="钱的第四维 (z-lib.gd).pdf"'),'钱的第四维.pdf');
 assert.equal(downloadFileName(ticket,''),'钱的第四维 (温铁军).pdf');
 assert.equal(downloadFileName({url:'',description:'No Ext',author:'',extension:''},'attachment; filename=book.epub'),'book.epub');
 assert.equal(downloadFileName({url:'',description:'Bare',author:'',extension:'EPUB'}),'Bare.epub');
 assert.equal(downloadFileName({url:'',description:'Only Suffix (z-library.se)',author:'',extension:'mobi'},''),'Only Suffix.mobi');
});

test('search responses map books defensively and fall back pagination to the requested page',()=>{
 const parsed=parseSearchResponse({success:1,books:[{id:115066162,hash:'e9f13b',title:'Test',author:'Author',year:2020,extension:'PDF',filesizeString:'1.2 MB',description:'<p>简介</p>'},{id:'x',hash:'',title:''}],pagination:{current:2,total_pages:7}},3);
 assert.equal(parsed.books[0]!.id,'115066162');assert.equal(parsed.books[0]!.extension,'pdf');assert.equal(parsed.books[0]!.size,'1.2 MB');
 assert.equal(parsed.books[1]!.title,'（无标题）');assert.deepEqual(parsed.books[1]!.authors,[]);
 assert.equal(parsed.page,2);assert.equal(parsed.totalPages,7);
 const fallback=parseSearchResponse({success:1,books:[]},4);assert.equal(fallback.page,4);assert.equal(fallback.totalPages,4);
 assert.throws(()=>parseSearchResponse({success:0,error:'daily limit reached'}),/daily limit reached/);
 assert.throws(()=>parseSearchResponse({success:0}),/搜索被拒绝/);
});

test('ticket responses accept nested and flat link fields and reject empty links',()=>{
 assert.equal(parseTicketResponse({success:1,file:{downloadLink:'https://cdn/a.pdf',description:'D',author:'A',extension:'PDF'}}).url,'https://cdn/a.pdf');
 assert.equal(parseTicketResponse({success:1,downloadLink:'https://cdn/b.epub'}).url,'https://cdn/b.epub');
 assert.throws(()=>parseTicketResponse({success:1,file:{}}),/未返回可用的下载链接/);
 assert.throws(()=>parseTicketResponse({success:0,error:'not authorized'}),/not authorized/);
});

test('profiles expose only explicit remaining-download fields',()=>{
 assert.equal(parseProfile({success:1,user:{name:'N',email:'a@b.c',dailyRemain:7}}).remaining,7);
 assert.equal(parseProfile({success:1,user:{name:'N',downloads_left:'3'}}).remaining,3);
 assert.equal(parseProfile({success:1,user:{name:'N',dailyLimit:10}}).remaining,null);
 assert.throws(()=>parseProfile({success:0}),/获取账号信息被拒绝/);
});

test('login exchanges credentials and guides to cookie paste when the login endpoint rejects',async()=>{
 const {calls,fetcher}=fetcherOf(({url,body})=>{
  assert.equal(url,'https://z-lib.gd/eapi/user/login');
  assert.match(body!,/email=a%40b.c/);assert.match(body!,/password=pw/);
  return{json:{success:1,user:{id:42,remix_userkey:'secret-key'}}};
 });
 const client=new ZLibraryClient('https://z-lib.gd',{userId:'',userKey:''},fetcher);
 assert.deepEqual(await client.login('a@b.c','pw'),credentials);
 assert.equal(calls[0]!.headers['Cookie'],undefined);
 const rejected=fetcherOf(()=>({status:400,json:{success:0,error:'Authorization failed'}}));
 await assert.rejects(new ZLibraryClient('https://z-lib.gd',{userId:'',userKey:''},rejected.fetcher).login('a@b.c','pw'),/remix_userid/);
 const wrong=fetcherOf(()=>({json:{success:0,error:'Incorrect email or password'}}));
 await assert.rejects(new ZLibraryClient('https://z-lib.gd',{userId:'',userKey:''},wrong.fetcher).login('a@b.c','pw'),/Incorrect email or password/);
});

test('search sends filters with session credentials and classifies expired sessions',async()=>{
 const {calls,fetcher}=fetcherOf(({url,headers,body})=>{
  assert.equal(url,'https://z-lib.gd/eapi/book/search');
  assert.equal(headers['Cookie'],'remix_userid=42; remix_userkey=secret-key');
  assert.equal(headers['remix-userid'],'42');assert.equal(headers['remix-userkey'],'secret-key');
  assert.match(body!,/message=%E4%B9%A6/);assert.match(body!,/extensions%5B%5D=pdf/);assert.match(body!,/languages%5B%5D=chinese/);assert.match(body!,/order=bestmatch/);
  return{json:{success:1,books:[{id:1,hash:'h',title:'书'}],pagination:{current:1,total_pages:1}}};
 });
 const client=new ZLibraryClient('https://z-lib.gd',credentials,fetcher);
 const page=await client.search('书',{extensions:['PDF'],languages:['chinese'],order:'bestmatch',limit:99});
 assert.equal(page.books[0]!.id,'1');assert.equal(calls[0]!.body!.match(/limit=(\d+)/)![1],'50');
 const expired=fetcherOf(()=>({json:{success:0,error:'Invalid credentials'}}));
 await assert.rejects(new ZLibraryClient('https://z-lib.gd',credentials,expired.fetcher).search('x'),ZlibSessionError);
 const plain=fetcherOf(()=>({json:{success:0,error:'daily limit reached'}}));
 await assert.rejects(new ZLibraryClient('https://z-lib.gd',credentials,plain.fetcher).search('x'),/daily limit reached/);
});

test('downloads resolve the ticket then fetch the CDN link without session credentials',async()=>{
 const {calls,fetcher}=fetcherOf(call=>{
  if(call.url.endsWith('/file')){assert.equal(call.method,'GET');assert.equal(call.headers['Cookie'],'remix_userid=42; remix_userkey=secret-key');return{json:{success:1,file:{downloadLink:'https://cdn.zlib.example/get/9',description:'Dune',author:'Frank Herbert',extension:'pdf'}}};}
  assert.equal(call.url,'https://cdn.zlib.example/get/9');
  assert.equal(call.headers['Cookie'],undefined);assert.equal(call.headers['remix-userkey'],undefined);
  return{headers:{'content-disposition':'attachment; filename="Dune (z-lib.gd).pdf"'},bytes:new Uint8Array([1,2,3])};
 });
 const client=new ZLibraryClient('https://z-lib.gd',credentials,fetcher);
 const ticket=await client.ticket('9','abc');
 assert.equal(ticket.extension,'pdf');
 const file=await client.downloadFile(ticket);
 assert.equal(file.filename,'Dune.pdf');
 assert.equal(new Uint8Array(file.bytes).length,3);
 assert.equal(calls.length,2);
 const failing=fetcherOf(()=>({status:403}));
 await assert.rejects(new ZLibraryClient('https://z-lib.gd',credentials,failing.fetcher).downloadFile({url:'https://cdn/x',description:'',author:'',extension:'pdf'}),/下载失败/);
});

test('mirror lists normalize, dedupe and drop invalid entries in order',()=>{
  assert.deepEqual(parseMirrorList('https://z-lib.gd/\nhttps://z-lib.gd\nhttp://bad\nz-lib.gl, https://z-library.ec ;https://a.b'),['https://z-lib.gd','https://z-lib.gl','https://z-library.ec','https://a.b']);
 assert.deepEqual(parseMirrorList('  \n'),[]);
});

test('probing reports latency for healthy mirrors and failures for blocked ones',async()=>{
  const healthy=fetcherOf(()=>({json:{success:1,domains:{main:'https://z-lib.gd'}}}));
 const probe=await probeMirror('https://z-lib.gd',healthy.fetcher);
 assert.equal(probe.ok,true);assert.equal(probe.error,undefined);assert.ok(probe.ms>=0);
 const blocked=fetcherOf(()=>({text:'<html>DiamWall</html>',json:null}));
 const bad=await probeMirror('https://z-lib.gd',blocked.fetcher);
 assert.equal(bad.ok,false);assert.equal(bad.error,'响应异常');
 const dead=fetcherOf(()=>{throw new Error('connect ECONNREFUSED');});
 const down=await probeMirror('https://z-lib.gd',dead.fetcher);
 assert.equal(down.ok,false);assert.match(down.error!,/ECONNREFUSED/);
});

test('failover walks mirrors on mirror errors but never on server-answered errors',async()=>{
 const made:string[]=[];
 const make=(domain:string)=>{made.push(domain);return {domain} as never;};
 const failFirst=async(client:{domain:string})=>{if(client.domain==='https://a.b')throw new ZlibMirrorError();return 'ok:'+client.domain;};
 const result=await withMirrorFailover(['https://a.b','https://c.d'],'https://a.b',make,failFirst);
 assert.deepEqual(result,{value:'ok:https://c.d',domain:'https://c.d'});assert.deepEqual(made,['https://a.b','https://c.d']);
 made.length=0;
 await assert.rejects(withMirrorFailover(['https://a.b','https://c.d'],'https://a.b',make,async()=>{throw new ZlibApiError('Z-Library：daily limit reached');}),/daily limit/);
 assert.deepEqual(made,['https://a.b']);
 made.length=0;
 await assert.rejects(withMirrorFailover(['https://a.b'],'https://a.b',make,async()=>{throw new ZlibMirrorError();}),ZlibMirrorError);
 assert.deepEqual(made,['https://a.b']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { once } from 'node:events';
import { makeAnchor, resolveAnchor, indexPassages, contextFor, freshReading, exportReading, blockedPath } from '../src/core';
import { apiEndpoint, askAgent, parseCodexLine } from '../src/agent';
import {placeMarginItems, segmentMarks} from '../src/reading-ui';

test('margin notes remain next to their paragraphs when they do not collide',()=>{
  assert.deepEqual(placeMarginItems([{id:'a',desired:100,height:60,created:1},{id:'b',desired:300,height:90,created:2}]),{a:100,b:300});
});
test('active margin comment keeps its anchor while neighboring notes move above and below',()=>{
  const items=[{id:'a',desired:200,height:60,created:1},{id:'active',desired:220,height:180,created:2},{id:'b',desired:240,height:50,created:3}];
  assert.deepEqual(placeMarginItems(items,'active'),{a:144,active:220,b:416});
});
test('dense comments never overlap or extend above the page',()=>{
  const items=[{id:'a',desired:0,height:110,created:1},{id:'b',desired:3,height:170,created:2},{id:'c',desired:9,height:40,created:3}];
  const tops=placeMarginItems(items,'b');assert.ok(tops.a>=0);for(let i=1;i<items.length;i++)assert.ok(tops[items[i].id]>=tops[items[i-1].id]+items[i-1].height+16);
  assert.deepEqual(placeMarginItems([]),{});
});
test('margin spacing remains stable across crowded layouts and pins a feasible active card',()=>{
  for(let seed=0;seed<80;seed++){
    const items=Array.from({length:1+seed%13},(_,i)=>({id:'card-'+i,desired:Math.floor((i*i*19+seed*7)/3),height:18+(seed*13+i*17)%180,created:i,mini:(seed+i)%3===0}));
    const original=structuredClone(items),selected=seed%items.length;
    const positions=placeMarginItems(items,items[selected].id);
    let required=0;
    for(let i=0;i<items.length;i++){
      assert.ok(Number.isFinite(positions[items[i].id]));
      assert.ok(positions[items[i].id]>=0);
      if(i){const prior=items[i-1],gap=prior.mini&&items[i].mini?4:16;required+=prior.height+gap;assert.ok(positions[items[i].id]>=positions[prior.id]+prior.height+gap);}
      if(i===selected)assert.equal(positions[items[i].id],Math.max(items[i].desired,required));
    }
    assert.deepEqual(items,original);
    assert.deepEqual(placeMarginItems(items,items[selected].id),positions);
  }
});
test('margin placement handles an absent active card and page-edge anchors without overlap',()=>{
  const items=[{id:'one',desired:-20,height:0,created:1},{id:'two',desired:0,height:25,created:2},{id:'three',desired:4,height:0,created:3}];
  assert.deepEqual(placeMarginItems(items,'missing'),placeMarginItems(items));
  const result=placeMarginItems(items,'three');
  assert.equal(result.one,0);assert.ok(result.two>=16);assert.ok(result.three>=result.two+41);
});

import {bookPath} from '../src/formats';
test('EPUB resource resolution preserves literal Unicode filenames and rejects encoded root escapes',()=>{
  assert.equal(bookPath('OPS/book.opf','#chapter'),'OPS/book.opf');
  assert.equal(bookPath('OPS/chapter/a.xhtml','../图像/封面%23一.png?cache=1#part'),'OPS/图像/封面#一.png');
  assert.equal(bookPath('OPS/book.opf','./chapters/../二.xhtml'),'OPS/二.xhtml');
  assert.equal(bookPath('OPS/book.opf','../title.xhtml'),'title.xhtml');
  for(const href of ['../../outside','%2e%2e/%2e%2e/outside','%2Foutside','%5coutside','%00bad','file:///etc/passwd','https%3A%2F%2Fexample.invalid/a','%E0%A4%A'])assert.equal(bookPath('OPS/book.opf',href),null);
});
test('overlapping reader highlight and AI underline retain both identities without nested marks',()=>{
  const segments=segmentMarks(12,[{id:'h',start:1,end:9,kind:'highlight',color:'blue'},{id:'g',start:5,end:11,kind:'thread'}]);
  assert.deepEqual(segments.map(s=>[s.start,s.end,s.highlights.map(h=>h.id),s.threads.map(g=>g.id)]),[[0,1,[],[]],[1,5,['h'],[]],[5,9,['h'],['g']],[9,11,[],['g']],[11,12,[],[]]]);
  assert.equal(segments.reduce((sum,s)=>sum+s.end-s.start,0),12);
});
test('a newer overlapping color does not destroy the previous highlight boundaries',()=>{
  const segments=segmentMarks(9,[{id:'yellow',start:0,end:7,kind:'highlight',color:'yellow'},{id:'pink',start:3,end:9,kind:'highlight',color:'pink'}]);
  assert.deepEqual(segments.map(s=>s.highlights.at(-1)?.color),['yellow','pink','pink']);assert.equal(segments[1].highlights.length,2);
});
test('cross-paragraph marks clip to each text block without adding or dropping characters',()=>{
  const segments=segmentMarks(6,[{id:'wide',start:-4,end:4,kind:'highlight',color:'green'},{id:'next',start:4,end:11,kind:'thread'},{id:'invalid',start:7,end:3,kind:'pending'}]);
  assert.deepEqual(segments.map(s=>[s.start,s.end]),[[0,4],[4,6]]);assert.equal(segments[0].highlights[0].id,'wide');assert.equal(segments[1].threads[0].id,'next');assert.ok(segments.every(s=>!s.pending));
});

test('Chinese selection survives inserted paragraphs and repeated phrases', () => {
  const source = '第一章\n\n我们在这里慢慢阅读。\n\n第二章\n\n我们在这里慢慢阅读。';
  const start = source.lastIndexOf('我们在这里'); const a = makeAnchor(source, start, source.length);
  const edited = '新增说明。\n\n' + source;
  assert.equal(resolveAnchor(edited, a), edited.lastIndexOf('我们在这里'));
  assert.equal(edited.slice(resolveAnchor(edited, a)!), a.quote);
});
test('missing and ambiguous quotes are never guessed onto another passage', () => {
  const a = makeAnchor('前文这一句后文', 2, 5);
  assert.equal(resolveAnchor('前文已经改写后文', a), null);
  const b = makeAnchor('这一句', 0, 3);
  assert.equal(resolveAnchor('这一句——这一句', b), null);
});
test('anchors trim whitespace without losing CJK or emoji offsets', () => {
  const text = '甲\n\n  阅读📖，保留理解。  \n\n乙';
  const a = makeAnchor(text, 3, text.length - 3);
  assert.equal(a.quote, '阅读📖，保留理解。');
  assert.equal(resolveAnchor(text, a), text.indexOf('阅读'));
});
test('nearby context includes complete selected paragraphs, preserves numbering and excludes unrelated passages', () => {
  const ix = indexPassages(['引言', '背景', '核心观点', '论据', '结论', '无关附录']);
  const a = makeAnchor(ix.text, ix.passages[2].start, ix.passages[2].end);
  const c = contextFor(ix.passages, a, ix.text, false, 1000);
  assert.equal(c, '[¶2] 背景\n\n[¶3] 核心观点\n\n[¶4] 论据');
  assert.throws(() => contextFor(ix.passages, undefined, ix.text, true, 4), /超过/);
  const changed = makeAnchor('旧的原句', 0, 5);
  assert.throws(() => contextFor(ix.passages, changed, ix.text, false, 1000), /无法可靠定位/);
});
test('cross-paragraph selection keeps all selected passages', () => {
  const ix = indexPassages(['A', 'B段', 'C段', 'D', 'E']);
  const a = makeAnchor(ix.text, ix.passages[1].start, ix.passages[2].end);
  assert.equal(contextFor(ix.passages, a, ix.text, false, 1000), '[¶1] A\n\n[¶2] B段\n\n[¶3] C段\n\n[¶4] D');
});
test('exports retain quote, personal note, full conversation and encoded return links', () => {
  const r = freshReading(); const a = makeAnchor('完整的原文', 0, 5);
  r.highlights.push({id:'h1',anchor:a,color:'yellow',note:'我的批注',created:1});
  r.highlights.push({id:'removed',anchor:a,color:'pink',note:'不应导出',created:1,removed:true});
  r.threads.push({id:'t1',anchor:a,messages:[{role:'user',content:'为什么？'},{role:'assistant',content:'解释 [¶1]'}],created:1});
  const md = exportReading('剪藏/一篇 文档.md', r, '00_个人库');
  assert.match(md,/obsidian:\/\/banana-reader\?/);assert.doesNotMatch(md,/obsidian:\/\/gloss-reader\?/);
  assert.match(md, /我的批注/); assert.match(md, /解释 \[¶1\]/); assert.match(md, /anchor=h1/); assert.match(md, /anchor=t1/); assert.ok(md.includes(encodeURIComponent('剪藏/一篇 文档.md'))); assert.ok(!md.includes('不应导出'));
});
test('protected directories are excluded without matching unrelated similar names', () => {
  for (const p of ['日记/今天.md', '20_投资库/a.md', '子目录/60_工作库/a.md', 'A1_交易数据/a.md']) assert.equal(blockedPath(p), true);
  assert.equal(blockedPath('自媒体/阅读日记的方法.md'), false);
});
test('Codex parser accepts complete answers and recognizes failures without leaking diagnostics', () => {
  assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"答案 [¶1]"}}'), {text:'答案 [¶1]'});
  assert.deepEqual(parseCodexLine('{"type":"turn.failed","error":{"message":"failed"}}'), {error:'failed'});
  assert.deepEqual(parseCodexLine('diagnostic private-output'), {});
});
test('API endpoint validation allows TLS and localhost, rejects credential URLs and remote HTTP', () => {
  assert.equal(apiEndpoint('https://example.com/v1/').pathname, '/v1/chat/completions');
  assert.equal(apiEndpoint('http://127.0.0.1:1234/v1').hostname, '127.0.0.1');
  assert.throws(() => apiEndpoint('http://example.com/v1'));
  assert.throws(() => apiEndpoint('https://key@example.com/v1'));
  assert.throws(() => apiEndpoint('https://example.com/v1?key=x'));
});

async function mockService(handler: http.RequestListener) {
  const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as {port:number};
  return {server, settings:{provider:'api',codexPath:'',codexModel:'',apiBase:`http://127.0.0.1:${address.port}/v1`,apiKey:'test-key',apiModel:'test-model'}};
}
test('API roundtrip streams a chunked SSE response and sends only the given context/history', async () => {
  let request: any; const updates: string[] = [];
  const {server,settings} = await mockService((req,res) => {let body=''; req.on('data',b=>body+=b); req.on('end',()=>{request=JSON.parse(body); res.writeHead(200,{'Content-Type':'text/event-stream'}); res.write('data: {"choices":[{"delta":{"content":"解释"}}]}\r\n\r\n'); setTimeout(()=>res.end('data: {"choices":[{"delta":{"content":" [¶1]"}}]}\n\ndata: [DONE]\n\n'),20);});});
  try {const answer=await askAgent({settings,context:'[¶1] 公开测试原文',messages:[{role:'user',content:'请解释'}],signal:new AbortController().signal,onText:t=>updates.push(t)}); assert.equal(answer,'解释 [¶1]'); assert.deepEqual(updates,['解释','解释 [¶1]']); assert.equal(request.model,'test-model'); assert.equal(request.messages.at(-1).content,'请解释'); assert.ok(JSON.stringify(request).includes('公开测试原文'));} finally {server.closeAllConnections(); server.close();}
});
test('API cancellation closes a pending request', async () => {
  const {server,settings}=await mockService((req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': keepalive\n\n');});
  try {const c=new AbortController();const p=askAgent({settings,context:'test',messages:[],signal:c.signal,onText:()=>{}});setTimeout(()=>c.abort(),30);await assert.rejects(p,/已停止/);} finally {server.closeAllConnections();server.close();}
});
test('API failures never echo provider error bodies or keys', async () => {
  const {server,settings}=await mockService((req,res)=>{res.writeHead(401);res.end('secret-provider-error test-key');});
  try {await assert.rejects(askAgent({settings,context:'test',messages:[],signal:new AbortController().signal,onText:()=>{}}), e => String(e).includes('401') && !String(e).includes('test-key') && !String(e).includes('secret-provider-error'));} finally {server.closeAllConnections();server.close();}
});

import {DEFAULT_COMMANDS,MAX_COMMANDS,normalizeCommands,saveCommand,renderCommand} from '../src/prompts';
import {parseApiEvent,apiRequest,cliConfig,parseClaudeLine,type ApiProtocol} from '../src/agent';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('command migration preserves edits, ordering and deliberate empty lists',()=>{
  assert.equal(normalizeCommands(undefined).length,5);assert.deepEqual(normalizeCommands([]),[]);
  const edited=[{id:'translate',name:'译成中文',prompt:'只译中文。'},{id:'mine',name:'我的指令',prompt:'自定义'}];
  assert.deepEqual(normalizeCommands(edited).map(c=>[c.id,c.name,c.prompt]),edited.map(c=>[c.id,c.name,c.prompt]));
  assert.equal(normalizeCommands([...edited,...edited]).length,2);
});
test('eight-command cap allows edits at capacity and rejects a ninth command',()=>{
  let c=normalizeCommands(undefined);for(let i=c.length;i<MAX_COMMANDS;i++)c=saveCommand(c,{id:'custom'+i,name:'指令'+i,prompt:'问题'});
  assert.equal(c.length,8);assert.throws(()=>saveCommand(c,{id:'ninth',name:'第九条',prompt:'不应保存'}),/最多/);
  const updated=saveCommand(c,{...c[0],prompt:'修改内置 prompt'});assert.equal(updated[0].prompt,'修改内置 prompt');assert.equal(c[0].prompt,DEFAULT_COMMANDS[0].prompt);
  assert.throws(()=>saveCommand(c,{...c[0],prompt:' '}),/Prompt/);assert.throws(()=>saveCommand(c,{...c[0],name:'长'.repeat(17)}),/名称/);
});
test('command placeholders are literal, preserve dollar signs and never execute code',()=>{
  assert.equal(renderCommand('针对 {{title}}：{{selection}}','带 $& 与 {{title}} 的原文','文档'),'针对 文档：带 $& 与 {{title}} 的原文');
  assert.equal(renderCommand('{{unknown}}','x','y'),'{{unknown}}');
});
for(const protocol of ['responses','anthropic','gemini'] as ApiProtocol[])for(const stream of [true,false])test(protocol+' handles '+(stream?'chunked SSE':'JSON')+' with correct request/auth and no duplicated final text',async()=>{
  let sent:any,headers:any,path='';const updates:string[]=[];
  const {server,settings}=await mockService((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{sent=JSON.parse(raw);headers=req.headers;path=req.url||'';
    const final=protocol==='responses'?{status:'completed',output:[{content:[{type:'output_text',text:'解释 [¶1]'}]}]}:protocol==='anthropic'?{content:[{type:'text',text:'解释 [¶1]'}]}:{candidates:[{content:{parts:[{text:'解释 [¶1]'}]}}]};
    if(!stream){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(final));return;}
    const events=protocol==='responses'?[{type:'response.output_text.delta',delta:'解释'},{type:'response.output_text.delta',delta:' [¶1]'},{type:'response.completed',response:final}]:protocol==='anthropic'?[{type:'content_block_delta',delta:{type:'text_delta',text:'解释'}},{type:'content_block_delta',delta:{type:'text_delta',text:' [¶1]'}},{type:'message_stop'}]:[{candidates:[{content:{parts:[{text:'secret thought',thought:true},{text:'解释'}]}}]},{candidates:[{content:{parts:[{text:' [¶1]'}]}}]}];
    res.writeHead(200,{'Content-Type':'text/event-stream'});const output=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');res.write(output.slice(0,31));setTimeout(()=>res.end(output.slice(31)),10);
  });});
  try{const answer=await askAgent({settings:{...settings,apiProtocol:protocol},context:'[¶1] 公开原文',messages:[{role:'user',content:'我的指令'}],signal:new AbortController().signal,onText:t=>updates.push(t)});assert.equal(answer,'解释 [¶1]');assert.equal(updates.at(-1),answer);
    if(protocol==='responses'){assert.equal(path,'/v1/responses');assert.equal(sent.store,false);assert.equal(sent.input.at(-1).content,'我的指令');assert.equal(headers.authorization,'Bearer test-key');}
    if(protocol==='anthropic'){assert.equal(path,'/v1/messages');assert.equal(headers['x-api-key'],'test-key');assert.equal(headers['anthropic-version'],'2023-06-01');assert.equal(sent.messages.at(-1).content,'我的指令');assert.ok(sent.max_tokens>0);}
    if(protocol==='gemini'){assert.equal(path,'/v1/models/test-model:streamGenerateContent?alt=sse');assert.equal(headers['x-goog-api-key'],'test-key');assert.ok(!path.includes('test-key'));assert.equal(sent.contents.at(-1).parts[0].text,'我的指令');}
  }finally{server.closeAllConnections();server.close();}
});
test('all API protocols cancel, sanitize errors and reject unsafe endpoints',async()=>{
  for(const protocol of ['openai','responses','anthropic','gemini'] as ApiProtocol[]){
    const {server,settings}=await mockService((req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(':keepalive\n\n');});
    try{const c=new AbortController();const p=askAgent({settings:{...settings,apiProtocol:protocol},context:'test',messages:[],signal:c.signal,onText:()=>{}});setTimeout(()=>c.abort(),10);await assert.rejects(p,/已停止/);}finally{server.closeAllConnections();server.close();}
    for(const base of ['https://secret@example.com/v1','https://example.com/v1?key=secret','http://example.com/v1'])assert.throws(()=>apiEndpoint(base,protocol,'m'));
    const bad=await mockService((req,res)=>{res.writeHead(401);res.end('test-key private-provider-message');});try{await assert.rejects(askAgent({settings:{...bad.settings,apiProtocol:protocol},context:'test',messages:[],signal:new AbortController().signal,onText:()=>{}}),e=>String(e).includes('401')&&!String(e).includes('test-key')&&!String(e).includes('private-provider-message'));}finally{bad.server.closeAllConnections();bad.server.close();}
  }
  assert.deepEqual(parseApiEvent('responses',{type:'response.failed',response:{error:{message:'private'}}}),{error:true});assert.deepEqual(parseApiEvent('gemini',{promptFeedback:{blockReason:'SAFETY'}}),{error:true});
});
test('Claude CLI isolates tools/config, sends stdin context, parses text without duplicating final events',async()=>{
  const folder=await fs.mkdtemp(join(tmpdir(),'reader-claude-test-'));const bin=join(folder,'claude');
  await fs.writeFile(bin,'#!/usr/bin/env node\nlet data="";process.stdin.on("data",b=>data+=b);process.stdin.on("end",()=>{if(!data.includes("公开上下文")||!process.argv.includes("--safe-mode"))process.exit(2);for(const e of [{type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:"Claude 回答"}}},{type:"assistant",message:{content:[{type:"text",text:"Claude 回答"}]}},{type:"result",subtype:"success",result:"Claude 回答"}])console.log(JSON.stringify(e));});\n',{mode:0o700});
  const settings={provider:'claude',claudePath:bin,claudeModel:'sonnet',codexPath:'',codexModel:'',apiBase:'',apiKey:'',apiModel:''};
  try{const config=cliConfig(settings);assert.equal(config.args[config.args.indexOf('--tools')+1],'');assert.ok(config.args.includes('--safe-mode'));assert.ok(config.args.includes('--strict-mcp-config'));assert.ok(config.args.includes('--no-session-persistence'));assert.ok(!config.args.includes('--dangerously-skip-permissions'));
    const updates:string[]=[];assert.equal(await askAgent({settings,context:'公开上下文',messages:[{role:'user',content:'测试'}],signal:new AbortController().signal,onText:t=>updates.push(t)}),'Claude 回答');assert.deepEqual(updates,['Claude 回答']);
    assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"error","is_error":true,"result":"private"}'),{error:true});assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}'),{error:true,login:true});
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

import {markStyle,MARK_STYLES} from '../src/core';
import {railMagnification} from '../src/reading-ui';
import {normalizeModels,mergeModels,discoverCodexModels,discoverApiModels,apiRequest} from '../src/agent';
test('legacy marks retain highlight style, wave and underline export without losing quote or notes',()=>{
  assert.equal(markStyle(undefined),'highlight');assert.equal(markStyle('unsupported'),'highlight');assert.equal(markStyle('wavy'),'wavy');
  const r=freshReading();r.highlights.push({id:'wave',anchor:makeAnchor('原文引句',0,4),color:'blue',style:'wavy',note:'我的理解',created:1});
  r.threads.push({id:'t',anchor:makeAnchor('原文引句',0,4),messages:[{role:'user',content:'为什么？'},{role:'assistant',content:'因为原文如此。[¶1]',provider:'claude',model:'sonnet'}],created:1});
  const md=exportReading('文章.md',r,'test');assert.match(md,/波浪线/);assert.match(md,/> 原文引句/);assert.match(md,/我的理解/);assert.match(md,/Agent · sonnet/);assert.match(md,/\[¶1\]/);assert.equal(MARK_STYLES.underline,'直线');
});
test('timeline magnification peaks near the reading position and decays symmetrically',()=>{
  assert.equal(railMagnification(0),2.25);assert.ok(railMagnification(15)>railMagnification(45));assert.equal(railMagnification(-20),railMagnification(20));assert.ok(railMagnification(300)<1.001);
});
test('model discovery filters hidden Codex entries and preserves custom choices without duplicates',async()=>{
  const folder=await fs.mkdtemp(join(tmpdir(),'reader-models-'));try{const cache=join(folder,'models.json');await fs.writeFile(cache,JSON.stringify({models:[{slug:'available',display_name:'Available',visibility:'list'},{slug:'internal',visibility:'hide'}]}));assert.deepEqual(await discoverCodexModels(cache),[{id:'available',name:'Available'}]);assert.deepEqual(await discoverCodexModels(join(folder,'missing')),[]);
  assert.deepEqual(mergeModels([{id:'custom',name:'My model'}],[{id:'custom',name:'Other'},{id:'available',name:'Available'}]).map(m=>m.name),['My model','Available']);assert.equal(normalizeModels(['bad id','',null,{},'valid','valid']).length,1);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('model lists use protocol auth, filter Gemini embedding models, sanitize failures and support abort',async()=>{
  let auth:any;const server=http.createServer((req,res)=>{auth=req.headers;if(req.url==='/fail/models'){res.writeHead(403);res.end('private-key');return;}if(req.url==='/wait/models')return;
    res.setHeader('content-type','application/json');res.end(req.url==='/gemini/models'?JSON.stringify({models:[{name:'models/chat',displayName:'Chat',supportedGenerationMethods:['generateContent']},{name:'models/embed',supportedGenerationMethods:['embedContent']}]}):JSON.stringify({data:[{id:'chat-one',name:'Chat One'},{id:'chat-two'}]}));});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address()as any).port;
  const settings={provider:'api',apiProtocol:'openai' as const,codexPath:'',codexModel:'',apiBase:base,apiKey:'test-key',apiModel:'chat-one'};
  try{for(const protocol of ['openai','responses','anthropic','gemini']as const){const result=await discoverApiModels({...settings,apiProtocol:protocol,apiBase:protocol==='gemini'?base+'/gemini':base},new AbortController().signal);assert.equal(result[0].id,protocol==='gemini'?'chat':'chat-one');assert.equal(result.length,protocol==='gemini'?1:2);assert.equal(auth[protocol==='anthropic'?'x-api-key':protocol==='gemini'?'x-goog-api-key':'authorization'],protocol==='openai'||protocol==='responses'?'Bearer test-key':'test-key');}
  await assert.rejects(discoverApiModels({...settings,apiBase:base+'/fail'},new AbortController().signal),e=>!String(e).includes('private-key')&&/403/.test(String(e)));const controller=new AbortController();const pending=discoverApiModels({...settings,apiBase:base+'/wait'},controller.signal);controller.abort();await assert.rejects(pending,/已停止/);
  const request=apiRequest({settings,context:'公开原文',messages:[{role:'assistant',content:'回答',provider:'claude',model:'sonnet'},{role:'user',content:'继续'}],signal:new AbortController().signal,onText:()=>{}});assert.ok(request.body.messages.every((m:any)=>!('model'in m)&&!('provider'in m)));
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
import {referenceTokens} from '../src/core';
test('citations preserve standalone, grouped and ranged references without unbounded expansion',()=>{
  const source='引用[¶1]，参见[¶11–13]、[¶2, ¶5]和[¶8–¶9]。';assert.deepEqual(referenceTokens(source).map(t=>t.ids),[['1'],['11','12','13'],['2','5'],['8','9']]);assert.equal(referenceTokens('[¶0] [¶1–999999] [¶9–2]').length,0);assert.equal(referenceTokens('普通 [1] 或代码').length,0);
});

import {uniqueReferences} from '../src/core';
test('hundreds of PDF paragraph references on one page produce one page link',()=>{
 const citations=Object.fromEntries(Array.from({length:600},(_,i)=>[String(i+1),{...makeAnchor('source '+i,0,8),pdfPage:6}]));
 const ids=Array.from({length:600},(_,i)=>String(i+1));assert.deepEqual(uniqueReferences([...ids,...ids],citations).map(r=>r.label),['第 6 页']);
 citations['601']={...makeAnchor('next page',0,9),pdfPage:7};assert.deepEqual(uniqueReferences([...ids,'601','missing'],citations).map(r=>r.label),['第 6 页','第 7 页']);
});
test('text references preserve distinct locations while collapsing aliases',()=>{
 const first=makeAnchor('one two one',0,3),second=makeAnchor('one two one',8,11);
 assert.deepEqual(uniqueReferences(['1','2','3','1'],{'1':first,'2':{...first},'3':second}).map(r=>r.id),['1','3']);
});

test('adjacent reference groups share one navigable PDF page chip without swallowing surrounding prose',()=>{
 const text='说明 [¶1][¶2] [¶3]。另一个结论 [¶4]';const refs=referenceTokens(text);assert.deepEqual(refs.map(r=>r.ids),[['1','2','3'],['4']]);assert.equal(text.slice(refs[0].start,refs[0].end),'[¶1][¶2] [¶3]');const citations=Object.fromEntries(['1','2','3'].map(id=>[id,{...makeAnchor('same page',0,9),pdfPage:6}]));assert.equal(uniqueReferences(refs[0].ids,citations).length,1);
});

import {followupHistory,visibleThreadError} from '../src/core';
test('card follow-up appends one question, preserves the original conversation and sources',()=>{
 const t={id:'same-card',created:1,selection:false,context:'whole document',citations:{'1':makeAnchor('source',0,6)},messages:[{role:'user' as const,content:'主题？'},{role:'assistant' as const,content:'主题与依据 [¶1]',model:'original-model'}]},before=JSON.stringify(t),h=followupHistory(t,'  举个例子？  ');
 assert.deepEqual(h.map(m=>m.content),['主题？','主题与依据 [¶1]','举个例子？']);assert.equal(h[1].model,'original-model');assert.equal(JSON.stringify(t),before);assert.notEqual(h[0],t.messages[0]);assert.throws(()=>followupHistory({...t,removed:true},'继续'),/已删除/);assert.throws(()=>followupHistory(t,' '),/请输入/);
});
test('interrupted partial answers remain useful history and cancellation is quiet',()=>{
 const t={id:'partial',created:1,interrupted:true,error:'已停止',messages:[{role:'user' as const,content:'请解释'},{role:'assistant' as const,content:'先看第一点'}]};assert.deepEqual(followupHistory(t,'继续').map(m=>m.content),['请解释','先看第一点','继续']);assert.equal(visibleThreadError(t),undefined);assert.equal(visibleThreadError({...t,error:'已停止（已保留原回答）'}),undefined);assert.equal(visibleThreadError({...t,error:'网络连接失败'}),'网络连接失败');
});


import {compactMarginIds,annotationAnchor} from '../src/reading-ui';
test('only nearby source anchors form compact notes, independent of card height or active expansion',()=>{
 const items=[{id:'isolated',desired:800,height:800,created:1},{id:'same-a',desired:100,height:350,created:2},{id:'same-b',desired:100,height:30,created:3},{id:'nearby',desired:187,height:400,created:4},{id:'separate',desired:400,height:20,created:5}];
 assert.deepEqual([...compactMarginIds(items)].sort(),['nearby','same-a','same-b']);assert.deepEqual([...compactMarginIds(items,'same-a')].sort(),['nearby','same-b']);assert.deepEqual([...compactMarginIds(items.map(i=>({...i,height:9999})))].sort(),['nearby','same-a','same-b']);
 assert.equal(compactMarginIds([{id:'a',desired:0,height:10,created:1},{id:'b',desired:88,height:10,created:2}]).size,0);assert.equal(compactMarginIds([{id:'stale',desired:0,sourceY:NaN,height:10,created:1},{id:'valid',desired:0,height:10,created:2}]).size,0);
});
test('compact rows use a small gap while normal previews retain their spacing',()=>{
 assert.deepEqual(placeMarginItems([{id:'a',desired:10,height:30,created:1,mini:true},{id:'b',desired:10,height:30,created:2,mini:true},{id:'preview',desired:10,height:90,created:3}]),{a:10,b:44,preview:90});
});
test('collapsing with no focused reference safely clears the source, without inventing a whole-document anchor',()=>{
 const a=makeAnchor('source',0,6),threads=[{id:'selected',created:1,anchor:a,messages:[]},{id:'whole',created:2,selection:false,anchor:a,messages:[]}];
 assert.equal(annotationAnchor(threads),undefined);assert.equal(annotationAnchor(threads,undefined,undefined),undefined);assert.equal(annotationAnchor(threads,'whole'),undefined);assert.equal(annotationAnchor(threads,'selected'),a);assert.equal(annotationAnchor(threads,'whole',{threadId:'whole',anchor:a}),a);assert.equal(annotationAnchor(threads,'whole',{threadId:'selected',anchor:a}),undefined);assert.equal(annotationAnchor([{...threads[0],removed:true}],'selected'),undefined);
});


import {answerReceipt} from '../src/core';
test('legacy answer receipts explain missing metadata without borrowing a current model or estimating usage',()=>{
 const legacy={role:'assistant' as const,content:'旧回答'},before=JSON.stringify(legacy),receipt=answerReceipt(legacy);assert.equal(receipt.model,'模型未记录');assert.equal(receipt.usage,'用量未记录');assert.match(receipt.detail,/无法补算/);assert.equal(JSON.stringify(legacy),before);
 const missing=answerReceipt({...legacy,model:'actual-model',serviceId:'saved-service'},'实际模型');assert.equal(missing.model,'实际模型');assert.equal(missing.usage,'用量未返回');
});
test('answer receipts preserve actual zero usage, returned totals and built-in translation semantics',()=>{
 const message={role:'assistant' as const,content:'回答',model:'actual',usage:{input:0,output:12}};assert.equal(answerReceipt(message).usage,'0 输入 · 12 输出');assert.equal(answerReceipt({...message,usage:{total:48}}).usage,'48 tokens');
 const translated=answerReceipt({role:'assistant',content:'译文',provider:'Google Translate',model:'Google Translate · 简体中文'});assert.equal(translated.usage,undefined);assert.equal(translated.model,'Google Translate · 简体中文');assert.equal(translated.detail,'谷歌翻译 · 内置');
});


import {readingMapMetrics,readingMapViewport,readingMapLines} from '../src/reading-ui';
test('reading map keeps short articles compact and caps long articles at the viewport',()=>{
 const short=readingMapMetrics(1500,760,36);assert.equal(short.height,100);assert.equal(short.scale,1/15);
 const long=readingMapMetrics(60000,760,36);assert.equal(long.height,680);
 for(const content of [0,30,1500,60000]){const map=readingMapMetrics(content,760,36);assert.ok(Number.isFinite(map.scale));assert.ok(map.height>=24&&map.height<=680);}
});
test('reading map viewport clips header space and remains inside the silhouette at both ends',()=>{
 assert.deepEqual(readingMapViewport(-300,700,1500,1/15),{top:0,height:400/15});
 assert.deepEqual(readingMapViewport(1400,700,1500,1/15),{top:1400/15,height:100/15});
 const end=readingMapViewport(1600,700,1500,1/15);assert.ok(end.top+end.height<=100);assert.ok(end.top>=0);
});
test('reading map merges split highlight rectangles without fabricating uniform line widths',()=>{
 const lines=readingMapLines([{top:10,left:30,width:60,height:20},{top:10,left:90,width:30,height:20},{top:35,left:30,width:40,height:20}],{top:10,left:30,width:100});
 assert.deepEqual(lines,[{top:0,width:16.2},{top:25,width:7.2}]);
});

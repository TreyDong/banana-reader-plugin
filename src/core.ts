import type {ContextInfo} from './rag';
import type {ReadingBrief} from './brief';
export interface Anchor { pdfPage?:number;pdfOffset?:number;quote: string; start: number; prefix: string; suffix: string }
export interface Passage { source?:string;text: string; start: number; end: number; number: number }
export interface TokenUsage {input?:number;output?:number;cacheRead?:number;cacheWrite?:number;total?:number}
export interface WebSource {title:string;url:string;snippet:string}
export interface WebReceipt {provider?:string;query:string;sources:WebSource[]}
export interface Message { web?:WebReceipt; role: 'user' | 'assistant'; content: string; provider?:string; model?:string; serviceId?:string; usage?:TokenUsage }
export interface Thread { pending?:boolean;recovery?:ThreadRecovery;mobileModel?:{serviceId:string;modelId:string};interrupted?:boolean;followupDraft?:string;translationTarget?:string; selection?:boolean; contextInfo?:ContextInfo; id: string; removed?:boolean; removedAt?:number; commandId?:string; label?:string; anchor?: Anchor; messages: Message[]; created: number; error?: string; context?: string; citations?: Record<string, Anchor> }
export type ThreadRecovery=Pick<Thread,'messages'|'context'|'citations'|'contextInfo'|'anchor'|'selection'>;
/** Save the last complete answer and evidence before a regeneration replaces them. */
export function beginThreadRequest(thread:Thread,regenerating=false){
 thread.pending=true;
 if(regenerating){const {messages,context,citations,contextInfo,anchor,selection}=thread;thread.recovery=JSON.parse(JSON.stringify({messages,context,citations,contextInfo,anchor,selection})) as ThreadRecovery;}
 else delete thread.recovery;
}
export function settleThreadRequest(thread:Thread){delete thread.pending;delete thread.recovery;}
export type MarkStyle='highlight'|'underline'|'wavy';
export const MARK_STYLES:Record<MarkStyle,string>={highlight:'荧光笔',underline:'直线',wavy:'波浪线'};
export function markStyle(value:unknown):MarkStyle{return value==='underline'||value==='wavy'?value:'highlight';}
export interface Highlight { id: string; anchor: Anchor; color: string; note: string; created: number; removed?: boolean; style?:MarkStyle }
export interface Reading { pdfPage?:number;brief?:ReadingBrief; highlights: Highlight[]; threads: Thread[]; progress: number; draft: string; updated: number }
export const freshReading = (): Reading => ({highlights: [], threads: [], progress: 0, draft: '', updated: Date.now()});
export function makeAnchor(text: string, start: number, end: number): Anchor {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { quote: text.slice(start, end), start, prefix: text.slice(Math.max(0, start - 48), start), suffix: text.slice(end, end + 48) };
}
export function resolveAnchor(text: string, a: Anchor): number | null {
  if (!a.quote) return null;
  const candidates: {pos: number; score: number}[] = [];
  let pos = text.indexOf(a.quote);
  while (pos !== -1) {
    let score = 0;
    for (let i = 1; i <= a.prefix.length && pos >= i; i++) { if (text[pos - i] !== a.prefix[a.prefix.length - i]) break; score++; }
    for (let i = 0; i < a.suffix.length && pos + a.quote.length + i < text.length; i++) { if (text[pos + a.quote.length + i] !== a.suffix[i]) break; score++; }
    candidates.push({pos, score});
    pos = text.indexOf(a.quote, pos + 1);
  }
  if (candidates.length === 1) return candidates[0].pos;
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || !candidates[0].score || candidates[0].score === candidates[1].score) return null;
  return candidates[0].pos;
}
export function indexPassages(texts: string[]): {text: string; passages: Passage[]} {
  let text = '';
  const passages = texts.map((t, i) => {
    const start = text.length; text += t;
    const result = {text: t, start, end: text.length, number: i + 1};
    if (i < texts.length - 1) text += '\n\n';
    return result;
  });
  return {text, passages};
}
export function contextFor(passages: Passage[], anchor: Anchor | undefined, text: string, whole: boolean, maxChars: number): string {
  let chosen = passages;
  if (!whole && anchor) {
    const start = resolveAnchor(text, anchor);
    if (start === null) throw new Error('原文已变化，无法可靠定位选中文本。请重新选择。');
    const first = passages.findIndex(p => p.end > start);
    const last = passages.findIndex(p => p.end >= start + anchor.quote.length);
    chosen = passages.slice(Math.max(0, first - 1), Math.min(passages.length, Math.max(first, last) + 2));
  }
  const context = chosen.map(p => `[¶${p.number}] ${p.source?"（"+p.source+"） ":""}${p.text}`).join('\n\n');
  if (context.length > maxChars) throw new Error(`本轮上下文超过 ${maxChars.toLocaleString()} 字符，请缩小选区或改为“选中文本及相邻段落”。`);
  return context;
}
export function blockedPath(path: string): boolean {
  return path.split('/').some(p => ['日记', '60_工作库', '20_投资库', 'A1_交易数据'].includes(p));
}
export function exportReading(path: string, data: Reading, vault: string): string {
  const source = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`;
  let md = `# 阅读笔记 · ${path.split('/').pop()?.replace(/\.md$/, '')}\n\n[打开原文](${source})\n\n`;
  const back = (id: string) => `obsidian://banana-reader?vault=${encodeURIComponent(vault)}&path=${encodeURIComponent(path)}&anchor=${encodeURIComponent(id)}`;
  for (const h of data.highlights.filter(h => !h.removed)) {
    md += `## 摘录 · ${MARK_STYLES[markStyle(h.style)]}${h.anchor.pdfPage?' · PDF 第 '+h.anchor.pdfPage+' 页':''}\n\n> ${h.anchor.quote.replace(/\n/g, '\n> ')}\n\n[↩ 返回划线](${back(h.id)})\n\n${h.note ? h.note + '\n\n' : ''}`;
  }
  for (const t of data.threads.filter(t=>!t.removed)) {
    md += `## 阅读对话${t.label?' · '+t.label:''}${t.anchor?.pdfPage?' · PDF 第 '+t.anchor.pdfPage+' 页':''}\n\n${t.anchor ? '> ' + t.anchor.quote.replace(/\n/g, '\n> ') + '\n\n' : ''}[↩ 返回对话](${back(t.id)})\n\n`;
    if(t.contextInfo)md+='上下文：'+t.contextInfo.label+(t.contextInfo.embeddingModel?' · Embedding：'+t.contextInfo.embeddingModel:'')+'\n\n';
    if(t.contextInfo?.embeddingModel){md+='### 检索来源\n\n';for(const [id,anchor]of Object.entries(t.citations||{})){const label=anchor.pdfPage?'PDF 第 '+anchor.pdfPage+' 页':t.contextInfo.sources.find(s=>s.id===id)?.label||'原文片段';md+='- [¶'+id+'] ['+label+']('+back(t.id)+'&citation='+encodeURIComponent(id)+')\n';}md+='\n';}
    for (const m of t.messages){md += `### ${m.role === 'user' ? '我的问题' : 'Agent'+(m.model?' · '+m.model:'')}\n\n${m.content}\n\n`;if(m.web?.sources.length){md+='网络来源（'+(m.web.provider||'网页')+' 搜索摘要）：\n\n';for(const source of m.web.sources)md+='- ['+source.title.replace(/[\[\]\n]/g,' ')+'](<'+source.url+'>)\n';md+='\n';}}
  }
  return md;
}

export function referenceTokens(text:string):{start:number;end:number;ids:string[]}[]{
  const tokens:{start:number;end:number;ids:string[]}[]=[];
  for(const match of text.matchAll(/\[¶\d+(?:\s*(?:[–—-]\s*¶?\d+|[,，、]\s*¶?\d+))*\]/g)){
    const ids:string[]=[];for(const part of match[0].matchAll(/¶?(\d+)(?:\s*[–—-]\s*¶?(\d+))?/g)){const first=Number(part[1]),last=Number(part[2]||part[1]);if(first<1||last<first||last-first>100)continue;for(let n=first;n<=last;n++)ids.push(String(n));}
    if(ids.length){const previous=tokens.at(-1);if(previous&&/^\s*$/.test(text.slice(previous.end,match.index!))){previous.end=match.index!+match[0].length;previous.ids=[...new Set([...previous.ids,...ids])];}else tokens.push({start:match.index!,end:match.index!+match[0].length,ids:[...new Set(ids)]});}
  }return tokens;
}

export function regenerationHistory(thread:Thread):Message[]{let index=thread.messages.length-1;while(index>=0&&thread.messages[index].role!=='user')index--;if(index<0)throw new Error('没有可重新生成的问题。');return thread.messages.slice(0,index+1).map(m=>({...m}));}
export function tokenReceipt(usage?:TokenUsage){if(!usage)return'用量未返回';const n=(value:number)=>value.toLocaleString('zh-CN');const parts=[usage.input!==undefined?n(usage.input)+' 输入':'',usage.output!==undefined?n(usage.output)+' 输出':''].filter(Boolean);return parts.join(' · ')||(usage.total!==undefined?n(usage.total)+' tokens':'用量未返回');}
export function tokenDetails(usage?:TokenUsage){if(!usage)return'该回答未保存服务返回的 token 用量';return[usage.input!==undefined?'输入 '+usage.input+' tokens（包含缓存）':'',usage.output!==undefined?'输出 '+usage.output+' tokens':'',usage.cacheRead!==undefined?'缓存读取 '+usage.cacheRead+' tokens':'',usage.cacheWrite!==undefined?'缓存写入 '+usage.cacheWrite+' tokens':'',usage.total!==undefined?'总计 '+usage.total+' tokens':''].filter(Boolean).join(' · ');}

/** One navigable reference per PDF page or original text location. Missing IDs are not sources. */
export function uniqueReferences(ids:string[],citations:Record<string,Anchor>={}):{id:string;anchor:Anchor;label:string}[]{
 const seen=new Set<string>(),result:{id:string;anchor:Anchor;label:string}[]=[];
 for(const id of ids){const anchor=citations[id];if(!anchor)continue;const key=anchor.pdfPage?'pdf:'+anchor.pdfPage:'text:'+anchor.start+':'+anchor.quote;
  if(seen.has(key))continue;seen.add(key);result.push({id,anchor,label:anchor.pdfPage?'第 '+anchor.pdfPage+' 页':'¶'+id});
 }return result;
}

/** A card follow-up keeps its source/history; the bottom composer always starts another thread. */
export function followupHistory(thread:Thread,question:string):Message[]{
 if(thread.removed)throw new Error('这条问答已删除。');const text=question.trim();if(!text)throw new Error('请输入追问。');
 return[...thread.messages.filter(m=>m.content.trim()).map(m=>({...m})),{role:'user',content:text}];
}
export function visibleThreadError(thread:Thread):string|undefined{
 const error=thread.error;if(!error||/^(?:已停止|已取消|用户取消|AbortError|The operation was aborted|This operation was aborted|aborted|cancelled|canceled)[。.！!]*(?:（已保留原(?:回答|译文)）)?$/i.test(error.trim()))return;return error;
}

/** Report saved facts; legacy records must never inherit the current model or estimated tokens. */
export function answerReceipt(message:Message,modelName?:string):{model:string;usage?:string;detail:string}{
 const google=message.provider==='Google Translate',model=modelName?.trim()||message.model?.trim()||(google?'Google Translate':'模型未记录');
 const usage=google?undefined:message.usage?tokenReceipt(message.usage):message.model?.trim()?'用量未返回':'用量未记录';
 const detail=google?'谷歌翻译 · 内置':[message.provider,message.model,message.usage?tokenDetails(message.usage):message.model?'服务未返回本轮用量':'这条历史记录没有保存模型或用量，无法补算。'].filter(Boolean).join(' · ');
 return{model,usage,detail};
}

import {type AgentSettings, type ApiProtocol, API_DEFAULTS, type ModelOption,type ModelType, normalizeModels, mergeModels} from './agent';
export type ServiceKind='codex'|'claude'|'pi'|'api';
export interface ModelService {id:string;name:string;kind:ServiceKind;path:string;protocol:ApiProtocol;base:string;models:ModelOption[]}
export interface ModelRef {serviceId:string;modelId:string}
export interface ModelSetup {services:ModelService[];taskModels:Record<string,ModelRef|null>;mobileTaskModels?:Record<string,ModelRef|null>}
export const SERVICE_NAMES:Record<ServiceKind,string>={codex:'Codex',claude:'Claude',pi:'Pi',api:'自定义 API'};
export const SERVICE_ICONS:Record<ServiceKind,string>={codex:'terminal',claude:'sparkles',pi:'command',api:'globe'};
export function newService(kind:ServiceKind,id:string):ModelService{return{id,name:SERVICE_NAMES[kind],kind,path:'',protocol:'openai',base:API_DEFAULTS.openai,models:[]};}
export function supportsEmbedding(service:ModelService){return service.kind==='api'&&['openai','responses'].includes(service.protocol);}
export function serviceChoices(setup:ModelSetup,type:ModelType='chat'){return setup.services.flatMap(service=>service.models.filter(model=>type==='embedding'?model.type==='embedding'&&supportsEmbedding(service):model.type!=='embedding').map(model=>({...model,serviceId:service.id,serviceName:service.name,kind:service.kind})));}
/** A phone may inherit API assignments once, but never writes the desktop routes. */
export function deviceAssignments(setup:ModelSetup,mobile=false):Record<string,ModelRef|null>{
 if(!mobile)return setup.taskModels;
 if(!setup.mobileTaskModels){setup.mobileTaskModels={};for(const [task,ref]of Object.entries(setup.taskModels)){const service=setup.services.find(s=>s.id===ref?.serviceId);if(service?.kind==='api'&&validRef(setup,ref,task==='embedding'?'embedding':'chat'))setup.mobileTaskModels[task]={...ref!};}}
 return setup.mobileTaskModels;
}
export function setupForDevice(setup:ModelSetup,mobile=false):ModelSetup{return{services:mobile?setup.services.filter(s=>s.kind==='api'):setup.services,taskModels:deviceAssignments(setup,mobile)};}
export function validRef(setup:ModelSetup,ref:ModelRef|null|undefined,type:ModelType='chat'):ref is ModelRef{return !!ref&&serviceChoices(setup,type).some(m=>m.serviceId===ref.serviceId&&m.id===ref.modelId);}
export function resolveModel(setup:ModelSetup,task='default',override?:ModelRef):{service:ModelService;model:ModelOption}{
 const ref=override||setup.taskModels[task]||setup.taskModels.default;if(!ref)throw new Error('请先在设置中分配默认问答模型。');const service=setup.services.find(s=>s.id===ref.serviceId),model=service?.models.find(m=>m.id===ref.modelId);if(!service||!model)throw new Error('所选模型已移除，请重新分配模型。');if(model.type==='embedding')throw new Error('嵌入模型不能用于聊天，请重新选择问答模型。');return{service,model};
}
export function resolveEmbeddingModel(setup:ModelSetup):{service:ModelService;model:ModelOption}{const ref=setup.taskModels.embedding;if(!validRef(setup,ref,'embedding'))throw new Error('请在设置 → 模型服务 → 嵌入中选择嵌入模型。');const service=setup.services.find(s=>s.id===ref.serviceId)!;return{service,model:service.models.find(m=>m.id===ref.modelId)!};}
export function setModelType(setup:ModelSetup,service:ModelService,model:ModelOption,type:ModelType){if(type==='embedding'&&!supportsEmbedding(service))throw new Error('嵌入类型需要 OpenAI 兼容 API 服务。');model.type=type;pruneAssignments(setup);}
/** Preserve legacy endpoint/credential separation unless the caller confirms a shared service uses the same key. */
export function migrateEmbeddingModel(setup:ModelSetup,legacy:{base?:string;model?:string},reuse:(service:ModelService)=>boolean=()=>true):{service:ModelService;created:boolean}|null{
 const id=legacy.model?.trim();if(!id||setup.taskModels.embedding)return null;const base=legacy.base?.trim()||API_DEFAULTS.openai;let service=setup.services.find(s=>supportsEmbedding(s)&&s.base.replace(/\/+$/,'')===base.replace(/\/+$/,'')&&reuse(s)),created=false;
 if(!service){let name='legacy-embedding',n=1;while(setup.services.some(s=>s.id===name))name='legacy-embedding-'+n++;service={...newService('api',name),name:'嵌入服务',base};setup.services.push(service);created=true;}
 let model=service.models.find(m=>m.id===id);if(model)model.type='embedding';else{model={id,name:id,type:'embedding'};service.models.push(model);}setup.taskModels.embedding={serviceId:service.id,modelId:id};pruneAssignments(setup);return{service,created};
}
export function serviceSettings(service:ModelService,modelId='',key=''):AgentSettings{
  return{provider:service.kind,serviceId:service.id,serviceName:service.name,codexPath:service.path,codexModel:modelId,claudePath:service.path,claudeModel:modelId,piPath:service.path,piModel:modelId,apiProtocol:service.protocol,apiBase:service.base,apiModel:modelId,apiKey:key};
}
export function pruneAssignments(setup:ModelSetup){
 for(const [mobile,assignments]of [[false,setup.taskModels],[true,setup.mobileTaskModels]] as const){if(!assignments)continue;const available=mobile?{services:setup.services.filter(s=>s.kind==='api'),taskModels:assignments}:setup;for(const [task,ref]of Object.entries(assignments))if(ref&&!validRef(available,ref,task==='embedding'?'embedding':'chat'))delete assignments[task];}
}
export function migrateSetup(legacy:AgentSettings&{services?:ModelService[];taskModels?:Record<string,ModelRef|null>;mobileTaskModels?:Record<string,ModelRef|null>;modelLists?:Record<string,ModelOption[]>;apiProfiles?:Record<string,{base:string;model:string}>}):ModelSetup{
  if(Array.isArray(legacy.services)){
    const seen=new Set<string>();const services=legacy.services.filter(s=>s&&typeof s.id==='string'&&/^[a-z0-9-]+$/.test(s.id)&&!seen.has(s.id)&&!!SERVICE_NAMES[s.kind]&&(seen.add(s.id),true)).map(s=>({...s,name:s.name?.trim().slice(0,80)||SERVICE_NAMES[s.kind],path:s.path||'',protocol:API_DEFAULTS[s.protocol]?s.protocol:'openai' as ApiProtocol,base:s.base||API_DEFAULTS.openai,models:normalizeModels(s.models)}));
    return{services,taskModels:{...(legacy.taskModels||{})},...(legacy.mobileTaskModels&&typeof legacy.mobileTaskModels==='object'&&!Array.isArray(legacy.mobileTaskModels)?{mobileTaskModels:{...legacy.mobileTaskModels}}:{})};
  }
  const services:ModelService[]=[];
  for(const kind of ['codex','claude']as const){const selected=kind==='codex'?legacy.codexModel:legacy.claudeModel;const models=mergeModels(normalizeModels(legacy.modelLists?.[kind]),selected?[{id:selected,name:selected}]:[]);if(!models.length)continue;services.push({...newService(kind,'legacy-'+kind),path:kind==='codex'?legacy.codexPath:legacy.claudePath||'',models});}
  const protocols=new Set<ApiProtocol>([legacy.apiProtocol||'openai',...Object.keys(legacy.apiProfiles||{})as ApiProtocol[],...Object.keys(legacy.modelLists||{}).filter(k=>k.startsWith('api:')).map(k=>k.slice(4)as ApiProtocol)]);
  for(const protocol of protocols){if(!API_DEFAULTS[protocol])continue;const current=protocol===(legacy.apiProtocol||'openai'),profile=legacy.apiProfiles?.[protocol],id=current?legacy.apiModel:profile?.model||'',models=mergeModels(normalizeModels(legacy.modelLists?.['api:'+protocol]),id?[{id,name:id}]:[]);if(!models.length&&!(current&&legacy.provider==='api'))continue;services.push({...newService('api','legacy-api-'+protocol),name:'API · '+({openai:'OpenAI',responses:'Responses',anthropic:'Anthropic',gemini:'Gemini'}[protocol]),protocol,base:(current?legacy.apiBase:profile?.base)||API_DEFAULTS[protocol],models});}
  const selectedId=legacy.provider==='codex'?legacy.codexModel:legacy.provider==='claude'?legacy.claudeModel:legacy.apiModel;
  const selected=services.find(s=>s.kind===legacy.provider&&(s.kind!=='api'||s.protocol===(legacy.apiProtocol||'openai'))&&s.models.some(m=>m.id===selectedId));
  return{services,taskModels:{default:selected&&selectedId?{serviceId:selected.id,modelId:selectedId}:null}};
}

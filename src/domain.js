export const SCHEMA = 1;
export const VERSION = '4.0.0';
export const uid = () => crypto.randomUUID();
export const stages = ['Novo contato', 'Em atendimento', 'Aguardando cliente', 'Atendimento finalizado', 'Já é cliente'].map((name, i) => ({id: `stage-${i}`, name, color: ['#68717d','#dc2626','#d97706','#15803d','#334155'][i]}));
export const defaults = () => ({schema: SCHEMA, replies: [], categories: [{id:'general',name:'Geral'}], labels: [], attendants: [{id:'franciel',name:'Franciel',active:true}], accounts: [], stages: structuredClone(stages), preferences: {signature:true,attendantId:'franciel',panelOpen:true}, revision:0});
export function chatKey(accountId, chatId) {
  if (!accountId || !chatId || !/^[\w.:-]+@(?:c\.us|s\.whatsapp\.net|lid|g\.us)$/.test(chatId)) throw new Error('Identidade da conversa inválida');
  return `${accountId}|${chatId}`;
}
export function signedText(text, attendant, enabled = true) {
  return enabled && attendant?.active && attendant.name ? `*_${attendant.name}:_*\n${text}` : text;
}
export function pixText(action) {
  if (!action.key?.trim() || !action.holder?.trim()) throw new Error('PIX precisa de chave e titular');
  return [action.text?.trim(),`Chave PIX: ${action.key.trim()}`,`Titular: ${action.holder.trim()}`,action.bank?.trim() ? `Banco: ${action.bank.trim()}` : ''].filter(Boolean).join('\n');
}
export function validateReply(reply) {
  if (!reply || typeof reply.title !== 'string' || !reply.title.trim()) throw new Error('Informe o título da resposta');
  if (!Array.isArray(reply.actions) || !reply.actions.length || reply.actions.length > 100) throw new Error('Resposta precisa de 1 a 100 ações');
  for (const a of reply.actions) {
    if (!a || !['text','audio','image','video','document','pix'].includes(a.type)) throw new Error('Tipo de ação inválido');
    if (a.type === 'text' && (typeof a.text !== 'string' || !a.text.trim())) throw new Error('Texto vazio');
    if (a.type === 'pix') pixText(a);
    if (['audio','image','video','document'].includes(a.type) && !a.mediaId) throw new Error('Selecione uma mídia para cada ação');
  }
  return reply;
}
const pick = (value,keys) => Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
export function migrateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração inválida');
  if (Number(input.schema || 0) > SCHEMA) throw new Error('Backup de versão futura');
  const result = defaults();
  for (const key of ['replies','categories','labels','attendants','accounts','stages']) if (Array.isArray(input[key])) result[key] = structuredClone(input[key]);
  if (input.preferences && typeof input.preferences === 'object') {
    result.preferences = {...result.preferences};
    for (const k of ['signature','attendantId','panelOpen']) if (input.preferences[k] !== undefined) result.preferences[k] = input.preferences[k];
  }
  for (const key of ['categories','labels','attendants','accounts','stages']) {
    const ids=new Set();
    result[key]=result[key].map(item=>{
      if(!item || typeof item.id!=='string' || !item.id || ids.has(item.id) || typeof item.name!=='string' || !item.name.trim())throw new Error(`Cadastro inválido em ${key}`);
      ids.add(item.id);return pick(item,{categories:['id','name'],labels:['id','name','color'],attendants:['id','name','active'],accounts:['id','name','phone'],stages:['id','name','color']}[key]);
    });
  }
  const replyIds=new Set();
  result.replies=result.replies.map(reply=>{
    if(!reply.id || replyIds.has(reply.id))throw new Error('Identificação de resposta duplicada ou ausente');replyIds.add(reply.id);
    const r=pick(reply,['id','title','shortcut','favorite','categoryId','updatedAt','useCount']);
    r.actions=(reply.actions || []).map(action=>pick(action,['id','type','text','key','holder','bank','mediaId','name','caption','mimetype']));return r;
  });
  for (const r of result.replies) validateReply(r);
  if (!result.stages.length) result.stages = structuredClone(stages);
  result.revision = Number.isSafeInteger(input.revision) ? input.revision : 0;
  return result;
}
export function mergeSessions(local, remote, web = []) {
  const all = new Map(local.map(a => [a.id,{...a,status:'offline',source:'bridge'}]));
  for (const a of remote) all.set(a.id,{...all.get(a.id),...a,source:'bridge'});
  for (const a of web) all.set(a.id,{...all.get(a.id),...a,source:'web'});
  return [...all.values()];
}
export function validateBackup(raw) {
  if (raw?.format !== 'APOIS-CRM' || raw.version !== 1) throw new Error('Formato de backup não reconhecido');
  const config = migrateConfig(raw.config);
  if (!Array.isArray(raw.media) || !Array.isArray(raw.conversations)) throw new Error('Backup incompleto');
  const ids = new Set();
  for (const m of raw.media) {
    if (!m?.id || ids.has(m.id) || typeof m.data !== 'string' || !/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(m.data)) throw new Error('Mídia de backup inválida');
    ids.add(m.id);
  }
  for (const r of config.replies) for (const a of r.actions) if (a.mediaId && !ids.has(a.mediaId)) throw new Error('Backup tem mídia ausente');
  for (const c of raw.conversations) if (c.key !== chatKey(c.accountId,c.chatId)) throw new Error('Conversa inválida no backup');
  const media=raw.media.map(m=>pick(m,['id','name','type','size','data']));
  const conversations=raw.conversations.map(c=>pick(c,['key','accountId','chatId','name','labels','stageId','attendantId','updatedAt','transferredTo']));
  const events=(raw.events || []).map(e=>pick(e,['id','type','at','accountId','chatId','attendantId','messageId','jobId','index','transferId','originAccount','destinationAccount','client','status','error','key','stageId']));
  if(events.some(e=>typeof e.id!=='string'))throw new Error('Histórico inválido');
  return {format:'APOIS-CRM',version:1,config,media,conversations,events};
}
export async function runActions(actions, send, progress = () => {}) {
  const sent = [];
  for (let index = 0; index < actions.length; index++) {
    progress({index,total:actions.length,status:actions[index].type === 'audio' ? 'Preparando áudio…' : 'Enviando…'});
    try {
      const result = await send(actions[index], index);
      if (!result) throw new Error('Envio não confirmado');
      sent.push(result); progress({index,total:actions.length,status:'Enviado',sent:sent.length});
    } catch (error) {
      const e = new Error(`Ação ${index+1}/${actions.length}: ${error.message}. ${sent.length} enviada(s); restante interrompido.`,{cause:error});
      e.sent = sent; e.failedIndex = index; throw e;
    }
  }
  return sent;
}

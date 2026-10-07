import {defaults,uid,validateReply,validateBackup} from './domain.js';
export function importLegacy(raw) {
  const previous=raw?.format==='APOIS_QUICK_REPLIES_BACKUP';
  const data=previous?raw.data:raw;
  if(!data || (!Array.isArray(data.quickReplies)&&!Array.isArray(data.respostasRapidas)))throw new Error('Backup não reconhecido. Backups comerciais com metadados cifrados precisam ser exportados como JSON legível.');
  const config=defaults(),media=[],warnings=[];
  if(previous)for(const m of raw.media || [])media.push({id:m.id,name:m.name || 'arquivo',type:m.mime || '',size:m.size || 0,data:m.dataUrl});
  for(const k of ['categories','labels','attendants','accounts','stages'])if(Array.isArray(data[k]))config[k]=data[k];
  if(Array.isArray(data.categoria))config.categories=data.categoria.map(c=>({id:c.id,name:c.name || c.nome || c.titulo || 'Categoria'}));
  function actionFromOld(a) {
    const p=a.propriedades || a;const type={txt:'text',doc:'document'}[a.type] || a.type;
    if(!['text','audio','image','video','document','pix'].includes(type))throw new Error(`Ação ${a.type} não suportada na migração`);
    if(type==='text')return {id:a.id || uid(),type,text:p.mensagem || p.text || ''};
    if(type==='pix')return {id:a.id || uid(),type,key:p.pixKey || p.key || '',holder:p.pixHolder || p.name || p.holder || '',bank:p.pixBank || '',text:p.pixMessage || p.text || ''};
    let mediaId=p.mediaId;
    if(p.base64) {mediaId=uid();media.push({id:mediaId,name:p.base64Name || 'arquivo',type:'',size:0,data:p.base64});}
    return {id:a.id || uid(),type,mediaId,name:p.fileName || p.base64Name || '',caption:p.caption || p.mensagem || '',mimetype:p.mimeType || ''};
  }
  const source=data.quickReplies || data.respostasRapidas;
  for(const r of source) {
    try {
      let actions;
      if(data.quickReplies)actions=(r.blocks?.length?r.blocks:[r]).map(actionFromOld);
      else if(r.type==='script') {
        actions=[];
        for(const item of r.script || []) {
          const record=(data.respostasRapidasAcao || []).find(a=>a.id===item.id);if(!record)throw new Error('Script com ação ausente');
          if(item.timer)warnings.push(`Resposta ${r.titulo}: pausa de script não importada`);
          actions.push(...record.acao.map(actionFromOld));
        }
      } else {
        const record=(data.respostasRapidasAcao || []).find(a=>a.id===r.id);if(!record)throw new Error('Lista de ações ausente');actions=record.acao.map(actionFromOld);
      }
      const reply={id:r.id || uid(),title:r.title || r.titulo || 'Resposta importada',shortcut:r.alias || r.shortcut || '',categoryId:r.categoryId || r.categoria || '',favorite:!!r.favorite,actions};validateReply(reply);config.replies.push(reply);
    }catch(e){warnings.push(`${r.title || r.titulo || r.id}: ${e.message}`);}
  }
  // The previous build keyed contacts by display name, which is not a safe WhatsApp identity.
  if(Object.keys(data.contacts || {}).length)warnings.push('Contatos antigos identificados somente por nome não foram associados automaticamente a números.');
  if(!config.replies.length)throw new Error(`Nenhuma resposta utilizável: ${warnings.join('; ')}`);
  const used=new Set(config.replies.flatMap(r=>r.actions.map(a=>a.mediaId).filter(Boolean)));
  const backup={format:'APOIS-CRM',version:1,config,media:media.filter(m=>used.has(m.id)),conversations:[],events:[]};
  return {backup:validateBackup(backup),warnings};
}

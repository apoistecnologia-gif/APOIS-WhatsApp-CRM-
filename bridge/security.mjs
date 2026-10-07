import {timingSafeEqual} from 'node:crypto';
export function authorized(value,token) {
  if(typeof value!=='string' || !value.startsWith('Bearer '))return false;
  const a=Buffer.from(value.slice(7)),b=Buffer.from(token);return a.length===b.length && timingSafeEqual(a,b);
}
export function validSessionId(id) {if(typeof id!=='string'||!/^acct_[a-f0-9-]{36}$/.test(id))throw new Error('Identificação de sessão inválida');return id;}
export function validJid(jid) {if(typeof jid!=='string'||!/^\d{5,20}@s\.whatsapp\.net$/.test(jid))throw new Error('Use uma conversa individual com telefone identificado');return jid;}
export function validOrigin(origin) {return !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);}
export function validOperationId(id) {if(typeof id!=='string'||!/^[a-zA-Z0-9:_-]{8,100}$/.test(id))throw new Error('Identificação de operação inválida');return id;}
export async function readJson(req,limit=60*1024*1024) {
  let bytes=0;const chunks=[];
  for await(const c of req){bytes+=c.length;if(bytes>limit){throw new Error('Pedido excede o limite de 60 MB');}chunks.push(c);}
  if(!chunks.length)return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function messageText(message) {
  let m=message || {};
  for(let i=0;i<5;i++) {
    if(m.ephemeralMessage)m=m.ephemeralMessage.message;
    else if(m.viewOnceMessage)m=m.viewOnceMessage.message;
    else if(m.viewOnceMessageV2)m=m.viewOnceMessageV2.message;
    else break;
  }
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.fileName || (m.audioMessage?'Nota de voz':m.imageMessage?'Imagem':m.videoMessage?'Vídeo':'');
}

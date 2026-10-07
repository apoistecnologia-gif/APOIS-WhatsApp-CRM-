import {Database, blobToData, dataToBlob} from './database.js';
import {uid, validateBackup, migrateConfig, chatKey} from './domain.js';
const db = new Database();
const webSessions = new Map();
const requestCache = new Map();
const allowed = new Set(['config','saveConfig','saveReply','deleteReply','putMedia','getMedia','conversation','conversations','event','events','diagnostic','diagnostics','reserveJob','updateJob','jobs','registerWeb','sessions','bridge','exportBackup','importBackup','openCentral']);
async function bridge(path,method='GET',body) {
  if (!/^\/(health|sessions(?:\/[a-zA-Z0-9_-]+(?:\/(?:connect|messages|send|transfer))?)?)$/.test(path)) throw new Error('Rota bridge inválida');
  const {bridgeToken}=await chrome.storage.local.get('bridgeToken');
  if (!bridgeToken) throw new Error('Configure a chave local na Central APOIS');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try {
    const r=await fetch(`http://127.0.0.1:3210${path}`,{method,headers:{'Content-Type':'application/json','Authorization':`Bearer ${bridgeToken}`},...(body ? {body:JSON.stringify(body)} : {}),signal:controller.signal});
    const data=await r.json();if(!r.ok)throw new Error(data.error || `Bridge: HTTP ${r.status}`);return data;
  } finally {clearTimeout(timer);}
}
async function dispatch(type,p={},sender={}) {
  switch(type) {
    case 'config': return db.config();
    case 'saveConfig': return db.mutateConfig(()=>migrateConfig(p.config),p.revision);
    case 'saveReply': return db.saveReply(p.reply,p.revision);
    case 'deleteReply': return db.mutateConfig(c=>{c.replies=c.replies.filter(r=>r.id!==p.id);return c;},p.revision);
    case 'putMedia': {
      if (typeof p.data !== 'string' || p.data.length>72*1024*1024 || !/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(p.data)) throw new Error('Mídia inválida ou maior que 50 MB');
      const blob=dataToBlob(p.data);if(blob.size>50*1024*1024)throw new Error('Limite de mídia: 50 MB');
      const m={id:uid(),blob,name:String(p.name || 'arquivo').slice(0,255),type:blob.type,size:blob.size};await db.put('media',m);return {id:m.id,name:m.name,type:m.type,size:m.size};
    }
    case 'getMedia': {const m=await db.get('media',p.id);if(!m)throw new Error('Mídia não encontrada');return {id:m.id,name:m.name,type:m.type,size:m.size,data:await blobToData(m.blob)};}
    case 'conversation': return db.conversation(p.accountId,p.chatId,p.patch);
    case 'conversations': return db.all('conversations');
    case 'event': return db.event(p.type,p.data);
    case 'events': return (await db.all('events')).sort((a,b)=>b.at-a.at).slice(0,1000);
    case 'diagnostic': return db.put('diagnostics',{id:uid(),at:Date.now(),message:String(p.message).slice(0,500),area:p.area});
    case 'diagnostics': return (await db.all('diagnostics')).sort((a,b)=>b.at-a.at).slice(0,30);
    case 'reserveJob': {
      chatKey(p.accountId,p.chatId);
      return db.transaction(['jobs'],'readwrite',(tx,done)=>{
        const store=tx.objectStore('jobs'),req=store.get(p.id);
        req.onsuccess=()=>{if(req.result){done({accepted:false,job:req.result});return;}const job={id:p.id,accountId:p.accountId,chatId:p.chatId,replyId:p.replyId,status:'running',at:Date.now(),completed:0};store.put(job);done({accepted:true,job});};
      });
    }
    case 'updateJob': {
      return db.transaction(['jobs'],'readwrite',(tx,done)=>{const store=tx.objectStore('jobs'),req=store.get(p.id);req.onsuccess=()=>{if(!req.result){done(false);return;}const job={...req.result,...p.patch,id:p.id};store.put(job);done(job);};});
    }
    case 'jobs': return (await db.all('jobs')).sort((a,b)=>b.at-a.at).slice(0,100);
    case 'registerWeb': {
      if(!sender.tab?.id)throw new Error('Registro exige aba WhatsApp');
      const s={...p.session,tabId:sender.tab.id,updatedAt:Date.now(),source:'web'};webSessions.set(sender.tab.id,s);return true;
    }
    case 'sessions': return [...webSessions.values()].filter(s=>s.updatedAt>Date.now()-15000);
    case 'bridge': return bridge(p.path,p.method,p.body);
    case 'exportBackup': {
      const media=[];let size=0;
      for(const m of await db.all('media')) {size+=m.size;if(size>200*1024*1024)throw new Error('Backup maior que 200 MB. Exporte mídias em lotes numa futura versão.');media.push({id:m.id,name:m.name,type:m.type,size:m.size,data:await blobToData(m.blob)});}
      return {format:'APOIS-CRM',version:1,at:new Date().toISOString(),config:await db.config(),media,conversations:await db.all('conversations'),events:await db.all('events')};
    }
    case 'importBackup': return db.replaceBackup(validateBackup(p.backup));
    case 'openCentral': await chrome.runtime.openOptionsPage();return true;
  }
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || msg?.scope!=='APOIS-CRM' || !allowed.has(msg.type))return false;
  const key=`${sender.tab?.id || sender.url || 'extension'}:${msg.requestId}`;
  let promise=requestCache.get(key);
  if(!promise) {
    promise=dispatch(msg.type,msg.payload,sender).then(async result=>{if(['saveConfig','saveReply','deleteReply','conversation','importBackup'].includes(msg.type))await chrome.storage.local.set({crmRevision:uid()});return {ok:true,result};}).catch(error=>({ok:false,error:error.message}));
    if(!['getMedia','exportBackup','bridge'].includes(msg.type)){requestCache.set(key,promise);if(requestCache.size>64)requestCache.delete(requestCache.keys().next().value);}
  }
  promise.then(respond);return true;
});
chrome.tabs.onRemoved.addListener(id=>webSessions.delete(id));
chrome.action.onClicked.addListener(async tab=>{
  if(tab.id && tab.url?.startsWith('https://web.whatsapp.com/')) {try{await chrome.tabs.sendMessage(tab.id,{scope:'APOIS-CRM',type:'toggle'});}catch{await chrome.runtime.openOptionsPage();}}
  else await chrome.runtime.openOptionsPage();
});

import {defaults, migrateConfig, chatKey, uid, validateReply} from './domain.js';
export const DB_NAME = 'apois-crm-independent';
export class Database {
  constructor(factory = indexedDB, name = DB_NAME) { this.factory = factory; this.name = name; this.opening = null; }
  open() {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve,reject) => {
      const req = this.factory.open(this.name,2);
      req.onupgradeneeded = () => {
        for (const name of ['config','media','conversations','events','jobs','diagnostics']) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name,{keyPath:name === 'conversations' ? 'key' : 'id'});
      };
      req.onerror = () => { this.opening = null; reject(req.error); };
      req.onblocked = () => { this.opening = null; reject(new Error('Feche outras telas APOIS para atualizar o banco')); };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => {db.close(); this.opening = null;}; resolve(db); };
    });
    return this.opening;
  }
  async transaction(names, mode, work) {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(names,mode); let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Falha ao salvar dados'));
      tx.onabort = () => reject(tx.apoisError || tx.error || new Error('Transação cancelada'));
      try { work(tx,v => {result = v;}); } catch (e) {tx.abort();reject(e);}
    });
  }
  get(store,id) { return this.transaction([store],'readonly',(tx,done) => {const req=tx.objectStore(store).get(id);req.onsuccess=()=>done(req.result);}); }
  all(store) { return this.transaction([store],'readonly',(tx,done) => {const req=tx.objectStore(store).getAll();req.onsuccess=()=>done(req.result);}); }
  put(store,item) { return this.transaction([store],'readwrite',(tx,done)=>{tx.objectStore(store).put(item);done(item);}); }
  remove(store,id) { return this.transaction([store],'readwrite',tx=>{tx.objectStore(store).delete(id);}); }
  config() {return this.get('config','main').then(r=>migrateConfig(r?.value || defaults()));}
  mutateConfig(fn, revision) {
    return this.transaction(['config'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('config'),req=store.get('main');
      req.onsuccess=()=>{
        try {
          const config=migrateConfig(req.result?.value || defaults());
          if (revision !== undefined && config.revision !== revision) throw new Error('Dados mudaram em outra tela. Reabra o editor para salvar.');
          const next=migrateConfig(fn(config) || config);next.revision=config.revision+1;
          store.put({id:'main',value:next});done(next);
        } catch(e) {tx.apoisError=e;tx.abort();}
      };
    });
  }
  async saveReply(reply,revision) {
    validateReply(reply);
    for (const a of reply.actions) if (a.mediaId && !await this.get('media',a.mediaId)) throw new Error('Mídia não encontrada');
    return this.mutateConfig(c=>{const i=c.replies.findIndex(r=>r.id===reply.id);const r={...reply,id:reply.id || uid(),updatedAt:Date.now()};if(i<0)c.replies.push(r);else c.replies[i]=r;return c;},revision);
  }
  conversation(accountId,chatId,patch={}) {
    const key=chatKey(accountId,chatId);
    return this.transaction(['conversations'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('conversations'),req=store.get(key);
      req.onsuccess=()=>{const item={labels:[],stageId:'stage-0',...req.result,...patch,key,accountId,chatId,updatedAt:Date.now()};store.put(item);done(item);};
    });
  }
  async event(type,data={}) {return this.put('events',{id:uid(),type,at:Date.now(),...data});}
  async replaceBackup(backup) {
    const media=backup.media.map(m=>({...m,blob:dataToBlob(m.data),data:undefined}));
    return this.transaction(['config','media','conversations','events'],'readwrite',(tx,done)=>{
      for (const name of ['media','conversations','events']) tx.objectStore(name).clear();
      tx.objectStore('config').put({id:'main',value:backup.config});
      for (const m of media) tx.objectStore('media').put(m);
      for (const c of backup.conversations) tx.objectStore('conversations').put(c);
      for (const e of backup.events || []) tx.objectStore('events').put(e);
      done(true);
    });
  }
}
export function dataToBlob(data) {
  const [header,body]=data.split(',');const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
  return new Blob([bytes],{type:header.slice(5).split(';')[0]});
}
export async function blobToData(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for (let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

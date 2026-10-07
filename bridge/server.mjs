import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import makeWASocket,{useMultiFileAuthState,DisconnectReason,Browsers} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {authorized,validSessionId,validJid,validOrigin,validOperationId,readJson,messageText} from './security.mjs';
const root=process.env.APOIS_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'),'APOIS-CRM');
await fs.mkdir(root,{recursive:true,mode:0o700});
const registryPath=path.join(root,'accounts.json'),journalPath=path.join(root,'operations.json');
async function readFileJSON(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(file,value){const temp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temp,file);}
let token;
try{token=(await fs.readFile(path.join(root,'bridge-token'),'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;token=randomBytes(32).toString('hex');await fs.writeFile(path.join(root,'bridge-token'),token,{mode:0o600});}
if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Arquivo de chave local inválido');
const records=await readFileJSON(registryPath,[]),journal=new Map((await readFileJSON(journalPath,[])).map(x=>[x.id,x])),sessions=new Map(),pending=new Map();
const logger=pino({level:'silent'});let shuttingDown=false,writeChain=Promise.resolve();
function persist(file,data){writeChain=writeChain.then(()=>atomic(file,data));return writeChain;}
function publicSession(s){return {id:s.id,name:s.name,status:s.status,phone:s.phone || '',qrDataUrl:s.qrDataUrl || '',updatedAt:s.updatedAt,error:s.error || '',chats:[...s.chats.values()].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,100)};}
async function saveRegistry(){await persist(registryPath,[...sessions.values()].map(s=>({id:s.id,name:s.name,phone:s.phone || ''})));}
async function saveJournal(){await persist(journalPath,[...journal.values()]);}
function baseSession(record){return {...record,status:'offline',qrDataUrl:'',updatedAt:Date.now(),error:'',sock:null,connecting:null,timer:null,generation:0,chats:new Map(),messages:new Map()};}
async function saveChats(s){await persist(path.join(root,s.id,'chats.json'),{chats:[...s.chats.values()],messages:[...s.messages.entries()]});}
function updateMessages(s,messages){
  for(const msg of messages || []) {
    const jid=String(msg.key?.remoteJid || '').replace(/:\d+@/,'@');if(!jid||jid==='status@broadcast')continue;
    const text=messageText(msg.message),at=Number(msg.messageTimestamp || Math.floor(Date.now()/1000))*1000;
    const c=s.chats.get(jid) || {jid,name:msg.pushName || jid.split('@')[0]};s.chats.set(jid,{...c,preview:text.slice(0,180),updatedAt:at});
    const list=s.messages.get(jid) || [];const id=msg.key?.id;if(!id)continue;
    const item={id,fromMe:!!msg.key.fromMe,text:text.slice(0,4000),at,raw:msg.message};
    const idx=list.findIndex(x=>x.id===id);if(idx<0)list.push(item);else list[idx]=item;
    s.messages.set(jid,list.sort((a,b)=>a.at-b.at).slice(-200));
  }
  s.updatedAt=Date.now();
  if(s.saveTimer)clearTimeout(s.saveTimer);s.saveTimer=setTimeout(()=>{void saveChats(s).catch(e=>{s.error=`Falha ao salvar conversas: ${e.message}`;});},1000);
}
async function connect(s) {
  if(s.connecting)return s.connecting;if(s.status==='connected')return publicSession(s);
  s.connecting=(async()=>{
    clearTimeout(s.timer);s.generation++;const generation=s.generation;
    try{s.sock?.end(new Error('Reconectando'));}catch{/* already closed */}
    s.sock=null;s.status='connecting';s.error='';s.updatedAt=Date.now();
    const dir=path.join(root,validSessionId(s.id));await fs.mkdir(dir,{recursive:true,mode:0o700});
    const history=await readFileJSON(path.join(dir,'chats.json'),{chats:[],messages:[]});s.chats=new Map(history.chats.map(c=>[c.jid,c]));s.messages=new Map(history.messages);
    const {state,saveCreds}=await useMultiFileAuthState(path.join(dir,'auth'));
    const sock=makeWASocket({auth:state,logger,browser:Browsers.windows('APOIS CRM'),markOnlineOnConnect:false,syncFullHistory:false,getMessage:async key=>s.messages.get(key.remoteJid)?.find(m=>m.id===key.id)?.raw});s.sock=sock;
    sock.ev.on('creds.update',()=>{void saveCreds().catch(e=>{s.error=`Falha de sessão: ${e.message}`;});});
    sock.ev.on('messages.upsert',({messages})=>updateMessages(s,messages));
    sock.ev.on('messaging-history.set',({messages,chats,contacts})=>{
      for(const c of chats || [])s.chats.set(c.id,{jid:c.id,name:c.name || c.id.split('@')[0],updatedAt:Number(c.conversationTimestamp || 0)*1000});
      for(const c of contacts || [])if(s.chats.has(c.id))s.chats.get(c.id).name=c.name || c.notify || s.chats.get(c.id).name;
      updateMessages(s,messages);
    });
    sock.ev.on('contacts.upsert',contacts=>{for(const c of contacts)if(s.chats.has(c.id))s.chats.get(c.id).name=c.name || c.notify || s.chats.get(c.id).name;});
    sock.ev.on('connection.update',update=>{void(async()=>{
      if(s.generation!==generation)return;
      if(update.qr){s.qrDataUrl=await QRCode.toDataURL(update.qr,{width:320,margin:2});s.status='qr';s.updatedAt=Date.now();}
      if(update.connection==='open'){s.status='connected';s.qrDataUrl='';s.phone=String(sock.user?.id || '').split(':')[0].split('@')[0];s.updatedAt=Date.now();s.retries=0;await saveRegistry();}
      if(update.connection==='close') {
        const code=update.lastDisconnect?.error?.output?.statusCode;s.qrDataUrl='';s.status=code===DisconnectReason.loggedOut?'logged_out':'reconnecting';s.updatedAt=Date.now();
        s.error=code===DisconnectReason.loggedOut?'Sessão desconectada pelo WhatsApp. Conecte novamente.':`Conexão interrompida (${code || 'rede'})`;
        if(!shuttingDown && code!==DisconnectReason.loggedOut){s.retries=(s.retries || 0)+1;clearTimeout(s.timer);s.timer=setTimeout(()=>{void connect(s).catch(e=>{s.status='error';s.error=e.message;});},Math.min(60000,2000*2**Math.min(s.retries,5)));}
      }
    })().catch(e=>{s.status='error';s.error=e.message;});});
    return publicSession(s);
  })();
  try{return await s.connecting;}catch(e){s.status='error';s.error=e.message;throw e;}finally{s.connecting=null;}
}
for(const r of records){validSessionId(r.id);const s=baseSession(r);sessions.set(s.id,s);}
// Discover auth folders even when the registry was lost; never hide connected sessions.
for(const entry of await fs.readdir(root,{withFileTypes:true}))if(entry.isDirectory()&&/^acct_[a-f0-9-]{36}$/.test(entry.name)&&!sessions.has(entry.name))sessions.set(entry.name,baseSession({id:entry.name,name:'Conta recuperada'}));
async function convertAudio(buffer) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apois-voice-')),input=path.join(dir,'input.bin'),output=path.join(dir,'voice.ogg');
  try {
    await fs.writeFile(input,buffer);
    await new Promise((resolve,reject)=>{
      const child=spawn(ffmpeg.path,['-nostdin','-y','-i',input,'-vn','-ac','1','-ar','48000','-c:a','libopus','-b:a','32k','-f','ogg',output],{windowsHide:true});let stderr='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('Conversão de áudio excedeu 120 segundos'));},120000);
      child.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-1000);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`Áudio inválido ou codec não suportado (${code}): ${stderr.slice(-180)}`));});
    });
    return await fs.readFile(output);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function send(s,body) {
  validOperationId(body.operationId);const jid=validJid(body.chatId),key=`${s.id}:${body.operationId}`;
  if(pending.has(key))return pending.get(key);
  if(journal.has(key)){const record=journal.get(key);if(record.status==='completed')return record.result;throw new Error('Operação anterior incompleta ou incerta. Confira a conversa antes de repetir com nova operação.');}
  if(s.status!=='connected'||!s.sock)throw new Error('Conta destino precisa estar conectada');
  const action=body.action;if(!action||!['text','pix','audio','image','video','document'].includes(action.type))throw new Error('Ação inválida');
  const promise=(async()=>{
    const record={id:key,accountId:s.id,chatId:jid,at:Date.now(),status:'preparing'};journal.set(key,record);await saveJournal();
    try {
      let content;
      if(action.type==='text'||action.type==='pix'){if(typeof action.text!=='string'||!action.text.trim())throw new Error('Texto vazio');content={text:action.text};}
      else {
        if(typeof action.data!=='string'||!/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(action.data))throw new Error('Mídia inválida');
        const buffer=Buffer.from(action.data.split(',')[1],'base64');if(buffer.length>40*1024*1024)throw new Error('Mídia maior que 40 MB');
        if(action.type==='audio'){record.status='converting';await saveJournal();content={audio:await convertAudio(buffer),ptt:true,mimetype:'audio/ogg; codecs=opus'};}
        else if(action.type==='image')content={image:buffer,caption:action.caption || ''};
        else if(action.type==='video')content={video:buffer,caption:action.caption || ''};
        else content={document:buffer,fileName:String(action.name || 'documento').slice(0,255),mimetype:action.mimetype || 'application/octet-stream'};
      }
      record.status='sending';await saveJournal();
      const msg=await s.sock.sendMessage(jid,content);if(!msg?.key?.id)throw new Error('WhatsApp não confirmou envio');
      record.status='completed';record.result={id:msg.key.id};record.finishedAt=Date.now();await saveJournal();updateMessages(s,[msg]);return record.result;
    }catch(e){record.status='failed';record.error=e.message;await saveJournal();throw e;}
  })();
  pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const respond=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)){respond(403,{error:'Somente acesso local'});return;}
  if(!['127.0.0.1:3210','localhost:3210'].includes(req.headers.host)){respond(403,{error:'Host inválido'});return;}
  if(!validOrigin(origin)){respond(403,{error:'Origem não autorizada'});return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST'});res.end();return;}
  if(!authorized(req.headers.authorization,token)){respond(401,{error:'Chave local ausente ou inválida'});return;}
  try {
    const route=new URL(req.url,'http://127.0.0.1:3210').pathname;
    if(route==='/health'&&req.method==='GET'){respond(200,{ok:true,version:'4.0.0'});return;}
    if(route==='/sessions'&&req.method==='GET'){respond(200,{sessions:[...sessions.values()].map(publicSession)});return;}
    if(route==='/sessions'&&req.method==='POST') {
      const body=await readJson(req,4096),name=String(body.name || '').trim().slice(0,80);if(!name)throw new Error('Informe nome da conta');
      const s=baseSession({id:`acct_${randomUUID()}`,name});sessions.set(s.id,s);await saveRegistry();respond(201,{session:await connect(s)});return;
    }
    const match=route.match(/^\/sessions\/(acct_[a-f0-9-]{36})\/(connect|send|messages)$/);
    if(!match||req.method!=='POST'){respond(404,{error:'Rota inexistente'});return;}
    const s=sessions.get(validSessionId(match[1]));if(!s){respond(404,{error:'Conta inexistente'});return;}
    const body=await readJson(req,match[2]==='send'?60*1024*1024:4096);
    if(match[2]==='connect')respond(200,{session:await connect(s)});
    if(match[2]==='messages'){const jid=validJid(body.chatId);respond(200,{messages:(s.messages.get(jid) || []).map(({raw:_raw,...m})=>m)});}
    if(match[2]==='send')respond(200,await send(s,body));
  }catch(error){respond(400,{error:error.message});}
});
server.requestTimeout=150000;server.headersTimeout=10000;server.listen(3210,'127.0.0.1',()=>{
  console.log('APOIS CRM bridge em http://127.0.0.1:3210');console.log(`Chave local para a Central APOIS: ${token}`);
  for(const s of sessions.values())void connect(s).catch(e=>{s.status='error';s.error=e.message;});
});
async function stop(){if(shuttingDown)return;shuttingDown=true;for(const s of sessions.values()){clearTimeout(s.timer);clearTimeout(s.saveTimer);s.generation++;try{s.sock?.end(new Error('Encerramento'));}catch{}await saveChats(s);}await saveRegistry();await writeChain;server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});

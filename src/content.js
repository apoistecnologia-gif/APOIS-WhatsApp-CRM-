import {Transport} from './transport.js';
import {Manager,baseDiagnostic} from './manager.js';
import {rpc,esc,icon} from './client.js';
import {uid,runActions,signedText,pixText} from './domain.js';
window.__APOIS_UI_V4__?.destroy();
document.getElementById('apois-crm-host')?.remove();document.getElementById('apois-layout')?.remove();
const host=document.createElement('div');host.id='apois-crm-host';const shadow=host.attachShadow({mode:'open'});
const style=document.createElement('link');style.rel='stylesheet';style.href=chrome.runtime.getURL('src/ui.css');shadow.append(style);
const shell=document.createElement('div');shadow.append(shell);document.documentElement.append(host);
const layoutStyle=document.createElement('style');layoutStyle.id='apois-layout';layoutStyle.textContent=`html.apois-active #app {width:calc(100% - var(--apois-width, 0px)) !important;height:calc(100dvh - 54px) !important;position:relative !important;top:54px !important;min-width:0 !important;}html.apois-active #app .app-wrapper-web{min-width:0 !important;max-width:100% !important;}html.apois-active #app .two{min-width:0 !important;max-width:100% !important;}`;document.head.append(layoutStyle);
const abort=new AbortController();let config,manager,transport,st={ready:false},conversation=null,open=true,sending=false,stopped=false;
let lastSignature='',shortcutShown='';
function notify(message,error=false) {const el=shadow.querySelector('[data-panel-status]');if(el){el.textContent=message;el.dataset.error=String(error);}if(error)void rpc('diagnostic',{area:'content',message}).catch(()=>{});}
function width() {
  const w=window.innerWidth;
  const value=open&&w>=900?Math.min(360,w-640):0;
  document.documentElement.classList.add('apois-active');document.documentElement.style.setProperty('--apois-width',`${value}px`);
  const panel=shadow.querySelector('.panel');if(panel)panel.hidden=!value;
  shell.style.setProperty('--panel-width',`${value}px`);
}
async function changeConfig(c) {config=c;await configureSignature();renderFooter();renderBar();}
function attendant() {return config.attendants.find(a=>a.id===(conversation?.attendantId ?? config.preferences.attendantId)&&a.active);}
async function configureSignature() {
  const a=attendant(),sig={enabled:!!config.preferences.signature&&!!a,name:a?.name || '',attendantId:a?.id || ''};
  if(JSON.stringify(sig)===lastSignature)return;
  await transport.call('signature',sig,5000);lastSignature=JSON.stringify(sig);
}
function renderShell() {
  shell.innerHTML=`<header class="crm-bar"><div class="brand"><b>APOIS</b><span>CRM</span></div><div data-funnel class="funnel"></div><button data-action="toggle" aria-label="Abrir ou fechar painel APOIS">${icon('settings')} Painel</button><button data-action="central">Central</button></header><aside class="panel"><div class="panel-header"><div><b data-chat-name>WhatsApp</b><small data-account-name>Conectando…</small></div><button data-action="toggle" aria-label="Fechar painel">${icon('close')}</button></div><div data-panel-status role="status" aria-live="polite">Carregando integração…</div><div class="panel-scroll"><section data-manager></section></div><footer class="panel-footer" data-footer></footer></aside>`;
  manager=new Manager(shadow.querySelector('[data-manager]'),{onChange:changeConfig,diagnostic:async()=>({...await baseDiagnostic(),content:true,main:st,transport:transport.connected,activeAttendant:attendant()?.name || '',pending:transport.pending.size,bridge:'Opcional; veja Contas na Central'})});
  manager.config=config;manager.render();renderFooter();width();void renderBar();
}
async function renderBar() {
  const el=shadow.querySelector('[data-funnel]');if(!el||!config)return;
  const chats=await rpc('conversations');
  if(stopped)return;
  el.innerHTML=config.stages.map(s=>`<button data-stage="${esc(s.id)}" class="${conversation?.stageId===s.id?'active':''}" ${!conversation?'disabled':''}><span>${esc(s.name)}</span><small>${chats.filter(c=>c.stageId===s.id).length}</small></button>`).join('');
}
function renderFooter() {
  const el=shadow.querySelector('[data-footer]');if(!el||!config)return;
  const a=attendant();
  el.innerHTML=`<small>CONTA</small><b>${st.phone?`WhatsApp ${esc(st.phone)}`:'WhatsApp principal'}</b><small>ATENDENTE</small><select name="attendant" aria-label="Atendente da conversa"><option value="">Sem atribuição</option>${config.attendants.filter(x=>x.active).map(x=>`<option value="${esc(x.id)}" ${a?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>${conversation?`<div class="label-row">${config.labels.map(l=>`<label><input type="checkbox" data-label="${esc(l.id)}" ${conversation.labels?.includes(l.id)?'checked':''}>${esc(l.name)}</label>`).join('')}</div><button data-action="transfer">Transferir atendimento</button>`:''}`;
}
async function syncStatus(next) {
  const changed=next.chatId!==st.chatId || next.accountId!==st.accountId;st=next;
  const name=shadow.querySelector('[data-chat-name]'),account=shadow.querySelector('[data-account-name]');
  if(name)name.textContent=st.chatName || 'Abra uma conversa';if(account)account.textContent=st.phone?`Conta ${st.phone}`:'WhatsApp não conectado';
  if(changed) {
    conversation=st.accountId&&st.chatId?await rpc('conversation',{accountId:`web:${st.accountId}`,chatId:st.chatId,patch:{name:st.chatName}}):null;
    renderFooter();await renderBar();
  }
  if(st.ready)await configureSignature();
  if(!sending)notify(st.ready?'Pronto para atender.':'Aguardando WhatsApp conectado…');
  if(st.accountId) {
    const session={id:`web:${st.accountId}`,name:`WhatsApp Web ${st.phone}`,phone:st.phone,status:'connected',chatId:st.chatId};
    await rpc('registerWeb',{session});
  }
}
async function sendReply(replyId) {
  if(sending)return;
  if(!st.ready||!st.chatId)throw new Error('Abra uma conversa no WhatsApp conectado');
  const r=config.replies.find(x=>x.id===replyId);if(!r)throw new Error('Resposta não encontrada');
  const target={accountId:st.accountId,chatId:st.chatId},a=attendant(),operationId=uid();
  const reserve=await rpc('reserveJob',{id:operationId,accountId:`web:${target.accountId}`,chatId:target.chatId,replyId});if(!reserve.accepted)return;
  sending=true;const original=r.actions.map(x=>structuredClone(x));
  try {
    await runActions(original,async(action,index)=>{
      let payload;
      if(action.type==='text'||action.type==='pix')payload={...action,text:signedText(action.type==='pix'?pixText(action):action.text,a,config.preferences.signature)};
      else{notify(action.type==='audio'?'Preparando áudio…':'Preparando mídia…');const media=await rpc('getMedia',{id:action.mediaId});payload={...action,data:media.data,name:media.name};}
      notify(action.type==='audio'?'Enviando nota de voz…':'Enviando…');
      const result=await transport.call('send',{...target,operationId:`${operationId}:${index}`,action:payload});
      await rpc('event',{type:'sent',data:{...target,attendantId:a?.id || '',messageId:result.id,jobId:operationId,index}});
      await rpc('updateJob',{id:operationId,patch:{completed:index+1}});return result;
    },p=>notify(`${p.status} (${p.index+1}/${p.total})`));
    await rpc('updateJob',{id:operationId,patch:{status:'completed',finishedAt:Date.now()}});notify('Todas as ações foram enviadas.');
  }catch(error){await rpc('updateJob',{id:operationId,patch:{status:'failed',error:error.message,finishedAt:Date.now()}});throw error;}
  finally{sending=false;}
}
async function transferDialog() {
  if(!conversation)throw new Error('Abra uma conversa');
  const origin={accountId:st.accountId,chatId:st.chatId},conv=structuredClone(conversation);
  let accounts=[];try{accounts=(await rpc('bridge',{path:'/sessions'})).sessions.filter(s=>s.status==='connected');}catch{/* local transfer remains available */}
  const el=document.createElement('section');el.className='transfer-dialog';el.innerHTML=`<h2>Transferir atendimento</h2><form><label>Atendente<select name="attendant">${config.attendants.filter(a=>a.active).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label><label>Conta destino<select name="account"><option value="">Mesma conta</option>${accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.phone)}</option>`).join('')}</select></label><label>Mensagem ao cliente<textarea name="notice">Seu atendimento será transferido. Vamos dar continuidade na outra conta.</textarea></label><label>Mensagem da conta destino<textarea name="continuation">Olá! Vamos continuar seu atendimento por este número.</textarea></label><div class="row"><button type="button" data-cancel>Cancelar</button><button class="primary">Transferir</button></div><p role="status" data-transfer-status></p></form>`;shadow.querySelector('.panel-scroll').append(el);
  el.querySelector('[data-cancel]').onclick=()=>el.remove();
  el.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const f=e.target,button=f.querySelector('.primary'),status=el.querySelector('[data-transfer-status]');if(button.disabled)return;button.disabled=true;
    const data=new FormData(f),destination=String(data.get('account') || ''),attendantId=String(data.get('attendant') || '');
    const transferId=uid();
    try {
      if(!attendantId)throw new Error('Cadastre um atendente ativo');
      const history={transferId,originAccount:`web:${origin.accountId}`,destinationAccount:destination || `web:${origin.accountId}`,attendantId,client:origin.chatId,at:Date.now()};
      if(!destination) {
        await rpc('conversation',{accountId:`web:${origin.accountId}`,chatId:origin.chatId,patch:{attendantId}});await rpc('event',{type:'transfer',data:{...history,status:'completed'}});
      } else {
        if(!origin.chatId.endsWith('@c.us'))throw new Error('Transferência entre números exige conversa individual com telefone identificado. IDs @lid/grupos não são convertidos por suposição.');
        const notice=String(data.get('notice') || '').trim(),continuation=String(data.get('continuation') || '').trim();if(!notice||!continuation)throw new Error('Preencha as duas mensagens de transferência');
        const target=accounts.find(a=>a.id===destination);if(!target)throw new Error('Destino não está conectado');
        if(target.phone===st.phone)throw new Error('Origem e destino são o mesmo número');
        const jid=origin.chatId.replace('@c.us','@s.whatsapp.net');
        await rpc('event',{type:'transfer',data:{...history,status:'started'}});
        status.textContent='Notificando cliente pela conta origem…';
        const sent=await transport.call('send',{...origin,operationId:`${transferId}:origin`,action:{type:'text',text:notice}});
        await rpc('event',{type:'transfer_origin_sent',data:{...history,messageId:sent.id}});
        status.textContent='Enviando continuidade pela conta destino…';
        await rpc('bridge',{path:`/sessions/${destination}/send`,method:'POST',body:{operationId:`${transferId}:destination`,chatId:jid,action:{type:'text',text:continuation}}});
        await rpc('conversation',{accountId:destination,chatId:jid,patch:{name:conv.name,labels:conv.labels,stageId:conv.stageId,attendantId}});
        await rpc('conversation',{accountId:`web:${origin.accountId}`,chatId:origin.chatId,patch:{attendantId,transferredTo:destination}});
        await rpc('event',{type:'transfer',data:{...history,status:'completed'}});
      }
      el.remove();await syncStatus(await transport.call('status',{},5000));notify('Atendimento transferido.');
    }catch(error){status.textContent=error.message;await rpc('event',{type:'transfer',data:{transferId,status:'failed',error:error.message,originAccount:origin.accountId,destinationAccount:destination}});notify(error.message,true);button.disabled=false;}
  };
}
async function onClick(e) {
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.stage&&conversation) {
    conversation=await rpc('conversation',{accountId:conversation.accountId,chatId:conversation.chatId,patch:{stageId:b.dataset.stage}});await rpc('event',{type:'stage',data:{key:conversation.key,stageId:b.dataset.stage}});await renderBar();return;
  }
  if(b.dataset.action==='toggle') {if(window.innerWidth<900){await rpc('openCentral');return;}open=!open;width();return;}
  if(b.dataset.action==='central'){await rpc('openCentral');return;}
  if(b.dataset.action==='transfer')await transferDialog();
}
function destroy() {
  stopped=true;abort.abort();clearInterval(poll);observer.disconnect();transport?.destroy();manager?.destroy();host.remove();layoutStyle.remove();document.documentElement.classList.remove('apois-active');document.documentElement.style.removeProperty('--apois-width');chrome.runtime.onMessage.removeListener(onRuntime);chrome.storage.onChanged.removeListener(onStorageChanged);
}
function onRuntime(message) {if(message?.scope==='APOIS-CRM'&&message.type==='toggle'){open=!open;width();}}
shadow.addEventListener('click',e=>{void onClick(e).catch(error=>notify(error.message,true));},{signal:abort.signal});
shadow.addEventListener('apois-send',e=>{void sendReply(e.detail.replyId).catch(error=>notify(error.message,true));},{signal:abort.signal});
shadow.addEventListener('change',e=>{void(async()=>{
  if(e.target.name==='attendant') {
    if(conversation){conversation=await rpc('conversation',{accountId:conversation.accountId,chatId:conversation.chatId,patch:{attendantId:e.target.value}});await rpc('event',{type:'assignment',data:{key:conversation.key,attendantId:e.target.value}});}
    else{config.preferences.attendantId=e.target.value;config=await rpc('saveConfig',{config,revision:config.revision});}
    await configureSignature();
  }
  if(e.target.dataset.label&&conversation) {
    const id=e.target.dataset.label,labels=new Set(conversation.labels);if(e.target.checked)labels.add(id);else labels.delete(id);
    conversation=await rpc('conversation',{accountId:conversation.accountId,chatId:conversation.chatId,patch:{labels:[...labels]}});
  }
})().catch(error=>notify(error.message,true));},{signal:abort.signal});
window.addEventListener('resize',width,{signal:abort.signal});
window.addEventListener('keydown',e=>{if(e.altKey&&e.key.toLowerCase()==='a'){e.preventDefault();open=!open;width();}},{signal:abort.signal});
chrome.runtime.onMessage.addListener(onRuntime);
function onStorageChanged(changes,area){if(area!=='local'||!changes.crmRevision||!config)return;void(async()=>{config=await rpc('config');if(st.chatId&&st.accountId)conversation=(await rpc('conversations')).find(c=>c.accountId===`web:${st.accountId}`&&c.chatId===st.chatId) || null;renderFooter();await renderBar();await configureSignature();})().catch(e=>notify(e.message,true));}
chrome.storage.onChanged.addListener(onStorageChanged);
// One observer only, child-list only, ignores changes inside the shadow root.
const observer=new MutationObserver(()=>{if(!document.getElementById('app')&&!stopped)notify('Aguardando carregamento do WhatsApp…');});observer.observe(document.body,{childList:true});
transport=new Transport((event,payload)=>{
  if(event==='status'&&config)void syncStatus(payload).catch(error=>notify(error.message,true));
  if(event==='progress'&&sending)notify(payload.status);
  if(event==='error')notify(payload.message,true);
  if(event==='nativeSent')void rpc('event',{type:'sent_manual',data:payload}).catch(error=>notify(error.message,true));
  if(event==='outgoing')void rpc('event',{type:'outgoing_observed',data:{...payload,attendantId:attendant()?.id || '',observed:true}}).catch(()=>{});
});
const poll=setInterval(()=>{if(!config||stopped)return;void transport.call('status',{},5000).then(syncStatus).catch(error=>notify(error.message,true));},3000);
window.__APOIS_UI_V4__={destroy};
try {config=await rpc('config');open=config.preferences.panelOpen;renderShell();await syncStatus(await transport.call('status',{},5000));}
catch(error){notify(error.message,true);}
// Shortcuts only offer a send button. Typing never sends or inserts an attendant.
document.addEventListener('input',e=>{
  if(!config || !(e.target instanceof Element) || !e.target.matches('#main footer [contenteditable="true"]'))return;
  const text=e.target.innerText.trim();const reply=config.replies.find(r=>r.shortcut&&text===`/${r.shortcut}`);
  if(reply&&shortcutShown!==reply.id){shortcutShown=reply.id;manager.query=reply.title;manager.view='replies';manager.render();open=true;width();notify(`Atalho /${reply.shortcut}: clique em Enviar na resposta.`);}else if(!reply)shortcutShown='';
},{signal:abort.signal});

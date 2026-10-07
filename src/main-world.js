(() => {
  if (window.__APOIS_MAIN_V4__) return;
  window.__APOIS_MAIN_V4__ = true;
  let port = null, ready = false, signature = {enabled:false,name:'',attendantId:''}, nativeBusy = false;
  const outcomes = new Map();
  const cleanId = value => typeof value === 'string' ? value : value?._serialized || '';
  const emit = (event,payload) => {try{port?.postMessage({event,payload});}catch{}};
  const account = () => cleanId(window.WPP?.conn?.getMyUserId?.());
  const active = () => window.WPP?.chat?.getActiveChat?.();
  function status() {
    try {
      const chat=ready ? active() : null, accountId=ready ? account() : '';
      return {main:true,ready,authenticated:!!accountId,accountId,phone:accountId.split('@')[0],chatId:cleanId(chat?.id),chatName:chat?.formattedTitle || chat?.contact?.name || chat?.contact?.pushname || cleanId(chat?.id).split('@')[0],library:window.WPP?.version || '4.6.1'};
    } catch(error) {return {main:true,ready:false,error:error.message};}
  }
  function guard(payload) {
    if(!ready || !account()) throw new Error('WhatsApp ainda não está conectado');
    if(payload.accountId !== account()) throw new Error('Conta ativa mudou; envio interrompido');
    if(payload.chatId !== cleanId(active()?.id)) throw new Error('Conversa ativa mudou; envio interrompido');
    if(!/^[\w.:-]+@(?:c\.us|g\.us|lid|s\.whatsapp\.net)$/.test(payload.chatId)) throw new Error('Destinatário inválido');
  }
  async function send(payload) {
    guard(payload);
    const a=payload.action;let result;
    if(a.type==='text' || a.type==='pix') {
      if(typeof a.text!=='string' || !a.text.trim())throw new Error('Mensagem vazia');
      result=await window.WPP.chat.sendTextMessage(payload.chatId,a.text,{waitForAck:true,...(payload.quotedMsg ? {quotedMsg:payload.quotedMsg} : {})});
    } else {
      if(!['audio','image','video','document'].includes(a.type) || !/^data:[^,]*;base64,/.test(a.data || ''))throw new Error('Mídia inválida');
      const options={type:a.type,filename:a.name,caption:a.caption || '',waitForAck:true};
      if(a.type==='audio') {options.isPtt=true;options.waveform=true;emit('progress',{requestId:payload.operationId,status:'Enviando nota de voz…'});}
      result=await window.WPP.chat.sendFileMessage(payload.chatId,a.data,options);
    }
    if(!result?.id)throw new Error('WhatsApp não confirmou a mensagem');
    return {id:cleanId(result.id),ack:result.ack};
  }
  async function command(type,payload) {
    if(type==='status')return status();
    if(type==='signature') {signature={enabled:!!payload.enabled,name:String(payload.name || '').slice(0,80),attendantId:payload.attendantId || ''};return true;}
    if(type==='send') {
      if(!payload.operationId)throw new Error('Envio sem identificação');
      if(!outcomes.has(payload.operationId)) {
        if(outcomes.size>=1000)throw new Error('Limite de operações da aba atingido; recarregue o WhatsApp');
        outcomes.set(payload.operationId,send(payload));
      }
      return outcomes.get(payload.operationId);
    }
    throw new Error('Operação MAIN inválida');
  }
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.scope!=='APOIS-CRM-CONNECT' || !event.ports[0])return;
    port?.close();port=event.ports[0];
    port.onmessage=async e=>{
      const req=e.data;if(!req?.id || typeof req.type!=='string')return;
      try{port.postMessage({id:req.id,ok:true,result:await command(req.type,req.payload || {})});}
      catch(error){port.postMessage({id:req.id,ok:false,error:error.message});}
    };
    port.start();emit('connected',{main:true});
  });
  function quotedKey(composer) {
    // The original also gets the reply key from the native React tree.
    const footer=composer.closest('footer');
    const quoted=footer?.querySelector('[data-testid="quoted-message"], [data-testid="quoted-message-preview"], [data-testid="quoted-message-container"]');
    if(!quoted)return undefined;
    for(const node of [quoted,...quoted.querySelectorAll('*')]) {
      const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));
      let fiber=key ? node[key] : null;
      for(let n=0;fiber && n<12;n++,fiber=fiber.return) {
        const props=fiber.memoizedProps || {};
        for(const value of [props.msg,props.message,props.quotedMsg,props.quotedMessage]) {
          const id=cleanId(value?.id);if(id && /^(true|false)_/.test(id))return id;
        }
        if(typeof fiber.key==='string' && /^(true|false)_[^_]+_[A-Za-z0-9]+/.test(fiber.key))return fiber.key;
      }
    }
    throw new Error('Resposta citada não identificada. Desative a assinatura para esse envio.');
  }
  async function nativeSend(composer) {
    if(nativeBusy)return;
    nativeBusy=true;
    const st=status(),text=composer.innerText;
    const operationId=crypto.randomUUID();
    try {
      const quote=quotedKey(composer);
      const result=await command('send',{accountId:st.accountId,chatId:st.chatId,operationId,quotedMsg:quote,action:{type:'text',text:`*_${signature.name}:_*\n${text}`}});
      // Never clear a different chat's draft or text the user typed during delivery.
      if(cleanId(active()?.id)===st.chatId && composer.isConnected && composer.innerText===text)await window.WPP.chat.setInputText('',st.chatId);
      emit('nativeSent',{accountId:st.accountId,chatId:st.chatId,attendantId:signature.attendantId,messageId:result.id,at:Date.now()});
    } catch(error) {emit('error',{area:'assinatura',message:error.message});}
    finally {nativeBusy=false;}
  }
  function maybeIntercept(event) {
    if(!signature.enabled || !signature.name || !ready || event.isComposing)return;
    const composer=document.querySelector('#main footer [contenteditable="true"][role="textbox"]');
    if(!composer || !composer.innerText.trim())return;
    // Editing and media previews retain their native send behavior.
    if(document.querySelector('#main footer [data-icon="edit"], [data-testid="media-caption-input-container"]'))return;
    const keyboard=event.type==='keydown' && event.key==='Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && (event.target===composer || composer.contains(event.target));
    const click=event.type==='click' && event.target instanceof Element && !!event.target.closest('#main footer button[data-testid="compose-btn-send"], #main footer [data-testid="send"], #main footer button:has([data-icon="send"]), #main footer [role="button"]:has([data-icon="send"])');
    if(!keyboard && !click)return;
    event.preventDefault();event.stopImmediatePropagation();void nativeSend(composer);
  }
  document.addEventListener('keydown',maybeIntercept,true);
  document.addEventListener('click',maybeIntercept,true);
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(window.WPP?.isReady) {
      clearInterval(timer);ready=true;emit('status',status());
      window.WPP.on('chat.active_chat',()=>emit('status',status()));
      window.WPP.on('chat.new_message',msg=>{
        if(msg?.id?.fromMe)emit('outgoing',{accountId:account(),chatId:cleanId(msg.to || msg.id.remote),messageId:cleanId(msg.id),at:Date.now()});
      });
    } else if(attempts>=180) {clearInterval(timer);emit('error',{area:'main',message:'Integração WhatsApp não ficou pronta em 90 segundos'});}
  },500);
})();

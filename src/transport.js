export class Transport {
  constructor(onEvent) {
    this.pending=new Map();this.onEvent=onEvent;this.channel=new MessageChannel();this.connected=false;
    this.channel.port1.onmessage=e=>{
      const msg=e.data;
      if(msg.event){if(msg.event==='connected')this.connected=true;this.onEvent(msg.event,msg.payload);return;}
      const req=this.pending.get(msg.id);if(!req)return;
      clearTimeout(req.timer);this.pending.delete(msg.id);if(msg.ok)req.resolve(msg.result);else req.reject(new Error(msg.error));
    };
    this.channel.port1.start();
    window.postMessage({scope:'APOIS-CRM-CONNECT'},location.origin,[this.channel.port2]);
  }
  call(type,payload={},timeout=90000) {
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Tempo esgotado; envio pode ter ocorrido. Confira a conversa antes de repetir.'));},timeout);
      this.pending.set(id,{resolve,reject,timer});this.channel.port1.postMessage({id,type,payload});
    });
  }
  destroy() {this.channel.port1.close();for(const r of this.pending.values()){clearTimeout(r.timer);r.reject(new Error('Painel encerrado'));}this.pending.clear();}
}

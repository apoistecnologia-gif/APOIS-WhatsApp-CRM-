import {rpc,esc,icon,download} from './client.js';
import {uid,VERSION,validateReply,validateBackup,mergeSessions,runActions,signedText,pixText} from './domain.js';
import {importLegacy} from './migration.js';
import {Database,blobToData} from './database.js';
const color = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#dc2626';
const options = (items,value) => items.map(x=>`<option value="${esc(x.id)}" ${x.id===value?'selected':''}>${esc(x.name)}</option>`).join('');
const field = (label,name,value='',type='text',extra='') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export class Manager {
  constructor(root,{onChange=()=>{},diagnostic=async()=>({}),central=false}={}) {
    this.root=root;this.onChange=onChange;this.diagnostic=diagnostic;this.central=central;this.view='replies';this.query='';this.category='';this.edit=null;this.config=null;this.abort=new AbortController();this.busy=false;this.sessions=[];this.bridgeError='';this.selectedAccount='all';this.selectedChat='';
    root.addEventListener('click',e=>{void this.click(e).catch(error=>this.error(error));},{signal:this.abort.signal});
    root.addEventListener('submit',e=>{e.preventDefault();void this.submit(e).catch(error=>this.error(error));},{signal:this.abort.signal});
    root.addEventListener('change',e=>{void this.change(e).catch(error=>this.error(error));},{signal:this.abort.signal});
    this.onStorageChanged=(changes,area)=>{if(area==='local'&&changes.crmRevision&&!this.edit&&!this.busy)void this.refresh().catch(e=>this.error(e));};
    chrome.storage.onChanged?.addListener(this.onStorageChanged);
    root.addEventListener('input',e=>{
      if(e.target.name==='search'){this.query=e.target.value;this.renderList();}
    },{signal:this.abort.signal});
  }
  error(error) {this.message(error.message,true);void rpc('diagnostic',{area:'ui',message:error.message}).catch(()=>{});}
  message(text,isError=false) {const el=this.root.querySelector('[data-status]');if(el){el.textContent=text;el.dataset.error=String(isError);}}
  async start() {this.config=await rpc('config');this.render();}
  async refresh() {this.config=await rpc('config');await this.onChange(this.config);this.render();}
  async save(config=this.config) {this.config=await rpc('saveConfig',{config,revision:config.revision});await this.onChange(this.config);}
  destroy() {this.abort.abort();clearInterval(this.poll);chrome.storage.onChanged?.removeListener(this.onStorageChanged);}
  render() {
    const names={replies:'Respostas',categories:'Categorias',labels:'Etiquetas',attendants:'Atendentes',pipeline:'Funil',stages:'Etapas',accounts:'Contas',settings:'Configurações'};
    this.root.innerHTML=`<div class="manager"><nav class="tabs">${Object.entries(names).map(([id,name])=>`<button data-view="${id}" class="${this.view===id?'active':''}">${name}</button>`).join('')}</nav><div data-status role="status" aria-live="polite"></div><section data-body></section></div>`;
    if(this.edit){this.renderEditor();return;}
    const body=this.root.querySelector('[data-body]');
    if(this.view==='replies') {
      body.innerHTML=`<div class="tools"><input name="search" value="${esc(this.query)}" placeholder="Pesquisar respostas…" aria-label="Pesquisar respostas"><button data-action="newReply" class="primary" aria-label="Nova resposta">${icon('plus')}</button></div><div class="category-row"><button data-category="" class="${!this.category?'active':''}">Todas</button>${this.config.categories.map(c=>`<button data-category="${esc(c.id)}" class="${this.category===c.id?'active':''}">${esc(c.name)}</button>`).join('')}</div><div data-list></div>`;this.renderList();
    } else if(['categories','labels','attendants','stages'].includes(this.view)) {
      body.innerHTML=`<div class="section-heading"><h2>${names[this.view]}</h2><button class="primary" data-action="newEntity">${icon('plus')} Novo</button></div><div class="items">${this.config[this.view].map(x=>`<article><div><b>${esc(x.name)}</b>${x.active===false?'<small>Inativo</small>':''}${x.color?`<span class="dot" style="background:${color(x.color)}"></span>`:''}</div><div class="row"><button data-action="editEntity" data-id="${esc(x.id)}" aria-label="Editar ${esc(x.name)}">${icon('edit')}</button><button data-action="deleteEntity" data-id="${esc(x.id)}" aria-label="Excluir ${esc(x.name)}">${icon('trash')}</button></div></article>`).join('')}</div>`;
    } else if(this.view==='pipeline') {
      body.innerHTML='<h2>Funil de atendimento</h2><label>Filtrar por etiqueta<select name="pipelineLabel"><option value="">Todas as etiquetas</option>'+options(this.config.labels,this.pipelineLabel || '')+'</select></label><div data-kanban class="kanban"></div>';void this.renderPipeline().catch(e=>this.error(e));
    } else if(this.view==='settings') {
      body.innerHTML=`<h2>Configurações</h2><label class="check"><input type="checkbox" name="signature" ${this.config.preferences.signature?'checked':''}> Identificar atendente somente no envio</label><p>O campo de digitação permanece normal. A assinatura é incluída ao enviar texto.</p><div class="stack"><button data-action="diagnostic">Copiar diagnóstico</button><button data-action="jobs">Histórico de envios</button>${this.central?'<button data-action="export">Exportar backup completo</button><label class="file-button">Importar backup<input name="backup" type="file" accept="application/json,.json"></label>':'<button data-action="central">Backup e multiconta na Central</button>'}</div>${this.central?`<form data-form="bridge"><h3>Bridge local</h3><p>Copie a chave exibida pelo instalador. As sessões ficam neste computador.</p>${field('Chave local','token','','password','autocomplete="off"')}<button class="primary">Salvar chave</button></form>`:''}<div data-detail></div>`;
    } else if(this.view==='accounts') {
      if(!this.central)body.innerHTML='<h2>Contas de atendimento</h2><p>Abra a central para conectar números independentes e acompanhar todas as sessões.</p><button class="primary" data-action="central">Abrir Central APOIS</button>';
      else {body.innerHTML='<h2>Contas de atendimento</h2><div data-accounts></div>';void this.refreshAccounts().catch(e=>this.error(e));if(!this.poll)this.poll=setInterval(()=>{if(this.view==='accounts'&&!this.edit)void this.refreshAccounts().catch(e=>this.message(e.message,true));},5000);}
    }
  }
  renderList() {
    const list=this.root.querySelector('[data-list]');if(!list)return;
    const items=this.config.replies.filter(r=>(!this.category || r.categoryId===this.category)&&`${r.title} ${r.shortcut || ''} ${r.actions.filter(a=>a.type==='text').map(a=>a.text).join(' ')}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite));
    list.innerHTML=items.length ? items.map(r=>`<article class="reply-card"><div class="reply-title"><b>${esc(r.title)}</b><button data-action="favorite" data-id="${esc(r.id)}" class="icon-button ${r.favorite?'favorite':''}" aria-label="Favoritar ${esc(r.title)}">${icon('star')}</button></div><p>${esc(r.actions.map(a=>({text:'Texto',audio:'Nota de voz',image:'Imagem',video:'Vídeo',document:'Documento',pix:'PIX'}[a.type])).join(' → '))}</p><small>${r.shortcut?`/${esc(r.shortcut)} · `:''}${esc(r.actions.length)} ação(ões)</small><div class="row"><button data-action="editReply" data-id="${esc(r.id)}" aria-label="Editar ${esc(r.title)}">${icon('edit')}</button><button data-action="duplicate" data-id="${esc(r.id)}" aria-label="Duplicar ${esc(r.title)}">${icon('copy')}</button><button data-action="deleteReply" data-id="${esc(r.id)}" aria-label="Excluir ${esc(r.title)}">${icon('trash')}</button>${!this.central?`<button class="primary send" data-action="send" data-id="${esc(r.id)}">${icon('send')} Enviar</button>`:''}</div></article>`).join('') : '<div class="empty"><h3>Suas respostas, em um só lugar</h3><p>Use o botão + para criar textos, notas de voz, mídias e PIX na ordem que precisar.</p></div>';
  }
  renderEditor() {
    const body=this.root.querySelector('[data-body]');
    if(this.edit.entity) {
      const x=this.edit.value;body.innerHTML=`<form data-form="entity"><h2>${x.id?'Editar':'Novo'} ${esc({categories:'categoria',labels:'etiqueta',attendants:'atendente',stages:'etapa'}[this.view])}</h2>${field('Nome','name',x.name,'text','required maxlength="80"')}${['labels','stages'].includes(this.view)?field('Cor','color',color(x.color),'color'):''}${this.view==='attendants'?`<label class="check"><input type="checkbox" name="active" ${x.active!==false?'checked':''}> Ativo</label>`:''}<div class="row"><button type="button" data-action="cancel">Cancelar</button><button class="primary">Salvar</button></div></form>`;return;
    }
    const r=this.edit.value;
    body.innerHTML=`<form data-form="reply"><h2>${r.id?'Editar resposta':'Nova resposta'}</h2>${field('Título','title',r.title,'text','required maxlength="120"')}${field('Atalho (sem /)','shortcut',r.shortcut,'text','pattern="[A-Za-z0-9_-]*" maxlength="40"')}<label>Categoria<select name="categoryId">${options(this.config.categories,r.categoryId)}</select></label><label class="check"><input type="checkbox" name="favorite" ${r.favorite?'checked':''}> Favorita</label><div class="actions">${r.actions.map((a,i)=>this.actionEditor(a,i)).join('')}</div><div class="row"><select name="newType" aria-label="Tipo de nova ação">${['text','audio','image','video','document','pix'].map(t=>`<option value="${t}">${{text:'Texto',audio:'Nota de voz',image:'Imagem',video:'Vídeo',document:'Documento',pix:'PIX'}[t]}</option>`).join('')}</select><button type="button" data-action="addAction">${icon('plus')} Ação</button></div><div class="row sticky-actions"><button type="button" data-action="cancel">Cancelar</button><button class="primary" ${this.busy?'disabled':''}>Salvar resposta</button></div></form>`;
  }
  actionEditor(a,i) {
    const types={text:'Texto',audio:'Nota de voz',image:'Imagem',video:'Vídeo',document:'Documento',pix:'PIX'};
    let editor='';
    if(a.type==='text')editor=`<label>Mensagem<textarea name="text" required>${esc(a.text)}</textarea></label>`;
    else if(a.type==='pix')editor=`${field('Chave PIX','key',a.key,'text','required')}${field('Titular','holder',a.holder,'text','required')}${field('Banco (opcional)','bank',a.bank)}<label>Texto personalizado<textarea name="text">${esc(a.text)}</textarea></label>`;
    else editor=`<label class="file-button">${a.mediaId?`Arquivo: ${esc(a.name)}`:'Escolher arquivo'}<input name="media" type="file" data-index="${i}" accept="${{audio:'audio/*',image:'image/*',video:'video/*',document:'*/*'}[a.type]}"></label>${a.type==='audio'?'<small>Será enviado diretamente como nota de voz. A compatibilidade do codec é verificada pelo WhatsApp.</small>':''}${['image','video'].includes(a.type)?`<label>Legenda<textarea name="caption">${esc(a.caption)}</textarea></label>`:''}`;
    return `<fieldset data-index="${i}"><legend>${i+1}. ${types[a.type]}</legend><div class="action-tools"><button type="button" data-action="moveUp" data-index="${i}" ${i===0?'disabled':''} aria-label="Mover ação para cima">${icon('up')}</button><button type="button" data-action="moveDown" data-index="${i}" ${i===this.edit.value.actions.length-1?'disabled':''} aria-label="Mover ação para baixo">${icon('down')}</button><button type="button" data-action="copyAction" data-index="${i}" aria-label="Duplicar ação">${icon('copy')}</button><button type="button" data-action="removeAction" data-index="${i}" aria-label="Remover ação">${icon('trash')}</button></div>${editor}</fieldset>`;
  }
  harvest() {
    if(!this.edit || this.edit.entity)return;
    const f=this.root.querySelector('form[data-form="reply"]');if(!f)return;
    for(const k of ['title','shortcut','categoryId'])this.edit.value[k]=f.elements[k]?.value || '';
    this.edit.value.favorite=f.elements.favorite.checked;
    for(const el of f.querySelectorAll('fieldset'))for(const input of el.querySelectorAll('input:not([type=file]),textarea'))this.edit.value.actions[Number(el.dataset.index)][input.name]=input.value;
  }
  async click(event) {
    const b=event.target.closest('button');if(!b || b.disabled)return;
    if(b.dataset.view){this.edit=null;this.view=b.dataset.view;this.render();return;}
    if(b.hasAttribute('data-category')){this.category=b.dataset.category;this.render();return;}
    const action=b.dataset.action,id=b.dataset.id,i=Number(b.dataset.index);
    if(!action)return;
    if(['moveUp','moveDown','copyAction','removeAction','addAction'].includes(action)) {
      this.harvest();const arr=this.edit.value.actions;
      if(action==='addAction'){arr.push({id:uid(),type:this.root.querySelector('[name=newType]').value,text:''});}
      if(action==='copyAction')arr.splice(i+1,0,{...structuredClone(arr[i]),id:uid()});
      if(action==='removeAction')arr.splice(i,1);
      if(action==='moveUp'&&i>0)[arr[i-1],arr[i]]=[arr[i],arr[i-1]];
      if(action==='moveDown'&&i<arr.length-1)[arr[i+1],arr[i]]=[arr[i],arr[i+1]];
      this.renderEditor();return;
    }
    if(action==='cancel'){this.edit=null;this.render();return;}
    if(action==='newReply'){this.edit={value:{title:'',shortcut:'',categoryId:this.config.categories[0]?.id || '',actions:[{id:uid(),type:'text',text:''}],favorite:false}};this.render();return;}
    if(action==='editReply'){this.edit={value:structuredClone(this.config.replies.find(r=>r.id===id))};this.render();return;}
    if(action==='duplicate'){const r=structuredClone(this.config.replies.find(r=>r.id===id));r.id=uid();r.title+=' (cópia)';r.shortcut='';this.config.replies.push(r);await this.save();this.render();return;}
    if(action==='favorite'){const r=this.config.replies.find(r=>r.id===id);r.favorite=!r.favorite;await this.save();this.renderList();return;}
    if(action==='deleteReply') {this.confirm('Excluir esta resposta?',async()=>{this.config=await rpc('deleteReply',{id,revision:this.config.revision});await this.onChange(this.config);this.render();});return;}
    if(action==='newEntity'||action==='editEntity'){this.edit={entity:true,value:action==='newEntity'?{name:'',active:true,color:'#dc2626'}:structuredClone(this.config[this.view].find(x=>x.id===id))};this.render();return;}
    if(action==='deleteEntity') {
      if(this.view==='stages'&&this.config.stages.length===1)throw new Error('Mantenha pelo menos uma etapa');
      this.confirm('Excluir este item? As referências serão ajustadas.',async()=>{
        const key=this.view;const next=structuredClone(this.config);next[key]=next[key].filter(x=>x.id!==id);
        if(key==='categories')for(const r of next.replies)if(r.categoryId===id)r.categoryId=next.categories[0]?.id || '';
        if(key==='attendants'&&next.preferences.attendantId===id)next.preferences.attendantId=next.attendants.find(x=>x.active)?.id || '';
        await this.save(next);
        for(const c of await rpc('conversations')) {
          const patch={};
          if(key==='labels'&&c.labels?.includes(id))patch.labels=c.labels.filter(l=>l!==id);
          if(key==='stages'&&c.stageId===id)patch.stageId=next.stages[0].id;
          if(key==='attendants'&&c.attendantId===id)patch.attendantId='';
          if(Object.keys(patch).length)await rpc('conversation',{accountId:c.accountId,chatId:c.chatId,patch});
        }
        this.render();
      });return;
    }
    if(action==='send'){this.root.dispatchEvent(new CustomEvent('apois-send',{detail:{replyId:id},bubbles:true,composed:true}));return;}
    if(action==='central'){await rpc('openCentral');return;}
    if(action==='diagnostic') {
      const report=await this.diagnostic();const text=JSON.stringify(report,null,2);
      try{await navigator.clipboard.writeText(text);this.message('Diagnóstico copiado.');}catch{this.showDetail(`<h3>Diagnóstico</h3><textarea readonly rows="12">${esc(text)}</textarea>`);}
      return;
    }
    if(action==='jobs') {const jobs=await rpc('jobs');this.showDetail(`<h3>Histórico</h3>${jobs.map(j=>`<p>${esc(new Date(j.at).toLocaleString())} · ${esc(j.status)} · ${esc(j.completed)} ação(ões)${j.error?`<br>${esc(j.error)}`:''}</p>`).join('') || '<p>Nenhum envio registrado.</p>'}`);return;}
    if(action==='export') {
      const db=new Database(),media=[];let bytes=0;this.message('Preparando backup…');
      for(const m of await db.all('media')){bytes+=m.size;if(bytes>200*1024*1024)throw new Error('Backup excede 200 MB. Reduza ou divida o acervo.');media.push({id:m.id,name:m.name,type:m.type,size:m.size,data:await blobToData(m.blob)});}
      download(`apois-crm-backup-${new Date().toISOString().slice(0,10)}.json`,{format:'APOIS-CRM',version:1,config:await db.config(),media,conversations:await db.all('conversations'),events:await db.all('events')});this.message('Backup exportado, incluindo mídias.');return;
    }
    if(action==='connect'){await rpc('bridge',{path:`/sessions/${id}/connect`,method:'POST',body:{}});await this.refreshAccounts();return;}
    if(action==='selectAccount'){this.selectedAccount=id;this.selectedChat='';await this.refreshAccounts();return;}
    if(action==='sendCentralReply'){await this.sendCentralReply();return;}
    if(action==='selectChat'){this.selectedChat=b.dataset.chat;await this.renderAccounts();return;}
  }
  confirm(text,perform) {
    const box=document.createElement('div');box.className='confirmation';box.setAttribute('role','alertdialog');box.setAttribute('aria-label',text);box.innerHTML=`<p>${esc(text)}</p><div class="row"><button data-yes class="primary">Confirmar</button><button data-no>Cancelar</button></div>`;
    this.root.append(box);box.querySelector('[data-no]').onclick=()=>box.remove();box.querySelector('[data-yes]').onclick=()=>{box.remove();void perform().catch(e=>this.error(e));};box.querySelector('[data-no]').focus();
  }
  showDetail(html) {const detail=this.root.querySelector('[data-detail]');if(detail)detail.innerHTML=html;else{const el=document.createElement('div');el.className='detail';el.innerHTML=html;this.root.querySelector('[data-body]').append(el);}}
  async submit(e) {
    if(this.busy)return;
    const f=e.target,kind=f.dataset.form,data=new FormData(f);
    if(kind==='reply') {
      this.harvest();validateReply(this.edit.value);this.busy=true;
      try{this.config=await rpc('saveReply',{reply:this.edit.value,revision:this.config.revision});this.edit=null;await this.onChange(this.config);this.render();this.message('Resposta salva.');}finally{this.busy=false;}
    } else if(kind==='entity') {
      const x={...this.edit.value,id:this.edit.value.id || uid(),name:String(data.get('name') || '').trim()};if(!x.name)throw new Error('Informe o nome');
      if(['labels','stages'].includes(this.view))x.color=color(data.get('color'));
      if(this.view==='attendants')x.active=f.elements.active.checked;
      const next=structuredClone(this.config),i=next[this.view].findIndex(r=>r.id===x.id);if(i<0)next[this.view].push(x);else next[this.view][i]=x;
      await this.save(next);this.edit=null;this.render();
    } else if(kind==='bridge') {
      const token=String(data.get('token') || '').trim();if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Chave local deve ter 64 caracteres hexadecimais');
      await chrome.storage.local.set({bridgeToken:token});f.reset();this.message('Chave local salva.');
    } else if(kind==='newAccount') {
      const name=String(data.get('name') || '').trim();if(!name)throw new Error('Informe nome da conta');
      const result=await rpc('bridge',{path:'/sessions',method:'POST',body:{name}});this.config.accounts.push({id:result.session.id,name:result.session.name,phone:result.session.phone || ''});await this.save();f.reset();f.elements.name.blur();await this.refreshAccounts();
    } else if(kind==='centralTransfer') {
      await this.centralTransfer(data);
    } else if(kind==='centralSend') {
      const accountId=this.selectedAccount,chatId=this.selectedChat,text=String(data.get('message') || '').trim();
      if(!text)throw new Error('Digite a mensagem');this.busy=true;
      try{const conv=await rpc('conversation',{accountId,chatId});const att=this.config.attendants.find(a=>a.id===(conv.attendantId ?? this.config.preferences.attendantId));const result=await rpc('bridge',{path:`/sessions/${accountId}/send`,method:'POST',body:{operationId:uid(),chatId,action:{type:'text',text:signedText(text,att,this.config.preferences.signature)}}});await rpc('event',{type:'sent_manual',data:{accountId,chatId,attendantId:att?.id || '',messageId:result.id}});f.reset();this.message('Mensagem enviada.');await this.refreshAccounts();}finally{this.busy=false;}
    }
  }
  async change(e) {
    const input=e.target;
    if(input.name==='pipelineLabel'){this.pipelineLabel=input.value;await this.renderPipeline();return;}
    if(input.name==='pipelineStage'){const c=this.pipelineConversations.find(c=>c.key===input.dataset.key);if(c){await rpc('conversation',{accountId:c.accountId,chatId:c.chatId,patch:{stageId:input.value}});await rpc('event',{type:'stage',data:{key:c.key,stageId:input.value}});await this.renderPipeline();}return;}
    if(input.name==='signature'){this.config.preferences.signature=input.checked;await this.save();return;}
    if(input.name==='media'&&input.files[0]) {
      const file=input.files[0];if(file.size>40*1024*1024)throw new Error('Limite por mídia: 40 MB');
      this.harvest();this.busy=true;this.message('Salvando mídia…');
      try {
        const data=await blobToData(file),media=await rpc('putMedia',{name:file.name,data});const a=this.edit.value.actions[Number(input.dataset.index)];a.mediaId=media.id;a.name=file.name;a.mimetype=file.type;this.renderEditor();this.message('Mídia salva.');
      }finally{this.busy=false;const saveButton=this.root.querySelector('form[data-form=reply] .sticky-actions .primary');if(saveButton)saveButton.disabled=false;}
    }
    if(input.name==='backup'&&input.files[0]) {
      const file=input.files[0];if(file.size>300*1024*1024)throw new Error('Backup maior que 300 MB');
      const input=JSON.parse(await file.text());const legacy=input.format==='APOIS-CRM'?null:importLegacy(input);const raw=legacy?legacy.backup:validateBackup(input);
      this.confirm('Restaurar substitui os dados locais. Exporte o backup atual antes de confirmar.',async()=>{await new Database().replaceBackup(raw);await this.refresh();this.message(legacy?.warnings.length?'Importado com observações: '+legacy.warnings.join('; '):'Backup restaurado.');});
    }
  }
  async renderPipeline() {
    const root=this.root.querySelector('[data-kanban]');if(!root)return;
    this.pipelineConversations=await rpc('conversations');
    const filtered=this.pipelineConversations.filter(c=>!this.pipelineLabel || c.labels?.includes(this.pipelineLabel));
    root.innerHTML=this.config.stages.map(stage=>{
      const cards=filtered.filter(c=>c.stageId===stage.id);
      return `<section class="kanban-column"><h3>${esc(stage.name)} <small>${cards.length}</small></h3>${cards.map(c=>`<article><b>${esc(c.name || c.chatId)}</b><small>${esc(c.accountId)}</small><p>${(c.labels || []).map(id=>esc(this.config.labels.find(l=>l.id===id)?.name || '')).filter(Boolean).join(' · ')}</p><label>Etapa<select name="pipelineStage" data-key="${esc(c.key)}">${options(this.config.stages,c.stageId)}</select></label></article>`).join('')}</section>`;
    }).join('');
  }
  async sendCentralReply() {
    if(this.busy)return;
    const accountId=this.selectedAccount,chatId=this.selectedChat;
    if(!chatId || accountId==='all')throw new Error('Selecione uma conta e uma conversa');
    const id=this.root.querySelector('[name=centralReply]')?.value,reply=this.config.replies.find(r=>r.id===id);if(!reply)throw new Error('Selecione uma resposta');
    const jobId=uid(),conv=await rpc('conversation',{accountId,chatId}),att=this.config.attendants.find(a=>a.id===(conv.attendantId ?? this.config.preferences.attendantId));
    await rpc('reserveJob',{id:jobId,accountId,chatId,replyId:id});this.busy=true;
    try {
      await runActions(reply.actions,async(action,index)=>{
        let prepared;
        if(action.type==='text'||action.type==='pix')prepared={...action,text:signedText(action.type==='pix'?pixText(action):action.text,att,this.config.preferences.signature)};
        else {const media=await rpc('getMedia',{id:action.mediaId});prepared={...action,data:media.data,name:media.name};}
        const result=await rpc('bridge',{path:`/sessions/${accountId}/send`,method:'POST',body:{operationId:`${jobId}:${index}`,chatId,action:prepared}});
        await rpc('updateJob',{id:jobId,patch:{completed:index+1}});await rpc('event',{type:'sent',data:{accountId,chatId,attendantId:att?.id || '',messageId:result.id,index,jobId}});return result;
      },p=>this.message(`${p.status} ${p.index+1}/${p.total}`));
      await rpc('updateJob',{id:jobId,patch:{status:'completed',finishedAt:Date.now()}});this.message('Resposta enviada.');
    }catch(e){await rpc('updateJob',{id:jobId,patch:{status:'failed',error:e.message}});throw e;}finally{this.busy=false;}
  }
  async centralTransfer(data) {
    if(this.busy)return;
    const accountId=this.selectedAccount,chatId=this.selectedChat,destination=String(data.get('destination') || ''),attendantId=String(data.get('attendant') || '');
    const notice=String(data.get('notice') || '').trim(),continuation=String(data.get('continuation') || '').trim();
    if(!destination || !attendantId || !notice || !continuation)throw new Error('Preencha conta destino, atendente e mensagens');
    const id=uid(),history={transferId:id,originAccount:accountId,destinationAccount:destination,client:chatId,attendantId,at:Date.now()};this.busy=true;
    try {
      const sessions=(await rpc('bridge',{path:'/sessions'})).sessions;
      for(const target of [accountId,destination])if(!sessions.some(s=>s.id===target&&s.status==='connected'))throw new Error('As duas contas precisam estar conectadas');
      await rpc('event',{type:'transfer',data:{...history,status:'started'}});
      await rpc('bridge',{path:`/sessions/${accountId}/send`,method:'POST',body:{operationId:`${id}:origin`,chatId,action:{type:'text',text:notice}}});
      await rpc('event',{type:'transfer_origin_sent',data:history});
      await rpc('bridge',{path:`/sessions/${destination}/send`,method:'POST',body:{operationId:`${id}:destination`,chatId,action:{type:'text',text:continuation}}});
      const conv=await rpc('conversation',{accountId,chatId});
      await rpc('conversation',{accountId:destination,chatId,patch:{labels:conv.labels,stageId:conv.stageId,attendantId,name:conv.name}});
      await rpc('conversation',{accountId,chatId,patch:{attendantId,transferredTo:destination}});
      await rpc('event',{type:'transfer',data:{...history,status:'completed'}});this.message('Transferência concluída.');
    }catch(e){await rpc('event',{type:'transfer',data:{...history,status:'failed',error:e.message}});throw e;}finally{this.busy=false;}
  }
  async refreshAccounts() {
    const web=await rpc('sessions');let remote=[];this.bridgeError='';
    try{remote=(await rpc('bridge',{path:'/sessions'})).sessions;}catch(e){this.bridgeError=e.message;}
    this.sessions=mergeSessions(this.config.accounts,remote,web);await this.renderAccounts();
  }
  async renderAccounts() {
    const box=this.root.querySelector('[data-accounts]');if(!box)return;
    if(box.querySelector('form input:focus, form textarea:focus, form select:focus') || this.busy)return;
    const selected=this.sessions.find(s=>s.id===this.selectedAccount);
    box.innerHTML=`<p class="error">${esc(this.bridgeError)}</p><div class="account-picker"><button data-action="selectAccount" data-id="all" class="${this.selectedAccount==='all'?'primary':''}">Todas (${this.sessions.length})</button>${this.sessions.map(s=>`<button data-action="selectAccount" data-id="${esc(s.id)}" class="${s.id===this.selectedAccount?'primary':''}">${esc(s.name || s.phone || s.id)} · ${s.status==='connected'?'Online':esc(s.status)}</button>`).join('')}</div><form data-form="newAccount" class="row">${field('Nova conta','name','','text','required')}<button class="primary">Conectar número</button></form><div class="accounts-grid">${this.sessions.filter(s=>this.selectedAccount==='all'||s.id===this.selectedAccount).map(s=>`<article><h3>${esc(s.name || 'WhatsApp Web')}</h3><b>${esc(s.phone || 'Aguardando vínculo')}</b><p>${esc(s.status)} · ${s.updatedAt?esc(new Date(s.updatedAt).toLocaleTimeString()):'Sem sincronização'}</p>${s.qrDataUrl&&/^data:image\/png;base64,/.test(s.qrDataUrl)?`<img class="qr" src="${s.qrDataUrl}" alt="QR para conectar ${esc(s.name)}">`:''}${s.error?`<p class="error">${esc(s.error)}</p>`:''}${s.source==='bridge'&&s.status!=='connected'?`<button data-action="connect" data-id="${esc(s.id)}">Reconectar / exibir QR</button>`:''}${(s.chats || []).map(c=>`<button class="chat-row" data-action="selectChat" data-chat="${esc(c.jid)}">${esc(c.name)}<small>${esc(c.preview)}</small></button>`).join('')}</article>`).join('')}</div>${selected?.source==='bridge'&&this.selectedChat?`<section><h3>Conversa ${esc(this.selectedChat)}</h3><div data-messages></div><form data-form="centralSend"><textarea name="message" required placeholder="Mensagem para continuar atendimento"></textarea><button class="primary">Enviar</button></form><div class="row"><select name="centralReply" aria-label="Resposta composta">${this.config.replies.map(r=>`<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select><button data-action="sendCentralReply" class="primary">Enviar resposta</button></div><form data-form="centralTransfer"><h3>Transferir atendimento</h3><label>Conta destino<select name="destination">${this.sessions.filter(s=>s.source==='bridge'&&s.status==='connected'&&s.id!==this.selectedAccount).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>Atendente<select name="attendant">${options(this.config.attendants.filter(a=>a.active),this.config.preferences.attendantId)}</select></label>${field('Mensagem da conta origem','notice','Seu atendimento será transferido para outra conta.')}${field('Mensagem da conta destino','continuation','Olá! Vou dar continuidade ao seu atendimento.')}<button class="primary">Transferir</button></form></section>`:''}`;
    if(selected?.source==='bridge'&&this.selectedChat) {
      const result=await rpc('bridge',{path:`/sessions/${selected.id}/messages`,method:'POST',body:{chatId:this.selectedChat}});
      const messages=box.querySelector('[data-messages]');if(messages)messages.innerHTML=result.messages.map(m=>`<p class="message ${m.fromMe?'own':''}">${esc(m.text)}<small>${esc(new Date(m.at).toLocaleString())}</small></p>`).join('');
    }
  }
}
export async function baseDiagnostic() {
  let idb='OK';try{await rpc('config');}catch(e){idb=e.message;}
  return {product:'APOIS CRM',version:VERSION,extension:chrome.runtime.id,indexedDB:idb,sessions:await rpc('sessions'),jobs:await rpc('jobs'),errors:await rpc('diagnostics'),at:new Date().toISOString()};
}

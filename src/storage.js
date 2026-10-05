(() => {
  const SCHEMA_VERSION = 3;
  const now = () => Date.now();
  const uid = (prefix='id') => `${prefix}_${Math.random().toString(36).slice(2,9)}_${Date.now().toString(36)}`;
  const clone = v => JSON.parse(JSON.stringify(v));

  const DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      enabled: true,
      showTopbar: true,
      notifications: true,
      compactMode: false,
      openPanelOnChatChange: false,
      slashCommands: true,
      theme: 'auto',
      reminderLeadMinutes: 0
    },
    stages: [
      { id: 'new', name: 'Novo contato', color: '#8a8f98', order: 0 },
      { id: 'active', name: 'Em atendimento', color: '#0b76da', order: 1 },
      { id: 'waiting', name: 'Aguardando cliente', color: '#c67a00', order: 2 },
      { id: 'done', name: 'Atendimento finalizado', color: '#17834a', order: 3 },
      { id: 'client', name: 'Já é cliente', color: '#7c3aed', order: 4 }
    ],
    contacts: {},
    quickReplies: [
      { id: 'qr_welcome', title: 'Boas-vindas', category: 'Geral', text: 'Olá, {{nome}}! Seja bem-vindo(a). Como posso ajudar?', favorite: true, useCount: 0, createdAt: now(), updatedAt: now() },
      { id: 'qr_wait', title: 'Aguarde', category: 'Geral', text: 'Recebi sua mensagem. Já vou continuar seu atendimento.', favorite: false, useCount: 0, createdAt: now(), updatedAt: now() }
    ],
    followUps: [],
    scheduled: [],
    automations: [],
    campaigns: [],
    events: []
  };

  function normalize(data) {
    const merged = {
      ...clone(DEFAULTS),
      ...data,
      settings: { ...clone(DEFAULTS.settings), ...(data.settings || {}) },
      stages: Array.isArray(data.stages) && data.stages.length ? data.stages : clone(DEFAULTS.stages),
      contacts: data.contacts && typeof data.contacts === 'object' ? data.contacts : {},
      quickReplies: Array.isArray(data.quickReplies) ? data.quickReplies : clone(DEFAULTS.quickReplies),
      followUps: Array.isArray(data.followUps) ? data.followUps : [],
      scheduled: Array.isArray(data.scheduled) ? data.scheduled : [],
      automations: Array.isArray(data.automations) ? data.automations : [],
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      events: Array.isArray(data.events) ? data.events : []
    };
    merged.stages = merged.stages.map((s,i) => ({color:'#8a8f98', order:i, ...s, order:Number.isFinite(s.order)?s.order:i})).sort((a,b)=>a.order-b.order);
    return merged;
  }

  async function getAll() {
    const data = await chrome.storage.local.get(null);
    const normalized = normalize(data);
    if ((data.schemaVersion || 0) < SCHEMA_VERSION) await chrome.storage.local.set({ ...normalized, schemaVersion: SCHEMA_VERSION });
    return normalized;
  }

  async function setKey(key, value) { await chrome.storage.local.set({ [key]: value }); return value; }
  async function addEvent(type, payload={}) {
    const { events } = await getAll();
    const next = [{ id: uid('evt'), type, at: now(), ...payload }, ...events].slice(0, 1200);
    await setKey('events', next);
  }

  async function upsertContact(contactId, patch={}) {
    const { contacts } = await getAll();
    const previous = contacts[contactId] || { id: contactId, createdAt: now(), tags: [], customFields: {}, stageId: 'new' };
    contacts[contactId] = { ...previous, ...patch, id: contactId, updatedAt: now() };
    await setKey('contacts', contacts);
    return contacts[contactId];
  }

  async function removeContact(contactId) {
    const data = await getAll();
    delete data.contacts[contactId];
    await chrome.storage.local.set({
      contacts: data.contacts,
      followUps: data.followUps.filter(x=>x.contactId!==contactId),
      scheduled: data.scheduled.filter(x=>x.contactId!==contactId)
    });
  }

  async function setStage(contactId, stageId, displayName='') {
    const contact = await upsertContact(contactId, { displayName, stageId });
    await addEvent('stage_changed', { contactId, displayName, stageId });
    return contact;
  }

  async function addFollowUp(item) {
    const { followUps } = await getAll();
    const record = { id: uid('fu'), done:false, createdAt:now(), notifiedAt:null, ...item };
    followUps.push(record); await setKey('followUps', followUps);
    chrome.runtime.sendMessage({ type: 'APOIS_SYNC_ALARMS' }).catch(()=>{});
    await addEvent('followup_created', { contactId: record.contactId, followUpId: record.id, when: record.when });
    return record;
  }

  async function updateFollowUp(id, patch) {
    const { followUps } = await getAll();
    const next = followUps.map(x=>x.id===id?{...x,...patch,updatedAt:now()}:x);
    await setKey('followUps', next); chrome.runtime.sendMessage({ type:'APOIS_SYNC_ALARMS' }).catch(()=>{}); return next.find(x=>x.id===id);
  }

  async function deleteFollowUp(id) {
    const { followUps } = await getAll(); await setKey('followUps', followUps.filter(x=>x.id!==id));
    chrome.runtime.sendMessage({ type:'APOIS_SYNC_ALARMS' }).catch(()=>{});
  }

  async function addScheduled(item) {
    const { scheduled } = await getAll();
    const record = { id: uid('sch'), status:'pending', createdAt:now(), ...item };
    scheduled.push(record); await setKey('scheduled', scheduled); chrome.runtime.sendMessage({type:'APOIS_SYNC_ALARMS'}).catch(()=>{}); return record;
  }

  async function updateScheduled(id, patch) {
    const { scheduled } = await getAll();
    const next = scheduled.map(x=>x.id===id?{...x,...patch,updatedAt:now()}:x);
    await setKey('scheduled', next); chrome.runtime.sendMessage({type:'APOIS_SYNC_ALARMS'}).catch(()=>{}); return next.find(x=>x.id===id);
  }

  async function saveQuickReply(reply) {
    const { quickReplies } = await getAll();
    const i = quickReplies.findIndex(x=>x.id===reply.id);
    const record = { id: reply.id || uid('qr'), category:'Geral', favorite:false, useCount:0, createdAt:now(), ...reply, updatedAt:now() };
    if (i>=0) quickReplies[i] = { ...quickReplies[i], ...record }; else quickReplies.push(record);
    await setKey('quickReplies', quickReplies); return record;
  }

  async function touchQuickReply(id) {
    const { quickReplies } = await getAll();
    const next = quickReplies.map(x=>x.id===id?{...x,useCount:(x.useCount||0)+1,lastUsedAt:now()}:x);
    await setKey('quickReplies', next);
  }

  async function deleteQuickReply(id) { const {quickReplies}=await getAll(); await setKey('quickReplies', quickReplies.filter(x=>x.id!==id)); }

  async function saveAutomation(rule) {
    const { automations } = await getAll(); const i=automations.findIndex(x=>x.id===rule.id);
    const record={id:rule.id||uid('auto'),enabled:true,createdAt:now(),trigger:'contains',match:'',reply:'',cooldownMinutes:60,...rule,updatedAt:now()};
    if(i>=0)automations[i]={...automations[i],...record};else automations.push(record); await setKey('automations',automations); return record;
  }

  async function saveCampaign(campaign) {
    const { campaigns }=await getAll(); const i=campaigns.findIndex(x=>x.id===campaign.id);
    const record={id:campaign.id||uid('camp'),name:'Campanha',status:'draft',contactIds:[],message:'',createdAt:now(),...campaign,updatedAt:now()};
    if(i>=0)campaigns[i]={...campaigns[i],...record};else campaigns.push(record); await setKey('campaigns',campaigns); return record;
  }

  async function replaceAll(data) {
    const safe = normalize(data || {}); safe.schemaVersion = SCHEMA_VERSION; await chrome.storage.local.clear(); await chrome.storage.local.set(safe); chrome.runtime.sendMessage({type:'APOIS_SYNC_ALARMS'}).catch(()=>{}); return safe;
  }

  window.APOISStorage = { SCHEMA_VERSION, DEFAULTS, uid, getAll, setKey, addEvent, upsertContact, removeContact, setStage, addFollowUp, updateFollowUp, deleteFollowUp, addScheduled, updateScheduled, saveQuickReply, touchQuickReply, deleteQuickReply, saveAutomation, saveCampaign, replaceAll };
})();

const FU = 'apois_fu_';
const SCH = 'apois_sch_';

async function getData(){return chrome.storage.local.get({settings:{notifications:true,reminderLeadMinutes:0},followUps:[],scheduled:[]});}

async function syncAlarms(){
  const {followUps,scheduled,settings}=await getData();
  const alarms=await chrome.alarms.getAll();
  await Promise.all(alarms.filter(a=>a.name.startsWith(FU)||a.name.startsWith(SCH)).map(a=>chrome.alarms.clear(a.name)));
  const lead=(Number(settings?.reminderLeadMinutes)||0)*60000; const now=Date.now();
  for(const f of followUps){if(!f.done&&f.when&&f.when-lead>now)chrome.alarms.create(FU+f.id,{when:f.when-lead});}
  for(const s of scheduled){if(s.status==='pending'&&s.when&&s.when>now)chrome.alarms.create(SCH+s.id,{when:s.when});}
}

chrome.runtime.onInstalled.addListener(syncAlarms);
chrome.runtime.onStartup.addListener(syncAlarms);
chrome.runtime.onMessage.addListener((msg)=>{if(msg?.type==='APOIS_SYNC_ALARMS')syncAlarms();});
chrome.action.onClicked.addListener(async tab=>{if(tab?.id&&tab.url?.startsWith('https://web.whatsapp.com/'))chrome.tabs.sendMessage(tab.id,{type:'APOIS_TOGGLE_PANEL'}).catch(()=>{});else chrome.runtime.openOptionsPage();});

chrome.alarms.onAlarm.addListener(async alarm=>{
  const data=await getData();
  if(alarm.name.startsWith(FU)){
    const id=alarm.name.slice(FU.length), item=data.followUps.find(x=>x.id===id); if(!item||item.done)return;
    if(data.settings?.notifications!==false) await chrome.notifications.create('apois_fu_'+id,{type:'basic',iconUrl:'assets/icon128.png',title:'APOIS CRM • Follow-up',message:`${item.contactName||'Contato'}: ${item.note||'Follow-up pendente'}`,priority:2});
    await chrome.storage.local.set({followUps:data.followUps.map(x=>x.id===id?{...x,notifiedAt:Date.now()}:x)});
  }
  if(alarm.name.startsWith(SCH)){
    const id=alarm.name.slice(SCH.length), item=data.scheduled.find(x=>x.id===id); if(!item||item.status!=='pending')return;
    if(data.settings?.notifications!==false) await chrome.notifications.create('apois_sch_'+id,{type:'basic',iconUrl:'assets/icon128.png',title:'APOIS CRM • Mensagem agendada',message:`${item.contactName||'Contato'}: ${item.text||'Mensagem pronta para envio'}`,priority:2});
    await chrome.storage.local.set({scheduled:data.scheduled.map(x=>x.id===id?{...x,status:'due',dueAt:Date.now()}:x)});
  }
});

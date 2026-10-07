export async function rpc(type,payload={}) {
  const response=await chrome.runtime.sendMessage({scope:'APOIS-CRM',type,payload,requestId:crypto.randomUUID()});
  if(!response?.ok)throw new Error(response?.error || 'Extensão indisponível. Recarregue o WhatsApp.');
  return response.result;
}
export function download(name,data,type='application/json') {
  const blob=new Blob([typeof data==='string' ? data : JSON.stringify(data)],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${{plus:'M12 5v14M5 12h14',send:'m3 3 18 9-18 9 4-9-4-9Zm4 9h14',close:'m6 6 12 12M6 18 18 6',edit:'m16 3 5 5-12 12H4v-5L16 3Z',star:'m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',copy:'M8 8h13v13H8V8ZM16 8V3H3v13h5',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'}[name] || 'M4 4h16v16H4Z'}"/></svg>`;
export function button(label,action,extra='') {return `<button type="button" data-action="${esc(action)}" ${extra}>${esc(label)}</button>`;}

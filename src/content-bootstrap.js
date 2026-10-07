(() => {
  if(window.__APOIS_BOOTSTRAP_V4__)return;
  window.__APOIS_BOOTSTRAP_V4__=true;
  import(chrome.runtime.getURL('src/content.js')).catch(error=>console.error('[APOIS CRM] Falha ao carregar:',error));
})();

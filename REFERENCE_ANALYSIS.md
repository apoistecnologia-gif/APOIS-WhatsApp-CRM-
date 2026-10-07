# Auditoria da referência — 7 de outubro de 2026

## Escopo e evidência
Referência: WHABOOST 7.4.2.16; anterior: APOIS 3.1.1. Extração de 355 arquivos externos, leitura estática integral por scanner dos arquivos de texto e inventário de binários, mais distribuição ZIP interna. Inventário verificável em docs/REFERENCE_INVENTORY.md. Rastreio manual dos caminhos críticos abaixo. Sem sessão real autenticada: execução, compatibilidade com o WhatsApp atual e todos os recursos secundários não estão comprovados. Código distribuído é compilado; não há fontes TypeScript originais nem sourcemaps suficientes para reconstruir nomes originais.

Para abreviar, C23 significa `content/assets/js/v_7_4_2_16_364f475f-21c1-4d89-bf17-70efc8c405b723.js`; outros C números seguem esse prefixo.

## Arquitetura
Manifest V3, content/index.js importa C20 e C21 dinamicamente. C20 injeta `whatsapp/index.iife.js` via script no documento (MAIN), espera `#app .app-wrapper-web`; o bundle publica WPP. C21 monta React; C23 reúne stores Zustand, ações, selectors e backend. Background clássico inicializa chrome.storage, alarmes, navegação e eventos entre abas. CRM, funil e fluxos possuem páginas próprias com chunks compartilhados. `window.postMessage` transporta RPC `{model:'WPP',type,action,dados,id}`; retorno `{type:'WPP',id,response}` JSON. Eventos usam `{type:'Ev',action,model}`. C10 contém transportes de eventos e helpers de IndexedDB.

## Mapa funcional rastreado
| Área | Origem/caminho | Comportamento e decisão |
|---|---|---|
| Manifest/permissões | manifest.json | storage, unlimitedStorage, alarms, tabs; recursos acessíveis amplos; update_url Chrome. Reduzir permissões e recursos no novo produto. |
| Content scripts | content/index.js → C20/C21 | Bootstrap, stores, montagem React e eventos. Não reutilizar chunks comerciais. |
| MAIN world | whatsapp/index.iife.js | WA-JS 3.18.8 mais wrapper proprietário, selectors, IA e multiatendimento. O arquivo APOIS vendor é idêntico byte a byte; não é biblioteca upstream limpa. Substituir por pacote oficial. |
| Background | background.js | Alarmes de 1/5/10/30 minutos, mensagens para abas, licença a cada 5 minutos, selectors remotos a cada 10. Reimplementar somente as rotas locais necessárias. |
| Armazenamento | background.js, C10/C23/C25 | chrome.storage.local para respostas, ações, categorias, CRM, perfil, agenda; IndexedDB para preferências e tabelas auxiliares; localStorage em bundles de bibliotecas. Não copiar tokens. |
| Schema rápido | C25 e C23 `oa` | `respostasRapidas` metadados; `respostasRapidasAcao` registros `{id,acao:[{id,type,propriedades}]}`; categoria; `guardaMsg`/`medias` formato anterior. Script compõe IDs e timers. |
| Execução composta | C23 `sendAction` → `st` | Captura destinatário; expande script; percorre ações com `await` e monitor com índice/quantidade. Inclui texto, imagem, vídeo, áudio, doc, PIX, etiquetas, CRM, timer, transferência, arquivo/contato e outros. Novo escopo cobre ações pedidas, com interrupção na falha e registro parcial. |
| Chat ativo | MAIN `initializeEventListeners`, `Chat` | `WPP.on('chat.active_chat')`, `WPP.chat.getActiveChat()`; IDs @lid convertidos via ApiContact.getPhoneNumber quando disponível. Preservar IDs completos, nunca usar nome como identidade. |
| Texto | C23 Uo → RPC Chat/sendTxt → MAIN `text` | `WPP.chat.sendTextMessage(Phone_serialized(id),msg,{createChat:true,detectMentioned:true,mentionedList})`; falhas antigas viram false. Nova versão propaga erro e não repete envio incerto. |
| Imagem | MAIN `image` | sendFileMessage base64 `{type:'image',createChat:true,isHD:true,caption,isViewOnce}`. Envio direto. |
| Vídeo | MAIN `video` | sendFileMessage `{type:'video',caption,isPtv,isViewOnce}`. Sem manipular preview. |
| Documento | MAIN `doc` | sendFileMessage `{type:'document',filename}`. |
| Áudio/PTT | C23 No → Chat/sendAudio → MAIN `audio` | `WPP.chat.sendFileMessage(id,base64,{createChat:true,type:'audio',isPtt:true})`. A referência não clica no gravador e não substitui getUserMedia para esse fluxo. Conversão/metadata ficam no WA-JS/WhatsApp. A versão APOIS anterior incluiu um fluxo alternativo complexo de microfone sintético; descartar. |
| Assinatura manual | C23 store I `configAssinatura`/`sendTextChat` | Intercepta Enter e clique de enviar; lê compositor só na tentativa de envio; constrói `*_<nome>:_* \n<texto>` em memória. Não preenche nome ao abrir chat. RPC Functions/sendTextChat usa WA-JS, recupera quotedMsg por React fiber e limpa compositor. Preservar reply nativo com opção WA-JS atual verificada. |
| Atendentes | C23 store Z + MAIN MultiAtendimento_Class | Nome de assinatura, browser/device, conta WhatsApp, email e atribuições. Indicador DOM na lista; rede coordena dispositivos. Nova versão terá atribuição local compartilhada entre telas da mesma extensão. |
| Transferência de atendente | C212/C139/C183 → C23 Z | Seleção, mensagem, urgência, Socket.IO `transferir_atendimento`; histórico/status remoto. Nova implementação local, sem fingir sincronização entre computadores. |
| Multiatendimento | C23 Z | websocket antigo, path `/ws/socket.io`, eventos connect-atendente/update, atribuições e status. Não reproduzir backend do fornecedor. |
| Etiquetas | MAIN Labels; C23 kt/Wo | WA-JS getAllLabels/addOrRemoveLabels com labelId/type. Também abas locais. Etiquetas CRM independentes persistentes podem funcionar em contas sem WhatsApp Business; documentar diferença. |
| Funil/kanban | C23 stores userTabs/crm, funnil/* | Abas com chats, cores, contadores; entradas/saídas acionam follow-up em C20. Novo escopo: etapas, movimentação, contador e persistência. |
| UI | C21, CSS, C23 selectors | React, Tailwind/DaisyUI, classes WhatsApp e selectors versionados/remotos. Muitos listeners/observers; reconstruir com Shadow DOM e reserva de espaço fora do painel. |
| Multiconta/QR | C23 whatsApi, backend websocket | Não prova isolamento de vários WhatsApp Web por cookies em uma extensão. Serviço antigo fornece API/gestão remota. Nova central usa bridge local com auth por pasta de sessão e QR dentro da central. |
| Backend/API | background.js, C23, C8/C2 | Backend principal/utilitários, IA, transcrição, websockets, calendário, webhook. Excluir rede comercial. Não confundir strings de libs com telemetria efetivamente disparada. |
| Licença/pagamento | background license_update, C23 C user.estado/ae/jt/Ir | Usuário pago/free, contadores/quotas por função, modais e renovação. Identificado e excluído; nenhuma alteração na original. |
| Telemetria/updates | background install/uninstall, selectors; bundles Statsig | Abertura remota em instalação; URL desinstalação; notificações e selectors remotos. Bundles contêm SDKs de métricas; presença não comprova todo uso. Não incorporar. |
| Bibliotecas | headers/imports dos chunks | WA-JS Apache-2.0; React/MIT, Zustand, jQuery, Socket.IO, Axios, ReactFlow/XYFlow, drag/drop Atlassian, emoji picker, compressão, SDK Google/OpenAI. Usar dependências upstream declaradas somente quando necessárias. |
| Minificação/ofuscação | todos os chunks | Minificação por build, nomes reduzidos, módulos webpack/Vite. Não foi demonstrada ofuscação criptográfica completa; funções comerciais usam dados cifrados. Novo código próprio legível. |
| Migração/backup | C25/C31 | Campos comprimidos por item e mídias base64, seleção/merge. Não existe acesso automático a chrome.storage de outra extensão. Importação deve partir de backup explícito, com whitelist e preservação de origem. |

## Riscos concretos da base anterior
Vendor 3.1.1 contém todo o wrapper WHABOOST (hash igual), inclusive selectors e funcionalidades remotas; não corresponde a uma cópia upstream limpa como sugere THIRD_PARTY_NOTICES. content.js tem 2.243 linhas, CSS 1.307 linhas com estilos acumulados, múltiplos caminhos de envio e fallback, bridge sem isolamento de API por autenticação adequada. Repositório main 0.9.0 contém somente 13 blobs; content.js/content.css/options.js/options.css/ícones estão ausentes apesar do manifest/HTML; .release guarda fragmentos base64 em vez do código completo. Preservar main e substituir numa branch nova.

## Arquitetura decidida antes de implementar
Extensão MV3 com service worker dono de IndexedDB, UI em Shadow DOM, camada MAIN mínima usando WA-JS upstream 4.6.1, RPC com correlacionamento, destinatário fixado e idempotência. Dados e blobs no origin da extensão, não no origin do WhatsApp. Bridge opcional Node local com API autenticada, sessões separadas e reconexão; sem licenciamento/servidor antigo. Não abrir sessões por abas com mesmos cookies.

Fontes primárias de API conferidas em 07/10/2026: https://wppconnect.io/wa-js/functions/chat.sendFileMessage.html ; https://github.com/wppconnect-team/wa-js ; https://github.com/WhiskeySockets/Baileys . Dependências instaladas upstream e versões fixadas no lockfile. A validação real de envio/duração/waveform continua necessária.

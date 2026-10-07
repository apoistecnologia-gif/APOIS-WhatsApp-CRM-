# Auditoria da referência 7.4.2.16 e APOIS 3.1.1

Data: 07/10/2026. O RAR foi extraído integralmente (355 arquivos), incluindo o ZIP `waboost.zip`. O inventário com caminhos, tamanhos e SHA-256 está em `docs/reference-inventory.json`. Os arquivos textuais foram percorridos para localizar módulos, APIs, persistência e destinos de rede; a leitura funcional concentrou-se nos fluxos abaixo. O código distribuído é minificado; não há fontes originais, source maps nem testes do fornecedor. Esta análise estática não comprova funcionamento no WhatsApp atual.

## Arquitetura e inventário técnico

| Área | Evidência encontrada | Decisão APOIS |
|---|---|---|
| Manifest e permissões | MV3; storage, unlimitedStorage, alarms, tabs; `content/index.js`; três CSS; `background.js`; recursos web muito amplos | Recursos e permissões restritos ao necessário |
| Content script | Loader Vite importa chunks em `content/assets/js`; componentes React e stores Zustand; jQuery em manipulação DOM | Preservar UI independente APOIS e separar núcleo testável |
| MAIN world | `whatsapp/index.iife.js`: WA-JS 3.18.8 seguida de código próprio do fornecedor; dispatcher `window.postMessage`, modelo WPP | Utilizar WA-JS oficial obtida do pacote npm 3.18.8; dispatcher próprio limitado |
| Background | Notificações/alarmes; comunicação com abas; seleção DOM obtida remotamente | Nenhum seletor, atualização ou bloqueio remoto do fornecedor |
| Persistência | chrome.storage.local; IndexedDB; localStorage; stores por recurso; gravações adiadas | chrome.storage + IndexedDB para mídia; migração e backup validado |
| Bibliotecas | React, Zustand, jQuery, WA-JS; Socket.IO; bibliotecas de arraste, fluxo e calendário nos chunks | UI APOIS sem frameworks novos; WA-JS isolada e opcional |
| Interface | Toolbar, filtros de chats, drawer, páginas iframe de CRM/funil/fluxo; alterações no DOM do WhatsApp | Redimensionar app; CSS com escopo APOIS; proteger menus nativos |
| Chat ativo | Evento WA-JS `chat.active_chat`; `id._serialized`; normalização LID por ApiContact.getPhoneNumber | Consultar ID atual antes de ação interna; não enviar para cache antigo |
| Texto | `Chat.sendTxt` chama WPP.chat.sendTextMessage; wrapper aplica `Phone_serialized` e retries | Await real; não repetir após erro de resultado incerto |
| Texto assinado | Chunk final `...b723.js`, store `sendTextChat` monta `*_<nome>:_*` + quebra de linha; `configAssinatura` intercepta keydown/click; `Functions.sendTextChat` usa quotedMsg | Nome somente no evento de envio; envio nativo preserva resposta/citação e emojis |
| Respostas rápidas | Editor de ações e categorias; ações processadas em ordem; mídia em base64; ordenação/favoritos/atalhos | Respostas compostas locais com trava de execução e validação de conversa |
| Imagem | `image(p)` -> sendFileMessage(id,base64,{type:image,isHD:true,caption,...}) | API isolada quando disponível; fluxo nativo como alternativa escolhida antes do envio |
| Vídeo | `video(p)` -> sendFileMessage(...,{type:video,caption,isPtv,isViewOnce}) | Vídeo/legenda; recursos PTV/view-once não equivalentes nesta entrega |
| Documento | `doc(p)` -> sendFileMessage(...,{type:document,filename}) | Envio com nome; sem backend |
| Áudio/PTT | `audio(p)` -> sendFileMessage(...,{createChat:true,type:audio,isPtt:true}); erros viram false | PTT direto se biblioteca pronta; alternativa pelo gravador nativo, com progresso |
| PIX | sendPixKeyMessage com keyType,name,key; editor armazena ação PIX | Mensagem imediata com chave/titular/banco; não reproduz cartão PIX interativo |
| Etiquetas | WPP.labels getAllLabels/addOrRemoveLabels; etiquetas internas adicionais | Etiquetas APOIS locais; não prometer sincronização com etiquetas Business |
| Atendentes | Assinatura, atribuição local `addLocalAtendente(id,Ativo)` e multiatendimento remoto | Cadastro/atribuição/histórico local; mídias atribuídas internamente |
| Transferência | Ação de troca de atendente; multiatendimento do fornecedor usa Socket.IO | Transferência de atendente local; entre números pela ponte independente |
| Funil/kanban | `funnil/index.js` e módulos CRM: colunas, cartões e chrome.storage | Etapas persistentes por contato e conta; gestão/kanban local |
| Multiconta/QR | Há API/socket do fornecedor e multiatendimento. Não foi demonstrada no pacote uma implementação inteiramente local de várias sessões independentes | Ponte Node separada com Baileys; cada sessão tem pasta própria e QR |
| Backend | Backend principal, auxiliares, multiatendimento, transcrição e seletores remotos | Não incorporar |
| Licenciamento | Configuração comercial/premium nos chunks e endpoints backend; cobrança externa na distribuição | Não incorporar validação, vencimento, pagamento ou autenticação do fornecedor |
| Telemetria | Referências Analytics/Statsig em dependências; WA-JS tem configuração disableGoogleAnalytics | Configuração de telemetria desativada antes do bootstrap; nenhum módulo fornecedor |
| Atualização | update_url Chrome Store; seletores remotos no background | Atualização por release, sem fetch de código ou seletores |
| Código minificado | Bundles Vite e WA-JS; texto de biblioteca não equivale a uso ativo de endpoint | Minificação apenas na biblioteca oficial identificada; código APOIS legível |

## Chamadas e parâmetros críticos

`configAssinatura` registra eventos em seletores `assChat`, `assInput`, `assBtn` e observa `mainAudio`. Ao abrir o chat não insere prefixo. `sendTextChat` lê childNodes do compositor, concatena linhas, consulta assinatura ativa, monta o texto e solicita `Functions.sendTextChat({chatID,formattedMessage})`. Este wrapper coleta a citação pelo React Fiber e chama WA-JS, mas **não aguarda** a Promise do envio antes de limpar o campo. APOIS 3.1.1 reutilizava esse wrapper e adicionava fallback: a combinação pode perder texto ou duplicar envio. A reconstrução remove o wrapper.

As funções image/doc/video/audio usam `trySendingMessage` e `Phone_serialized`. A resposta rápida composta dispara essas ações em ordem. O fato de WA-JS 3.18.8 estar no arquivo não garante compatibilidade com o build atual; sua inicialização e cada operação devem ser diagnosticadas, com erro visível.

## Servidores excluídos

Identificados destinos do backend principal, funções auxiliares, multiatendimento, transcrição, cobrança, painel do fornecedor e integrações de IA. A referência incorpora inclusive uma função IA que envia prompts a números terceiros. Nada disso pertence ao produto independente. Não publicar chaves, tokens nem valores de configuração encontrados no arquivo de referência. O inventário contém apenas nomes, tamanhos e hashes.

## Auditoria das bases APOIS

O ZIP 3.1.1 oferece painel, construtor de ações, etiquetas, atendentes e ponte multiconta. O arquivo `vendor/whatsapp-reference-adapter.js` contém tanto WA-JS como funções específicas do fornecedor; a atribuição de licença anterior descrevia o conjunto incorretamente como apenas WA-JS. Há chamada a função inexistente `prependAttendantSignature`, contadores de funil derivados de etiquetas (etapas sobrepostas), restauração que limpa storage antes de validar mídias, IDs de chat em cache e listeners sem cleanup central.

O repositório main consultado contém README da versão 0.9.0, manifest, background e storage, mas faltam content.js/CSS/options.js na árvore de execução. Esses arquivos existem apenas no ZIP codificado em `.release`. A branch de reconstrução mantém o histórico e substitui a árvore de execução por arquivos concretos. A base 0.9 não é a mesma versão do ZIP 3.1.1 anexado.

## Limites de equivalência

O inventário cobre todo o pacote; não há alegação de paridade integral com os módulos comerciais de IA, ERP, calendário, campanhas, chatbot, fluxo visual, follow-up ou disparo em massa. O objetivo desta versão é o conjunto solicitado: atendimento, respostas, mídia, etiquetas, funil e central local. Validação com conta WhatsApp real, upload/PTT entregue, QR e transferências entre celulares exige sessão conectada e não pode ser inferida de testes simulados.

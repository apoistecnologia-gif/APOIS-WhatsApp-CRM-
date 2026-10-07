# Arquitetura

## Componentes

| Componente | Responsabilidade |
|---|---|
| manifest.json | MV3; MAIN e ISOLATED carregados explicitamente; recursos de marca |
| src/wa-config.js | Desativa telemetria e servidores de prévia externos antes da biblioteca |
| vendor/wa-js-3.18.8.js | Biblioteca oficial Apache-2.0; patch documentado em vendor/PATCHES.md |
| src/whatsapp-adapter.js | Dispatcher próprio: prontidão, chat ativo, texto e mídia; valida ID atual e deduplica pedidos |
| src/main-world.js | Alternativa nativa de PTT: áudio salvo → MediaStream → gravador do WhatsApp; restaura hooks e recursos |
| src/core.js | Regras puras: assinatura, leitura de compositor/emoji, backup, identidade e trava de execução |
| src/storage.js | Schema 13, migração, entidades e API de persistência |
| src/background.js | Fila única de mutações entre abas; IndexedDB de mídias; requisições restritas à ponte local |
| src/content.js | UI, eventos de envio, respostas compostas, atendimento, funil, seleção de conta, backup |
| src/diagnostics.js | Relatório copiável; limita erros recentes e oculta números em mensagens de erro |
| apois-multiconta-bridge | Sessões Baileys independentes, QR, reconexão e envio pela conta de destino |

MAIN não acessa chrome.storage. ISOLATED troca mensagens locais com o adaptador; operações permitidas são explícitas. Nenhum código remoto, seletor remoto, licença ou prompt de IA do fornecedor é carregado. Uma página executando no próprio contexto do WhatsApp não pode ser isolada do motor do site por esse protocolo; a fronteira protege o produto contra operações acidentais do dispatcher antigo, não contra um WhatsApp comprometido.

## Fluxos

O texto manual permanece no compositor durante a digitação. O listener delegado em capture insere o prefixo somente no evento de envio e deixa o WhatsApp processar seu evento nativo. Isso preserva a citação sem consultar estruturas privadas React Fiber. Respostas rápidas de texto/PIX usam o compositor nativo, aguardam sua limpeza e preservam o rascunho anterior.

Antes do envio de mídia, a extensão decide qual motor usar. API pronta: sendFileMessage com type image/video/document/audio e isPtt para áudio. API indisponível: anexo/gravador nativo. Após tentativa de envio, erro não troca de motor, pois uma falha de confirmação pode ocorrer após a mensagem já ter sido aceita.

A trava por instância impede respostas compostas simultâneas na mesma aba. Cada ação verifica a conversa inicial. IDs de pedidos do adaptador são deduplicados inclusive durante execução. A fila do service worker serializa alterações de storage entre abas. Não há alegação de garantia distribuída de exactly-once entre reinícios do navegador e servidores WhatsApp.

## Dados

chrome.storage.local: respostas, categorias, etiquetas, atendentes, contas, contatos, etapas, atribuições, transferências, preferências e uso. IndexedDB `apois_media_db`: blobs, MIME, nome e duração. O backup contém mídia em base64; para acervos muito grandes, pode exigir bastante memória e disco. Não há exportação incremental/streaming nesta versão.

Contatos têm escopo de conta e usam WID quando disponível. Legados por nome são vinculados ao primeiro WID identificado; se houver homônimos nos dados antigos, a associação requer revisão. Sem API interna não há como distinguir com certeza homônimos apenas pelo título da conversa; o diagnóstico sinaliza disponibilidade da API.

Mídias compartilhadas por ações não são apagadas enquanto houver referência. Substituir arquivo gera novo ID. Restauração valida o backup, grava blobs em transação IndexedDB com novos IDs e só depois substitui a configuração; falha anterior ao último passo preserva as referências antigas. Pode deixar blobs sem referência se o storage falhar depois da transação, mas não destrói mídia anterior.

## Ponte

Escuta somente 127.0.0.1:3210. Há validação de Host, Origin e cabeçalho do cliente; a extensão só encaminha rotas permitidas. Credenciais permanecem em diretórios de sessão locais. A ponte persiste nomes, restaura sessões, descarta eventos de sockets antigos e cancela reconexão ao excluir sessão. Pedidos de texto com requestId deduplicam na memória da sessão. Reiniciar a ponte perde esse cache de deduplicação.

A seleção de conta Web é distinta dos cartões das sessões da ponte. Sessões existentes são reconciliadas com o cadastro, mesmo sem registro local anterior. A central mostra conversas recentes; não substitui uma tela completa de conversa de cada número. Transferência entre números mantém etiquetas, responsável e histórico; aviso na origem com falha é mostrado como pendência.

## Lifecycle e evolução

Listeners de assinatura usam AbortController; timers são rastreados e removidos ao finalizar; observer principal desconecta ao unload; gravação libera tracks/contexto. Alguns listeners locais em elementos descartados são coletados junto com o DOM. A extensão não mede heap nem comprova ausência absoluta de leaks.

Fontes APOIS são JavaScript legível, com módulos globais separados para MV3 sem build. Não há TypeScript nesta entrega; futura migração pode tipar as entidades e o dispatcher sem exigir mudança do produto.

# Arquitetura

## Responsabilidades
- `manifest.json`: MV3, MAIN scripts locais, isolado bootstrap, service worker módulo; somente storage/unlimitedStorage e hosts WhatsApp/loopback.
- `src/background.js`: RPC fechado, IndexedDB dono, sessão Web por aba, proxy bridge restrito, journals de envio, backup compatível.
- `src/database.js`: IndexedDB schema 2, transações, versionchange, optimistic locking por revisão, blobs, configurações, conversas, eventos, jobs, diagnóstico.
- `src/domain.js`: validação, whitelist de importação, PIX, assinatura, IDs account/chat, execução sequencial e interrupção.
- `src/main-world.js`: apenas integração WA-JS, status, guarda conta/chat, texto/mídia/PTT e captura do envio manual. Não há wrapper do fornecedor.
- `src/transport.js`: MessageChannel com correlação e timeout; pending limpo após retorno/erro/cleanup.
- `src/content.js`: Shadow DOM, largura reservada, funil, atendimento, etiquetas, sequência, transferência Web→bridge, diagnóstico e atalho.
- `src/manager.js`: CRUD/editor ordenado, central, contas, QR, funil, bridge→bridge, backups. Event delegation e AbortController.
- `src/migration.js`: importador explícito de backups legíveis; sem acesso ao armazenamento de outra extensão.
- `bridge/server.mjs`: Baileys upstream, auth por pasta, QR, registro de contas, descoberta de pastas órfãs, reconexão com geração e backoff, mensagens recentes, operação persistente, conversão OGG/Opus com FFmpeg.
- `src/contracts.ts`: tipos de domínio e transportes. Runtime é JS modular e lintado; typecheck cobre esses contratos.

## Dados
IndexedDB no origin da extensão (não no origin do WhatsApp), schema 2: config, media, conversations, events, jobs, diagnostics. A primeira versão interna usa config.schema 1, separado da versão do banco. A revisão impede salvar um editor sobre mudanças de outra tela. Transações readwrite serializam modificações concorrentes. Após salvar, chrome.storage emite apenas um marcador de revisão para atualizar telas; nenhum conteúdo de mensagens vai para storage.sync.

Conversa usa `${accountId}|${chatId}`; nome não é identidade. Contas Web têm prefixo `web:`; contas bridge têm UUID `acct_...`. LID preservado. A API bridge só usa JID telefônico individual para envio/transferência.

## Envios
Clique explícito gera operação UUID, reserva job no worker, fixa conta/chat/atendente e percorre ações com await. Cada passo tem ID próprio e resposta/ACK da biblioteca. MAIN memoriza resultados por operação sem executar de novo. Job registra quantas ações confirmadas. Timeout/falha interrompem restante, sem retry cego. Logs armazenam IDs e metadados, não conteúdo do texto normal no CRM; bridge armazena mensagens recentes localmente para continuidade e getMessage do Baileys.

Não se promete exactly-once de rede nem atomicidade entre contas. A persistência protege contra repetição de uma mesma operação conhecida; uma interrupção depois do envio e antes da confirmação permanece incerta. Reinício não reenvia journals incompletos. A UI de transferência registra started/origin_sent/completed/failed; o usuário verifica o cliente antes de repetir.

Assinatura: interceptação capture de Enter (exceto modifiers/composição) e botão nativo reconhecido; texto formatado em memória. O rascunho não recebe nome. Limpeza somente após sucesso, no mesmo chat e se o texto não mudou. Edição de mensagem/preview não são interceptados. Citação precisa de ID verificável; caso não identificado, exibe erro e mantém rascunho.

## Layout e ciclo de vida
Shadow DOM isola estilos. Ajuste externo se limita a #app/app-wrapper-web/two, com largura reservada e topo de 54 px. Painel não cobre chat; barra é z-index 60, painel 40. Menus de WhatsApp mantêm sua árvore nativa. Abaixo de 900 px o painel lateral recolhe e a Central permanece disponível. Isso precisa ser conferido com o layout nativo atual.

Listeners por delegação, AbortController, reinjeção com destroy, único MutationObserver childList no body. Uma consulta status por 3 segundos e polling de contas por 5 segundos somente com a tela Contas selecionada. Timers de timeout são limpos. Não há conversor de microfone falso, listeners por item, scripts remotos nem updates de selectors pelo antigo backend.

## Bridge local
Bind 127.0.0.1:3210; Host verificado; token aleatório 32 bytes; Bearer comparado em tempo constante; páginas Web não são origens aceitas. API no worker com whitelist de rota. Pastas/sessões validadas sem traversal. Credenciais ficam com permissões restritas quando o SO suporta. Token não entra em backup/diagnóstico.

Baileys recebe mensagens/contatos/history, guarda últimas 200 por conversa, listas públicas com preview e IDs. Credenciais separadas por sessão; auth folders descobertos sem registro. Reconexão limitada por backoff, geração evita evento de socket anterior atualizar sessão nova. FFmpeg é dependência npm do mantenedor; argumentos fixos via spawn sem shell e arquivos temporários removidos após uso.

Limites atuais: mensagens/grupos/LID na Central são somente visualizados quando compatíveis; envio bridge exige telefone individual. 40 MB por mídia/200 MB por exportação local. Retenção de histórico CRM/jobs ainda não tem UI de expurgo; para volume alto, monitore espaço. Mídias órfãs após editar/excluir não são apagadas automaticamente para preservar referências/backup; expurgo conservador é melhoria futura. Estas são limitações explícitas, não validação de carga em produção.

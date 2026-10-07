# APOIS CRM 4.0.0 — versão de homologação

Extensão independente para Chrome/Edge, com respostas compostas, notas de voz, mídias, PIX, etiquetas, atendentes, funil e central multiconta local. Não há assinatura, cobrança, licença comercial, bloqueio por vencimento ou backend do fornecedor antigo. A original não foi modificada.

## Instalar a extensão
1. Extraia o ZIP em uma pasta permanente.
2. Preserve a extensão antiga e exporte seus dados antes de desativá-la. Deixe somente uma extensão CRM ativa durante a homologação.
3. Abra `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
4. Ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta que contém `manifest.json`.
5. Recarregue o WhatsApp Web. Use a barra APOIS ou `Alt+A` para abrir/fechar o painel.
6. Para backup e números independentes, abra **Central**.

A extensão pronta está na raiz do projeto e em `dist/apois-crm` após o build. Não precisa executar npm para carregar a extensão quando o vendor já está presente.

## Respostas e atendimento
- `+` cria uma resposta com título, atalho, categoria, favorita e ações.
- Uma resposta pode combinar texto, nota de voz, imagem, vídeo, documento e PIX; use as setas para ordenar. Um clique em Enviar executa na ordem.
- Áudio é enviado pela API como PTT (`isPtt:true`), sem preview/segundo clique. Compatibilidade real do codec, waveform e duração precisam de homologação no WhatsApp atual. O bridge converte áudio para OGG/Opus com FFmpeg local.
- Nome do atendente é incluído no texto ao enviar, sem alterar o rascunho ao abrir conversa, selecionar atendente ou digitar. Shift+Enter continua quebra de linha. Resposta citada depende da identificação do modelo nativo; se não reconhecida, a mensagem permanece no campo e o diagnóstico explica a falha.
- Funil na barra move a conversa; a Central mostra colunas e permite mudar etapas e filtrar por etiqueta. Etapas são editáveis em **Etapas**.
- Etiquetas APOIS são locais e persistentes; não são as etiquetas oficiais do WhatsApp Business.
- Atendentes e histórico pertencem a este navegador/instalação. Não há sincronização de equipe entre computadores.
- Atalhos `/nome` localizam a resposta; clique em Enviar para confirmar o envio composto. O atalho não insere assinatura no rascunho.

## Conectar vários números
A extensão não isola cookies do WhatsApp em várias abas. A central usa um bridge Node local com sessões independentes, cada uma em sua pasta.

Windows:
1. Instale Node.js 20 ou superior.
2. Mantenha a pasta `bridge` em local permanente.
3. Execute `bridge/INSTALAR-APOIS.bat`. Ele instala dependências upstream e registra a tarefa **APOIS CRM Bridge** para iniciar no seu logon. A chave local é copiada para a área de transferência.
4. Na Central, abra **Configurações**, cole a chave em **Bridge local** e salve.
5. Em **Contas**, dê um nome, clique em **Conectar número** e escaneie o QR com **WhatsApp > Aparelhos conectados**.
6. Repita para outros números. Todas as sessões descobertas aparecem, mesmo sem cadastro na extensão. O seletor **Todas** e os nomes das contas ficam visíveis na central.

Para iniciar manualmente: `bridge/INICIAR-APOIS.bat`. Para retirar somente o início automático: execute `bridge/REMOVER-INICIO-AUTOMATICO.ps1`; seus dados permanecem. A tarefa/instaladores Windows ainda não foram executados num Windows real.

Linux/macOS: `cd bridge`, `npm ci --omit=dev --ignore-scripts`, `npm start`. Para início automático, use o gerenciador de serviços do sistema. O instalador automático incluído é Windows.

Sessões/credenciais do WhatsApp não entram no backup de configuração. Ficam em `%LOCALAPPDATA%\APOIS-CRM` no Windows ou `~/.local/share/APOIS-CRM` no Linux. A chave local autoriza a extensão a usar a API; não é uma licença comercial. Não compartilhe essa chave.

## Transferência
- No painel, escolha atendente e mesma conta, ou uma conta bridge conectada.
- Entre números, a origem notifica o cliente, o destino envia a continuidade e as etiquetas/etapa/atendente são copiados com registro de histórico.
- Na Central, selecione uma conta e uma conversa para transferir entre duas contas bridge.
- Apenas conversa individual com telefone identificado é transferida entre números. IDs `@lid` não são convertidos por suposição; grupos também não são transferidos.
- As duas mensagens não são uma transação atômica do WhatsApp. Se uma etapa falhar, o histórico registra a fase; confira a conversa antes de repetir. Não há repetição automática de envios incertos.

## Backup e atualização
Em **Central > Configurações**, exporte backup completo JSON (inclui as mídias, até 200 MB de dados binários). Limite de cada mídia: 40 MB na interface; para vídeos grandes use uma versão compactada. A restauração exige confirmação e valida o backup antes de substituir dados, em transação IndexedDB. Não importa tokens/licenças/senhas comerciais. Leia [MIGRATION.md](MIGRATION.md) para os formatos antigos aceitos e limites.

Para atualizar, exporte backup, preserve a mesma pasta e recarregue a extensão em chrome://extensions; depois recarregue o WhatsApp. Remover a extensão pode excluir seus dados locais. Não desinstale para atualizar. Restaurar num outro ID de extensão requer o backup explícito.

## Diagnóstico e status de validação
**APOIS > Configurações > Copiar diagnóstico** informa versão, content/MAIN, biblioteca, chat/conta/atendente, IndexedDB, sessões e erros. A Central mostra estados/QR/última sincronização e histórico de envios. Se o Clipboard for bloqueado, o relatório aparece em um campo copiável.

Passaram 23 testes automatizados e a validação de sintaxe/manifest/imports/lint/contratos TypeScript. Também passou um conjunto de testes de interface num Chromium headless com APIs Chrome/WhatsApp simuladas. O Chromium completo não conseguiu abrir uma extensão unpacked neste ambiente devido à restrição de socket AF_UNIX. Os testes simulados não comprovam entrega real de mensagens. Veja [TESTING.md](TESTING.md).

Falta homologação real: extensão instalada no Chrome/Edge, compatibilidade WA-JS com a conta atual, todos os tipos de mídia, PTT nos celulares destinatários, menus nativos, citação/edição nativa, QR de múltiplos números, reconexão autenticada, transferências entre números e início automático Windows. A logomarca gráfica definitiva ainda depende do arquivo prometido; esta versão usa a marca textual APOIS em vermelho, branco e grafite.

## Desenvolvimento
```bash
npm ci --ignore-scripts
npm ci --prefix bridge --ignore-scripts
npm run verify
node scripts/browser-smoke.mjs
```
O teste de UI usa Chromium headless shell do Playwright; configure `APOIS_CHROME_SHELL` se seu caminho for diferente. Para testar unpacked num ambiente sem a restrição acima: `node scripts/browser-unpacked.mjs`.

Código próprio é JavaScript modular legível; os contratos TypeScript são checados estritamente. Não alegamos que todo o JavaScript esteja tipado pelo TypeScript. Vendor upstream é minificado pelo mantenedor e preservado com licença. Documentação: [ARCHITECTURE.md](ARCHITECTURE.md), [REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md), [CHANGELOG.md](CHANGELOG.md).

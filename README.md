# APOIS CRM 3.2.0

Extensão independente para Chrome/Edge, Manifest V3, com dados locais e identidade APOIS. Versão candidata a teste real: os testes automatizados usam um WhatsApp simulado, não enviam mensagens a clientes.

## Instalar

1. Extraia `APOIS-CRM-v3.2.0.zip` para uma pasta permanente.
2. Abra `chrome://extensions` ou `edge://extensions` e ative Modo do desenvolvedor.
3. Clique em Carregar sem compactação e selecione a pasta `apois-crm`, que contém `manifest.json`.
4. Desative a extensão antiga para o primeiro teste. Abra/recarregue WhatsApp Web.
5. Cadastre atendentes pelo botão Atendentes e contas. Escolha o responsável no rodapé do painel.

Abrir uma conversa ou selecionar atendente não insere assinatura no compositor. Ao enviar texto por Enter ou pelo botão nativo, o prefixo `*_<nome>:_*` é inserido naquele evento. Shift+Enter continua disponível. A opção do WhatsApp de enviar por Enter deve estar ativada para esse fluxo.

## Respostas e atendimento

- Pesquisa, categorias, favoritos, uso, edição, duplicação, ordenação e atalhos `/`.
- Respostas compostas com texto, áudio/PTT, imagem, vídeo, documento e PIX; ações duplicáveis e reordenáveis.
- Um clique executa ações em ordem. A troca de conversa interrompe a sequência; erros não provocam reenvio automático por outro motor.
- PIX com chave, titular, banco opcional e mensagem personalizada. Configurar envio imediato ou incluir na sequência.
- PTT direto pela API interna quando pronta; alternativa pelo gravador nativo com progresso. Nesse modo a preparação leva a duração do áudio.
- Etiquetas locais, vários atendentes, responsável por conversa, histórico e transferência.
- Funil com uma etapa persistente por conversa, contadores e tela para mover contatos.
- Identidade pelo ID do WhatsApp quando a API o disponibiliza; modo nativo sem API usa o nome e tem limitação com homônimos.
- Diagnóstico: Configurações → Diagnóstico — copiar relatório.

O envio direto de mídia usa WA-JS 3.18.8, a versão identificada na referência. Se a API estiver pronta mas a operação falhar, a extensão mostra o erro e não tenta enviar de novo automaticamente. Confira a conversa antes de repetir.

## Multiconta

A aba WhatsApp Web mantém sua própria sessão. Números adicionais usam a ponte Node, com pastas de sessão separadas e QR na Central APOIS.

Windows: instale Node.js 20 ou superior, execute `INSTALAR-APOIS-MULTICONTA.bat` uma vez e depois conecte cada número pela Central. O instalador usa `npm ci`, registra a inicialização no Startup do usuário e exige manter a pasta no mesmo lugar. `INICIAR-APOIS-MULTICONTA.bat` inicia manualmente.

Linux/macOS: dentro de `apois-multiconta-bridge`, execute `npm ci` e `npm start`. A inicialização automática nesses sistemas deve ser configurada pelo usuário.

Não há mensalidade, licença, ativação premium ou servidor do fornecedor. A conexão com os servidores do próprio WhatsApp continua necessária. A ponte usa Baileys 7.0.0-rc14, versão pré-lançamento já usada na base anexada, agora com lockfile. A sessão exige teste real de QR, reconexão e transferência entre celulares.

## Atualizar sem perder dados

1. Na versão atual, exporte backup completo em Configurações e guarde o JSON.
2. Para manter o ID da extensão e o storage, mantenha o mesmo perfil e caminho da pasta já carregada; substitua os arquivos, clique em Recarregar e atualize a página.
3. Se instalar em outra pasta/perfil, restaure o backup. Os dados de uma extensão diferente não são acessíveis automaticamente.
4. Não apague a pasta de sessões da ponte. A atualização não requer limpar credenciais nem conectar novamente sem necessidade.

Não execute duas pontes na mesma porta. Se mudar a pasta da instalação, execute novamente o instalador para corrigir o caminho de Startup.

## Desenvolvimento e verificações

```bash
npm ci
npm run verify
npm run test:bridge
npm run test:browser
```

O teste de bridge exige `npm ci` também na pasta da ponte. Para browser, instale Playwright e um Chromium compatível no ambiente de desenvolvimento ou informe `PLAYWRIGHT_MODULE` e `CHROMIUM_PATH`. Os testes de navegador são fixture de DOM + APIs simuladas, com background e IndexedDB reais.

Leia `REFERENCE_ANALYSIS.md`, `ARCHITECTURE.md`, `MIGRATION.md`, `TESTING.md` e `CHANGELOG.md`. Esta versão não reproduz todos os módulos comerciais da referência, como IA, ERP, calendário, campanhas, chatbot e disparos em massa.

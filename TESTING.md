# Validação 3.2.0

## Evidências automatizadas

| Verificação | Resultado |
|---|---|
| Manifest MV3, recursos/caminhos e ícones existentes | Aprovado |
| node --check em JS/MJS/CJS | Aprovado |
| Scanner de endpoints do fornecedor e update_url | Aprovado |
| Regras, backup, migração, scope de conta, WID, transferência local, lock, API/PTT e deduplicação | 10 testes aprovados |
| Bridge com dependências instaladas via lockfile | Inicialização, health, sessões vazias, Origin/header e envio offline aprovados |
| Browser Chromium — fixture simulada | Painel, assinatura Enter/click, compositor vazio, funil, diagnóstico, IndexedDB, sequência texto/PIX/PTT e reload aprovados |
| Layout responsivo | Largura reservada no gerenciador e dock inferior em viewport de 760px aprovados |
| Editor composto | Duplicação, reordenação e remoção de ações verificadas no browser |
| Proteção de mídia referenciada | Verificada no browser |
| ESLint no-undef | Aprovado |
| TypeScript | Não aplicável: projeto em JavaScript |
| Extensão unpacked em browser do usuário | Pendente |

O browser disponível para a validação é uma distribuição headless de Chromium que não iniciou o service worker de uma extensão unpacked. Por isso o teste de interface carregou os scripts via fixture e executou o background em Worker com APIs chrome simuladas. IndexedDB, eventos DOM, clipboard e reload são reais; APIs WhatsApp e chrome.storage são controladas pelo harness. Isso **não equivale** a teste de extensão unpacked nem entrega de mensagem em produção.

Nenhuma conta WhatsApp real foi conectada; os testes não contataram clientes. O teste PTT confirma o parâmetro isPtt e o percurso de código, não waveform/duração/aceitação nos servidores do WhatsApp.

## Primeiro teste real — fazer em conjunto, após carregar o pacote

1. Manter backup e desativar a antiga. Carregar sem compactação e recarregar WhatsApp Web.
2. Abrir uma conversa de teste: compositor vazio; selecionar atendente: continua vazio. Digitar texto/emoji/linhas; enviar por Enter e pelo botão. Conferir uma só mensagem e prefixo correto. Conferir Shift+Enter, citação e opção de envio por Enter.
3. Cadastrar texto, PIX, áudio MP3/OGG, imagem, vídeo e PDF. Confirmar recebimento em outra conta. Áudio deve chegar como nota de voz, com duração e sem clique adicional.
4. Usar sequência composta; conferir ordem e ausência de duplicação. Trocar de conversa durante sequência para confirmar interrupção e conferir falha sem reenvio.
5. Verificar menus nativos Responder/Copiar/Reagir/Encaminhar/Fixar/Favoritar/Editar/Apagar, largura em diferentes resoluções e modo de zoom.
6. Aplicar etiquetas, mudar etapa, trocar atendente e recarregar. Conferir histórico e contatos com nomes iguais quando API disponível.
7. Conectar dois números por QR na ponte. Verificar ambos visíveis, renomeação, reconexão após reinício, logout e transferência. Conferir aviso nas duas contas e preservação de etiquetas/responsável.
8. Exportar e importar backup com mídia em perfil separado; conferir conteúdo. Não substituir a instalação de trabalho antes de concluir esse teste.
9. Em falha, copiar Diagnóstico em Configurações. Não enviar credenciais de sessão.

## Limitações conhecidas

- WA-JS 3.18.8 pode não acompanhar todas as mudanças atuais do WhatsApp; erro de API pronta não dispara fallback para evitar duplicatas.
- Alternativa nativa de voz prepara em tempo real; envio e reconexão reais permanecem pendentes.
- Etiquetas são do APOIS; não sincronizam automaticamente com WhatsApp Business.
- PIX é texto estruturado, não cartão interativo.
- Identificação por nome em modo sem API pode misturar homônimos; WID é usado quando disponível.
- A Central mostra conversas recentes; não implementa uma tela completa de chat para cada sessão.
- Backup base64 pode consumir muita memória com mídias grandes.
- Heap/memory leaks não foram medidos em sessão prolongada. Duplicação de listener é coberta por guards e reload de fixture, sem garantia absoluta em produção.
- Não há paridade com todos os módulos comerciais de WHABOOST.

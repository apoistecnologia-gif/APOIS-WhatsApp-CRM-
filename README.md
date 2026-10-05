# APOIS WhatsApp CRM

Extensão independente para Chrome/Chromium que adiciona uma camada local de CRM ao WhatsApp Web. Não depende de licença ou servidor de terceiros para funcionar.

## Versão 0.9.0 — pré-teste robusta

### Dentro do WhatsApp Web
- Barra de funil com contadores e etapas personalizáveis
- Painel lateral por conversa
- Cadastro automático local do contato ao abrir a conversa
- Etapa, prioridade, origem, telefone opcional e valor potencial
- Etiquetas e notas internas
- Respostas rápidas com busca, categorias, favoritas e contador de uso
- Variáveis `{{nome}}`, `{{primeiro_nome}}`, `{{telefone}}`, `{{valor}}`
- Atalhos de respostas rápidas digitando `/` no compositor
- Follow-ups com alarmes e notificações
- Agenda de mensagens com aviso no horário e inserção manual na conversa
- Kanban pesquisável dentro do painel
- Atalho `Alt+A` para abrir/fechar o painel
- Regras locais de automação por palavra/frase, com cooldown e atraso

### Central de gerenciamento
- Dashboard com métricas
- Editor de funil (nome, cor e ordem)
- Kanban geral
- Tabela de contatos com busca e exportação CSV
- CRUD de respostas rápidas
- Gestão de follow-ups
- Gestão de automações locais
- Campanhas para segmentação e preparação de mensagens
- Backup/restauração JSON
- Preferências de interface e notificações

## Segurança operacional
- O envio de mensagens agendadas permanece manual por padrão.
- Campanhas não fazem disparo em massa automático nesta versão.
- Automações começam desativadas quando criadas e têm cooldown configurável.

## Instalação para teste
1. Baixe ou clone o repositório.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta do projeto.
6. Abra ou recarregue `https://web.whatsapp.com`.

## Observação
O WhatsApp Web altera o DOM periodicamente. O APOIS CRM usa seletores defensivos, mas futuras mudanças do WhatsApp podem exigir manutenção.

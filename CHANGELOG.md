# Changelog

## 3.2.4 — 08/10/2026 — validação real pendente, sem ZIP de lançamento

- Assinatura manual segue o fluxo original: leitura do rascunho, nome antes do texto, WPP.chat.sendTextMessage e limpeza pelo WPP.chat.setInputText.
- Corrige inicialização que aceitava isFullReady=false e encerrava a espera; hidrata conversa depois da prontidão e retenta inicialização indisponível.
- Preserva quote conforme React Fiber da referência, deduplica RPC e protege novo rascunho.
- 13 testes de regras/adaptador e teste Chromium com prontidão atrasada aprovados. Ainda não houve teste em sessão real do WhatsApp com esta extensão.

## 3.2.3 — 07/10/2026 — inserção no editor nativo

- Aguarda seleção do editor antes da inserção, usa paste com texto simples e fallback apenas se nenhum handler tratar o evento.
- Diagnóstico inclui pasteHandled, tipo do editor, tamanhos e matched, sem conteúdo da mensagem.
- Assinatura sem espaço desnecessário antes da quebra de linha.
- Teste de navegador simula seleção e modelo internos com atualização atrasada. WhatsApp real ainda requer confirmação.

## 3.2.2 — 07/10/2026 — correção da assinatura manual

- Intercepta Enter/clique antes do envio e aguarda atualização do editor antes de acionar o botão nativo.
- Verifica texto completo e conversa antes do envio; falhas mantêm o rascunho e mostram erro.
- Reconhece ícone atual wds-ic-send-filled.
- Teste de navegador usa modelo interno com commit atrasado; verifica assinatura em Enter/clique e mensagem multilinha.
- Compatibilidade com WhatsApp real ainda requer confirmação.

## 3.2.0 — 07/10/2026 — candidata a teste real

- Inventário da referência e documentação dos fluxos reais, backend e licenciamento excluídos.
- Substituição do adaptador do fornecedor por WA-JS oficial e dispatcher APOIS limitado.
- Assinatura no evento de envio; mantém compositor vazio ao abrir/selecionar atendente; preserva emoji e linhas.
- PTT direto com isPtt quando API pronta; alternativa nativa, com erro visível e sem fallback após envio incerto.
- Trava de respostas compostas, verificação de conversa e deduplicação de requests do adaptador.
- Duplicação de ações no editor; preservação de mídias compartilhadas.
- Storage serializado no service worker, schema 13 e proteção contra downgrade.
- Restauração validada sem limpar storage; mídias restauradas por transação e novos IDs.
- Etapas persistentes, contadores sem sobreposição e quadro de movimentação de contatos.
- WID por conta quando disponível, com migração de contato legado por nome.
- Diagnóstico copiável e disponibilidade explícita da sessão Web.
- Ponte com dependências travadas, nomes persistentes, lifecycle de reconexão corrigido e pedidos idempotentes por sessão.
- Fontes legíveis, lint, testes de regras, browser simulado e inicialização da ponte.

Validações e limitações estão em TESTING.md; esta versão ainda exige teste real de envio/QR em WhatsApp conectado.

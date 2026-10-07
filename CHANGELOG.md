# Changelog

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

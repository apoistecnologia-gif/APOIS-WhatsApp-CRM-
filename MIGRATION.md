# Migração e backup

## Base 3.1.1 → 3.2.0

Schema 12 → 13 adiciona etapas persistentes e mantém respostas compostas, mídia, etiquetas, atendentes, contas, atribuições e histórico. A normalização é idempotente, preserva listas de etiquetas vazias e rejeita schema futuro, evitando downgrade. Chaves desconhecidas não são incorporadas a um backup restaurado.

Contatos antigos sem escopo recebem `acc_principal`. Quando um WID estiver disponível, o registro por nome pode ser migrado para `conta::WID`, preservando etiquetas e responsável. Homônimos antigos podem exigir revisão; novos contatos com IDs distintos permanecem separados.

Um novo ID de extensão não recebe o armazenamento de outra instalação. Exporte o backup na versão antiga e importe pelo APOIS. Não desinstale a versão anterior antes de guardar o backup. Se mantiver perfil e caminho, os dados da própria extensão podem permanecer disponíveis.

## Referência WHABOOST

O pacote contém código, não um backup das respostas cadastradas do usuário. Chrome não permite ler chrome.storage de outra extensão a partir do APOIS. Não há importador universal seguro implementado para os formatos proprietários encontrados. Uma exportação real, sem licença/tokens, precisa ser analisada antes de criar esse conversor. Não transferir tokens do fornecedor, configurações de cobrança ou credenciais de backend.

## Repositório 0.9.0

A árvore main examinada está incompleta como extensão executável; há um ZIP anterior codificado em `.release`. A branch 3.2.0 disponibiliza arquivos executáveis concretos. Follow-ups, agenda, campanhas e automações da base 0.9 não foram incorporados ao pacote 3.2.0. O histórico remoto preserva aquela versão; seus dados/recursos não devem ser tratados como equivalentes à base 3.1.1 fornecida.

## Restauração

O JSON `APOIS_QUICK_REPLIES_BACKUP` deve conter data.quickReplies e todas as mídias referenciadas. O sistema valida referências, IDs duplicados e Data URLs antes de pedir confirmação. A gravação das mídias ocorre em uma transação com novos IDs; só depois os dados normalizados são aplicados. Não chama chrome.storage.local.clear.

O backup não exporta credenciais Baileys. Essas sessões ficam na pasta `APOIS-WhatsApp-Central/sessions`, fora da extensão. Windows: sob LOCALAPPDATA; Linux/macOS: configure APOIS_DATA_DIR se desejar outro caminho. Guarde essas credenciais como dados privados. Não as envie ao GitHub nem em relatórios de diagnóstico.

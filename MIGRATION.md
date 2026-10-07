# Migração

A antiga extensão e seus arquivos permanecem intactos. A nova extensão não consegue ler automaticamente chrome.storage.local/IndexedDB de outro ID. Exporte um backup e importe em Central > Configurações.

## Formatos aceitos
1. APOIS-CRM formato 1: configuração, blobs base64, conversas e histórico whitelist, validados antes de restaurar.
2. APOIS_QUICK_REPLIES_BACKUP versão 2 da APOIS 3.1.1: respostas/blocks, texto, PIX, mídias dataUrl, categorias, etiquetas, atendentes e nomes das contas.
3. Snapshot JSON legível da original: respostasRapidas + respostasRapidasAcao + categoria. Script expande ações suportadas. Notas sobre ações/timers não suportados são exibidas; nenhum módulo do fornecedor é importado.

Os backups comerciais cifram metadados com encryptData; não importamos esses metadados cifrados nem incorporamos chave do fornecedor. Não tente converter strings cifradas por adivinhação: exporte uma estrutura legível. Contatos da APOIS anterior são identificados por nome; não são vinculados automaticamente a números, evitando fundir homônimos/contas.

Whitelist exclui licença, token, user login/senha, cobrança, webhook, credenciais do fornecedor e telemetria. Contas são descritores, não sessões autenticadas. A chave do bridge e as credenciais Baileys não são exportadas. Números do bridge precisam ser conectados no computador destino.

A importação mostra confirmação, substitui os dados em transação e preserva tudo em caso de falha. Não remove a extensão antiga. Exporte o acervo atual primeiro. Respostas sem PIX completo/mídia/ação suportada são informadas como rejeitadas; não se informa sucesso integral silenciosamente.

Schema migrations: banco IndexedDB v2 cria stores faltantes em onupgradeneeded e fecha conexão em versionchange. config.schema 1 migra defaults/campos conhecidos, rejeita futuro. Atualize preservando pasta/ID ou restaure backup explícito se mudar ID. Não desinstale antes de exportar.

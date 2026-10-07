# WA-JS

Origem: pacote npm oficial `@wppconnect/wa-js@3.18.8`. Licença Apache-2.0; textos completos neste diretório.

Única alteração na biblioteca oficial: substituir o array padrão de três servidores de prévia de links por `[]`. A configuração `src/wa-config.js` também define `linkPreviewApiServers: []` e desativa Analytics **antes** do carregamento. A camada de funções do fornecedor encontrada no RAR e no ZIP APOIS 3.1.1 não foi reaproveitada.

Os arquivos APOIS não são minificados. O arquivo WA-JS é a distribuição minificada do projeto externo. Para atualizar, revisar APIs e compatibilidade, aplicar a remoção de endpoints, manter as licenças e executar testes do adaptador e teste real de mídia.

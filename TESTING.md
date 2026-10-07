# Validação — 7 de outubro de 2026

## Executado e aprovado
- `npm run verify`: contratos TypeScript estritos, ESLint, 23 testes, build, manifest/caminhos/imports/sintaxe.
- 23 testes Node: configuração, whitelist, rejeição de versão futura, schema IndexedDB, blob/base64, rollback, persistência em nova conexão, 30 alterações concorrentes sem perda, revisão stale, isolamento de conta, migração APOIS/JSON original, PIX, sequência aguardada, interrupção sem retry, descoberta de sessões, token/origem/traversal/JID, API bridge 200/401/403, chave preservada em reinício e FFmpeg produzindo OGG/Opus verdadeiro.
- `node scripts/browser-smoke.mjs`: 17 verificações reais de DOM/IndexedDB num Chromium headless shell, com Chrome runtime e APIs WhatsApp/bridge simuladas. Exercita os módulos reais background/database/UI/MAIN e permite provar o comportamento do código sem enviar mensagens pessoais.
- Interface: criação de texto+PIX, ordenação, reload, etiquetas, diagnóstico, campo vazio ao abrir/selecionar atendente, Enter com assinatura somente no envio, sequência sem duplicata, cadastro/recuperação de áudio e opções PTT, reserva de largura, abrir/fechar, viewport 950 px, mover no kanban, contas descobertas sem registro, QR exibido, histórico da conta selecionada, envio composto bridge, transferência com duas mensagens e cleanup em reinjeção.
- Capturas da Central e painel inspecionadas visualmente. Vermelho/branco/grafite, letras legíveis, layout sem sobreposição no fixture.
- Vendor verificado byte a byte com @wppconnect/wa-js 4.6.1 instalado de npm. Nenhum wrapper proprietário na release. Scanner verifica ausência dos domínios comerciais conhecidos no código próprio.

## Bloqueio do ambiente e limites do teste
O script `browser-unpacked.mjs` tentou carregar a extensão MV3 em Chromium completo, mas o processo encerrou com `socket() failed: Operation not permitted` em process_singleton_posix (AF_UNIX). Não houve aprovação solicitada nem contorno de permissões; foi usado headless shell para testar módulos/UI. Portanto não alegamos carregamento unpacked validado.

A API WhatsApp foi simulada. O áudio do teste de UI é um fixture de transporte, não uma gravação validada por WhatsApp. Outro teste independente efetivamente converteu tom sintético para OGG/Opus com o FFmpeg. ACK, waveform/duração e entrega nos celulares não foram validados em WhatsApp real.

Nenhum celular/conta real foi conectado; QR do teste de UI é uma imagem fixture. Nenhuma mensagem real foi enviada. Reconexão autenticada Baileys, isolamento de várias sessões online e histórico sincronizado precisam de testes reais. Não houve teste prolongado de heap/memory leaks; cleanup/listeners foram exercitados por reinjeção, o que não equivale a prova de ausência de vazamento em uso contínuo.

## Homologação real pendente (uma rodada completa)
1. Carregar sem compactação em Chrome e Edge, abrir o WhatsApp, verificar o diagnóstico MAIN/content/IndexedDB.
2. Abrir conversa, selecionar atendente, digitar, Enter/clique, Shift+Enter, responder mensagem citada e editar mensagem existente. Conferir que rascunho nunca recebe nome antecipadamente.
3. Criar resposta com texto → áudio → imagem → vídeo → documento → PIX. Clique único, conferir ordem e entrega.
4. Ouvir nota de voz em dois celulares, duração e waveform; repetir com áudio MP3/M4A/WAV e codec suportado; assegurar que não chegou como arquivo.
5. Mudar chat durante sequência; confirmar interrupção do restante e job parcial. Offline/timeout: conferir antes de repetir.
6. Funil/etiquetas/atribuição, reload, abrir/fechar, largura pequena, menus nativos Responder/Copiar/Reagir/Encaminhar/Fixar/Favoritar/Editar/Apagar.
7. Executar instalador no Windows real, conectar 2–3 números, comparar telefones e sessões, gerar QR na Central, derrubar rede/reabrir computador e reconectar.
8. Transferir atendente; depois número Web→bridge e bridge→bridge. Conferir duas mensagens, etiqueta, etapa e histórico. Testar destino offline e falha após primeira mensagem.
9. Exportar backup com mídias, importar numa instalação de teste, verificar restauração e rejeição de backup incompleto.

## Reproduzir
```bash
npm ci --ignore-scripts
npm ci --prefix bridge --ignore-scripts
npm run verify
npx playwright install chromium
node scripts/browser-smoke.mjs
# Em ambiente que permita Chromium completo:
node scripts/browser-unpacked.mjs
```
`APOIS_CHROME_SHELL` permite apontar para o executável headless shell local. Relatório JSON e screenshots são gerados em test-results (fora do código versionado); cópia do resultado da rodada está em docs/VALIDATION_REPORT.json.

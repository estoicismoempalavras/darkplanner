# 90 — CONFERÊNCIA E ENTREGA

**Quando ler:** você terminou de escrever na timeline e vai dizer "pronto" — ou vai exportar.

## Conferir por NÚMERO (antes dos olhos)

1. `studio_estado {projeto, nivel: "resumo"}` — contagens (cena, legenda, composto, audio), `midia_faltando` (tem que estar vazio), `narracao.vinculada`, `predefinicao`.
2. `studio_estado {projeto, nivel: "destaques"}` — cada destaque com `blocoId`; `antecipacaoS` ≤ 0,6 s; `origem` coerente com o que você fez (ia/sorteio); nenhum destaque sem bloco (órfão) a não ser manual do usuário.
3. `studio_estado {projeto, nivel: "clipes", filtro: {kind: "cena"}}` — o que a tarefa prometeu: N com `efeito`, N com `transicaoOut`, N com `efeitosExtras`; a última cena sem transição; vizinhos sem repetição.
4. Compare com o pedido/predefinição: percentuais explicitamente pedidos são por CONTAGEM; universo estrito deve ser respeitado. Na edição criativa, confira a função de cada escolha e o ritmo final; não force uma quantidade ou conjunto único apenas para atingir uma heurística.
5. Recusas pendentes: releia o último `descartes`/`rejeitadas`/`problemas` — zero, ou explicado ao usuário.

## Conferir com os OLHOS

- `studio_capturar {projeto, atS}` em três tempos: o começo (abertura), o meio de um destaque (âncora: o texto tem que estar assentado quando a palavra é dita — capture 0,3 s depois do `ancoraS`) e dentro de um template.
- Still confere composição, texto e enquadramento; não comprova sincronia sonora nem fluidez. Para cortes com som, confira a reprodução e o trecho exportado com áudio. Informe separadamente qualquer caminho que não foi reproduzido.
- Editor fechado: o quadro é o still do motor; com aviso "aproximado" em trecho de template, abra com `studio_abrir` só se precisar ver o template — e feche (`studio_fechar`) depois, para o bastidor voltar a valer.
- Clipe vermelho / `midia_faltando`: avise — aquele trecho sai preto; o usuário repõe o arquivo no caminho de origem, ou confirma `continuar_sem_midias`.

## Entregar

1. `studio_exportar {projeto, nome: "<slug>", resolucao, qualidade}` — nome do arquivo sem extensão; em canal, o slug do vídeo. Resposta traz `destino` e `avisos` (repasse).
2. `studio_fila {esperar_s: 25}` repetidamente NO MESMO TURNO até o item sair de "renderizando" — com `informar_progresso` a cada volta ("exportando 40%…"). Nunca encerre prometendo conferir depois.
3. "concluido" → em canal, `registrar_no_canal` com o passo "montagem" e o caminho; fora de canal, diga o caminho.
4. Falhou → o item traz `erro`: diga qual, e o que fazer (mídia faltando, disco cheio, fonte inexistente).

## Registro para retomada

- `studio_snapshot {projeto, rotulo: "entregue — <data/versão>"}` depois do export: é o ponto de retorno de "muda só a abertura".
- Uma linha na memória da conversa: projeto (nome + id), predefinição, o que foi feito, o caminho.

## Saída (o que o usuário lê)

Uma linha com números + caminho: "Pirâmides (sp_a1): 32 cenas, 24 fades, 10 overlays, 9 destaques (7 da IA), 2 templates — exportado em …\renderizados\piramides.mp4". Depois, só o que ficou de fora e por quê.

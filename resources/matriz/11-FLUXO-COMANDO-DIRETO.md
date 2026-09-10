# 11 — FLUXO: COMANDO DIRETO ("faça só isto")

**Quando ler:** o usuário pediu UMA coisa num projeto existente: "movimento em todas as cenas", "overlays em 30% das cenas", "troque as transições por fades", "tire os destaques", "mais calma", "entradas suaves". Não é edição completa; não reaplique a direção.

**Entradas:** o projeto (id), o que ele pediu — traduzido em (ALVO, EIXO, CONJUNTO/ID, QUANTIDADE).

## Passos

1. `matriz {tema: "indice"}` se ainda não leu. `studio_projetos` → id. `studio_snapshot {projeto, rotulo: "antes de <pedido>"}`.
2. Traduza o pedido:
   - **Alvo**: todas as cenas · N% das cenas (por CONTAGEM) · só imagens / só vídeos · um trecho (deS–ateS) · cenas sob template (normalmente EXCLUÍDAS).
   - **Eixo**: movimento (`efeito`), overlays (`efeitosExtras`), transições (`transicaoOut`), entradas/saídas (`animIn`/`animOut`), filtro (`filtro`), destaques (`studio_destaques`), legenda/tipografia (`studio_configurar`).
   - **Conjunto ou id**: se ele disse um conjunto ("fades", "suave", "dinâmico"), pegue os ids em `matriz {tema: "conjuntos", id: "<eixo>"}`; se disse um id, confira em `studio_catalogo`.
   - **Quantidade**: "todas" = 100%; "algumas" = pergunte OU use 30% avisando; "N%" = arredonde por contagem (30% de 32 = 10).
3. `studio_estado {projeto, nivel: "clipes", filtro: {kind: "cena"}}` — a lista de ids na ordem da régua, com `kind` (imagem × vídeo) e `startS`. Cenas cobertas por composto: `filtro: {kind: "composto"}` e exclua as cenas dentro deles.
4. Leia a skill do eixo (`matriz {tema: "movimento" | "overlays" | "transicoes" | "animacoes"}`) — ela diz a regra de distribuição (rotação sem repetir vizinho, respiro, pares harmônicos, física imagem × vídeo).
5. **Primeiro a op em massa**: `studio_editar {projeto, operacoes: [{op: "aplicar_por_cena", eixo, conjunto | itens, pct, alvo: {kind, deS, ateS, ids, excluirTemplates}, seed}]}` — o editor distribui (rotação sem repetir vizinho, overlays espaçados por contagem, transições por junção, pares harmônicos, só imagem para movimento, fora de template) e `aplicadas[].nota` conta o que entrou e o que ficou de fora. `eixo: "filtro"` leva `id`; `eixo: "limpar"` leva `de`. Só quando o pedido não cabe nela (uma cena específica, valor por cena), monte o lote à mão: uma operação `ajustar` por cena (ou por grupo de cenas com o MESMO valor, via `ids: [...]`), máximo 40 operações por chamada: `{"op":"ajustar","kind":"cena","ids":["sc1","sc4"],"campos":{"efeito":"zoom_respiro"}}`. Para "todas as cenas" com o MESMO valor, `"todos": true` no lugar de `ids` — mas só quando a skill do eixo não manda variar (rotação) nem excluir (vídeo, template). Para overlays o campo é `efeitosExtras: ["ov_neblina"]` (lista, teto 2). Para transições, `transicaoOut` na cena de ORIGEM da junção (nunca na última). Para animações, `animIn`/`animOut` e, se preciso, `animDurS`.
6. `studio_editar {projeto, operacoes}` por lote. Leia `aplicadas` e `rejeitadas` de cada um. Rejeição de física (efeito de movimento em vídeo) não é erro seu se a skill mandou excluir vídeos — se aconteceu, você não filtrou.
7. `studio_capturar` em uma cena alterada (e numa não alterada, se a quantidade era parcial) e `studio_estado nivel "clipes"` para contar quantas ficaram com o valor.

## Critérios de aceite

- Contagem final = alvo pedido (± 1 por arredondamento, dito ao usuário).
- Nenhuma cena sob template alterada, salvo pedido explícito. Antes de excluir esse alvo, confira se o template declara herança para o eixo; se declarar, aplique somente a propriedade compatível e registre a exceção. Sem herança declarada, preserve o composto.
- Nenhum vizinho com o mesmo efeito de movimento (rotação) e nenhuma cena com mais de 2 overlays.
- `rejeitadas` vazio ou explicado.

## Exemplos resolvidos

- "movimento em todas as cenas": alvo = todas as IMAGENS (vídeo não aceita movimento), eixo `efeito`, conjunto `classico` de [conjuntos/movimento.json](conjuntos/movimento.json), rotação zoom_in → pan_esq → zoom_out → pan_dir… sem repetir vizinho; cenas sob template ficam de fora.
- "overlays em algumas, tipo 30%": alvo = 30% por contagem, não consecutivas, começando pela 2ª cena; eixo `efeitosExtras`; conjunto pelo clima do vídeo (`escuro` para dark/faceless) de [conjuntos/overlays.json](conjuntos/overlays.json); 1 overlay por cena.
- "troque as transições por fades": alvo = todas as junções (todas as cenas menos a última), eixo `transicaoOut`, conjunto `fades_cinema`; virada de assunto (pelo roteiro) recebe `fade`.
- "tire os destaques": `studio_destaques {projeto, acao: "limpar", confirmacao: true}` — SÓ depois de o usuário confirmar na conversa.
- "deixe mais calmo": não é um eixo — é predefinição. `matriz {tema: "predefinicoes"}`, monte/escolha uma calma e aplique com `studio_aplicar_direcao` (é uma reaplicação: avise que o sorteio de destaques muda).

## Saída

Uma linha: o que mudou, em quantas cenas, o que ficou de fora e por quê, e "confira: <captura>".

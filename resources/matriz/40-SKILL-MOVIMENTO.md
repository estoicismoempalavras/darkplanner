# 40 — SKILL: MOVIMENTO (Ken Burns e parentes)

**Quando ler:** "movimento em todas as cenas", "zoom lento", "as imagens estão paradas", ou a predefinição pede efeitos de movimento.

**Entradas:** projeto (id); `studio_estado nivel "clipes"` kind `cena` (ids, `kind` imagem/vídeo, `startS`, `durationS`, `efeito` atual); compostos (para excluir as cenas sob template); [conjuntos/movimento.json](conjuntos/movimento.json).

## Regras

As combinações e frequências abaixo orientam uma distribuição uniforme. Na edição criativa, escolha movimento, direção e intensidade para cada ação ou trecho; repetição intencional pode manter continuidade. Preserve limites aceitos pelo editor e escolhas manuais existentes.

- **Só imagem.** Movimento em vídeo é descartado pelo editor (`vale_para` do catálogo). Vídeo fica como está — diga isso ao usuário se ele pediu "todas".
- **Conjunto pela intensidade**: `respiro` (calmo, quase imóvel: `zoom_respiro`, `zoom_in`, `zoom_out`, pans lentos), `classico` (zoom + pan, o padrão), `dinamico` (`zoom_giro`, `zoom_rapido` — raro, nunca em duas cenas seguidas).
- **Rotação sem repetir o vizinho**: alterne dentro do conjunto (zoom_in → pan_esq → zoom_out → pan_dir → zoom_pan_cima…). Duas cenas seguidas com o mesmo efeito é o erro mais visível.
- **Direção contínua** numa sequência de lugar/mapa (pans no mesmo sentido); inverta só na virada de assunto.
- **Normalmente preserve cena sob template**, pois o composto costuma ter movimento próprio. Antes de excluir, confira no catálogo/contrato se o template declara herança de movimento; se não declarar, mantenha a exclusão. Cena com `efeito` escolhido pelo usuário (`origem` manual) só muda com pedido explícito.
- Força: cena curta (< 3 s) só `respiro`; cena longa aceita `classico`.

## Passos

1. Liste as cenas; filtre `kind: "image"`; exclua as cobertas por composto.
2. Escolha o conjunto (predefinição/pedido). Monte a rotação.
**Atalho para distribuição uniforme:** `studio_editar {projeto, operacoes: [{op: "aplicar_por_cena", eixo: "movimento", conjunto: "classico", alvo: {…}}]}` aplica a distribuição da skill e conta em `nota`. Para escolhas pelo roteiro, envie ajustes explícitos nos ids das cenas escolhidas; o atalho não substitui essa análise.
3. Lotes de `studio_editar {projeto, operacoes}` com `{"op":"ajustar","kind":"cena","ids":["sc1"],"campos":{"efeito":"zoom_respiro"}}` — agrupe ids com o mesmo efeito na mesma operação; ≤ 40 operações por chamada.
4. `studio_capturar` numa cena com movimento (o quadro mostra a posição, não o movimento — confira duas capturas na mesma cena, 1 s apart, se quiser ver o deslocamento).
5. `studio_estado nivel "clipes"` → conte quantas imagens ficaram com efeito.

## Critérios de aceite

- 100% das imagens fora de template com efeito (ou a % pedida); vizinhos diferentes; vídeos intactos.
- `rejeitadas` = 0 (movimento em vídeo rejeitado = você não filtrou).

## Saída

"movimento em N de N imagens (conjunto clássico, rotação de 4); N vídeos sem movimento; N cenas sob template intactas".

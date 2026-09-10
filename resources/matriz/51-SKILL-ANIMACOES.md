# 51 — SKILL: ENTRADAS E SAÍDAS (animações de cena)

**Quando ler:** "entradas suaves", "anime as cenas", "menos agitado", ou a predefinição pede entradas/saídas.

**Entradas:** projeto (id); cenas (`studio_estado nivel "clipes"`, kind `cena`, com `animIn`/`animOut`/`transicaoOut` atuais); [conjuntos/animacoes.json](conjuntos/animacoes.json) (famílias e PARES harmônicos).

## Regras

Pares e alternância são referências de continuidade, não uma sequência obrigatória. Na edição criativa, escolha entrada e saída conforme a ação, posição e ritmo de cada cena. Mantenha a regra técnica de prioridade da transição e confira o movimento combinado no player.

- **Pares harmônicos**: a saída da cena N combina com a entrada da N+1 (`pares` do conjunto: `saida` → `entrada`). Ex.: `zoom_out` → `zoom_in`; `slide_left` → `slide_left` (continuidade de direção); `fade` → `fade`.
- **Nunca em junção que já tem transição** (`transicaoOut` na cena N): é transição OU animação — os dois juntos brigam. Se a direção pôs transições, anime só as junções em corte. O motor também impõe isso no desenho (preview e export): com transição na junção, a saída da cena N e a entrada da N+1 não animam; exceção são os combos `cb_*`, cuja animação coordenada é o próprio desenho.
- **Alternância por take**: par A nas junções ímpares, par B nas pares, dentro do MESMO conjunto — variedade sem bagunça.
- **Continuidade de direção** numa sequência (todas `slide_left`, não esquerda/direita alternado); inverta na virada de assunto.
- **Duração ≤ 35% da cena**: `animDurS` (0,1–3 s) — o padrão do conjunto (`durAlvoS`) serve; em cena curta, reduza. Cena < 1,5 s: sem animação.
- Intensidade: `suave` (respiro, documentário) · `deslize` / `zoom` (médio) · `impacto` / `agito` (forte, só por pedido e nunca duas seguidas).
- Não anime a 1ª entrada nem a última saída se houver template de abertura/fecho.

## Passos

1. Liste as cenas; marque as junções SEM transição.
2. Escolha o conjunto e 2 pares dele.
3. Para cada junção elegível: cena N recebe `animOut: par.saida`, cena N+1 recebe `animIn: par.entrada`; `animDurS` ≤ 35% da menor das duas.
**Atalho para distribuição uniforme:** `studio_editar {projeto, operacoes: [{op: "aplicar_por_cena", eixo: "animacoes", conjunto: "suave", modo: "pares", alvo: {…}}]}` aplica os pares e conta em `nota`. Para coreografia por trecho, ajuste as cenas explicitamente; variar a entrada não exige variar a saída, e uma cena pode ficar sem animação.
4. `studio_editar` com `{"op":"ajustar","kind":"cena","ids":["sc2"],"campos":{"animOut":"zoom_out","animDurS":0.45}}` e `{"op":"ajustar","kind":"cena","ids":["sc3"],"campos":{"animIn":"zoom_in","animDurS":0.45}}`; para tirar, `null`.
5. `studio_capturar` 0,2 s depois do início de uma cena animada.

## Critérios de aceite

- Nenhuma junção com transição E animação; pares do mesmo conjunto; direção contínua; `animDurS` ≤ 35% da cena.

## Saída

"entradas/saídas: conjunto suave (fade↔fade, blur_in↔focus) em 18 junções em corte; 24 junções com transição ficaram sem animação".

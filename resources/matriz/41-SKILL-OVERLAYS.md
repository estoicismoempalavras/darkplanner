# 41 — SKILL: OVERLAYS (véus, luz, textura)

**Quando ler:** "overlays em algumas cenas", "30% com névoa", "dê um clima", ou a predefinição pede atmosfera.

**Entradas:** projeto (id); cenas (`studio_estado nivel "clipes"`, kind `cena`, com `efeitosExtras` atuais); [conjuntos/overlays.json](conjuntos/overlays.json); o clima do vídeo (escuro/dark, luz, vintage) — pelo tema do roteiro ou pelo pedido.

## Regras

Distribuição e conjuntos são referências de ritmo. Na edição criativa, escolha cada overlay pelo clima e pelo conteúdo do plano; é válido deixar trechos sem overlay. Respeite o teto aceito pelo editor, o contraste do texto e os ajustes existentes do usuário.

- Overlay vai em `efeitosExtras` (lista), **teto 2 por cena** — e 1 é o normal.
- **Porcentagem por CONTAGEM de cenas**: 30% de 32 cenas = 10 cenas. Arredonde e diga o número.
- **Distribuição com respiro**: nunca em cenas consecutivas; espalhe pelo vídeo (a cada ~3 cenas), preferindo cenas longas e contemplativas; evite a 1ª cena (a abertura já tem pompa). Sob template, confira primeiro se há herança de overlay no contrato; sem herança declarada, preserve o composto.
- **Escolha pelo clima**, um conjunto por vídeo: `escuro` (`ov_neblina`, `ov_poeira`, `ov_vinheta_pulso`, `ov_fumaca_rasteira`, `ov_particulas_lentas`) · `luz` (`ov_leak`, `ov_facho_suave`, `ov_veu_dourado`, `ov_bokeh_suave`) · `vintage` (`ov_sujeira`, `ov_scanlines`). `ov_flash_borda` e `fv_galaxy` são fortes: no máximo 1 no vídeo, num clímax.
- Nunca junto de destaque de intensidade alta na mesma cena (compete pela atenção). Nunca em cena que já tem overlay do usuário.
- Overlay não substitui o movimento: os dois convivem (`efeito` + `efeitosExtras`).

## Passos

1. Liste as cenas na ordem; calcule N = arredonda(% × total). Exclua template, 1ª cena e cenas com overlay manual.
2. Escolha as N cenas com respiro (passo ≈ total/N, começando pela 2ª), priorizando longas.
3. Alterne 2–3 ids do conjunto entre elas (não o mesmo em todas).
**Atalho para distribuição uniforme:** `studio_editar {projeto, operacoes: [{op: "aplicar_por_cena", eixo: "overlays", conjunto: "escuro", pct: 30, alvo: {…}}]}` aplica a distribuição da skill e conta em `nota`. Para escolhas pelo roteiro, ajuste explicitamente as cenas escolhidas e use a porcentagem como meta apenas se ela foi pedida.
4. `studio_editar {projeto, operacoes}` com `{"op":"ajustar","kind":"cena","ids":["sc4"],"campos":{"efeitosExtras":["ov_neblina"]}}` — uma operação por cena ou por grupo com o mesmo overlay; para tirar, `"efeitosExtras": null`.
5. `studio_capturar` numa cena com overlay e numa sem.

## Critérios de aceite

- Exatamente N cenas com overlay (± 1, dito); nenhuma consecutiva; ≤ 2 por cena; conjunto único.

## Saída

"overlays em 10 de 32 cenas (30%, conjunto escuro: névoa/poeira/vinheta), nenhuma consecutiva" + captura.

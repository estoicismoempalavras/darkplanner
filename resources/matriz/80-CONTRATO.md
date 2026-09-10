# 80 — CONTRATO (gerado do índice da biblioteca editorial — não edite à mão)

Recortes do `biblioteca-indice.json` que a IA precisa saber ANTES de propor destaques. O índice inteiro (uma linha por estilo) vem por `consultar_biblioteca {indice: true}`; o contrato completo de um estilo por `consultar_biblioteca {id}`. Este arquivo NÃO substitui o índice: ele dá as regras e o vocabulário; o índice dá os ids.

Schema 4 · idioma do contrato: en · estilos: 207 (190 automáticos) · templates: 167 (151 automáticos)

## Categorias de destaque

- `abertura` — Openings & Chapters (Abertura & Capítulos)
- `identificacao` — People, Places & Dates (Pessoas, Lugares & Datas)
- `dados_provas` — Data & Evidence (Dados & Provas)
- `enfase` — Speech Emphasis (Ênfase da Fala)
- `composicao` — Take Composition (Composição de Takes)
- `atmosfera` — Atmosphere & Support (Atmosfera & Apoio)
- `transicao` — Subject Transitions (Transições de Assunto)

## Papéis (o que o destaque faz na narrativa)

- `abertura` — Opening pomp: the first impact of the video, never in the body.
- `secao` — Change of subject or chapter — structure, not ornament.
- `destaque` — The most important sentence of the region: revelation, turn, thesis.
- `enfase` — Highlight inside the speech: one strong word or passage.
- `info` — Factual data: date, number, value, name, place, bible reference — never opinion.
- `apoio` — Discreet context: quote, definition, explanation.
- `composicao` — Multi-take composition (templates): comparison, sequence, mosaic.
- `conclusao` — Closing of the video: final reflection, ending — never an opening.

## Subtipos (os sinais que o motor detecta no bloco)

- `info` — `ano`, `data`, `hora`, `numero`, `pct`, `dinheiro`, `nome`, `rotulo`, `local`, `contagem`, `artigo`, `biblia`
- `expressao` — `titulo`, `frase`, `pergunta`, `impacto`, `forte`, `citacao`
- `estrutura` — `capitulo`, `corte`

## Regras (resumo) — o motor aplica; a proposta que as ignora vira descarte

- **golden**: The SPEECH anchors the reading point. A highlight enters preRoll before the first spoken word of its block (the animation impact lands exactly when the word is said), covers the WHOLE speech of the block, and breathes a tail into the silence up to the next speech. ONE highlight on screen at a time — neighbours never overlap. This holds for the local engine, for manual application and for anything the AI proposes: the intake recomputes start/end from these rules and rejects what cannot fit.
- **anchor**: The speech anchor of a highlight is the first spoken word OF ITS OWN TEXT, never the start of the block group: literal text is located in the word JSON (its first 2-3 words in sequence); authored/summary text must carry palavra or palavraIdx; a proposal whose text cannot be anchored inside a speech span longer than 2.5 s is rejected (texto autoral sem ancora na fala). The item appears at most preRoll (<= 0.5 s by class) before that word and keeps the tail rule after the speech ends.
- **timingConstants**: {"gapMinS":0.1,"gapSelecaoS":1.2,"espacoAntesMaxS":0.6,"folgaVizinhoS":0.04,"preRollFolgaS":0.08,"postRollMaxS":1,"fracaoVaoProxS":0.45,"durMinS":0.6,"durMinAposCorteS":0.8,"leitura":{"baseS":0.9,"batidasPorS":2.5,"minS":1.6,"maxS":6},"tipagemCps":[6,30]}
- **textReading**: reading duration of a text = 0.9s + beats / 2.5 per second, clamped 1.6–6s (a beat = a content word; connectives of the detected language do not count)
- **maxBeatsInWindow**: floor((min(6, max(1.6, windowS)) − 0.9) × 2.5) — a text with more beats than this (+1 tolerance) is rejected; shorten it
- **hard**: ["exclusivo: only when the block carries one of the style subtypes","subtiposProibidos: never on those subtypes","info styles with declared subtypes: only the matching subtype","manualOnly styles never (engine or AI)","strict universe: never outside the active preset kit"]

## Números da regra única de tempo (`core/regras-tempo.js`)

- vão mínimo entre destaques: 0.1 s · vão que separa grupos de fala (blocoIds): 1.2 s · espaço máximo antes da fala: 0.6 s
- duração mínima: 0.6 s (após corte: 0.8 s) · pós-rolo máximo: 1 s · fração do vão até o próximo: 0.45
- leitura: 0.9 s + 1 s a cada 2.5 batidas, entre 1.6 e 6 s · digitação: 6–30 cps
- ÂNCORA: o destaque entra na primeira palavra dita do SEU texto (pré-rolo da animação antes dela, nunca mais que o espaço máximo). Texto autoral sem palavra dita no trecho é recusado quando o bloco tem mais de 2,5 s — informe `palavra` ou `palavraIdx`.

## Densidade e ritmo

- densidades: `minimal` ×0.45 · `equilibrado` ×1 · `dinamico` ×1.6 · `maximo` ×2.4
- ritmos do plano: `calmo`, `equilibrado`, `dinamico`, `muito_dinamico`

## Esquema da proposta (intake)

```json
{
  "highlights": {
    "blocoId": "caption id of the speech block (required)",
    "estilo": "highlight style id (required, autoEligible)",
    "texto": "optional authored text (default: the block speech). If it quotes the speech, its first 2-3 words are located in the word JSON and anchor the highlight; if it is a summary, palavra or palavraIdx is REQUIRED on spans longer than 2.5 s",
    "campos": "optional field values by field id (see highlights[id].texto.campos)",
    "palavra": "word of the block that anchors the highlight (the item appears at most preRoll before it is spoken) — required for authored/summary text",
    "palavraIdx": "optional 0-based index of the spoken word in the block",
    "pos": "alto | centro | baixo (optional)",
    "tam": "g | m | p (optional)"
  },
  "rejectionReasons": [
    "bloco de fala inexistente",
    "bloco já recebeu destaque nesta proposta",
    "estilo desconhecido",
    "estilo só-manual (fora do sorteio e da IA)",
    "estilo fora da predefinição ativa",
    "estilo exclusivo de <subtipos> sem esse sinal no bloco",
    "subtipo proibido pelo estilo (subNao)",
    "texto vazio",
    "texto fora do alcance do estilo (min–max palavras)",
    "texto autoral sem âncora na fala: use palavras ditas no trecho ou informe palavra/palavraIdx",
    "palavra \"<x>\" não é dita neste bloco",
    "não cabe no tempo: N batidas em Ts (máx ≈ M) — encurte para ≤M palavras",
    "digitação fora de 6–30 cps",
    "colisão de tela"
  ]
}
```

## Predefinições do sistema

- `sys_tudo` **Padrão do sistema** — universo `sistema`, ritmo `equilibrado`, destaques equilibrado (0 no kit), transições 0, efeitos 0, entradas 0, saídas 0, templates 0
- `sys_doc_classico` **Documentário clássico** — universo `predef`, ritmo `equilibrado`, destaques desligados, transições 5, efeitos 4, entradas 0, saídas 0, templates 0
- `sys_cinema` **Cinema premium** — universo `predef`, ritmo `equilibrado`, destaques desligados, transições 5, efeitos 3, entradas 0, saídas 0, templates 0
- `sys_dinamico` **Cortes dinâmicos** — universo `predef`, ritmo `equilibrado`, destaques desligados, transições 4, efeitos 2, entradas 2, saídas 0, templates 0

# 20 — SKILL: DO ROTEIRO AOS DESTAQUES

**Quando ler:** você vai propor destaques (ação `inteligente` de `studio_destaques`) — a partir do roteiro, da narração vinculada (SRT + word JSON) ou de um pedido "destaques melhores / mais inteligentes".

**Entradas:** projeto (id); narração vinculada (`studio_estado resumo` → `narracao.vinculada: true`); o roteiro público (`studio_estado {nivel: "roteiro"}`), que traz blocos SRT, idioma, sinais e, quando disponível, a contagem de palavras; o índice da biblioteca (`consultar_biblioteca {indice: true}`); e a predefinição ativa. O SRT fornece o texto e a janela geral; o word JSON só deve ser usado quando `palavras_carregadas > 0` para escolher uma âncora de palavra.

## O que o motor faz por você (não refaça)

- Tempo: início/fim de cada destaque pela regra única (âncora na primeira palavra dita do SEU texto, pré-rolo da animação, cauda no silêncio, vão mínimo entre destaques). Você NUNCA manda tempo.
- Colisão: destaques existentes são fixos; o novo é aparado/deslocado/descartado — sai em `descartes`.
- Leitura: texto autoral que não cabe no tempo do bloco é recusado; texto literal (palavras da fala) é isento.
- Universo: fora do kit da predefinição = recusa, se o universo for estrito.

## Passos

O orçamento, as janelas e as recusas pertencem ao contrato do motor. As sugestões narrativas e visuais abaixo orientam o julgamento; não são uma sequência obrigatória de efeitos. Um trecho pode ficar sem destaque, e repetir uma linguagem com intenção pode ser melhor que trocar de estilo a cada frase.

1. `studio_estado {projeto, nivel: "roteiro"}` — um bloco por fala: `id` (o `blocoId`), `iniS/fimS`, `texto`, `palavras`, `grupo` (vizinhos que podem virar UM destaque via `blocoIds`), `sinais` (`ano`, `numero`, `pct`, `dinheiro`, `nome`, `local`, `biblia`, `pergunta`, `impacto`, `citacao`…), `destaque` existente. Anote `idioma` e `palavras_carregadas` (0 = sem word JSON: o motor usa as bordas do SRT; texto autoral também pode ser proposto se couber no tempo de leitura).
2. Leia o roteiro inteiro e descreva sua progressão: gancho, tese, viradas, provas, clímax e fecho, quando essas funções existirem. Não imponha essa estrutura a todo vídeo nem preencha uma cota por função. Escolha os trechos em que uma intervenção visual melhora a compreensão; isso orienta o PAPEL de cada proposta: `abertura` no gancho (máx. 1), `secao` nas viradas, `destaque` na tese/clímax, `info` nos dados, `enfase` numa palavra forte, `apoio` em citação/definição, `conclusao` no fecho.
2b. Análise POR BLOCO antes de decidir (é o que separa um destaque de um enfeite): **(a) função** — o que este bloco faz no argumento (gancho, tese, prova, virada, clímax, fecho)? sem função clara, sem destaque; **(b) sinais** — dado/nome/lugar/bíblia pedem estilo de info exclusivo; `corte` = a cena muda com este bloco; **(c) tamanho** — `palavras` e `durS` cabem na faixa do estilo (índice)? bloco com menos de 1,2 s não segura destaque; **(d) vizinhança** — segundos desde o último destaque (respeite a densidade), família do anterior (evite repetição automática; a continuidade visual pode ser intencional) e templates no trecho (`studio_estado {nivel: "clipes"}` → kind `composto`: nada de destaque de intensidade alta sob template); **(e) texto** — aproveite a fala ou escreva uma síntese, manchete, contraste ou palavra-chave fiel à ideia; **(f) universo** — o estilo está no kit da predefinição?
3. Orçamento pela densidade da predefinição (resumo → `predefinicao`; `matriz {tema: "contrato"}` traz os fatores): `minimal` ≈ 1 a cada 60 s · `equilibrado` ≈ 1 a cada 30 s · `dinamico` ≈ 1 a cada 18 s · `maximo` ≈ 1 a cada 12 s. Nunca dois destaques em blocos vizinhos do mesmo grupo. Blocos que já têm `destaque` ficam de fora (ou entram com `substituir_lote: true` se o usuário mandou refazer).
4. Estilo por papel: `matriz {tema: "conjuntos", id: "destaques"}` dá os ids por papel e por intensidade; o índice da biblioteca dá a faixa de palavras e o "quando NÃO usar" de cada um. Estilo exclusivo de sinal (ano, número, bíblia) só em bloco que TEM o sinal. Respeite o kit quando o universo for `predef`; kit vazio = todo o catálogo automático (nunca os estilos marcados na tela). Alterne famílias — o mesmo estilo duas vezes seguidas é o erro mais comum. **Família CORTE** (`ed_corte_lamina`, `ed_corte_flash`, `ed_corte_preto`, `ed_corte_persiana`, `ed_corte_split`, `ed_corte_glitch`, `ed_corte_zoom`, `ed_corte_luz`, `ed_corte_iris`, `ed_corte_batida`): irmãs da Pilha Dramática que COBREM o corte de cena — o destaque entra antes do corte e o fundo faz a transição (flash, quadro preto, lâmina, persiana, tela dividida, glitch, zoom, luz, íris, batida). Só em bloco com sinal `corte` (o motor recusa fora dele) e de preferência onde a cena E o assunto mudam (virada, revelação, salto no tempo); manchete de 2–10 palavras; máx. 3 por vídeo; nunca em dois cortes seguidos; alterne as irmãs pelo clima (flash/batida = choque; preto/luz = pausa e passagem; split = conflito; glitch = falha; zoom/íris = foco; lâmina/persiana = virada). Com narração sincronizada quase todo bloco começa num corte — o critério que manda é a VIRADA, não o corte em si.
5. Texto: decida entre citação literal, síntese, manchete, contraste ou palavra de ênfase conforme a função narrativa. Escreva `texto` quando houver uma escolha autoral; omita apenas quando a fala inteira for a melhor escolha. O texto autoral pode diferir da fala, mas deve preservar seu sentido e seus fatos: informe `palavra` ou `palavraIdx` para ancorá-lo no word JSON. Sem word JSON, escolha o bloco SRT que sustenta a ideia e envie o texto literal ou uma síntese curta; o motor mantém a janela do bloco, sem inventar timestamps de palavra. Respeite idioma, faixa de palavras e campos do estilo; não copie uma frase só para cumprir uma densidade.
6. Monte as `propostas` (≤ 60 por chamada): `{blocoId, estilo, texto?, palavra?, pos?, tam?}` ou `{blocoIds: [...vizinhos do mesmo grupo], estilo, texto}`. Campos de estilos com lacunas (`campos`) só quando o índice do estilo pede.
7. `studio_destaques {projeto, acao: "validar", propostas, opcoes}` — leia `aceitos` e `descartes`. Corrija SÓ os recusados (`matriz {tema: "recusas"}`) e valide de novo até `aprovado: true` (ou até restarem apenas descartes que você aceita perder).
8. `studio_destaques {projeto, acao: "inteligente", propostas, opcoes}` — aplique as propostas depois de ler a resposta de `validar`. Esse verbo não escolhe redação, estilo ou bloco por conta própria: a IA deve fazer a análise narrativa e enviar cada escolha em `propostas`. `opcoes`: `substituir_lote` (somente se o usuário pediu refazer o lote), `seed` (para reprodutibilidade dos detalhes de composição; não substitui as escolhas narrativas) e `universo_estrito`/`estilos` somente quando a predefinição ou o pedido os exigir.
9. `studio_estado {projeto, nivel: "destaques"}` — confira `blocoId`, `origem: "ia"`, `antecipacaoS` (≤ 0,6 s) e `som`. `studio_capturar {projeto, atS}` no meio de dois deles.

### Criar e reeditar texto

`texto` numa proposta cria o texto editorial do destaque: pode ser uma síntese, título ou manchete fiel aos fatos da fala, desde que ancorado em `palavra`/`palavraIdx` quando houver word JSON. Depois de aplicado, leia `studio_estado` em `nivel: "clipes"`, filtre `kind: "legenda"` e use o `id` real em `studio_clipe`; para corrigir um destaque já existente, `studio_editar` com `op: "ajustar"`, `kind: "legenda"`, esse `id` e `campos: {"text": "..."}` altera somente o texto. Não reenvie `inteligente` nem `substituir_lote` para editar uma escolha existente.

A legenda de fala continua sendo o texto do SRT/word JSON e sua sincronização; um título autoral do destaque não substitui a narração nem inventa uma fala. Estilo, tamanho e cor do destaque são ajustados pelos campos que `studio_clipe` devolver e pelos ids reais de `studio_catalogo`.

## Critérios de aceite

- `descartes` = 0 na aplicação; nenhum bloco com dois destaques; ≤ 1 `abertura`; intervalo médio dentro da densidade.
- Todo texto autoral ancorado (`ancoraS` presente quando há palavras carregadas).
- Idioma dos textos = `idioma` do resumo.
- A proposta autoral pode criar uma síntese, título ou contraste, mas cada afirmação deve estar sustentada pela fala; o validador rejeita números de campos ausentes da fala, mas não verifica todas as afirmações ou nomes. A IA deve conferir a fidelidade do texto antes de aplicar.
- Para reeditar, use o `id` retornado em `studio_estado {nivel: "destaques"}`/`studio_clipe` e `studio_editar`; não gere uma nova proposta nem reaplique o lote.

## Recusas esperadas

- "texto fora do alcance do estilo" → encurte (o motor não corta por você).
- "texto autoral sem âncora na fala" → comece com palavras ditas ou mande `palavra`.
- "estilo fora da predefinição ativa" → escolha do kit; só saia dele com ordem do usuário.
- "estilo exclusivo de …" / "estilo de info só para …" → o bloco não tem o sinal: troque o estilo.
- "colisão de tela" → há destaque fixo ali (manual): não insista; proponha noutro bloco.
- "estilo exclusivo de corte" → o bloco não começa num corte de cena: escolha um bloco com sinal `corte` ou outra família.
- Zero candidatos no sorteio ("sorteados: 0") num roteiro morno é comportamento normal do motor, não defeito — a IA propõe onde o roteiro tem gancho.

## Saída

"N destaques propostos, N aplicados (N descartados: motivo), papéis: abertura 1, destaque 4, info 3…" + uma captura.

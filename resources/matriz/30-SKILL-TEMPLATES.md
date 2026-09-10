# 30 — SKILL: TEMPLATES (blocos compostos)

**Quando ler:** a predefinição tem templates ligados, o usuário pediu "templates", "abertura", "comparação", "mosaico", ou você viu um trecho que pede composição.

**Entradas:** projeto (id); `studio_catalogo {tipo: "templates"}` (nome, `cenas` = quantos takes cobre, `duracaoS`, `preencher`); `consultar_biblioteca {id}` para o contrato de um template específico (papel, quando NÃO usar); as cenas (`studio_estado nivel "clipes"`, kind `cena`) e os compostos já existentes (kind `composto`).

## Onde um template cabe

- Trechos CONTEMPLATIVOS (fala lenta, sem dado), apresentação de pessoa/lugar, comparação (2 takes), sequência (3+ takes), abertura e fecho.
- Física: precisa de takes CONTÍGUOS a partir do tempo pedido, cada um ≥ 1 s; template de N cenas cobre as N seguintes. Imagem × vídeo: o template diz `preencher` (`tempo` = estica pelo trecho).
- Templates `tpl_avatar_*` pertencem a uma família separada. Eles não entram no catálogo automático normal nem em sorteios de templates comuns. Só podem ser aplicados quando há um clipe `kind:"avatar"` no intervalo; o tempo do Avatar coordena a janela e pode cobrir apenas parte da cena. O Avatar não é alongado para alcançar as bordas da cena.
- As composições normais de sequência usam seus takes contíguos. Os Shutters são uma exceção: ocupam um trecho curto sobre a cena e sorteiam fontes de outras cenas do vídeo pela lógica do Match Cut Shutter; não precisam consumir N takes contíguos. A IA escolhe onde e por que usar o cut, enquanto o template escolhe as fontes. Consulte o contrato da família antes de contar takes.
- Nunca sobre outro composto (o novo REMOVE o anterior — só com ordem do usuário). Nunca sob um destaque de intensidade alta no mesmo trecho.
- Quantidade: 1 a cada ~45 s em ritmo equilibrado (é a taxa do plano); abertura conta como 1.

## O que analisar antes de aplicar (por trecho)

1. **Função** do trecho no roteiro (`studio_estado {nivel: "roteiro"}`): contemplativo, apresentação, comparação, sequência, abertura, fecho — a função escolhe o template, não o contrário.
2. **Física da família**: nas composições de sequência, takes contíguos a partir de `em_s`, cada um ≥ 1 s; nos Shutters, cena-alvo e outras cenas candidatas do projeto. Confira `studio_estado {nivel: "clipes"}` e o contrato do template; não interprete `cenas: 0` de um especial como ausência de mídia necessária.
3. **Conflitos no trecho**: outro composto (nunca sobrepor), destaque de intensidade alta (`studio_estado {nivel: "destaques"}`), destaque da família Corte no mesmo corte (escolha um dos dois: o template já é a transição visual).
   Para um template Avatar, valide também a janela do Avatar e os `sceneId` cobertos; não use a janela de um composto normal como substituto dessa cobertura. Se a janela atravessar cenas, a mídia principal acompanha a régua e o layout termina no fim do Avatar.
4. **Texto**: os `campos` preenchidos com o que a fala DIZ, no idioma do roteiro; `legenda` = fala do take; `campos.deFabrica` vazio na resposta.
5. **Taxa e espaçamento**: cerca de 1 por 45 s no ritmo equilibrado é uma referência de planejamento. Prefira respiro entre composições; use trechos consecutivos somente quando a continuidade tiver uma função narrativa clara. Preserve as restrições de mídia, colisão e legibilidade da família.
6. **Conferir**: `studio_capturar` dentro do template e `studio_estado {nivel: "clipes"}` do trecho.

## Passos

1. Candidatos: percorra os grupos do roteiro (`studio_estado nivel "roteiro"`) e marque os trechos das funções acima. Some os takes disponíveis em cada um (`studio_estado nivel "clipes"` → cenas com `startS` ≥ início do trecho).
2. Escolha o template pela função e confirme sua necessidade de mídia: `cenas` conta takes nas composições de sequência; os especiais seguem o próprio contrato. Nome do catálogo entra em `template`.
3. `studio_aplicar_template {projeto, template: "<nome>", em_s: <startS da primeira cena do trecho>}` — um por chamada. Resposta: `aplicado`, `blocos` (total de compostos agora). Recusa "não entrou em Xs" = faltam cenas/legendas naquele ponto: escolha outro tempo ou outro template.
   Para `tpl_avatar_*`, a recusa deve dizer se faltou Avatar, se faltou mídia principal ou se a fonte não corresponde ao `sceneId`; cobertura parcial é válida e limita a janela ao intervalo do Avatar. Não criar um Avatar nem alterar a cena para fazer o molde caber.
4. Textos do template: `studio_catalogo {tipo: "templates"}` traz os `campos` de cada um (chave, fonte `fixo|fala`, padrão, instrução e máximo). Esses campos são derivados dos `texts` físicos e, nos Cinema50 V2, do contrato `textMotion`; não invente uma chave fora dessa lista. Todo rótulo de fábrica ("CAPÍTULO", "TÓPICO", "PERFIL", "COORDENADAS"…) é um lugar para o texto do roteiro: mande `campos: {"CAPÍTULO": "A QUEDA DE ROMA"}` na própria `studio_aplicar_template`, no idioma do roteiro, derivado da fala do trecho. A resposta lista em `campos.deFabrica` o que ficou sem texto — corrija ou escolha outro template. O campo `legenda` é a fala do take, resolvida de SRT/word JSON (só sobrescreva para encurtar ou corrigir com pedido explícito) e o template que o tem cobre a legenda padrão no trecho. Se o usuário quiser manter ou ocultar a legenda de fala sob templates: por projeto `studio_configurar {legenda_sob_templates: "auto" | "mostrar" | "ocultar"}`; por bloco `studio_editar {op: "ajustar", kind: "composto", id, campos: {legenda: "mostrar" | "ocultar" | "auto"}}` (o bloco vence o projeto).
5. `studio_capturar {projeto, atS}` dentro do template.

### Criar e reeditar títulos internos

Os valores de `campos` criam os títulos e rótulos autorais do template a partir da fala; podem sintetizar fielmente o conteúdo e os fatos, no idioma do roteiro. Depois de aplicar, `studio_estado {projeto, nivel: "clipes", filtro: {kind: "texto"}}` lista cada texto interno com `id`, `interno: true` e `compostoId`; use `studio_clipe {projeto, kind: "texto", id}` para conferir o alvo. Uma correção pontual usa o mesmo id: `studio_editar {projeto, operacoes: [{op: "ajustar", kind: "texto", id: "<id-real>", campos: {text: "NOVO TÍTULO", cor: "#FFD60A", size: 64}}]}`. Os campos aceitos são os que `studio_clipe` expõe (`text`, `size`, `cor`, `estilo`, `pos`, `caixa`); ids de fonte/estilo vêm de `studio_catalogo`.

Essa reedição altera o texto interno já aplicado e preserva o composto, seus takes e o relógio. Não reaplica o template nem sorteia fontes. A legenda de fala segue o SRT/word JSON e só muda se o usuário pedir explicitamente encurtamento pelo campo `legenda` ou pela edição da legenda correspondente.

## Critérios de aceite

### Apresentação Avatar contínua e grades

Leia as cenas e os clipes Avatar antes de escolher a janela. Uma apresentação pode atravessar duas ou mais cenas e recortes adjacentes de Avatar: o binder registra as fontes usadas, sem recodificar e sem adotar posteriormente outra mídia por aproximação. Uma lacuna real não autoriza esticar a fonte. Dentro de um layout contínuo, a transição da cena muda a mídia principal dentro da moldura; o apresentador não deve sair e entrar novamente apenas porque a cena mudou.

Para uma janela contínua escolhida pela narrativa, `studio_aplicar_template {projeto, template:"<nome real do layout Avatar>", em_s:42, duracao_s:6}` aplica exatamente 42–48 s. `duracao_s` é opcional e exclusivo desta família; nos templates normais a duração continua sendo resolvida pelos takes. Confira as fontes e a cobertura antes de aplicar. Sem esse campo, o Avatar inteiro usa a cena-alvo; um recorte usa sua janela existente.

Os cinco estilos `tpl_avatar_grade_estudio`, `tpl_avatar_grade_papel`, `tpl_avatar_grade_horizonte`, `tpl_avatar_grade_diagonal` e `tpl_avatar_grade_orbita` têm molduras 16:9. Escolha pelo roteiro e pelo espaço que a imagem precisa, consultando `whenToUse`; não alterne estilos a cada frase por sorteio. Em `studio_editar`, `ajustar` de `kind:"composto"`, `campos.avatarLayout` aceita `fundo`, `cor`, `gradeCor`, `gradeIntensidade` (0–1), `gradeMovimento` (boolean), `lado`, `escala`, `x`, `y`, `raio`, `entrada`, `saida` e `animDurS`. Nos modelos antigos de janela, duplo e molduras, `formato:"16:9"` é opcional; nos novos grids esse formato é fixo. Alterar a decoração não muda o relógio da fala.

- Compostos não se sobrepõem; duração e fontes seguem a família (sequência de takes ou cut curto sobre uma cena).
- Textos internos coerentes com a fala e no idioma certo; `campos.deFabrica` vazio em toda resposta.
- Taxa de 1 por 45 s é uma referência para ritmo equilibrado. Na edição criativa, justifique a distribuição pela função dos trechos, preservando legibilidade e evitando competição entre elementos.
- Um título ou rótulo pode ser autoral e sintetizar a fala, mas não pode criar fatos. Depois da aplicação, a edição usa o `id` interno real e altera apenas os campos expostos pelo `studio_clipe` (`text`, `size`, `cor`, `estilo`, `pos`, `caixa`), preservando takes, duração e relógio.

## Recusas esperadas

- "não entrou em Xs" → cenas insuficientes a partir dali; ande para a próxima cena ou escolha template de menos takes.
- `problemas` "template manual-only" na direção → escolha um automático (índice: `manualOnlyTemplates` são os proibidos).

## Saída

"N templates: <nome> em Xs (abertura), <nome> em Ys (comparação)…" + captura de um deles.

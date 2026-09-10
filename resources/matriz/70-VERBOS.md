# 70 — VERBOS (gerado do schema do servidor MCP — não edite à mão)

Gerado por `npm run gerar:matriz` a partir do `tools/list` real. Cada verbo abaixo é uma ferramenta `mcp__darkplanner__<nome>`. A descrição é o contrato: leia o "quando usar" dela antes de chamar. Campos fora do schema são recusados (`additionalProperties: false`).

## Ordem de leitura para editar

1. `matriz` (índice) → 2. `studio_projetos` → 3. `studio_estado` (resumo, roteiro, destaques) → 4. `studio_catalogo` / `consultar_biblioteca` (ids) → 5. verbos de escrita (`studio_editar`, `studio_destaques`, `studio_aplicar_direcao`, `studio_aplicar_template`, `studio_vincular_narracao`, `studio_configurar`) → 6. `studio_capturar` → 7. `studio_exportar` + `studio_fila`.

## Verbos do editor e da matriz (31)

### `informar_progresso`

Atualiza a LINHA DE PROGRESSO do chat: uma linha só, que se SOBRESCREVE a cada chamada — o jeito certo de acompanhar fila/narração (com esperar_s) sem encher a conversa. Mensagem normal fica pra marcos (começo, problema, fim). Chame a cada volta do esperar_s com o número da vez ("28 de 40 mídias prontas") em vez de escrever isso ao usuário: escrever cria uma bolha nova por checagem e enterra a conversa.

**Campos:**
- `texto` (obrigatório): string — A linha de agora, curta (até 200 caracteres; o resto é cortado). Ex.: "28 de 40 mídias prontas".

### `studio_projetos`

Lista os projetos do Studio (o editor de vídeo do app): id, nome e quando cada um foi mexido pela última vez. É o PRIMEIRO passo de qualquer trabalho no Studio: você escolhe o projeto aqui, confirma com o usuário qual é, e abre com studio_abrir. Não precisa do editor aberto na tela.

**Campos:** nenhum.

### `studio_criar_projeto`

Cria um projeto NOVO do Studio (o editor de vídeo do app), vazio, PRO TRABALHO EM SEGUNDO PLANO. Ele nasce fechado: este verbo NÃO abre a tela — abra com studio_abrir só se o usuário quiser VER o projeto. É assim que uma esteira de vários vídeos começa: cria um projeto por vídeo e edita cada um pelos bastidores (studio_editar, studio_aplicar_template, studio_exportar aceitam `projeto` com o editor fechado). O NOME é como o usuário vai reconhecer o projeto na grade: use o título/slug do vídeo, curto (teto de 60 caracteres). Nome que JÁ EXISTE é recusado com o projeto existente na resposta — não crie um segundo com o mesmo nome: os outros verbos resolvem projeto por nome e dois iguais deixariam tudo ambíguo. Se o vídeo já tem projeto, use studio_projetos e trabalhe nele em vez de criar outro.

**Campos:**
- `nome` (obrigatório): string — Nome do projeto na grade (ex.: "Ep 03 — Pirâmides"). Até 60 caracteres, único entre os projetos do Studio. Use o MESMO nome do projeto do Creator (cortado em 60).
- `creator_project_id`: integer,string — OPCIONAL: project_id do Creator com as mídias deste vídeo — vincula os dois projetos (grade mostra o selo e o export cai na pasta do Creator).

### `studio_fechar`

FECHA o projeto que está aberto no Studio e volta pra grade de projetos — a mesma coisa que o usuário faz clicando em "Projetos Studio" na barra do editor. A última edição é salva antes de fechar, e o projeto continua editável em segundo plano depois (studio_editar com `projeto`). SÓ FECHE por pedido do usuário, ou quando um verbo EXIGIR — hoje só studio_restaurar exige, porque restaurar um ponto salvo com o projeto aberto seria apagado pelo salvamento automático. Nesse caso AVISE o usuário que você vai fechar o editor dele antes de fazer, e diga depois que fechou. Fechar a tela de alguém sem avisar é mexer no que ele está olhando. Se não houver projeto aberto, o verbo não faz nada e diz isso (não é erro).

**Campos:** nenhum.

### `studio_abrir`

Abre um projeto no Studio: navega até o editor e carrega o projeto, como o usuário faria clicando na grade. Aceita o id (de studio_projetos) ou o NOME — nome que casa com mais de um projeto volta com os candidatos pra você PERGUNTAR ao usuário, nunca escolher por ele. A resposta já é o resumo do projeto aberto (duração, aspecto, contagens por tipo, faixas). Abrir dá a captura EXATA (studio_capturar fotografa o preview de verdade); com o editor fechado studio_capturar ainda funciona, montando o quadro nos bastidores.

**Campos:**
- `projeto` (obrigatório): string — Id ou nome do projeto do Studio (studio_projetos lista os dois).

### `studio_estado`

Lê o projeto do Studio em três níveis, do mais barato pro mais caro: "resumo" (duração, aspecto, se há narração vinculada, quantos itens de cada tipo e as faixas com mudo/volume), "faixas" (só o mapa das faixas) e "clipes" (a lista de itens com id, tipo, faixa, início e duração em segundos, mais as propriedades principais de cada tipo). COMECE pelo resumo e só desça pra "clipes" com filtro — por tipo (kind) e/ou por janela de tempo (deS/ateS) — senão a resposta vem cortada num teto e você perde o que importa. Os ids que voltam aqui são os que os outros verbos aceitam. Um clipe com `midia_faltando: true` é o VERMELHO que o usuário vê na timeline: o arquivo daquela mídia não está mais no disco (o projeto guarda o caminho do original, não uma cópia). Avise o usuário — ele repõe o arquivo no lugar de origem, ou aquele trecho sai preto no vídeo. Dois níveis são o MAPA para a ação "inteligente" de studio_destaques: "roteiro" devolve um bloco por fala com o `id` (é o blocoId da proposta), o texto, o `grupo` de vizinhos (blocos do mesmo grupo podem virar UM destaque via blocoIds), os `sinais` que o motor detectou (ano, número, pergunta, nome, referência bíblica… com o token) e o destaque que o bloco já tem; "destaques" lista os destaques com estilo, origem (ia/sorteio/manual), bloco e a âncora na palavra dita. O resumo traz o `idioma` do roteiro (proponha textos NESSE idioma) e a `predefinicao` ativa. Sem `projeto`, vale o que estiver aberto no editor.

**Campos:**
- `projeto`: string — Id ou nome do projeto. Sem isto, o que estiver aberto no Studio.
- `nivel`: string — um de: `resumo`, `faixas`, `clipes`, `roteiro`, `destaques` — Quanto detalhe (padrão: resumo). "roteiro" e "destaques" são os mapas para propor destaques.
- `filtro`: object — Para nivel "clipes", "roteiro" e "destaques": recorta o que volta (kind só em clipes).
  - `kind`: string (cena | camada | avatar | texto | legenda | audio | forma | composto | efeito) — Só itens deste tipo.
  - `deS`: number — Só itens que existem a partir deste segundo.
  - `ateS`: number — Só itens que começam antes deste segundo.

### `studio_clipe`

Detalha UM item da timeline do Studio: os mesmos campos da lista mais estilo, transformações, ajustes de cor, animações e as CURVAS de keyframes completas ({propriedade: [{emS, valor}]}, com emS contado do início do clipe). Chame ANTES de mexer numa animação que já existe: "definir_keyframes" substitui a curva inteira, então você precisa ler o que há hoje pra não apagar pontos sem querer. O par tipo+id vem do studio_estado nivel "clipes".

**Campos:**
- `kind` (obrigatório): string — um de: `cena`, `camada`, `avatar`, `texto`, `legenda`, `audio`, `forma`, `composto`, `efeito` — O tipo do item, como veio no studio_estado.
- `id` (obrigatório): string — O id do item, como veio no studio_estado.
- `projeto`: string — Id ou nome do projeto. Sem isto, o que estiver aberto no Studio.

### `studio_capturar`

Os SEUS OLHOS no editor: devolve o CAMINHO de um PNG do quadro — abra esse arquivo como IMAGEM pra realmente ver (ler o caminho não mostra nada). Com `atS`, o quadro daquele segundo; sem, o quadro em que a agulha está. FUNCIONA NOS DOIS MODOS: com o projeto ABERTO no editor é a FOTO do preview (a composição real, tudo desenhado); com o editor FECHADO, mande `projeto` e eu monto o quadro NOS BASTIDORES com o motor de render — sem abrir nada, sem tirar o usuário da tela dele. O still do bastidor é o mesmo desenho do preview NAQUILO QUE O MOTOR COBRE; quando o trecho tem algo que ele não desenha (template, efeito de shader, destaque em selo, legenda muito customizada) a resposta vem com `aproximado: true` e `motivo` — nesse caso NÃO garanta ao usuário que conferiu aquele detalhe: ou abra o projeto com studio_abrir e capture de novo, ou diga a ele o que ficou de fora. MÍDIA POR REFERÊNCIA: o projeto aponta pros arquivos no disco do usuário — arquivo movido ou apagado rende o clipe PRETO no still, igual ao que sairia no vídeo exportado (é achado, não bug do olho). Use depois de editar pra CONFERIR o que mudou (legenda cobrindo o rosto, texto fora do quadro, cena preta) em vez de garantir ao usuário um resultado que você não viu. As capturas são temporárias: só as últimas ficam no disco.

**Campos:**
- `atS`: number — Segundo do vídeo a ver. Sem isto, o quadro em que a agulha já está (ou o segundo 0, no bastidor).
- `projeto`: string — Id ou nome do projeto. Necessário quando o editor NÃO está aberto nele — é o que liga o still de bastidor.

### `studio_editar`

EDITA a timeline do Studio: um LOTE de operações aplicadas em ordem, cada uma igual ao gesto que o usuário faria na mão (mover, aparar, dividir, remover, duplicar, ajustar propriedades, adicionar texto/forma/áudio/legenda/cenas, volume e mudo de faixa, recolar, aplicar legendas, converter cena↔camada, ANIMAR por keyframes). Os IDS VÁLIDOS de efeito, filtro, transição, animação, estilo, fonte e Look vêm do studio_catalogo — id inventado é aceito pelo campo e não vira nada na tela. KEYFRAMES (em cena E em camada — numa camada x/y são deslocamento em % sobre pos e scale multiplica o tamanho): "definir_keyframes" SUBSTITUI a curva de UMA propriedade (x, y, scale, rotate, opacity e as da máscara), com `pontos: [{emS, valor}]` — e `emS` é contado do INÍCIO DO CLIPE, não da régua do vídeo (ponto fora da duração do clipe é recusado). Zoom animado (Ken Burns) é {"op":"definir_keyframes","kind":"cena","id":"sc1","propriedade":"scale","pontos":[{"emS":0,"valor":1},{"emS":5,"valor":1.2}]}. "limpar_keyframes" sem `propriedade` apaga TODAS as curvas daquele clipe. A curva atual você lê no studio_clipe. FAIXA AVATAR (vídeo pronto, sem gerar): adicionar_avatar com nome do vídeo do bin e modo "inteiro" coloca desde zero; "distribuir" com pct seleciona cenas completas por DURAÇÃO no prefixo coberto; "primeira" escolhe exatamente a primeira cena; "intercalar" usa início/intervalo/quantidade; "cenas" exige ids ou números 1-based; "selecao" usa ids explícitos ou a seleção atual; "agulha" usa emS (ou a agulha do Studio aberto). Cenas inválidas, sobrepostas, travadas, sob template normal ou fora da duração da fonte são recusadas/relatadas; candidatos válidos podem ser aplicados. seed torna o sorteio repetível. cortar_avatar com cenaId divide o avatar nas DUAS bordas dessa cena num gesto, preservando o trecho-fonte; id opcional limita o clipe alvo. Os itens são kind "avatar", faixa "avatar:0", áudio inicialmente mudo. Ajustes visuais e keyframes são próprios; transição nos campos do avatar exige cenaId e edita somente a junção da cena de baixo, com um som. Leia matriz tema "avatar". AVATAR (HeyGen): "reservar_avatar" marca as cenas dos `ids` como RESERVADAS pro avatar falante (a lacuna que a narração vira depois) — {"op":"reservar_avatar","ids":["sc5","sc12"],"avatar":"Gertrudes"}. O avatar é o NOME (ou id) de um avatar da conta HeyGen; conta desconectada ou nome que não existe é recusado com a lista. "limpar_avatar" com `ids` tira a reserva. A GERAÇÃO/preenchimento do vídeo do avatar é um passo à parte — aqui só se reserva. RETEMPORIZAR é o jeito CERTO de casar as cenas com o mapa de tempo da narração (o srt de sincronia): {"op":"retemporizar","itens":[{"id":"sc1","emS":0,"duracaoS":4.2},{"id":"sc2","emS":4.2,"duracaoS":3.8}, …]} — TODAS as cenas numa ÚNICA operação (até 200), num passo de desfazer só. NUNCA re-temporize cena a cena com "mover"/"aparar_direita": 58 cenas viram 58 operações, dezenas de lotes e meia hora de trabalho para o que é uma chamada. REGRAS QUE VALEM SEMPRE: (1) chame studio_estado ANTES — todo alvo é por id REAL e todo tempo é em SEGUNDOS absolutos da régua do vídeo, nunca "o terceiro clipe" nem posição de tela; (2) lotes PEQUENOS e conferidos: edite poucas coisas, chame studio_capturar e VEJA o resultado antes de continuar; (3) `rejeitadas` NÃO é erro — é o editor dizendo que aquilo não cabia (colisão, mínimo de 0,5s, id que sumiu). Leia o motivo, conte ao usuário o que entrou e o que não entrou, e não invente que deu tudo certo; (4) operações DESTRUTIVAS (substituir_cenas, resetar_estilos, faixa_remover, e remover com mais de 10 ids) exigem que você PERGUNTE ao usuário na conversa e só então reenvie a operação com confirmacao: true; (5) errou? studio_desfazer volta atrás. O lote inteiro costuma virar UM passo de desfazer. EM MASSA (M5): {"op":"aplicar_por_cena","eixo":"movimento|overlays|transicoes|animacoes|filtro|limpar","conjunto":"<id da matriz>" | "itens":[ids],"pct":30,"alvo":{"kind":"imagem|video","deS","ateS","ids","excluirTemplates"},"seed"} faz "movimento em todas as cenas", "overlays em 30%", "troque as transições por fades" ou "entradas em pares" NUMA operação: a distribuição (rotação sem repetir vizinho, overlays espaçados por contagem, transições por junção, pares harmônicos, só imagem para movimento, fora de template) é do editor, determinística pela seed; `aplicadas[].nota` conta o que entrou e o que ficou de fora. Os conjuntos estão em matriz {tema:"conjuntos"}; "filtro" leva `id` (+`forca`); "limpar" leva `de` (o eixo a limpar). FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a edição acontece em SEGUNDO PLANO, sem tirar o usuário da tela em que ele está — ele pode estar gerando um projeto, ajustando contas ou pedindo outro vídeo noutro chat. Se ele ABRIR esse projeto, passa a ver a edição AO VIVO daí em diante (a troca é automática, lote a lote). Com o editor fechado NÃO há Ctrl+Z: a volta atrás é o studio_restaurar, e todo lote em segundo plano salva sozinho um ponto "antes-do-lote". Um projeto só aceita UM chat editando por vez.

**Campos:**
- `projeto`: string — Id ou NOME do projeto a editar (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a edição roda em segundo plano.
- `operacoes` (obrigatório): array — As operações, na ordem em que devem acontecer (máximo 40 por chamada).
  - item.`op`: string — O que fazer.
  - item.`kind`: string — O tipo do item, como veio no studio_estado.
  - item.`modo`: string — Em adicionar_avatar: inteiro desde zero; distribuir por porcentagem; primeira = cena 1; intercalar = início/intervalo/quantidade; cenas = ids ou números 1-based; selecao = ids ou seleção atual; agulha = emS ou agulha do Studio.
  - item.`pct`: number — Em adicionar_avatar modo distribuir: porcentagem de DURAÇÃO, escolhendo cenas inteiras dentro do prefixo coberto pelo avatar.
  - item.`seed`: string — Semente do sorteio de avatar; mesma entrada e seed mantêm a seleção.
  - item.`ids`: array — Vários alvos do MESMO tipo (remover, duplicar, ajustar).
  - item.`numeros`: array — Números 1-based das cenas para modo cenas; não misture com ids.
  - item.`inicioCena`: integer — Modo intercalar: primeira posição 1-based.
  - item.`intervalo`: integer — Modo intercalar: passo entre cenas.
  - item.`quantidade`: integer,null — Modo intercalar: número de cenas; nulo = todas as válidas.
  - item.`emS`: number — Tempo em segundos ABSOLUTOS da régua: destino do "mover", ponto do "dividir", onde nasce o item novo.
  - item.`cenaId`: string — Id real da cena principal em cortar_avatar ou ao ajustar uma transição de kind avatar. A cena fornece os dois limites ou a junção compartilhada.
  - item.`id`: string — Id do item alvo (studio_estado nivel "clipes").
  - item.`todos`: boolean — Em "ajustar": aplica em TODOS os itens do tipo (ex.: baixar o volume de todos os áudios).
  - item.`duracaoS`: number — Em "aparar_direita": a duração FINAL do clipe. Em "adicionar_*": quanto o item dura. CENA DE VÍDEO: duração e velocidade são ACOPLADAS — aparar_direita pra uma duração nova recalcula a velocidade sozinho pra caber o MESMO conteúdo (é o "esticar" de editor: encurtou = acelera, alongou = desacelera). Pra casar uma cena de vídeo com o tempo de uma fala, este é o jeito certo — não precisa mexer em velocidade na mão (mas dá, via ajustar {velocidade}, se quiser o efeito de câmera lenta/rápida por si só). Se o alongamento não pegar por colisão com o vizinho, reposicione os clipes de trás pra frente e tente de novo.
  - item.`deltaS`: number — Em "aparar_esquerda": quanto a borda esquerda anda (positivo encurta, negativo estica).
  - item.`faixa`: valor — Número da faixa (0 a 7) nas operações de item; nas de faixa é a chave que o studio_estado mostra, ex.: "audio:0".
  - item.`ripple`: boolean — Em "remover": fecha o buraco deixado (as cenas seguintes puxam pra trás).
  - item.`campos`: object — Em "ajustar" (e opcional nos "adicionar_*"): as propriedades a mudar, com os MESMOS nomes que o studio_clipe mostra (volume, velocidade, filtro, efeito, transicaoOut, transformacao {x,y,scale} = o zoom do clipe, mascara = o recorte, ajustes {brilho,contraste,saturacao,temperatura}, pos, cor, texto…). Os ids de catálogo vêm do studio_catalogo. Campo desconhecido derruba a operação inteira, com a lista do que dá pra mexer.
  - item.`porKind`: object — Em "vincular"/"desvincular": os ids por tipo, ex.: {"cena":["sc1"],"audio":["au1"]}. Itens vinculados andam e somem juntos.
  - item.`midias`: array — Em "adicionar_cenas"/"substituir_cenas": os NOMES dos arquivos já importados no projeto (nome ambíguo ou inexistente volta com a lista do que existe).
  - item.`texto`: string — Em "adicionar_texto"/"adicionar_legenda": o conteúdo.
  - item.`forma`: string — Em "adicionar_forma": retângulo, elipse ou linha.
  - item.`nome`: string — Em "adicionar_audio": o NOME do arquivo de áudio já importado no projeto. Em "adicionar_camada": o NOME da imagem/vídeo do projeto (inclusive os vídeos de avatar que o studio_avatar acao "midias" registra) que vai pra uma faixa de CIMA como camada — PiP, card, lado a lado. Uma camada aceita TUDO que uma cena aceita (mesmo vocabulário do studio_clipe), via "ajustar" ou nos `campos` da criação: transformacao {x,y,scale} = posição e tamanho da mídia no quadro (x/y em % do quadro a partir do centro; scale 1 = tela cheia e cobre a de baixo, 0.3 = PiP pequeno) — `pos` {x,y} em % do quadro e `scale` continuam aceitos como atalho e viram esse transform —, opacidade, rotacao, espelhado, enquadramento, mascara (tipos: circle pra bolinha, rect pra card com `round`, linear/mirror pra recorte, star, heart, text {texto} — o texto vira o recorte —, poly {pontos:[{x,y}] em % do quadro} e brush {tracos:[{w, pts}]}; campos x/y/w/h/rotate/feather/invert) e mascaras (lista de até 3 máscaras EXTRAS em união com a principal), corte {l,t,r,b} = recorte por lado em % da caixa da mídia (0–45; as alças laterais do gizmo), efeito/efeitosExtras, filtro/forcaDoFiltro, ajustes {brilho,contraste,saturacao,temperatura}, animIn/animOut/animDurS e keyframes (definir_keyframes com kind "camada", mesmas propriedades da cena). Isso é o que o CapCut faz com uma mídia em outra track — a composição (onde, tamanho, quando é PiP e quando é tela cheia) é sua decisão pelo conteúdo.
  - item.`pos`: object — Em "adicionar_camada": {x, y} em % do quadro onde fica o CENTRO da mídia (50/50 = meio; 85/18 = canto superior direito). Atalho: vira o transform da camada.
  - item.`scale`: number — Em "adicionar_camada": tamanho da mídia no quadro (0.3 = PiP pequeno, 0.5 = metade, 1 = tela cheia). Atalho: vira o transform.scale da camada. Padrão 1.
  - item.`avatar`: string — Em "reservar_avatar": o NOME (ou id) do avatar da conta HeyGen que vai preencher estas cenas. Nome ambíguo ou inexistente volta com a lista dos avatares da conta.
  - item.`volume`: number — Em "faixa_volume": 0 é mudo, 1 é o normal, 4 é o teto (+12 dB).
  - item.`silenciar`: boolean — Em "faixa_silenciar": true põe no mudo, false devolve o som (repetir não inverte).
  - item.`itens`: array — Em "retemporizar": TODAS as cenas e seus tempos numa lista só — [{id, emS, duracaoS}]. É o jeito certo de casar as cenas com o mapa de tempo (o srt de sincronia da narração): 58 cenas em UMA operação, nunca uma a uma.
  - item.`blocos`: array — Em "aplicar_srt": as falas com tempo próprio [{iniS, fimS, texto}] — substitui as legendas de fala do projeto.
  - item.`propriedade`: string — Em "definir_keyframes"/"limpar_keyframes": qual propriedade da cena ou camada é animada. Em "limpar_keyframes" é opcional (sem ela, apaga todas).
  - item.`pontos`: array — Em "definir_keyframes": a curva INTEIRA daquela propriedade — [{emS, valor}], com emS em segundos contados do INÍCIO do clipe (0 = primeiro quadro dele).
  - item.`confirmacao`: boolean — Só para as destrutivas, e SÓ depois de o usuário confirmar na conversa.

### `studio_configurar`

Muda os ajustes do PROJETO inteiro no Studio (não de um clipe): formato do quadro, Look, template de estilo dos textos e das legendas, posição e caixa da legenda na tela, a configuração dos destaques e a TIPOGRAFIA (fonte, tamanho, cor, contorno, sombra, brilho…) das legendas e dos textos livres. TUDO AQUI É GLOBAL: `tipografia_legenda` vale para TODAS as legendas do vídeo e `tipografia_texto` para TODOS os textos livres — para mexer em UM item só, use studio_editar com a operação "ajustar". Os objetos são MESCLADOS com o que já existe (mandar só a cor não apaga a fonte); mandar null no lugar do objeto inteiro volta ao padrão do estilo, e null num campo limpa só aquele campo. Cores em hex ("#FFD60A") ou rgba(); os ids (fonte, estilo, animação, Look) vêm do studio_catalogo — não invente. É o mesmo caminho dos painéis, então o editor clampa o que estiver fora de faixa e IGNORA o que não reconhecer — por isso a resposta diz o que foi `aplicados`, o que ficou `ignorados` e quais campos ele não conhecia (`avisos`): confie nela, não no que você pediu. Depois de mudar formato ou legenda, VEJA o resultado com studio_capturar: mudar o quadro reposiciona tudo. FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a mudança acontece em segundo plano; se o usuário abrir esse projeto, ele passa a ver as mudanças ao vivo.

**Campos:**
- `projeto`: string — Id ou NOME do projeto a configurar (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a mudança roda em segundo plano.
- `aspecto`: string — Formato do quadro, ex.: "16:9", "9:16", "1:1".
- `look`: string — Look do projeto (o mesmo nome do seletor do editor).
- `estilo_texto`: string — Template de estilo dos textos livres.
- `estilo_legenda`: string — Template de estilo das legendas.
- `legenda_sob_templates`: string — um de: `auto`, `mostrar`, `ocultar` — A legenda de fala sob templates: "auto" (padrão: some só onde o template já mostra a fala), "mostrar" (nunca some) ou "ocultar" (some sob qualquer template). Por bloco: studio_editar ajustar kind "composto" campos {legenda}.
- `pos_legenda`: object — Posição da legenda na tela, em % do quadro.
  - `x`: number
  - `y`: number
- `caixa_legenda`: object — Caixa da legenda em % do quadro (largura manda na quebra de linha).
  - `w`: number
  - `h`: number
- `config_destaques`: object — Configuração dos destaques (as mesmas chaves do painel). Junta-se ao que já existe em vez de substituir tudo.
- `tipografia_legenda`: object,null — Tipografia GLOBAL de TODAS as legendas. Campos: fonte (id do studio_catalogo tipo "fontes"), tamanho (16 a 400), cor, fundo, negrito, italico, sublinhado, caixa ("upper"/"lower"/"title"), espacamento, altura_linha, contorno, contorno_cor, contorno_largura, sombra, sombra_cor, sombra_desfoque, sombra_distancia, sombra_angulo, brilho, brilho_cor, brilho_forca, opacidade_texto, gradiente, animacao, predefinicao. null volta ao padrão do estilo.
- `tipografia_texto`: object,null — Tipografia GLOBAL de TODOS os textos livres. Campos: fonte (id do studio_catalogo tipo "fontes"), tamanho (16 a 400), cor, fundo, negrito, italico, sublinhado, caixa ("upper"/"lower"/"title"), espacamento, altura_linha, contorno, contorno_cor, contorno_largura, sombra, sombra_cor, sombra_desfoque, sombra_distancia, sombra_angulo, brilho, brilho_cor, brilho_forca, opacidade_texto, gradiente, animacao, predefinicao. null volta ao padrão do estilo.
- `animacao_legenda`: object,null — Animação de entrada/saída da FAIXA DE LEGENDAS: {"entrada": id, "saida": id}. Os ids vêm do studio_catalogo tipo "animacoes". null tira as duas.

### `studio_catalogo`

Lista os IDS que o editor aceita — o dicionário de que os outros verbos do Studio precisam. Os catálogos são: "efeitos" (movimento do clipe), "filtros" (cor), "transicoes" (entre cenas, mais os sons de transição), "animacoes" (entrada/saída de clipe e da legenda), "estilos_texto", "estilos_legenda" (inclui os de KARAOKÊ, marcados com exige_narracao: sem narração vinculada eles não têm palavra pra pintar), "looks" (o preset que restiliza o vídeo inteiro), "fontes", "destaques" (os estilos de destaque com papel, forma, faixa de palavras e se entram no automático — o contrato completo de cada um está em consultar_biblioteca), "predefinicoes" (as do sistema e as do usuário: nome, universo, ritmo, densidade e o que cada uma carrega — o nome entra em studio_aplicar_direcao) e "templates" (o acervo físico: nome, cenas, duração — o nome entra em studio_aplicar_template). CHAME ANTES de mandar qualquer id em studio_editar ("ajustar" com efeito/filtro/transicaoOut/animIn/estilo) ou em studio_configurar (look, estilo_texto, estilo_legenda, tipografia): id inventado é aceito pelo campo e simplesmente não vira nada na tela, e você acharia que aplicou. Cada item traz o `id` (é ele que entra nos outros verbos) e as bandeiras que ajudam a escolher — em "efeitos", `vale_para` diz se aquele efeito serve em vídeo ou só em imagem. É leitura pura: não precisa de projeto aberto e não muda nada.

**Campos:**
- `tipo` (obrigatório): string — um de: `efeitos`, `filtros`, `transicoes`, `animacoes`, `estilos_texto`, `estilos_legenda`, `looks`, `fontes`, `destaques`, `predefinicoes`, `templates` — Qual catálogo listar.

### `studio_desfazer`

DESFAZ os últimos passos no Studio — o mesmo Ctrl+Z do usuário, no mesmo histórico. É a sua rede de segurança: errou a edição, desfaz e refaz direito, em vez de tentar "editar de volta" (o que empilharia mais passos). A resposta diz quantos passos ANDARAM de verdade: pedir 5 quando só havia 2 desfaz 2 e avisa. Um lote do studio_editar costuma ser UM passo só. SÓ VALE NO PROJETO ABERTO no editor: o histórico de Ctrl+Z vive na tela. Para o que foi editado em segundo plano (editor fechado), a volta atrás é studio_snapshots + studio_restaurar.

**Campos:**
- `passos`: integer — Quantos passos desfazer (padrão 1, teto 20).

### `studio_refazer`

REFAZ o que foi desfeito no Studio (o Ctrl+Shift+Z do usuário). Só funciona enquanto nada novo foi editado depois do desfazer — editar apaga o caminho de volta. A resposta diz quantos passos andaram de verdade.

**Campos:**
- `passos`: integer — Quantos passos refazer (padrão 1, teto 20).

### `studio_snapshot`

SALVA um ponto de retorno do projeto no Studio — uma foto do documento inteiro, pra poder voltar depois. É o equivalente ao desfazer para quem edita com o editor FECHADO (o Ctrl+Z do studio_desfazer só existe no projeto aberto na tela). Use ANTES de uma mudança grande ou arriscada, e ponha um `rotulo` que descreva o estado ("antes de trocar as cenas"), porque é por ele que você vai reconhecer o ponto na lista. Todo lote do studio_editar em segundo plano já salva um "antes-do-lote" sozinho — este verbo é pros pontos que VOCÊ escolhe. Ficam os 20 mais novos por projeto; os mais velhos somem.

**Campos:**
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.
- `rotulo`: string — Como você vai reconhecer este ponto depois, ex.: "antes de trocar as cenas".

### `studio_snapshots`

LISTA os pontos de retorno salvos de um projeto do Studio, do mais novo pro mais velho, com `id`, `rotulo` e quando foram salvos. Chame ANTES do studio_restaurar — é daqui que sai o `id`. Os pontos "antes-do-lote" são os que o studio_editar salvou sozinho antes de cada lote em segundo plano. É leitura pura: não muda nada.

**Campos:**
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.

### `studio_restaurar`

VOLTA o projeto do Studio para um ponto salvo — o desfazer do bastidor. Substitui o documento inteiro pelo do snapshot, então TUDO que foi editado depois daquele ponto se perde: PERGUNTE ao usuário antes, sempre, e diga qual ponto (rotulo e hora) você vai restaurar. O `id` vem do studio_snapshots. Só funciona com o projeto FECHADO no editor: com ele aberto, o Studio tem o documento na memória e o salvamento automático dele jogaria a restauração fora — nesse caso, AVISE o usuário e feche o editor com studio_fechar (a última edição é salva antes), ou peça o Ctrl+Z na tela (ou use studio_desfazer, que é o histórico de verdade).

**Campos:**
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.
- `id` (obrigatório): string — O `id` do ponto salvo, como veio no studio_snapshots.

### `studio_importar_midia`

IMPORTA arquivos do computador do usuário para o projeto aberto no Studio: imagens (jpg, png, webp), vídeos (mp4, mov, webm) e áudios (mp3, wav, m4a). Os arquivos entram na "gaveta" de mídia do projeto e, se você pedir (na_timeline), já entram na timeline: imagens e vídeos viram cenas na trilha principal, áudios entram numa faixa nova. O arquivo NÃO É COPIADO: o projeto guarda o CAMINHO dele e toca direto de lá, então mover ou apagar o original deixa o clipe VERMELHO na timeline (e `midia_faltando: true` no studio_estado). Só arquivos que o usuário indicou, com o caminho COMPLETO — pastas do próprio app são recusadas, e um arquivo que falhar não derruba os outros (volta em `nao_importados` com o motivo). Máximo 20 por chamada. FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a mídia entra em SEGUNDO PLANO, sem tirar o usuário da tela em que ele está. Com isso a ESTEIRA INTEIRA roda sem tela — studio_criar_projeto → studio_importar_midia → studio_editar → studio_capturar → studio_exportar, do projeto vazio ao arquivo pronto, sem abrir o editor nenhuma vez (quem quiser ver, studio_abrir). Antes de cada lote em segundo plano o app salva sozinho um ponto "antes-do-lote", e um projeto só aceita UM chat por vez. Depois de importar: confira com studio_estado e VEJA com studio_capturar. Se um dos áudios for uma narração gerada aqui no app, vincule com studio_vincular_narracao ANTES de mexer nos destaques.

**Campos:**
- `caminhos` (obrigatório): array — Os caminhos COMPLETOS dos arquivos no computador do usuário.
- `na_timeline`: boolean — true = além de guardar na gaveta, já põe na timeline. Padrão: só guarda.
- `em_s`: number — Com na_timeline: em que segundo da régua o material entra (padrão: cenas no fim do vídeo, áudio no zero).
- `projeto`: string — Id ou NOME do projeto que recebe a mídia (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a importação roda em segundo plano.

### `studio_vincular_narracao`

VINCULA uma narração já pronta (a lista sai em narracoes_geradas) ao projeto aberto no Studio: as cenas são re-temporizadas para casar com a fala, as legendas entram com o tempo exato de cada palavra e o karaokê fica disponível. É o passo que dá RITMO ao vídeo — faça-o ANTES dos destaques e da direção, porque os dois se apoiam nas legendas que este verbo cria (sem elas, não há o que destacar). Repetir com o mesmo id RE-sincroniza em vez de duplicar. A resposta diz quantas cenas foram sincronizadas e quantas legendas existem agora — conte isso ao usuário em vez de dizer só "pronto". FUNCIONA COM O EDITOR FECHADO: mande `projeto` e a narração é vinculada em segundo plano (com a timeline vazia as cenas não são montadas — a resposta diz quantas falas ficaram sem cena).

**Campos:**
- `job_id` (obrigatório): string — O id da narração pronta, como veio em narracoes_geradas.
- `offset_s`: number — Em que segundo da régua a narração começa (padrão 0).
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a narração é vinculada em segundo plano.

### `studio_aplicar_template`

Aplica um TEMPLATE (bloco pronto de abertura/apresentação, com mídia, texto e som já montados) num ponto da régua do vídeo, exatamente como o clique no acervo do editor. Aceita o nome do template — nome ambíguo volta com os candidatos pra você PERGUNTAR ao usuário, nunca escolher por ele. O bloco vira UM item na timeline, que o usuário pode editar depois. Alguns moldes se montam sobre o que já existe (cenas ou legendas de fala naquele trecho): sem material ali, o verbo recusa e explica. Aplicar de novo no mesmo lugar SUBSTITUI o bloco anterior, nunca duplica. CAMPOS DE TEXTO: todo rótulo de fábrica ("CAPÍTULO", "TÓPICO", "PERFIL"…) é um LUGAR para o texto do roteiro — leia as chaves e a instrução em studio_catalogo {tipo:"templates"} e mande `campos`; a resposta lista em `campos.deFabrica` o que ficou sem texto (corrija). O template que mostra a FALA (campo "legenda") cobre a legenda padrão no trecho — o editor esconde a legenda ali sozinho, não duplique. FUNCIONA COM O EDITOR FECHADO: mande `projeto` e o bloco é montado em segundo plano.

**Campos:**
- `template` (obrigatório): string — Nome (ou id) do template do acervo.
- `em_s` (obrigatório): number — Em que segundo da régua o bloco entra.
- `duracao_s`: number — Somente para templates Avatar: janela explícita desde em_s. Pode atravessar cenas e clipes Avatar adjacentes, sem preencher lacunas ou alterar a duração das fontes. Omitir usa a janela automática do Avatar/cena.
- `campos`: object — O texto de cada campo do template pela CHAVE (rótulo de fábrica como "CAPÍTULO", ou "legenda"/"legenda:1" para o rótulo de fala). As chaves e a instrução de cada campo vêm de studio_catalogo {tipo:"templates"}. Rótulo de fábrica NÃO é conteúdo: mande o texto do roteiro.
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO o template é montado em segundo plano.

### `studio_aplicar_direcao`

Aplica uma PREDEFINIÇÃO DE EDIÇÃO no vídeo inteiro: é a "direção editorial" do editor — destaques, blocos prontos, transições entre cenas, efeitos de movimento, entradas/saídas e filtro de cor, tudo de uma vez e coerente entre si. Aceita o nome da predefinição (as do sistema e as que o usuário salvou). É a maneira mais rápida de dar acabamento a um vídeo cru — faça DEPOIS de ter as cenas e a narração no lugar. O editor VALIDA o plano antes de encostar na timeline: plano reprovado não muda nada e volta com o motivo. Tudo entra num passo só de desfazer. PERGUNTE ao usuário qual predefinição ele quer: é decisão de gosto, não sua. FUNCIONA COM O EDITOR FECHADO: mande `projeto` e a direção é aplicada em segundo plano.

**Campos:**
- `predef`: string — Nome (ou id) da predefinição de edição.
- `definicao`: object — Predefinição INLINE (V3: intensidade, conjuntos, eixos) aplicada sem salvar — alternativa a `predef`.
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.

### `matriz`

A MATRIZ DE EDIÇÃO do editor (Studio): o método que você segue para editar sem se perder — o que ler, em que ordem chamar os verbos studio_*, os conjuntos de ids que combinam e o que conferir antes de entregar. Para QUALQUER trabalho no editor, chame {tema: "indice"} ANTES do primeiro verbo studio_* (uma vez por conversa) e siga o fluxo que o índice indicar para a sua tarefa. Para PRODUZIR um vídeo do título ao render (roteiro → narração → prompts → mídia → edição), leia {tema: "producao"} ANTES do primeiro passo. Depois leia só os temas que a tarefa pedir: "fluxo_edicao" (edição completa com predefinição), "fluxo_comando" (um pedido direto: movimento em todas, overlays em 30%…), "projetos" (mais de um projeto / retomar), "roteiro_destaques", "templates", "movimento", "overlays", "transicoes", "animacoes", "predefinicoes", "verbos" (todos os verbos com campos), "contrato" (regras e vocabulário dos destaques), "conferencia", "recusas" (cada motivo de recusa → causa → correção) e "conjuntos" (com `id`: transicoes | animacoes | movimento | overlays | destaques — JSON com os ids que combinam). Os textos estão em português; traduza para o usuário se a conversa for noutro idioma. É leitura pura: não muda nada.

**Campos:**
- `tema` (obrigatório): string — um de: `indice`, `producao`, `fluxo_edicao`, `fluxo_comando`, `projetos`, `roteiro_destaques`, `templates`, `movimento`, `overlays`, `avatar`, `transicoes`, `animacoes`, `predefinicoes`, `verbos`, `contrato`, `conferencia`, `recusas`, `conjuntos` — Qual tema ler (comece por "indice").
- `id`: string — Só com tema "conjuntos": qual conjunto (transicoes, animacoes, movimento, overlays, destaques, intensidade).

### `studio_plano`

O REGISTRO de um vídeo em andamento no editor (Studio): identidade (nome, canal, predefinição, idioma), os passos (narracao → sincronia → direcao → destaques → conferencia → export) com status e nota, e observações. É como você RETOMA de onde parou — nesta ou noutra conversa: "ler" {projeto} ANTES de mexer num projeto (devolve o registro, ou existe:false, e o `proximo_passo`); "gravar" {projeto, nome?, canal?, predefinicao?, idioma?, observacao?} ao começar e a cada decisão; "passo" {projeto, passo, status: feito|pulado|pendente, nota?} ao concluir cada etapa; "listar" mostra os projetos em andamento com o próximo passo de cada um. SEMPRE pelo ID do projeto (studio_projetos) — nunca pelo nome. O registro vive na pasta DarkPlanner do usuário (matriz\projetos) e não muda a timeline. Divergência entre o registro e o studio_estado (o usuário editou na mão) = informe e siga do documento, atualizando o registro.

**Campos:**
- `acao` (obrigatório): string — um de: `ler`, `gravar`, `passo`, `listar` — O que fazer.
- `projeto`: string — O ID do projeto do Studio (studio_projetos). Obrigatório fora de "listar".
- `nome`: string — gravar: o nome do projeto/vídeo (como o usuário chama).
- `canal`: string — gravar: o canal, se houver.
- `predefinicao`: string — gravar: a predefinição escolhida (nome).
- `idioma`: string — gravar: o idioma do roteiro (pt, en, es…).
- `observacao`: string — gravar: uma linha datada anexada às observações (decisão, aviso ao usuário, o que ficou de fora).
- `passo`: string — um de: `narracao`, `sincronia`, `direcao`, `destaques`, `conferencia`, `export` — passo: qual etapa.
- `status`: string — um de: `feito`, `pulado`, `pendente` — passo: o estado da etapa.
- `nota`: string — passo: o que aconteceu (ex.: "12 destaques, 2 descartes").

### `studio_predefinicao`

A PREDEFINIÇÃO de edição (direção editorial) por nome, na forma V3: `intensidade` (0..100: 20 calmo · 50 equilibrado · 75 dinâmico · 95 muito dinâmico — deriva ritmo, densidade e a frequência de cada eixo), `conjuntos` por eixo (transicoes, animacoes, movimento, overlays — os ids estão em matriz {tema:"conjuntos"}), e os eixos com `pct` e itens (destaques com kit e densidade, templates, efeitos, overlays com maxPorCena, transicoes, entradas/saidas, pares com modo livre|pares|alternado, filtros, cores). AÇÕES: "listar" (sistema + do usuário, com o resumo dos eixos); "ler" {nome} (o modelo inteiro + cobertura do kit + problemas); "criar" {predef, base?} (valida ids contra os catálogos e RECUSA id fantasma; `base` copia uma existente); "atualizar" {nome, patch}; "excluir" {nome, confirmacao:true}; "simular" {nome | predef, projeto?} (o que a direção faria neste projeto — contagens por eixo, destaques por papel, cobertura, avisos — SEM tocar na timeline: mostre ao usuário em uma linha antes de aplicar); "aplicar" {nome | predef, projeto?} (= studio_aplicar_direcao; re-sorteia os destaques automáticos — avise). Traduzir um pedido de clima ("mais calma", "só fades", "poucos destaques") em predefinição está em matriz {tema: "predefinicoes"}. As do sistema não se editam. FUNCIONA COM O EDITOR FECHADO (mande `projeto` em simular/aplicar).

**Campos:**
- `acao` (obrigatório): string — um de: `listar`, `ler`, `criar`, `atualizar`, `excluir`, `simular`, `aplicar` — O que fazer.
- `nome`: string — Nome (ou id) da predefinição — em ler/atualizar/excluir/simular/aplicar.
- `projeto`: string — Id ou NOME do projeto (simular/aplicar). Sem ele, vale o que estiver aberto no Studio.
- `predef`: object — A definição: em "criar" é a predefinição nova; em "simular"/"aplicar" é uma definição INLINE (sem salvar).
- `base`: string — Só em "criar": copia esta predefinição (nome ou id) e aplica `predef` por cima.
- `patch`: object — Só em "atualizar": os campos a mudar (mesma forma de `predef`).
- `seed`: string — Só em simular/aplicar: semente determinística.
- `confirmacao`: boolean — Só em "excluir": true depois de o usuário confirmar na conversa.

### `consultar_biblioteca`

A BIBLIOTECA dos destaques do vídeo: o que cada estilo é, quando usar, quando NÃO usar, quantas palavras aceita, que papel cumpre na narrativa — mais as regras de ritmo/tempo, os catálogos de transição, efeito e filtro, as predefinições e o esquema exato da proposta. É a fonte da verdade de studio_destaques na ação "inteligente". FLUXO: leia o ÍNDICE PRIMEIRO ({indice: true}) — UMA vez por conversa basta, ele foi feito para caber no seu contexto e traz uma linha por estilo (id, categoria, papel, faixa de palavras, para que serve), o esquema da proposta e os motivos de recusa. Escolha os estilos e os blocos POR ELE. Só então aprofunde, e só no que você realmente vai usar: {id: "glow_01"} traz o contrato completo daquele estilo (ou de um template, item de catálogo ou predefinição), {secao: "rules"} traz um capítulo do contrato. NUNCA chute um id: os ids vivem no índice, e id inventado vira descarte. As seções são: purpose, glossary, v2, roles, subtypes, colorSystem, guidance, rules, catalogs, presets, intake. `catalogs` é grande — use `parte` para recortar ("transitions", "effects", "entrances", "filters"). A biblioteca está em INGLÊS (os rótulos e amostras dos estilos são em português): traduza para o usuário, não devolva o jargão cru. É leitura pura: não precisa de projeto aberto e não muda nada no editor.

**Campos:**
- `indice`: boolean — true = o ÍNDICE inteiro (comece SEMPRE por aqui; uma vez por conversa basta).
- `id`: string — Id de UM item para aprofundar (estilo de destaque, template, item de catálogo ou predefinição) — o id vem do índice.
- `secao`: string — um de: `purpose`, `glossary`, `v2`, `roles`, `subtypes`, `colorSystem`, `guidance`, `rules`, `catalogs`, `presets`, `intake` — Um capítulo do contrato completo (rules = as regras de seleção/tempo/texto; intake = o esquema da proposta e os motivos de recusa).
- `parte`: string — Só com `secao`: a sub-chave a recortar (ex.: secao "catalogs", parte "transitions").

### `studio_destaques`

Mexe nos DESTAQUES do vídeo — as palavras e frases que aparecem grandes na tela, com animação e som, em cima da fala. Quatro ações: "sortear" analisa as LEGENDAS DE FALA do projeto e escolhe sozinho o que merece destaque (só funciona se houver fala: vincule a narração antes, com studio_vincular_narracao); "importar_srt" transforma CADA bloco de um arquivo .srt que o usuário te deu num destaque, no tempo do arquivo; "limpar" apaga todos os destaques do projeto — e como isso é destrutivo, só passa depois de o usuário CONFIRMAR na conversa, com confirmacao: true. Sortear de novo re-sorteia tudo, e o que o usuário tinha ajustado à mão nos destaques anteriores se perde — avise ANTES de sortear pela segunda vez. ANTES de propor na ação "inteligente", LEIA consultar_biblioteca {indice: true}: os estilos que existem (com o que cada um é, a faixa de palavras e o quando NÃO usar), os papéis, o esquema exato da proposta e os motivos de recusa estão todos lá — propor sem ler o índice é chutar, e chute volta como `descartes`. "inteligente" é VOCÊ escolhendo em vez do sorteio: mande `propostas` por bloco de fala ({ blocoId, estilo, texto?, campos?, palavra?, palavraIdx?, pos?, tam? }); o tempo você NUNCA propõe — o motor de regras recalcula início/fim pela fala e recusa o que não cabe. A resposta traz `criados` e `descartes` com o motivo de cada recusa: corrija e reenvie os descartados. "validar" é o ENSAIO A SECO da "inteligente": as mesmas propostas, os mesmos motivos de recusa, SEM tocar na timeline — use antes de aplicar e só mande "inteligente" com zero descartes. Os ids de estilo vêm do catálogo do editor (não invente); os ids dos blocos vêm do studio_estado nivel "clipes", tipo "legenda". FUNCIONA COM O EDITOR FECHADO: mande `projeto` e tudo roda nos bastidores (a resposta vem com bastidor: true).

**Campos:**
- `acao` (obrigatório): string — um de: `sortear`, `importar_srt`, `limpar`, `inteligente`, `validar` — O que fazer com os destaques.
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO tudo roda em segundo plano.
- `propostas`: array — Nas ações "inteligente" e "validar": uma proposta por bloco de fala — { blocoId | blocoIds (vizinhos que viram UM destaque), estilo, texto?, campos?, palavra?, palavraIdx?, pos?, tam? }. Texto autoral precisa de `palavra` (a âncora na fala). Máximo 60 por chamada.
- `opcoes`: object — Só em "inteligente"/"validar". Por padrão o universo vem da PREDEFINIÇÃO ativa do projeto (kit marcado = estrito).
  - `substituir_lote`: boolean — true = remove o lote automático anterior (como o botão Inteligentes) antes de aplicar; padrão false (convive com o que já está).
  - `seed`: string — Semente determinística (mesma semente, mesmo resultado).
  - `universo_estrito`: boolean — true = só os estilos do kit da predefinição; false = qualquer estilo automático.
  - `estilos`: array — Kit explícito de estilos permitidos (sobrepõe o da predefinição).
- `config`: object — Só em "sortear": ajustes deste sorteio (não mudam o gosto salvo do usuário).
  - `densidade`: string (minimal | equilibrado | dinamico | maximo) — Quantos destaques por minuto de vídeo.
  - `estilos`: array — Os estilos de destaque permitidos neste sorteio.
- `srt`: string — Só em "importar_srt": o CONTEÚDO do arquivo .srt (cada bloco vira um destaque).
- `confirmacao`: boolean — Só em "limpar", e SÓ depois de o usuário confirmar na conversa.

### `studio_exportar`

EXPORTA um projeto do Studio como um arquivo de vídeo .mp4. Funciona nos DOIS modos: com o projeto ABERTO no editor (sem `projeto`, é o projeto da tela) e TAMBÉM em SEGUNDO PLANO, com o editor fechado — nesse caso mande `projeto` (id ou nome) e o vídeo é montado e enfileirado sem abrir tela nenhuma. É isso que permite tocar vários vídeos em paralelo: criar (studio_criar_projeto), montar e exportar cada um pelos bastidores. O arquivo cai na pasta do projeto do usuário (a mesma que o botão Exportar sugere) e NUNCA sobrescreve um arquivo existente: se o nome já estiver ocupado, o novo sai com um número no fim — quando isso acontecer, conte ao usuário. A DURAÇÃO do vídeo é a do item que termina MAIS TARDE na timeline — um áudio maior que as cenas ESTICA o vídeo (fim congelado) em vez de ser cortado. Antes de exportar, confira a duração no studio_estado e, se o áudio passar das cenas, apare-o com studio_editar aparar_direita (ou avise o usuário e pergunte o que ele prefere). O export é ASSÍNCRONO: este verbo devolve { na_fila: true, destino } na hora e o vídeo ainda está sendo feito. ACOMPANHE NO MESMO TURNO com studio_fila esperar_s=25, repetindo até o item sair de "renderizando", e a cada volta chame informar_progresso com UMA linha curta ("exportando 40%…") — nunca encerre o turno prometendo conferir depois, você não acorda sozinho. Só diga que o vídeo está pronto quando a fila disser "concluido". MÍDIA QUE SUMIU DO DISCO: as mídias do projeto são REFERÊNCIAS ao arquivo original do usuário — se ele apagou ou moveu algum, o verbo RECUSA a exportação e devolve a lista. Nesse caso PERGUNTE ao usuário se ele quer repor os arquivos ou exportar assim mesmo (aqueles trechos saem PRETOS) e só reenvie com continuar_sem_midias: true se ele confirmar. ANTES de exportar, VEJA o resultado com studio_capturar (ele também funciona com o editor fechado): exportar um vídeo errado gasta minutos da máquina do usuário. Se a resposta trouxer `avisos`, REPASSE ao usuário: são diferenças reais do vídeo que saiu (ex.: legenda de karaokê sem a pintura palavra a palavra), não recado interno. CANCELADO É ORDEM: se o item aparecer como "cancelado" na fila e não foi VOCÊ quem cancelou, foi o USUÁRIO — isso é uma ORDEM dele. NUNCA reenfileire, nunca re-exporte, nunca "tente de novo": pergunte a ele o que quer fazer. O "acompanhe até concluir" vale para o vídeo que está sendo feito, nunca para ressuscitar um cancelado.

**Campos:**
- `projeto`: string — Id ou NOME do projeto a exportar (studio_projetos lista os dois). Ausente = o projeto aberto no editor. Com o editor fechado, ou aberto em OUTRO projeto, o export roda em segundo plano.
- `resolucao`: string — um de: `720p`, `1080p`, `2k`, `4k` — Tamanho do vídeo final (padrão 1080p). 4K demora bem mais.
- `qualidade`: string — um de: `rapido`, `alta` — "rapido" (padrão) ou "alta" (arquivo maior, render mais demorado).
- `nome`: string — Nome do ARQUIVO, sem pasta e sem extensão (ex.: "episodio-03"). Ausente = o nome do projeto.
- `pasta`: string — Opcional. Pasta de DESTINO, caminho completo (na produção de canal: <pasta do canal>\videos\NN-slug\final). Ausente = a pasta de exports do projeto.
- `continuar_sem_midias`: boolean — Exportar MESMO com mídias que sumiram do disco (esses trechos saem pretos). Só depois de o usuário confirmar na conversa — nunca por iniciativa sua.

### `studio_fila`

Mostra a FILA DE EXPORTAÇÃO do app: cada vídeo que está sendo gerado ou já saiu, com nome, situação ("aguardando", "renderizando", "concluido", "cancelado", "erro"), em que fase está, a porcentagem e, quando termina, o CAMINHO do arquivo — é esse caminho que você registra no canal. Funciona mesmo com o editor fechado. USE COM esperar_s=25 depois de studio_exportar: o verbo segura a resposta aqui dentro enquanto ainda houver vídeo sendo feito, e a cada volta você chama informar_progresso com UMA linha curta (ela se sobrescreve; mensagem a cada checagem vira uma bolha nova). Nunca encerre o turno prometendo conferir depois. A ação "cancelar" ABORTA o vídeo que está sendo exportado agora e joga fora os minutos de máquina já gastos: é DESTRUTIVA e só pode ser usada depois de o usuário PEDIR ou CONFIRMAR o cancelamento na conversa — nunca por iniciativa sua, nem "pra tentar de novo mais rápido". Sem ação, o verbo só lê. ITEM "cancelado" QUE VOCÊ NÃO CANCELOU = o USUÁRIO cancelou, e isso é ORDEM: NUNCA reenfileire nem re-exporte aquele vídeo (o item vem com a nota "cancelado pelo usuário — não reenfileire"). Pare, conte o que aconteceu e PERGUNTE a ele o que quer fazer.

**Campos:**
- `acao`: string — um de: `cancelar` — Só "cancelar" (o vídeo em andamento), e SÓ depois de o usuário confirmar na conversa. Ausente = apenas ler a fila.
- `esperar_s`: integer — Segundos de espera DENTRO da chamada (máx 25) até a fila não ter mais nada em andamento. Esgotado o tempo, devolve a fila do jeito que está, sem erro — chame de novo. Ausente = responde na hora.

### `studio_avatar`

GERA os vídeos de AVATAR falante (HeyGen) das cenas RESERVADAS e PREENCHE a timeline com eles. É o passo que fecha o avatar: primeiro você RESERVA as cenas com studio_editar (op reservar_avatar, endereçando o avatar por nome); depois este verbo. Três ações: "gerar" — junta as cenas reservadas + a narração do projeto, recorta o áudio e dispara os jobs no HeyGen (devolve job_id e o modo escolhido); as cenas passam a pulsar em azul (gerando). "status" — acompanha a fila. USE COM esperar_s=25: o verbo segura a resposta enquanto ainda estiver "gerando"/"baixando", e a cada volta você chama informar_progresso com UMA linha curta (ela se sobrescreve) — a geração leva MINUTOS (acompanhe pela porcentagem real que o "status" devolve), então nunca encerre o turno prometendo conferir depois. "preencher" — quando o status virar "pronto", cola os vídeos nas cenas (cada lacuna vira cena de vídeo do avatar). A narração PRECISA existir (a fala do avatar sai dela). Funciona com o editor aberto ou fechado.

**Campos:**
- `projeto`: string — Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que está aberto no Studio.
- `acao` (obrigatório): string — um de: `gerar`, `status`, `preencher`, `midias`, `prontos` — prontos lista os vídeos completos disponíveis no histórico, sem gerar nem aplicar; para usar um deles na faixa Avatar, chame studio_editar op adicionar_avatar pelo nome e modo inteiro/distribuir (matriz tema avatar). gerar dispara os vídeos; status acompanha a fila; preencher cola os prontos FULLSCREEN nas cenas reservadas; midias põe os recortes prontos no BIN do projeto SEM colar — para compor em camada/template pelo mapa temporal retornado. Recortes e concatenações não são fontes integrais sincronizadas desde zero.
- `modo`: string — um de: `A`, `B`, `C` — OPCIONAL, só no "gerar": força o modo de áudio (A = 1 job por trecho; B = narração inteira; C = trechos concatenados num job). Ausente = o app decide pela heurística (documentada em docs/HEYGEN.md).
- `job_id`: string — OPCIONAL, só no "preencher": o job a colar (o "gerar" devolve job_id). Ausente = o job mais recente do projeto — com DUAS gerações no mesmo projeto, mire o job certo por aqui. A resposta traz `falhadas` (cenas cujo vídeo falhou; voltaram a "reservado" — gere de novo) e `desalinhadas` (cenas movidas/redimensionadas DEPOIS de gerar; o áudio é o de onde estavam — regere essas).
- `esperar_s`: integer — Só no "status": segundos de espera DENTRO da chamada (máx 25) até sair de "gerando"/"baixando". Esgotado o tempo, devolve o status do jeito que está, sem erro — chame de novo. Ausente = responde na hora.

### `narracoes_geradas`

Lista as narrações já geradas (inclusive as feitas no site e espelhadas): título, voz, status, arquivo, pasta, se tem SRT. Devolve também "dir", a pasta absoluta onde os áudios vivem no disco — use quando o usuário quiser abrir/mover os arquivos. O roteiro completo NÃO vem nesta lista (pode ter 150k chars): para lê-lo, chame status_narracao com o job_id. arquivo_removido:true = a entrada existe mas o áudio sumiu do disco.

**Campos:** nenhum.

### `guia_canal`

Devolve o PLAYBOOK de como conduzir o canal de vídeos do usuário: as regras de conversa, as perguntas de abertura, o pipeline de um vídeo (roteiro → narração → prompts → geração → montagem) e como retomar em conversa nova. CHAME ANTES de criar um canal ou de conduzir qualquer trabalho de canal — é o manual do fluxo, e seguir de memória faz pular passo. NÃO chame em conversa que não é sobre canal (é texto longo, custa cota do usuário à toa).

**Campos:** nenhum.

### `estado_do_canal`

FONTE DA VERDADE do canal — chame SEMPRE ao retomar ("vídeo do canal X") antes de perguntar qualquer coisa, e nunca refaça a abertura para um canal que existe. Devolve: identidade (narrador, regras, agentes por papel), a configuração de "narracao" já pronta para repassar ao gerar_narracao, a de "geracao" (de onde saem as TAGS dos prompts e o nº de variações que você confere com config_de_geracao antes de enviar), a de "edicao" (o ESTILO DE EDIÇÃO do canal — leia ANTES de montar, junto com a skills\edicao.md, em vez de escolher tipografia, transição e densidade do zero), as skills que o usuário tem (inclusive organizacao.md, que descreve onde os arquivos vão), os arquivos de cada pasta de vídeo, os vídeos e o que está PELA METADE (ex.: roteiro sem narração) com o próximo passo de cada um, e os últimos registros da memória. O que vale é o que foi REGISTRADO (registrar_no_canal); a varredura das pastas só cobre vídeo que ninguém registrou — cada vídeo diz em "origem" de onde veio. Nome parecido resolve sozinho; ambíguo devolve os candidatos para você PERGUNTAR. O que vem daqui vence a sua lembrança da conversa.

**Campos:**
- `canal` (obrigatório): string — Nome do canal como o usuário falou (aceita parcial: "galinha" acha "Galinha Pintadinha").

## Demais verbos do app (38) — uma linha cada

- `listar_projetos` — Lista todos os projetos do Creator (id, nome, status, conta vinculada, pasta de saída, prioridade, pausado).
- `criar_projeto` — Cria um projeto novo no Creator.
- `contas_disponiveis` — Contas Google que podem receber jobs: [{ account_id (o e-mail), status: active|quota_reached|reconnect|disabled, can_generate, cooldown_minutes }].
- `diagnosticar` — Diagnóstico completo do app numa chamada — use SEMPRE que o usuário disser que "travou", "não está gerando" ou "deu erro": workers/orquestrador/extensão/disco, contas (status, can_generate, cooldown_minutes), fila por st
- `logs_recentes` — Os últimos eventos da tela Logs do app, com contexto (projeto, job, conta mascarada, tipo, provedor): job iniciado/gerando/pronto/falhou (com o código do erro), cooldown de conta, sessão expirada, fila pausada/retomada, 
- `listar_jobs` — Lista os jobs (imagens/vídeos) de um projeto com status: pending | processing | done | failed | deleted.
- `excluir_jobs` — Manda VÁRIOS jobs de uma vez para a lixeira do projeto (restaurável pela tela) — o mesmo que o DELETE /api/jobs/{id} um a um, sem 70 chamadas.
- `detalhe_job` — Detalhe de UM job: status, error, media_id, file_path, tipo e datas.
- `enviar_prompts_texto` — Envia prompts para um projeto ESCREVENDO NA TELA do Creator — o texto entra no campo de prompts exatamente como o usuário colaria, e o app aplica TODAS as regras da tela (tags [i]/[v]/[iv], aspecto, modelos, qualidade, i
- `config_de_geracao` — SÓ LEITURA: o que a TELA do Creator aplicaria num envio AGORA — o MOTOR (quem gera, no vocabulário das tags) e quais motores esta tela oferece (`motores_disponiveis`), variações (cópias) por prompt, modelo e aspecto de i
- `configurar_geracao` — APLICA na TELA do Creator os ajustes que o usuário confirmou (o irmão que escreve do config_de_geracao): o MOTOR (quem gera), variações (cópias) por prompt, imagens por geração, tipo padrão, qualidade, aspecto, duração, 
- `plano_conversa` — CHECKLIST DE FASES na conversa (card que o usuário vê): todo trabalho com MAIS DE UMA fase começa por aqui — as fases na ordem, o que já existe na pasta (materiais) e as estimativas — e é ATUALIZADO a cada fase fechada (
- `reenviar_prompt_do_job` — Reescreve o prompt de um job (normalmente um que FALHOU) e o re-enfileira, mantendo params originais e a posição no grid.
- `mudar_numero_do_item` — Muda o NÚMERO (a posição) de um item do projeto — é esse número que ordena as mídias e casa cada uma com o trecho da narração na hora de montar o vídeo.
- `listar_vozes_tts` — Catálogo de vozes do gerador de narração do Studio (TTS), com id e nome de cada uma.
- `cota_narracao` — Cota do TTS ANTES de gastar: { used_today, limit, remaining, can_generate, plan_type, max_characters_per_audio }.
- `gerar_narracao` — Gera uma narração (TTS) no Studio a partir de um roteiro.
- `status_narracao` — Estado de uma narração: { status: processing | done | error | unknown, job, detail }.
- `consultar_docs` — Documentação viva do Dark Planner em markdown, em dois temas: "api" (padrão) = guia COMPLETO da API interna — rotas, catálogo atual de modelos, vozes, receitas passo a passo, gotchas e a seção de suporte (diagnóstico, re
- `pausar_fila` — PARA a esteira GLOBAL de geração — TODOS os projetos param de despachar (o que já está rodando termina).
- `retomar_fila` — Volta a despachar jobs — a partir daqui o app gera e GASTA CRÉDITO do Google.
- `pausar_projeto` — Pausa UM projeto: os jobs DELE param de ser despachados e o resto do app segue gerando normal.
- `retomar_projeto` — Volta a despachar os jobs de UM projeto pausado — a partir daí ele gera e GASTA CRÉDITO de novo.
- `reprocessar_job` — Manda um job que FALHOU de volta pra fila com os mesmos params.
- `cancelar_job` — Cancela um job (vira "falhou"), inclusive se estiver preso em processing.
- `destravar_jobs` — Auto-cura dos jobs presos em processing há 10+ min (os que o diagnosticar lista em possiveis_travados): cancela e re-enfileira cada um.
- `reprocessar_falhos` — Re-enfileira TODOS os jobs com erro de um projeto.
- `liberar_cooldown` — Tira uma conta do cooldown NA HORA e volta a usá-la.
- `ativar_conta` — Deixa uma conta disponível pro dispatch de novo (status active) e sobe o worker dela.
- `desativar_conta` — Tira uma conta do dispatch (status disabled) e para o worker dela na hora — jobs pendentes dela vão pras outras contas.
- `testar_proxy` — Testa se um proxy alcança o Google e mostra o IP de saída.
- `alterar_config` — Muda uma configuração OPERACIONAL do app (as mesmas da tela Configurações que o usuário mexe no dia a dia): job_dispatch_delay (segundos entre despachos, "5" ou "5-15"), max_concurrent_per_account (paralelismo por conta)
- `chamar_api` — Chama as rotas da API do Dark Planner documentadas no consultar_docs, já autenticada — é por aqui que você opera o que não tem verbo próprio.
- `listar_canais` — Lista os canais que o usuário já tem cadastrados: [{ nome, slug, pasta, criado_em }].
- `criar_canal` — Cria a pasta de um canal novo (canal.md, estado.json, memoria.md, a pasta skills/ já com a skill de organização padrão e a pasta videos/, onde cada vídeo ganha a sua NN-slug/) e registra o ponteiro no app.
- `adicionar_videos_ao_canal` — Coloca TÍTULOS na fila do canal: cria uma pasta videos\NN-slug\ por título (numeração continua da última) e guarda o título no estado — é o que deixa o usuário entregar dez títulos e dizer "produz".
- `registrar_no_canal` — Fecha um passo do vídeo: grava o passo e o arquivo no estado do canal e apenda uma linha datada na memória dele.
- `atualizar_edicao_do_canal` — O canal APRENDE com a aprovação: quando o usuário aprova a montagem ("ficou ótimo", "pode exportar") ou pede uma correção de ESTILO ("menos zoom", "fonte maior", "não gostei dessa transição"), grave aquilo como o padrão 

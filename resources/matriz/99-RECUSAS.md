# 99 — RECUSAS (gerado — não edite à mão)

Cada motivo que o editor pode devolver em `descartes`, `rejeitadas` ou `problemas`, com a CAUSA e o que FAZER. Recusa não é erro do verbo: é o motor protegendo o vídeo. Leia, corrija e reenvie só o que foi recusado — nunca reaplique o lote inteiro.


## plano-destaques

- **"bloco de fala inexistente"** — causa: o blocoId não é uma legenda de fala deste projeto. Faça: releia `studio_estado nivel "roteiro"` e use o `id` do bloco como veio.
- **"bloco de fala inexistente no grupo"** — causa: um dos blocoIds do grupo não existe. Faça: monte `blocoIds` só com ids vizinhos do mesmo `grupo` do roteiro.
- **"grupo com vão maior que 1,2 s entre blocos"** — causa: os blocos do grupo não são vizinhos (há silêncio maior que 1,2 s). Faça: use um bloco só, ou blocos do mesmo `grupo`.
- **"bloco do grupo já recebeu destaque nesta proposta"** — causa: o mesmo bloco aparece em duas propostas do lote. Faça: uma proposta por bloco (ou grupo).
- **"bloco já recebeu destaque nesta proposta"** — causa: o mesmo blocoId aparece duas vezes no lote. Faça: remova a duplicata.
- **"estilo desconhecido"** — causa: o id de estilo não existe no catálogo. Faça: pegue o id em `studio_catalogo {tipo:"destaques"}` ou no índice de `consultar_biblioteca`.
- **"estilo só-manual (fora do sorteio e da IA)"** — causa: o estilo é reservado ao editor humano. Faça: escolha outro estilo da mesma categoria com `automatico: true`.
- **"estilo fora da predefinição ativa"** — causa: o universo é estrito e o estilo não está no kit da predefinição. Faça: use um estilo do kit (`studio_estado resumo` → predefinicao; kit em `studio_catalogo predefinicoes`) ou mande `opcoes.universo_estrito: false` só se o usuário pediu sair da predefinição.
- **"estilo exclusivo de"** — causa: o estilo só serve para um sinal (ano, número, bíblia…) que o bloco não tem. Faça: confira os `sinais` do bloco no roteiro e troque o estilo ou o bloco.
- **"já no teto do vídeo"** — causa: o estilo já atingiu o máximo de usos no vídeo inteiro (o que já está na timeline conta; lotes não zeram o histórico). Faça: varie entre estilos COMPATÍVEIS do kit; sem candidato adequado, não adicione.
- **"traz um número ("** — causa: um campo numérico da proposta (ex.: dado: "42%") não aparece na fala do bloco — dado inventado. Faça: use o número exatamente como dito no trecho (com decimal e unidade); sem dado na fala, não use estilo de dado.
- **"subtipo proibido pelo estilo (subNao)"** — causa: o bloco carrega um sinal que esse estilo proíbe. Faça: troque o estilo por um da mesma categoria sem essa proibição.
- **"estilo de info só para"** — causa: estilo de informação (ano/número/dinheiro…) num bloco sem esse dado. Faça: use-o só em blocos cujo `sinais` traz o subtipo pedido.
- **"texto vazio"** — causa: a proposta ficou sem texto e o bloco não tem fala aproveitável. Faça: mande `texto` curto ou aponte um bloco com fala.
- **"texto fora do alcance do estilo"** — causa: o texto tem mais (ou menos) palavras que a faixa do estilo. Faça: encurte para a faixa `palavras` do estilo (catálogo/índice) — o motor NÃO corta por você.
- **"não é dita neste bloco"** — causa: a `palavra` de âncora não aparece no word JSON desse bloco. Faça: use uma palavra realmente dita no bloco (texto do roteiro), com a grafia falada.
- **"texto autoral sem âncora na fala"** — causa: texto inventado num bloco longo, sem nenhuma palavra dita para ancorar. Faça: comece o texto com palavras ditas no trecho, ou informe `palavra`/`palavraIdx`.

## agenda

- **"fora do universo"** — causa: candidato do sorteio fora do kit da predefinição (universo estrito). Faça: nada a fazer na proposta — é o sorteio respeitando a predefinição.
- **"orcamento/gap"** — causa: o orçamento de destaques por papel/densidade acabou, ou o vão mínimo entre destaques não foi respeitado. Faça: reduza propostas no trecho, ou suba a densidade da predefinição se o usuário quiser mais.
- **"sem estilo compatível"** — causa: nenhum estilo permitido serve para o papel/sinal do candidato. Faça: amplie o kit da predefinição ou troque o papel.

## regras-tempo

- **"colisão de tela"** — causa: o destaque não cabe sem invadir um destaque FIXO (manual ou já existente). Faça: proponha noutro bloco, ou remova o destaque existente com `studio_editar` se o usuário autorizou.
- **"texto vazio"** — causa: o evento chegou sem texto. Faça: mande `texto` ou aponte um bloco com fala.

## plano

- **"não existe"** — causa: o plano cita uma cena que não está na timeline. Faça: releia `studio_estado nivel "clipes"` antes de aplicar a direção.
- **"junção de cena inexistente"** — causa: o plano cita uma junção (cena → próxima) que não existe. Faça: releia as cenas; a última cena não tem junção.
- **"animDurS fora da faixa"** — causa: duração de animação fora do que a cena comporta. Faça: o motor recalcula; se persistir, escolha animações mais curtas.
- **"efeito desconhecido"** — causa: id de efeito inexistente. Faça: `studio_catalogo {tipo:"efeitos"}`.
- **"anim desconhecida"** — causa: id de animação inexistente. Faça: `studio_catalogo {tipo:"animacoes"}`.
- **"transição na última cena"** — causa: a última cena não tem junção seguinte. Faça: não proponha transição de saída na última cena.
- **"transição desconhecida"** — causa: id de transição inexistente. Faça: `studio_catalogo {tipo:"transicoes"}`.
- **"template manual-only no plano"** — causa: template reservado ao editor humano. Faça: escolha um template automático (`studio_catalogo {tipo:"templates"}` + índice).
- **"com cena inexistente"** — causa: o template aponta para cena que não existe. Faça: releia as cenas.
- **"sobrepõe composto existente"** — causa: o template cairia sobre um bloco já aplicado. Faça: escolha outro tempo, ou remova o composto se o usuário autorizou.
- **"templates sobrepostos"** — causa: dois templates no mesmo trecho. Faça: um template por trecho.
- **"template Avatar desconhecido"** — causa: o ID não pertence ao catálogo de apresentações Avatar. Faça: consulte os templates com alvo avatar e escolha um ID existente.
- **"sem janela aplicável"** — causa: faltam Avatar, cena principal ou duração de ao menos um frame no intervalo. Faça: consulte as faixas e use somente a interseção disponível, sem alongar a mídia.
- **"template Avatar ${tp.templateId}:"** — causa: a fonte ou a cobertura temporal do layout não coincide com o Avatar e a cena principal. Faça: releia os intervalos e a avatarSourceKey; corrija apenas o layout recusado.
- **"templates Avatar sobrepostos"** — causa: duas apresentações Avatar ocupam os mesmos frames. Faça: preserve os ajustes manuais e escolha uma janela livre; substituição explícita só ocorre dentro da mesma classe.

## predefs-edicao

- **"no catálogo"** — causa: a predefinição cita ids que não existem no catálogo. Faça: corrija a predefinição com ids do `studio_catalogo`.
- **"não existem ou são só-manual"** — causa: o kit de destaques cita estilos inexistentes ou só-manual. Faça: monte o kit com estilos `automatico: true`.

## mcp-publico

- **"não coube: na faixa"** — causa: o clipe colide com outro na mesma faixa. Faça: mova para outra faixa ou outro tempo (veja `studio_estado nivel "clipes"`).
- **"a borda direita não chegou"** — causa: o aparar/estender bateu no vizinho, no fim do arquivo ou no mínimo de 0,5 s. Faça: peça um tempo dentro do que a borda pode andar.
- **"a borda esquerda não andou"** — causa: idem pela esquerda. Faça: idem.
- **"não há nenhum"** — causa: a operação em massa não achou itens desse tipo. Faça: confira as contagens no resumo.
- **"essa faixa não tem nada pra remover"** — causa: faixa vazia. Faça: confira `studio_estado nivel "faixas"`.
- **"a cena não coube na faixa de camada pedida"** — causa: sem espaço na faixa de camada. Faça: outra faixa ou outro tempo.
- **"a camada não virou cena"** — causa: tempo pedido inválido para promover a camada. Faça: confira o tempo.
- **"essa cena não tem legenda colada pra virar texto"** — causa: a cena não tem legenda associada. Faça: escolha uma cena com legenda.
- **"não havia estilo nenhum pra limpar"** — causa: resetar_estilos sem nada para limpar. Faça: nada a fazer.
- **"os blocos não mudaram nada"** — causa: o SRT aplicado é idêntico ao atual. Faça: nada a fazer.
- **"não havia espaço nenhum entre as cenas pra fechar"** — causa: recolar sem lacunas. Faça: nada a fazer.
- **"a timeline não aceitou o item novo"** — causa: tempo/faixa inválidos para o item. Faça: confira tempo e faixa com `studio_estado`.
- **"confirme com o usu"** — causa: operação destrutiva sem `confirmacao: true`. Faça: pergunte ao usuário na conversa e reenvie com `confirmacao: true`.

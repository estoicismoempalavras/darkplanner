# 12 — PROJETOS EM ANDAMENTO (não se perder)

**Quando ler:** há mais de um projeto na conversa, o usuário disse "continue", "retome", "aquele outro", ou você vai tocar um vídeo em segundo plano enquanto ele trabalha noutro.

## A regra do id

- `studio_projetos` lista `{id, nome, atualizadoEm}`. Nome é para conversar; **id é para agir**. Depois da confirmação, TODO verbo leva `projeto: "<id>"` — inclusive leitura (`studio_estado`, `studio_capturar`). Sem `projeto`, o verbo cai no que está ABERTO na tela, que pode ser outro.
- Nome ambíguo (dois "Pirâmides") → o verbo devolve os candidatos: pergunte ao usuário, opções numeradas. Nunca escolha por ele.
- Nunca teste no projeto do usuário. Experimento = `studio_criar_projeto {nome: "rascunho — <assunto>"}` e diga que criou.

## Um lote por projeto por vez

- Com o editor fechado, o editor TRAVA o projeto durante um lote (`editar`, `destaques`, `aplicar_direcao`, `aplicar_template`, `vincular_narracao`, `importar_midia`). Se um verbo responder que o projeto está em uso por outra conversa, espere e tente de novo — não force noutro projeto "para adiantar".
- Antes de cada lote fechado o editor fotografa o projeto (`antes-do-lote`). Errou? `studio_snapshots {projeto}` → `studio_restaurar {projeto, id}` (com o projeto FECHADO; aberto, o autosave desfaria a restauração).

## O registro (`studio_plano`)

Cada vídeo tem um registro em `<pasta DarkPlanner>\matriz\projetos\<id>.json`: identidade (nome, canal, predefinição, idioma), os seis passos (narracao → sincronia → direcao → destaques → conferencia → export) com status/quando/nota e observações datadas. Ele sobrevive à conversa. Regras: `studio_plano {acao: "gravar", projeto, nome, predefinicao, idioma}` ao começar; `{acao: "passo", projeto, passo, status: "feito", nota}` ao concluir cada etapa (a nota leva os números: "12 destaques, 2 descartes"); `{acao: "gravar", projeto, observacao}` para decisões e avisos ao usuário; `{acao: "listar"}` para ver o que está em andamento. Sempre pelo ID.

## Retomar um trabalho

1. `studio_projetos` → o id (pelo nome que o usuário citou, ou pelo mais recente se ele disse "o de agora há pouco" — confirme em uma frase). `studio_plano {acao: "listar"}` também diz quais estão em andamento e em que passo.
2. `studio_plano {acao: "ler", projeto}` — o registro: o `proximo` passo é por onde continuar; as observações contam o que foi decidido. `existe: false` = nunca foi registrado: grave a identidade antes de seguir.
3. `studio_estado {projeto, nivel: "resumo"}` — o que já existe: narração vinculada? predefinição ativa? quantos destaques/compostos? `midia_faltando`? Divergência com o registro (o usuário editou na mão) → informe em uma frase, siga do documento e atualize o registro.
4. `studio_estado {projeto, nivel: "destaques"}` — se há destaques com `origem: "ia"`, um lote inteligente já rodou; não repita sem `substituir_lote`.
5. `studio_snapshots {projeto}` — os rótulos contam a história ("antes da edição completa", "antes de trocar transições").
6. Em canal: `estado_do_canal` → o passo "montagem" registrado (ou não) e o caminho do último export.
7. Só então decida o próximo passo e diga em uma frase: "retomando <nome> (id …): narração ok, direção Cinema aplicada, faltam os destaques da IA e o export".

## Dois vídeos ao mesmo tempo

- Pode: um lote fechado no projeto A enquanto o usuário edita B na tela. Não pode: dois lotes seus no mesmo projeto, nem lote seu no projeto que está ABERTO na tela sem avisar (a tela é dele).
- Export roda em segundo plano por projeto; `studio_fila` acompanha todos. Um `esperar_s: 25` por vez, no mesmo turno.

## Saída

Sempre nomeie o projeto pelo nome E confirme o id nas suas próprias notas (memória da conversa): "trabalhando em Pirâmides (sp_a1)".

# 00 — ÍNDICE DA MATRIZ DE EDIÇÃO

Você está prestes a editar um vídeo no editor (Studio) do DarkPlanner. Esta matriz é o MÉTODO: ela diz o que ler, em que ordem chamar os verbos `studio_*` e o que conferir antes de entregar. Leia este índice UMA vez por conversa; os demais temas só quando a tarefa pedir (`matriz {tema}`).

## As sete regras de ouro

1. **Leia antes de agir.** Índice → resumo do projeto → predefinição → catálogos. Verbo de escrita sem leitura anterior é chute, e chute vira recusa (`99-RECUSAS`).
2. **Projeto por ID.** Confirme o projeto com `studio_projetos` e, a partir daí, mande `projeto` (o id, nunca o nome) em TODO verbo. Com mais de um projeto na conversa, isso é o que impede editar o vídeo errado.
3. **O pedido define a direção.** Consulte a predefinição ativa (`studio_estado` resumo → `predefinicao`) e as preferências do usuário. Universo estrito = só ids do kit. Dentro dessas escolhas, decida função, texto, estilo e momento pelo roteiro; pedido de edição criativa autoriza essas decisões sem aprovação item a item.
4. **Só ids que existem.** Estilos, transições, efeitos, animações, templates e predefinições vêm de `studio_catalogo`, de `consultar_biblioteca` ou dos conjuntos desta matriz. Id inventado é descarte silencioso ou recusa — nunca "quase certo".
5. **Valide a seco, depois aplique.** Destaques: `studio_destaques` acao `validar` até zero descartes, só então `inteligente`. Direção: a resposta traz `problemas` — plano reprovado não encosta na timeline. Leia os descartes e corrija SÓ o recusado. Em trabalho criativo guiado por roteiro, leia → mapeie a narrativa → escolha estilos, textos e locais → valide → aplique; não use direção ou sorteio antes da análise. Predefinição é atalho pedido pelo usuário, simulação ou guia de gosto.
6. **Confira com os olhos e entregue com números.** `studio_capturar` em dois ou três tempos, `studio_estado` para contar o que ficou, `studio_exportar` + `studio_fila` no MESMO turno. Nunca teste no projeto do usuário: se precisar experimentar, crie um projeto de rascunho com `studio_criar_projeto` e apague o rastro depois.
7. **Referência, nunca cópia.** Áudio, SRT, imagens e vídeos ficam onde o app os gravou (a narração pronta já diz `arquivo` e `pasta`; o Creator grava na pasta do projeto; o Studio importa por referência). Nunca copie nem mova arquivo para "organizar": anote o caminho. Copiar duplica disco e quebra o vínculo da narração.

## Se a tarefa é… leia… e execute…

| Tarefa | Leia (tema) | Execute |
|---|---|---|
| "Produz", "produção", "faz o vídeo X do canal", ou um trecho ("só o roteiro", "manda gerar") | `producao` ([05](05-PRODUCAO.md)) + `guia_canal` | as cinco etapas com porta: `registrar_no_canal` a cada uma, `plano_conversa` no começo e a cada etapa |
| "Edite completamente com a predefinição X" / "monte o vídeo" | `fluxo_edicao` ([10](10-FLUXO-EDICAO-COMPLETA.md)) | os 12 passos, com `predefinicoes` ([60](60-PREDEFINICOES.md)) e as skills de cada eixo |
| "Faça só isto" (movimento em todas as cenas, overlays em 30%, trocar as transições, tirar os destaques…) | `fluxo_comando` ([11](11-FLUXO-COMANDO-DIRETO.md)) | a skill do eixo pedido + `studio_editar` |
| Mais de um projeto na conversa, retomar um trabalho, "continue de onde parou" | `projetos` ([12](12-PROJETOS-EM-ANDAMENTO.md)) | registro por id, um lote por projeto |
| Destaques a partir do roteiro (SRT, narração, word JSON) | `roteiro_destaques` ([20](20-SKILL-ROTEIRO-DESTAQUES.md)) + `contrato` ([80](80-CONTRATO.md)) | `studio_estado` nivel `roteiro` → propostas → `validar` → `inteligente` |
| Templates (quando cabe, quantos, qual) | `templates` ([30](30-SKILL-TEMPLATES.md)) | `studio_catalogo` tipo `templates` → `studio_aplicar_template` |
| Aplicar vídeo pronto de avatar, inteiro ou em porcentagem, cortar pela cena e editar a faixa exclusiva | `avatar` ([42](42-SKILL-AVATAR.md)) | `studio_editar` op `adicionar_avatar` / `cortar_avatar`; ajustes com `kind: "avatar"` |
| Movimento nas cenas (Ken Burns) | `movimento` ([40](40-SKILL-MOVIMENTO.md)) + [conjuntos/movimento.json](conjuntos/movimento.json) | `studio_editar` op `ajustar` (efeito) por cena |
| Overlays (véus, luz, textura) | `overlays` ([41](41-SKILL-OVERLAYS.md)) + [conjuntos/overlays.json](conjuntos/overlays.json) | `studio_editar` op `ajustar` (efeitos extras) em N% das cenas |
| Transições | `transicoes` ([50](50-SKILL-TRANSICOES.md)) + [conjuntos/transicoes.json](conjuntos/transicoes.json) | `studio_editar` op `ajustar` (transicaoOut) por junção |
| Entradas e saídas (animações) | `animacoes` ([51](51-SKILL-ANIMACOES.md)) + [conjuntos/animacoes.json](conjuntos/animacoes.json) | `studio_editar` op `ajustar` (animIn/animOut) em pares |
| Ler, criar ou aplicar uma predefinição | `predefinicoes` ([60](60-PREDEFINICOES.md)) | `studio_catalogo` tipo `predefinicoes` → `studio_aplicar_direcao` |
| Não sei qual verbo usar / que campos aceita | `verbos` ([70](70-VERBOS.md)) | — |
| Algo foi recusado (`descartes`, `rejeitadas`, `problemas`) | `recusas` ([99](99-RECUSAS.md)) | corrija só o recusado e reenvie |
| Conferir e entregar (capturas, export, fila, registro) | `conferencia` ([90](90-CONFERENCIA-E-ENTREGA.md)) | `studio_capturar` → `studio_exportar` → `studio_fila` |

## Ordem mínima de qualquer edição

1. `matriz {tema: "indice"}` (este arquivo) — uma vez por conversa. Trabalho com MAIS DE UMA fase: `plano_conversa` antes do primeiro passo (o checklist que o usuário vê) e de novo a cada fase fechada.
2. `studio_projetos` → confirme o ID com o usuário se houver dúvida; `studio_plano {acao: "ler", projeto}` diz se é retomada e por onde continuar.
3. `studio_estado {projeto, nivel: "resumo"}` — idioma, narração vinculada, predefinição ativa, contagens.
4. A skill da tarefa (tabela acima) e os catálogos que ela manda ler.
5. Escrita em lotes pequenos, lendo `descartes`/`rejeitadas`/`problemas` de cada um.
6. `studio_capturar` + `studio_estado` para conferir; `studio_exportar` + `studio_fila` para entregar.

## O que a matriz NÃO é

- Não é o contrato completo dos estilos: isso é `consultar_biblioteca` (índice primeiro, item depois).
- Não substitui o gosto do usuário: predefinição, canal (`estado_do_canal` → "edicao") e o pedido dele valem acima de qualquer conjunto daqui.
- Números de densidade, percentuais, espaçamentos e exemplos de distribuição são heurísticas editoriais; gates do motor (tempo, âncora, colisão, ids e universo estrito) são as restrições efetivas.
- Não é lugar de testar: teste em projeto de rascunho, nunca no do usuário.

## Temas disponíveis (`matriz {tema}`)

`indice` · `producao` · `fluxo_edicao` · `fluxo_comando` · `projetos` · `roteiro_destaques` · `templates` · `movimento` · `overlays` · `transicoes` · `animacoes` · `predefinicoes` · `verbos` · `contrato` · `conferencia` · `recusas` · `conjuntos` (com `id`: `transicoes`, `animacoes`, `movimento`, `overlays`, `destaques`).

Arquivos do usuário em `<pasta DarkPlanner>\matriz\skills\` com o MESMO nome sobrepõem os daqui (a resposta diz `origem: "usuario"`).

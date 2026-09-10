# 60 — PREDEFINIÇÕES (a direção editorial)

**Quando ler:** o usuário citou uma predefinição ("com a minha X", "cinema", "documentário"), pediu um clima ("mais calma", "mais dinâmica", "poucos destaques, muitos fades") ou você vai aplicar a direção.

## O que é

Uma predefinição é o GOSTO fechado do vídeo. Ela é um atalho escolhido pelo usuário, uma simulação ou um guia de gosto; não substitui a leitura criativa do roteiro nem deve introduzir aleatoriedade por iniciativa do agente: `universo` (`predef` = só o que está marcado nela; `sistema` = tudo o que é automático), `ritmo`, `cores` (paleta única ou do projeto), e por eixo — `transicoes`, `efeitos`, `entradas`, `saidas`, `templates`, `destaques` (kit de estilos + `densidade`; kit vazio = todo o catálogo automático), `filtros`, `legenda` — os itens marcados com peso (`pct` = frequência do eixo, 0 = desligado). O editor a aplica de uma vez (`studio_aplicar_direcao`) num plano DETERMINÍSTICO (mesma seed = mesmo resultado), validado antes de encostar na timeline.

## A V3 (intensidade e conjuntos)

Uma predefinição pode ser descrita por um DIAL de `intensidade` (0..100: 20 calmo · 50 equilibrado · 75 dinâmico · 95 muito dinâmico) que deriva, por padrão, o ritmo, a densidade dos destaques e a frequência de cada eixo; e por `conjuntos` por eixo (`transicoes`: fades_cinema · varreduras_suaves · luz · formas · impacto · digital · cortes; `animacoes`: suave · deslize · zoom · impacto · agito, com PARES harmônicos; `movimento`: respiro · classico · dinamico; `overlays`: escuro · luz · vintage). Os números de cada intensidade estão em `matriz {tema: "conjuntos", id: "intensidade"}`. O que o usuário fixar por eixo vence o dial. Overlays têm `pct` por CONTAGEM de cenas e teto por cena; entradas/saídas têm `pares.modo` (livre · pares · alternado).

## Ler

1. `studio_catalogo {tipo: "predefinicoes"}` — as do sistema (`sys_tudo`, `sys_doc_classico`, `sys_cinema`, `sys_dinamico`) e as do usuário: nome, universo, ritmo, densidade e quantos itens por eixo.
2. `studio_estado {projeto, nivel: "resumo"}` → `predefinicao` = a ATIVA no projeto (a última aplicada). É ela que fecha o universo dos destaques da IA.
3. Detalhe de um item do kit: `consultar_biblioteca {id}`.

## Traduzir um pedido de clima em predefinição

| O usuário disse | Escolha / ajuste |
|---|---|
| "calma", "documentário", "sóbrio" | `sys_doc_classico` (ou a do usuário mais parecida): transições fades, movimento respiro, destaques minimal/equilibrado |
| "cinema", "premium", "elegante" | `sys_cinema` |
| "dinâmica", "cortes rápidos", "energia" | `sys_dinamico` |
| "tudo que o editor tem" | `sys_tudo` (universo sistema — a IA pode usar qualquer estilo) |
| "poucos destaques" / "muitos" | a densidade: `minimal` · `equilibrado` · `dinamico` · `maximo` (`studio_configurar {config_destaques: {densidade}}` para o sorteio, ou a predefinição) |
| "só fades" / "sem transição" | conjunto `fades_cinema` / `cortes` via skill de transições, depois da direção |

Criar pelo verbo: `studio_predefinicao {acao: "criar", predef: {nome, intensidade, conjuntos: {transicoes, animacoes, movimento, overlays}, destaques: {densidade, estilos}, …}, base?: "Cinema premium"}` — ids inexistentes são RECUSADOS. Ajustar: `{acao: "atualizar", nome, patch}`. Um pedido de clima ("mais calma, fades, poucos destaques") vira `{intensidade: 25, conjuntos: {transicoes: "fades_cinema"}, destaques: {densidade: "minimal"}}`. Antes de aplicar, SIMULE: `{acao: "simular", nome | predef, projeto}` e diga ao usuário em uma linha o que a predefinição faria (contagens por eixo, destaques por papel, avisos).

## Aplicar

1. Qual predefinição: a que o usuário nomeou; sem escolha numa edição NOVA → `Padrão do sistema` (`sys_tudo`), sem perguntar — é a regra única da tela, do serviço de produção e do verbo. Retomada de um projeto que já tem direção → o snapshot já aplicado (`studio_estado` → `predefinicao`), salvo pedido de troca. Só pergunte quando ele pediu para escolher ENTRE as dele.
2. `studio_snapshot {projeto, rotulo: "antes da direção <nome>"}`.
3. `studio_aplicar_direcao {projeto, predef: "<nome>"}` (ou `studio_predefinicao {acao: "aplicar", nome, projeto}`; `definicao` aplica uma predefinição inline sem salvar) — resposta: `cenasAjustadas`, `juncoes`, `blocos`, `destaques`/`destaquesAntes`, `avisos`. Reaplicar RE-SORTEIA os destaques automáticos (o que o usuário ajustou à mão nos automáticos se perde) — avise ANTES.
4. `problemas` = plano reprovado, nada aplicado: ids inexistentes no catálogo, templates sobre compostos, template manual-only → corrija a predefinição (tela) ou remova o obstáculo com autorização; `matriz {tema: "recusas"}`.
5. Depois da direção, a IA respeita o kit: `studio_destaques inteligente` recusa estilo fora dele (universo `predef`). Só mande `opcoes.universo_estrito: false` se o usuário pediu explicitamente sair da predefinição.

## Critérios de aceite

- Universo respeitado (zero "estilo fora da predefinição ativa" nas propostas seguintes).
- `problemas` vazio; `avisos` repassados ao usuário em uma frase.

## Saída

"direção <nome> aplicada: N cenas ajustadas, N junções, N templates, N destaques (antes N)".

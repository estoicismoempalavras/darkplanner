# 10 — FLUXO: EDIÇÃO COMPLETA COM UMA PREDEFINIÇÃO

**Quando ler:** o usuário pediu "edite completamente", "monte o vídeo", "edite com a minha predefinição X" ou o passo 5 do guia do canal chegou à montagem.

**Entradas (precisam estar na mão antes do passo 1):** o projeto (id), a narração pronta (job em `narracoes_geradas`) ou as legendas já aplicadas, as mídias importadas ou o caminho delas, e a predefinição pedida (nome) — ou a do canal (`estado_do_canal` → "edicao") — ou nenhuma (aí a do projeto, e se não houver, `Padrão do sistema` (`sys_tudo`, o padrão do sistema — a mesma regra da tela, do serviço de produção e do verbo), avisando em uma frase).

## Passos

1. `matriz {tema: "indice"}` — uma vez por conversa. Se já leu, pule.
2. `studio_projetos` → confirme o **id**. Se o usuário citou um nome ambíguo, pergunte (uma pergunta, opções numeradas). Daqui em diante todo verbo leva `projeto: "<id>"`. Não existe? `studio_criar_projeto {nome}` (nasce fechado, é assim que se trabalha). Em seguida `studio_plano {acao: "ler", projeto}`: registro existente = RETOMADA (siga do `proximo`, ver [12](12-PROJETOS-EM-ANDAMENTO.md)); `existe: false` = grave a identidade (`acao: "gravar"` com nome, predefinição, idioma) e marque cada passo abaixo ao concluir (`acao: "passo"`).
3. `studio_snapshot {projeto, rotulo: "antes da edição completa"}` — é o seu desfazer com o editor fechado.
4. `studio_estado {projeto, nivel: "resumo"}` — anote: `idioma` (os textos que você propuser saem NESSE idioma), `narracao.vinculada`, `predefinicao` ativa, `contagens`, `midia_faltando`. Cena nenhuma → importe (`studio_importar_midia`, caminhos completos, ordem numérica, `na_timeline: true`).
5. Narração ainda não vinculada → `studio_vincular_narracao {projeto, job_id, offset_s}`. É ela que cria as legendas de fala e sincroniza as cenas; sem ela não há destaque. Leia `cenasSincronizadas`, `falasSemCena`, `cenasSemFala` e conte ao usuário se sobrou algo. Áudio que entrou por ARQUIVO (`studio_importar_midia`) é trilha comum, não narração: o corte das cenas e as legendas só vêm do vínculo pelo `job_id` (ou de um arquivo com o MESMO nome do gerado na aba TTS, que o editor reconhece sozinho).
6. Estilo do canal (se houver) — `studio_configurar` numa chamada só: `estilo_legenda`, `tipografia_legenda`, `config_destaques` (densidade). Ids conferidos em `studio_catalogo` (`estilos_legenda`, `fontes`).
7. A predefinição — `matriz {tema: "predefinicoes"}` e `studio_catalogo {tipo: "predefinicoes"}`. Escolha a pedida pelo NOME. Universo `predef` = tudo o que você propuser depois fica dentro do kit dela.
8. **Escolha o modo:** na edição criativa, leia `matriz {tema: "roteiro_destaques"}` e siga roteiro completo → mapa narrativo → propostas → validação → aplicação, escolhendo também templates, movimentos e transições para cada trecho. `studio_aplicar_direcao` aplica o plano automático, inclusive seu sorteio: use quando esse atalho foi pedido. Guia de gosto pode ser apenas consultado; simulação usa `studio_predefinicao {acao: "simular", projeto, nome}` e não aplica nada.
9. Destaques inteligentes fazem parte da edição criativa quando ajudam a narrativa e não foram desativados pelo usuário. Escreva propostas autorais ou literais ancoradas na fala. Se já houver lote automático e o usuário pediu substituição, informe e envie `substituir_lote: true`; o padrão preserva edição existente.
10. Ajustes por eixo: escolha os que servem à narrativa dentro do pedido de edição completa e leia a skill correspondente. Em pedido pontual ("mais fades", "movimento em todas", "overlays em 30%"), siga `matriz {tema: "fluxo_comando"}` sem ampliar o escopo.
11. Conferência: `matriz {tema: "conferencia"}` — `studio_estado nivel "destaques"` (âncoras e origem), `studio_capturar` em três tempos (começo, um destaque, um template), `studio_estado resumo` (contagens finais, `midia_faltando`).
12. Entrega: `studio_exportar {projeto, nome}` e `studio_fila {esperar_s: 25}` no MESMO turno até sair de "renderizando"; em canal, `registrar_no_canal` com o caminho; `studio_plano {acao: "passo", projeto, passo: "export", status: "feito", nota: "<caminho>"}`.

## Critérios de aceite

- Zero `problemas` na direção quando direção foi escolhida; zero `descartes` na última chamada `inteligente`.
- Todo destaque com `blocoId` no `studio_estado nivel "destaques"` e `antecipacaoS` ≤ 0,6 s.
- `midia_faltando` vazio antes de exportar (ou o usuário confirmou `continuar_sem_midias`).
- Nenhum id fora do kit quando o universo é `predef`.
- Contagens finais ditas ao usuário em uma linha: "N cenas, N transições, N destaques (N da IA), N templates".

## Recusas esperadas e o que fazer

- `problemas` na direção → predefinição cita ids que não existem (`studio_catalogo`) ou templates sobre compostos — corrija a predefinição ou remova o composto, com autorização.
- `descartes` nos destaques → `matriz {tema: "recusas"}`; corrija só os recusados.
- "não há legendas de fala" → volte ao passo 5.
- Verbo respondeu "diga em qual projeto" → você esqueceu `projeto`.

## Saída

Uma linha de resumo com números + o caminho do arquivo exportado (ou "na fila, X%") + o que ficou de fora e por quê. Nada de relatório.

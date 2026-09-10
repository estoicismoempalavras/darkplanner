# 05 — PRODUÇÃO: do título ao render, sem se perder

**Quando ler:** o usuário disse "produz", "produção", "faz o vídeo X do canal", "roda a criação", ou pediu um trecho do processo ("só o roteiro", "só os prompts", "manda gerar"). Leia UMA vez por conversa, antes do primeiro vídeo. O playbook completo do canal (abertura, perguntas, configuração) está em `guia_canal`; este tema é o MÉTODO das etapas: ordem, portas, erros.

## Os princípios (não negociáveis)

1. **Método no app, dados na pasta.** A ordem e as portas vivem aqui; o conteúdo vive na pasta do canal (`estado_do_canal` diz o que existe). Você nunca decide a ordem lendo a conversa: lê o estado.
2. **Uma etapa só avança pela porta.** `registrar_no_canal` CONFERE o artefato antes de marcar a etapa; recusa = a etapa não está feita, corrija e registre de novo. Etapa registrada nunca é refeita sem o usuário pedir "refaz".
3. **Referência, nunca cópia.** Narração, SRTs, imagens e vídeos ficam onde o app os grava; a pasta do vídeo guarda ponteiros (job, caminhos). Copiar duplica disco e quebra o vínculo da narração.
4. **Skills do usuário são obrigatórias.** Roteiro e prompts saem SEMPRE da skill dele (num canal: `skills\` com "roteiro" / "prompt" no nome; no modo pasta: os arquivos que ele apontou no prompt ou que têm "roteiro"/"prompt" no nome, onde estiverem — .md ou .txt). Sem a skill, a etapa fica bloqueada: diga qual arquivo falta e pare. Nunca invente uma skill.
5. **O usuário vê o progresso pelo checklist.** `plano_conversa` no começo (as cinco etapas, o que já existe, estimativas) e de novo a cada etapa registrada. Sem botões, sem aprovação: o processo é automático até a porta que depende dele.
6. **Espere dentro do verbo.** Narração e leva de mídia com `esperar_s`; nunca `sleep`, nunca procurar arquivo no disco.
7. **Confirme com fatos, não com fé.** `enviar_prompts_texto` devolve `jobs_criados`; `listar_jobs {resumo: true}` conta a leva; `studio_fila` diz quando o render acabou. Sucesso é o que o verbo devolve, não o que você supõe.

## As cinco etapas e suas portas

| # | Etapa | Verbos | Porta (o que o registro confere) | Registro |
|---|---|---|---|---|
| 1 | Roteiro | skill de roteiro do usuário → salvar `videos\NN-slug\roteiro.md` | skill de roteiro presente; arquivo existe; mínimo de palavras SE a skill declarar | `registrar_no_canal {passo: "roteiro", dados: {caminho}}` |
| 2 | Narração e SRT | `gerar_narracao {esperar_s}` → `status_narracao {esperar_s}` até `done` | job `done` no app; ponteiros `audio` e `tempo_srt` existem no disco | `{passo: "narracao", dados: {job_id}}` (o app preenche os ponteiros) |
| 3 | Prompts | skill de prompts do usuário + o srt de TEMPO (leia pelo ponteiro `tempo_srt`) → `videos\NN-slug\prompts.txt` | skill de prompts presente; N linhas = N trechos do srt de tempo; cada linha dentro do limite de palavras que a skill declara | `{passo: "prompts", dados: {caminho}}` |
| 4 | Mídia | `criar_projeto {name, pasta: <canal>\videos\NN-slug\midias}` → `config_de_geracao` → `enviar_prompts_texto {project_id, arquivo}` → `listar_jobs {resumo: true, esperar_s}` | `jobs_criados` > 0 no envio; na fila: gerando 0 e falhos 0 | `{passo: "geracao", dados: {project_id}}` (o app confere a fila) |
| 5 | Edição e render | `fluxo_edicao` (tema 10) com o estilo do canal → `studio_exportar {pasta: <canal>\videos\NN-slug\final}` → `studio_fila {esperar_s}` | arquivo .mp4 existe na pasta do vídeo | `{passo: "montagem", dados: {caminho}}` |

Regras de ordem: 4 só depois de 3 registrado; 5 só depois de 4 registrado (o projeto do Studio sem mídia pronta devolve `aviso` — no fluxo de produção isso é PORTA). Editar enquanto gera só se o usuário pediu explicitamente.

## Entrar no meio (o usuário não quer tudo)

- "só o roteiro" → etapa 1 e pare na porta, dizendo o próximo passo.
- "aqui está o roteiro, faz os prompts" → salve o texto dele como `roteiro.md`, registre 1 com `dados: {caminho, origem: "usuario"}`, siga para 2 e 3 (a narração é a fonte do srt de tempo; sem narração não há prompts por trecho).
- "manda gerar estes prompts" → salve como `prompts.txt`, registre 3 com `origem: "usuario"` (o registro confere o limite da skill, não o número de trechos quando não há srt), siga para 4.
- "só edita" → etapa 5, exigindo mídia pronta (4 registrado ou projeto com mídias).
- Mídia de outra pasta: `studio_importar_midia` com os caminhos completos — por referência, sem copiar.

## Vários vídeos e várias conversas

- **Qual canal:** o da PASTA DA CONVERSA, sempre (`listar_canais` → o canal cuja `pasta` é a pasta em que você está; ou o `canal.md` que está nela). Canal do índice que mora em OUTRA pasta não entra sozinho: se a pasta da conversa não é canal, pergunte em uma linha ("trabalho no Canal X, em <pasta>, ou adapto esta pasta?") antes de qualquer coisa — misturar os dois foi o erro do teste de 04/09.
- **"produz" sozinho** = TODOS os vídeos pendentes do canal, na ordem numérica, UM por vez: primeiro o que está pela metade (`estado_do_canal` → `pela_metade`, a partir do `proximo` dele), depois o próximo título sem nenhuma etapa feita. Fechou as cinco etapas de um, começa o seguinte sem perguntar; acabou a lista, avise. "produz o 03" / "só o roteiro do 02" = só aquele recorte.
- "produz os 10 títulos" → o mesmo: um vídeo por vez, na ordem; `plano_conversa` por vídeo.
- A ordem vem do ESTADO (números das pastas `videos\NN-slug\` e o `titulo` de cada uma), nunca da sua leitura da pasta.
- **Pasta da conversa sem `canal.md` = MODO PASTA (o padrão de hoje).** NÃO crie canal, NÃO reorganize, renomeie ou apague nada: a pasta do usuário fica como ele deixou. O PROMPT dele é o pipeline: quem faz cada etapa (delegue à IA que ele nomeou, pela ferramenta de delegação; sem nome, você faz), quais skills usar (os arquivos que ele apontou ou os que têm "roteiro"/"prompt" no nome, onde estiverem), quais títulos, temas e orientações. Progresso em `.darkplanner\producao.json` DENTRO da pasta anexada (forma: `{ videos: { "<nome>": { titulo, passos: { roteiro: {caminho}, narracao: {job_id, audio, tempo_srt}, prompts: {caminho}, geracao: {project_id}, montagem: {caminho} } } } }`) e uma linha por ação em `.darkplanner\memoria.md`; conversa nova começa lendo os dois. Sem `registrar_no_canal` aqui, as PORTAS você mesmo confere antes de marcar a etapa: arquivo existe; N linhas = N trechos do srt de tempo; limite de palavras da skill; leva com gerando 0 e falhos 0; .mp4 no disco. O checklist é o `plano_conversa`. Um canal criado (com `canal.md`) troca este modo pelo registro com portas do app.
- **A ORDEM no modo pasta.** A ordem das cinco etapas é FIXA (roteiro → narração → prompts → mídia → edição: cada uma depende da anterior). O prompt manda em três coisas: (1) a ORDEM DOS VÍDEOS — a ordem em que os títulos aparecem no prompt ou no arquivo de títulos, um vídeo por vez, do primeiro ao último ("faz o 3 primeiro" reordena); (2) ETAPAS EXTRAS entre as fixas — "o GPT revisa o roteiro antes de narrar", "me mostra os prompts antes de gerar" (aprovação sua): entram no checklist no lugar que o prompt disser, e a etapa seguinte só começa depois delas; (3) QUEM faz cada etapa e com QUAL skill. O que o prompt não disser fica no padrão: você faz, com as skills da pasta, um vídeo por vez, sem parar entre vídeos. Repita a ordem entendida em UMA linha antes de começar ("ordem: roteiro (eu) → revisão (GPT) → narração → prompts (GPT) → mídia (Gemini) → edição (Gemini); vídeos 1 a 4") — é a chance de o usuário corrigir antes de gastar narração.
- Cada vídeo tem `dono` no estado (a conversa que registrou por último). Outra conversa só pega um vídeo sem dono ou cujo dono é ela mesma; conflito = pergunte ao usuário.
- Agentes por etapa (`## Agentes` do canal.md): delegue a etapa ao agente marcado; a passagem de bastão é o disco (artefato + registro), nunca a conversa.

## Em caso de erro (o que fazer, etapa a etapa)

- **Registro recusado (porta reprovada):** o erro diz o que faltou (linhas × trechos, palavras acima do limite, arquivo inexistente, skill ausente). Corrija SÓ aquilo e registre de novo. Nunca "avance mesmo assim".
- **Skill ausente:** pare a etapa, diga ao usuário o nome do arquivo esperado em `skills\` e o que ele deve conter. Não crie a skill.
- **Narração `error`/`blocked`:** `blocked` = moderação do texto, reescreva o trecho apontado e gere de novo; `error` = tente uma vez mais; persistindo, conte ao usuário com o detalhe. Cota (`cota_narracao`) esgotada: pare e avise.
- **Envio de prompts com `jobs_criados: 0`:** a tela recusou (tag ambígua, campo ocupado, projeto errado) — leia o erro, confira `listar_jobs {resumo: true}` e NUNCA reenvie às cegas (reenviar duplica). Duplicatas: `excluir_jobs {ids}` com os ids sobrando.
- **Jobs falhos na leva:** `detalhe_job` → reescreva o prompt → `reenviar_prompt_do_job`. Leva parada (pending sem andar): `diagnosticar` e conte ao usuário; não registre a etapa 4.
- **Studio com `aviso` de projeto sem mídia:** volte à etapa 4. **`problemas`/`descartes`/`rejeitadas`:** `matriz {tema: "recusas"}` — corrija só o recusado.
- **Export cancelado pelo usuário:** é ordem dele; não reenfileire. **Fila com erro:** leia `studio_fila`, conte ao usuário, não registre a etapa 5.
- **Conversa caiu / retomada:** `estado_do_canal` → `pela_metade` diz o vídeo e o `proximo`; continue dali. O estado vence a sua memória.
- **Qualquer bloqueio que dependa do usuário:** uma frase dizendo o que falta e pare o turno. Registre no `memoria.md` via o próprio `registrar_no_canal` (o registro escreve lá).

## Saída de cada etapa

Uma linha ao usuário ("roteiro pronto: 1.620 palavras em videos\01-titulo\roteiro.md") + `plano_conversa` atualizado. No fim: onde está o .mp4.

## Áudio da narração na régua (porta da etapa 5)

`studio_vincular_narracao` sincroniza as cenas, aplica as legendas E coloca o mp3 da narração na régua (a resposta traz `audioNaRegua`). Antes de exportar, `studio_estado {nivel: "resumo"}` tem de mostrar `narracao.vinculada: true` **e** `narracao.audioNaRegua: true`; senão o vídeo sai MUDO — foi o vídeo 005 (04/09/2026), entregue como "concluído" sem uma palavra de áudio. Se `audioNaRegua` vier `false` (app antigo ou falha ao puxar o mp3): `studio_importar_midia {projeto, caminhos: [<mp3 da narração, o `arquivo` que gerar_narracao/narracoes_geradas devolvem>], na_timeline: true}` — o app reconhece o job pelo metadado do arquivo e o vínculo continua valendo. A porta reprova export com `audioNaRegua: false` quando a produção exige narração.


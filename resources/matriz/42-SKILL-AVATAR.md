# 42 — Avatar pronto na faixa exclusiva

**Quando ler:** adicionar, distribuir, cortar ou editar um vídeo de avatar pronto no Studio. Para gerar um vídeo novo, os verbos HeyGen continuam separados.

## Aplicação

Para um vídeo do histórico, leia `studio_avatar {acao:"prontos"}`. Essa consulta só lista vídeos completos prontos; aplicar pelo nome registra a referência no projeto. Não use `gerar` para inserir um arquivo existente. Os recortes de lacunas/concatenações têm outro mapa temporal e continuam no fluxo legado.

Leia o projeto e as mídias disponíveis antes de escrever. A fonte usa a mesma narração e começa no zero; um arquivo menor cobre apenas o prefixo. Duração parecida, sozinha, não comprova que dois arquivos contêm a mesma fala.

- **Inteiro:** `studio_editar {operacoes:[{op:"adicionar_avatar",nome:"Avatar completo.mp4",modo:"inteiro"}]}`. Usa o vídeo já importado, desde zero, na faixa `avatar:0`, com áudio embutido inicialmente mudo. A agulha não desloca a aplicação.
- **Distribuir:** `studio_editar {operacoes:[{op:"adicionar_avatar",nome:"Avatar completo.mp4",modo:"distribuir",pct:20,seed:"pedido-1"}]}`. A porcentagem mede **tempo disponível**, não contagem de cenas. O resultado usa cenas completas e informa a cobertura real; pode aproximar a meta por causa das durações diferentes.
- **Escolha explícita:** use `modo:"primeira"` para a cena 1 exata; `modo:"intercalar",inicioCena:1,intervalo:2,quantidade:3` para cenas alternadas; `modo:"cenas",ids:[...]` ou `numeros:[1,3]` (exatamente uma dessas listas); `modo:"selecao",ids:[...]` ou a seleção atual do Studio; `modo:"agulha",emS:12.5` para a cena sob a agulha. Sem candidatos válidos a operação é recusada; itens válidos podem seguir acompanhados dos indisponíveis.
- Esses modos são escolhas da IA baseadas no roteiro/SRT ou na intenção explícita do usuário; não substitua a análise por sorteio. A aplicação incremental preserva clipes existentes e recusa duplicação, sobreposição, lock, template normal e qualquer cena que a fonte não cubra integralmente.
- No modo **Distribuir**, cenas cobertas por um composto/template normal ficam fora das candidatas, mesmo quando a duração do Avatar comporta a cena. O relatório deve informar quantas foram excluídas por template; nunca remover o composto para abrir espaço.
- Quando o pedido exigir escolhas narrativas, analise o roteiro/SRT, escolha cenas reais e use `modo:"cenas",ids:[...]` (ou `numeros:[...]`) para endereçá-las; não transforme essa escolha em `pct:100` nem em sorteio do projeto inteiro. Em `intercalar`, os ordinais são resolvidos antes dos filtros de fonte, template e colisão.
- A cena de 50–53 s usa o trecho 50–53 s do avatar. Nunca reinicie a fonte no zero em cada cena e nunca compacte o áudio dos trechos sorteados.
- `agulha` escolhe a cena inteira sob a agulha em segundos, respeitando gaps e a mesma régua acumulada do Player; não cria um recorte parcial.
- Cena que ultrapassa o fim do arquivo fica fora. Não estique, congele ou repita a boca para preencher a falta de mídia.
- O modo **Inteiro** é a exceção: pode atravessar e aparecer por cima de templates normais porque a faixa Avatar é independente. Isso não autoriza transformar o template normal em template Avatar.

## Cortar e editar

`studio_editar {operacoes:[{op:"cortar_avatar",cenaId:"id-real-da-cena"}]}` isola o intervalo nas duas bordas. `id` opcional limita o clipe de avatar. Os pedaços anterior, central e posterior permanecem: remover qualquer um exige a intenção correspondente do usuário.

Os clipes aparecem em `studio_estado nivel:"clipes"` com `kind:"avatar"`. Use os IDs retornados para ajustar, aparar, remover ou definir keyframes. As mesmas travas e regras de desfazer do editor continuam valendo. Não use o número ordinal exibido da cena como ID.

Mover, colar ou duplicar um trecho sincronizado ajusta também o ponto de leitura da fonte para o novo tempo. Não pede recodificação. Destinos fora da fonte disponível ou ocupados são recusados; releia o resultado antes de continuar. Alterar intencionalmente a velocidade muda a relação com a narração, então não faça isso para compensar um erro de alinhamento.

- Efeito, filtro, máscara, enquadramento, posição e keyframes são próprios do avatar. Movimento exclusivo de imagem não se aplica ao vídeo.
- Os tempos de `definir_keyframes` são locais ao trecho selecionado. Depois de um corte, 0 s significa o começo desse trecho; a aplicação preserva internamente a fase dos efeitos anteriores. Não some o início global manualmente.
- Transição no avatar exige `cenaId` da cena abaixo: `ajustar` com `kind:"avatar"` e campos de transição edita a única junção dessa cena. Não crie outro som para o avatar.
- Transições GL podem usar o fallback de composição quando o avatar está transformado, assim como sob templates. Confira o resultado; não descreva um fade de compatibilidade como o shader exato solicitado.
- Manter a narração única é o padrão. Só reative o áudio embutido quando esse for o pedido; o volume não precisa ser aumentado para sincronizar.
- Os templates `tpl_avatar_*` são uma família separada. Só podem ser escolhidos quando há Avatar no intervalo e mídia principal disponível; a cobertura pode ser parcial. O layout acompanha o tempo do Avatar e termina sem cortar, alongar ou reiniciar a fonte. A mídia principal, a narração e o composto normal continuam referências independentes. Eles não são candidatos do sorteio de templates comuns.
- Não há uma segunda faixa de Avatar nesta etapa. Colisão, fim de arquivo e faixa travada exigem rever a operação, não mover outros clipes ou desligar travas por conta própria.

## Conferência

Confira a nota de aplicação, os tempos e a mídia disponível. Verifique um trecho tardio do vídeo, as duas bordas de um corte, uma cena com avatar e outra sem, e uma junção com som. Uma captura estática não comprova sincronia labial: reproduza ou confira uma exportação curta quando avaliar a fala.

Pedido de aplicar um vídeo pronto não é pedido para usar `studio_avatar acao:"gerar"`. Não altere reservas, fila de geração, cenas principais, narração ou templates apenas para adicionar a faixa. Os templates PiP ficam na seção Avatar da aba Templates; consulte a skill 30 e o contrato do layout antes de aplicar.

Uma apresentação pode atravessar cenas e segmentos Avatar adjacentes. O vínculo salvo inclui as fontes usadas (`avatarSourceKey` e, quando necessário, `avatarSourceKeys`); não altere essas referências para capturar uma mídia diferente depois. O mesmo Avatar deve continuar no seu ponto de fala enquanto a transição muda apenas a mídia principal dentro da moldura. Confira também frames intermediários da transição: a principal não deve aparecer por um frame no lugar do Avatar. Fora de um layout contínuo, a junção herdada deve ocorrer entre as apresentações Avatar dos dois lados, sem uma terceira imagem intermediária.

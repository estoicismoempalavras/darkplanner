# conjuntos/ (gerado dos perfis editoriais — não edite à mão)

Um conjunto é um vocabulário fechado de ids que combinam entre si. A skill de cada eixo diz QUANDO usar cada conjunto; a predefinição diz QUAL conjunto o vídeo usa. Os ids aqui existem no catálogo (o verify confere).

- `transicoes.json` — Conjuntos de transições por FAMÍLIA e força (perfis-transicoes.js). Um conjunto é o vocabulário de um vídeo: escolha um, alterne dentro dele, e use a virada de assunto (fade escuro) fora dele.
- `animacoes.json` — Conjuntos de entradas/saídas por FAMÍLIA (perfis-anims.js) e os PARES HARMÔNICOS: a saída de uma cena combina com a entrada da próxima. Alterne pares dentro do conjunto; nunca anime a junção que já tem transição.
- `movimento.json` — Conjuntos de MOVIMENTO (Ken Burns e parentes, perfis-efeitos.js). Só em IMAGEM — em vídeo o editor descarta. Rotacione sem repetir o vizinho.
- `overlays.json` — Conjuntos de OVERLAYS (véus por cima da cena) por CLIMA. Overlay vai em `effects` (extra), teto 2 por cena, distribuídos com respiro (não em cenas consecutivas). A porcentagem é por CONTAGEM de cenas.
- `destaques.json` — Kits de DESTAQUE por papel (enfases-meta.js), só estilos automáticos. Um kit calmo usa poucos papéis e intensidade baixa; um dinâmico usa todos.
- `intensidade.json` — O dial de INTENSIDADE (0..100) da predefinição V3 e os eixos que ele deriva por padrão (o usuário sobrescreve por eixo). Âncoras: 20 calmo · 50 equilibrado · 75 dinâmico · 95 muito dinâmico.

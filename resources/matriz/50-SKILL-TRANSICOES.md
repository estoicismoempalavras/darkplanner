# 50 — SKILL: TRANSIÇÕES

**Quando ler:** "troque as transições", "mais fades", "transições inteligentes", ou você está distribuindo transições fora da direção.

**Entradas:** projeto (id); cenas na ordem (`studio_estado nivel "clipes"`, kind `cena`, com `transicaoOut` atual); o roteiro (`nivel "roteiro"` → grupos e viradas de assunto); [conjuntos/transicoes.json](conjuntos/transicoes.json); a predefinição (conjunto e se quer som).

## Regras

Conjunto único, alternância e fade nas viradas são referências para distribuição uniforme. Na edição criativa, a relação entre os planos pode pedir corte seco, continuidade, contraste ou pausa; escolha a junção por essa relação. Os campos e a cena de origem abaixo são o contrato técnico.

- A transição mora na cena de ORIGEM da junção (`transicaoOut` da cena N leva à N+1). A última cena não tem junção.
- **Vocabulário coerente com o roteiro:** `fades_cinema` (calmo, documentário), `varreduras_suaves` (médio), `luz` (película, dourado), `formas` (geometria), `impacto` (forte), `digital` (tecnologia). `cortes` = sem transição. Um conjunto é um bom ponto de partida; a IA pode combinar escolhas quando a intenção narrativa justificar.
- **Virada de assunto:** `fade` é uma referência de pontuação, não uma obrigação criativa. Identifique viradas pelo roteiro e escolha fade, corte ou outra junção de acordo com a mudança de tema.
- **Junções sob template**: prefira respiro (`fade` ou nenhuma) quando o composto já tem movimento. Se a relação narrativa pedir outra transição, escolha-a explicitamente e confira o preview; `gl_*` pode ficar no fallback fade sob composto, enquanto `ft_*` continua como overlay.
- **Porcentagem por junções**: "transições em 60%" = 60% das junções; as demais ficam em corte. Alterne 2–4 ids do conjunto; não repita o mesmo em junções vizinhas.
- Duração: `transicaoFrames` padrão do catálogo; fades longos (18–24) em ritmo calmo, curtos (8–12) em dinâmico.
- **Som:** consulte `studio_catalogo {tipo:"transicoes"}`: cada ID informa `audio.politica`, `audio.sugerido`, `audio.volume_padrao` e `audio.db_padrao`. Ao aplicar, omitir `transicaoSom` usa a curadoria/política atual; `default` nasce com som, `opt-in` nasce silencioso. `"auto"` escolhe e grava o sugerido; um arquivo explícito substitui a sugestão; `null` ou `"nenhum"` silencia. A interface mostra dB; `transicaoVol` persiste ganho linear: padrão −25 dB ≈ 0.056234 (ganho = 10^(dB/20)); 0 é mudo. Respeite a escolha do usuário e a narração. Documentos antigos silenciosos não ganham som ao carregar.
- O efeito começa no corte, não antes dele. Nos sons curados o pico acompanha a fase do gesto, inclusive ao ajustar a duração. Áudio personalizado exige escuta de conferência. Para remover todos os sons sem remover os visuais: ajuste `transicaoSom:null` nas cenas (`todos:true`); é uma edição que pode ser desfeita.

## Passos

1. Liste as cenas; marque as junções contíguas (exclua a última cena e intervalos vazios). Marque as viradas de assunto pelo roteiro.
2. Escolha o conjunto; pegue os ids em `matriz {tema: "conjuntos", id: "transicoes"}`; confira frames em `studio_catalogo {tipo: "transicoes"}` se for ajustar.
3. Monte: virada → `fade`; sob template → `fade`/nenhuma; demais → rotação do conjunto até a % pedida.
**Atalho para distribuição uniforme:** `studio_editar {projeto, operacoes: [{op: "aplicar_por_cena", eixo: "transicoes", conjunto: "fades_cinema", pct: 100, viradas: [ids das viradas], alvo: {…}}]}` aplica a distribuição da skill e conta em `nota`. Para decisões narrativas diferentes em cada junção, use ajustes explícitos e mantenha o corte seco onde ele servir melhor.
4. `studio_editar` com `{"op":"ajustar","kind":"cena","ids":["sc3"],"campos":{"transicaoOut":"fade","transicaoFrames":18}}`; para tirar, `"transicaoOut": null`. ≤ 40 por chamada.
5. `studio_capturar` antes, durante e depois da junção; confira também reprodução/exportação com áudio. Uma imagem isolada não comprova sincronia sonora. Use `nivel "clipes"` para conferir os valores aplicados.

## Critérios de aceite

- Escolhas coerentes com o roteiro; nenhuma transição na última cena ou em intervalos vazios; % de junções = pedido quando especificada. Distribuição automática é um recurso, não substitui a análise criativa da IA.
- `rejeitadas` = 0 ("transição desconhecida" = id fora do catálogo).

## Saída

"transições: fades de cinema em 24 junções, 3 viradas de assunto com fade escuro, 2 junções sob template sem transição".

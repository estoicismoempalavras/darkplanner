#!/usr/bin/env node
/**
 * MCP "darkplanner" — servidor stdio que expõe a API interna do app aos agentes CLI
 * do usuário (Claude Code, Codex, Antigravity, Grok). Ver docs/CHAT-IA.md.
 *
 * PROTOCOLO: JSON-RPC 2.0 em NDJSON (uma mensagem JSON por linha, SEM Content-Length).
 * REGRA DE OURO: stdout carrega SÓ JSON-RPC. Todo log vai pro stderr — um `console.log`
 * perdido aqui corrompe o transporte e o CLI derruba a conexão sem dizer por quê.
 *
 * CONFIG (env, injetada pelo Electron no spawn do CLI):
 *   DARKPLANNER_API_PORT  porta do FastAPI local (127.0.0.1) — VARIA por instância
 *   DARKPLANNER_TOKEN     valor do header X-Session-Token (16 bytes hex por sessão do app)
 *
 * ⚠️ DECISÃO DE PRODUTO PENDENTE — ESCOPO DO TOKEN.
 * Hoje o DARKPLANNER_TOKEN é o token de SESSÃO da UI (getSessionToken() no chat-ipc.js),
 * o mesmo que o Electron usa. Consequência: este servidor alcança TODA rota `Internal`,
 * que a X-API-Key pública NÃO alcança — e o app vai deixar IAs EXTERNAS do usuário
 * plugarem aqui. Enquanto não existir um token de escopo "agente" (mais fraco que o de
 * sessão), a contenção é feita NESTE arquivo: whitelist por verbo + ROTAS_NEGADAS do
 * chamar_api + o scrubber de saída (`limpar`). Ver docs/API_EXPOSICAO.md.
 *
 * Zero dependências. Node >= 20 (fetch e AbortSignal.timeout nativos).
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────

const fsMod = require('node:fs');
const pathMod = require('node:path');
const PORTA = String(process.env.DARKPLANNER_API_PORT || '').trim();
const TOKEN = String(process.env.DARKPLANNER_TOKEN || '').trim();
// Modo Time (delegação): só existe quando o Electron injeta a ponte. Ausente =
// o verbo `delegar` nem é listado (turno normal, ou turno DELEGADO — sem cascata).
const DELEG_PORT = String(process.env.DELEGACAO_PORT || '').trim();
const DELEG_TOKEN = String(process.env.DELEGACAO_TOKEN || '').trim();
const DELEG_CONVERSA = String(process.env.DELEGACAO_CONVERSA || '').trim();
// A conversa DESTE turno. Vem em todo turno (env separada da DELEGACAO_*, que
// só existe no Modo Time) porque é ela que diz em qual aba do chat a linha de
// progresso do `informar_progresso` tem de aparecer.
const CONVERSA = String(process.env.DARKPLANNER_CONVERSA || '').trim();
// Teto de uma linha de progresso: é UMA linha na conversa, não um relatório.
const PROGRESSO_MAX = 200;
const TIMEOUT_MS = 30000;
const BASE = `http://127.0.0.1:${PORTA}`;
const NOME_SERVIDOR = 'darkplanner';
const VERSAO = '1.0.0';
const PROTOCOLO_PADRAO = '2025-06-18';

function log(...args) {
  process.stderr.write(`[mcp-darkplanner] ${args.join(' ')}\n`);
}

if (!PORTA || !/^\d+$/.test(PORTA) || !TOKEN) {
  process.stderr.write(
    '[mcp-darkplanner] ERRO DE CONFIGURAÇÃO: faltam variáveis de ambiente.\n' +
      `  DARKPLANNER_API_PORT = ${PORTA ? PORTA : '(vazio)'}  (porta numérica do FastAPI local)\n` +
      `  DARKPLANNER_TOKEN    = ${TOKEN ? '(definido)' : '(vazio)'}  (header X-Session-Token)\n` +
      'Este servidor só roda lançado pelo Dark Planner Studio, que injeta as duas.\n'
  );
  process.exit(1);
}

// ─── Higiene de saída (scrubber) ──────────────────────────────────────────────
// DEFESA EM PROFUNDIDADE, não a regra: a regra é a whitelist por verbo. Isto existe
// porque o `chamar_api` é genérico e porque uma chave nova no backend não pode virar
// vazamento sozinha no próximo commit. Tudo que sai daqui pro modelo passa por `limpar`.
// A lista vem de docs/API_EXPOSICAO.md ("Nunca sai, em nenhuma rota").

const CHAVES_PROIBIDAS = new Set([
  // gpid do Google (injetado em params SEM prefixo `_` — local_client.py:2002)
  'google_project_id', 'gpid',
  // ids/URLs do transporte do Google (revelam a máquina de geração)
  'workflow_id', 'fife_url', 'thumbnail_url', 'servingBaseUri',
  // anti-detecção / economia
  'proxy_url', 'model_stats', 'tier', 'credits', 'allowed_tiers', 'active_tiers',
  // catálogo de vídeo do Google + versão do rules
  'video_models', 'schema_version',
]);

// Famílias inteiras: `_*` (params internos), `flow_native_*` (transporte nativo),
// `tier_*` e `captcha_*` (escada de captcha/VPN — os valores carregam o NOME do
// provedor, ex. "vpn:onevpn2").
const PREFIXOS_PROIBIDOS = ['_', 'flow_native_', 'tier_', 'captcha_'];

/**
 * `project_id` é AMBÍGUO: no jobs/projects é o id LOCAL (inteiro, legítimo e necessário
 * pros verbos); dentro de `params` de um job é o gpid do Google (string opaca), gravado
 * com o MESMO nome. Distinguimos pelo VALOR: inteiro (ou string só de dígitos) = local,
 * fica; qualquer outra coisa = gpid, sai.
 */
function ehProjectIdLocal(v) {
  return Number.isInteger(v) || (typeof v === 'string' && /^\d+$/.test(v.trim()));
}

function chaveProibida(chave, valor, dono) {
  if (PREFIXOS_PROIBIDOS.some((p) => chave.startsWith(p))) return true;
  if (CHAVES_PROIBIDAS.has(chave)) return true;
  if (chave === 'project_id') return !ehProjectIdLocal(valor);
  // `updated_at` é timestamp legítimo em job/projeto; só é proibido o do rules — que
  // aparece SEMPRE ao lado de `schema_version` (shape do /api/capabilities).
  if (chave === 'updated_at') return dono && Object.prototype.hasOwnProperty.call(dono, 'schema_version');
  return false;
}

/** Poda recursiva. Devolve um valor NOVO (nunca muta a resposta original). */
function limpar(valor) {
  if (Array.isArray(valor)) return valor.map(limpar);
  if (!valor || typeof valor !== 'object') return valor;
  const saida = {};
  for (const [k, v] of Object.entries(valor)) {
    if (chaveProibida(k, v, valor)) continue;
    saida[k] = limpar(v);
  }
  return saida;
}

// ─── Cliente HTTP da API local ────────────────────────────────────────────────

/** Erro "de negócio": vira isError:true no tools/call, com texto legível pro agente. */
class ErroApi extends Error {}

/**
 * Chama a API local. `caminho` já inclui a query string quando houver.
 * Devolve { json } quando a resposta é JSON, ou { texto } quando é texto puro
 * (o /api/docs/guide responde markdown — stringificar aquilo viraria um bolo de \n).
 */
async function chamar(metodo, caminho, corpo) {
  const url = BASE + caminho;
  const opcoes = {
    method: metodo,
    // X-DP-Cliente: o app marca no log do usuário o que foi feito PELO assistente.
    headers: { 'X-Session-Token': TOKEN, 'X-DP-Cliente': 'agente', Accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }

  let resp;
  try {
    resp = await fetch(url, opcoes);
  } catch (e) {
    const motivo = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
      ? `sem resposta em ${TIMEOUT_MS / 1000}s`
      : String((e && e.message) || e);
    throw new ErroApi(
      `Não consegui falar com o Dark Planner (${metodo} ${caminho}): ${motivo}.\n` +
        'Verifique se o app está ABERTO — a API local só existe enquanto ele roda.'
    );
  }

  const bruto = await resp.text();
  const tipo = resp.headers.get('content-type') || '';
  let dados = null;
  let ehJson = false;
  if (bruto && tipo.includes('json')) {
    try {
      dados = JSON.parse(bruto);
      ehJson = true;
    } catch {
      /* deixa como texto */
    }
  }

  if (!resp.ok) {
    // `detail` é o campo de erro do FastAPI — é ele que ensina o agente a se corrigir
    // (prompt vazio, model inexistente, projeto sem conta...).
    const detalhe = ehJson && dados && dados.detail !== undefined
      ? typeof dados.detail === 'string' ? dados.detail : JSON.stringify(dados.detail, null, 2)
      : (bruto || '(corpo vazio)').slice(0, 4000);
    throw new ErroApi(
      `Erro HTTP ${resp.status} em ${metodo} ${caminho}\n${detalhe}` +
        (resp.status === 401 ? '\n(token de sessão recusado — o app pode ter sido reiniciado)' : '')
    );
  }

  // TODA resposta da API passa pelo scrubber ANTES de virar contexto do modelo —
  // inclusive as que os verbos só consomem por dentro (o que eles leem, `limpar` preserva).
  return ehJson ? { json: limpar(dados) } : { texto: bruto };
}

const get = (caminho) => chamar('GET', caminho);
const post = (caminho, corpo) => chamar('POST', caminho, corpo === undefined ? {} : corpo);
const patch = (caminho, corpo) => chamar('PATCH', caminho, corpo === undefined ? {} : corpo);

// ─── Espera do lado do SERVIDOR (`esperar_s`) ─────────────────────────────────
// PORQUÊ: narração e leva de mídias levam MINUTOS, e o agente NÃO acorda sozinho
// depois que o turno termina — encerrar com "daqui a pouco eu confiro" é uma
// promessa que ele nunca cumpre (relato do dono). Sem isto a única alternativa
// dele era chamar o verbo de status em rajada, queimando uma ida-e-volta de
// modelo (e contexto) por checagem. Com `esperar_s` UMA chamada segura o turno
// por alguns segundos e volta com o estado terminal quando ele chega.
//
// TETO = 25s, POR CHAMADA. Cada CLI aplica seu próprio timeout à execução de
// ferramenta MCP, e esse valor NÃO está documentado em lugar nenhum deste repo:
// procurei por `MCP_TOOL_TIMEOUT`/`tool_timeout`/`startup_timeout` no repo
// inteiro (só bate dentro de um .exe compilado, ou seja, nada aproveitável) e no
// (doc de referência da orquestração) — lá os únicos timeouts são de
// OUTRA camada (watchdog de 60s do driver, handshake ACP de 20s, quota 3s,
// `session/prompt` com timeout 0 = infinito), nenhum deles por chamada de
// ferramenta. Os drivers do app (electron/src/main/agentes/*-driver.js) não
// impõem timeout de ferramenta nenhum: os `setTimeout` de lá são watchdog de
// SILÊNCIO (informativo, não mata o turno) e idle de pool. Sem evidência sólida,
// 25s é a escolha conservadora — cabe folgado abaixo dos 30s/60s que os CLIs
// costumam usar de padrão. Esperar mais é barato: o modelo repete a chamada, e
// repetição de tool call custa quase nada perto de um turno inteiro.
// O app pode SUBIR o teto por provider (DARKPLANNER_ESPERA_MAX_S): pro claude
// ele também fixa MCP_TOOL_TIMEOUT no spawn do CLI, então 120 s cabem. Sem a
// env (regressão, CLI avulso) vale o 25 conservador de sempre.
const ESPERA_MAX_S = Math.min(600, Math.max(25, parseInt(process.env.DARKPLANNER_ESPERA_MAX_S || '25', 10) || 25));
const ESPERA_DICA = 'esperar_s=' + ESPERA_MAX_S;
const ESPERA_PASSO_MS = 3000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lê `esperar_s` do args. Ausente/0/inválido = 0 (comportamento antigo, sem espera). */
function segundosDeEspera(args) {
  const v = args && args.esperar_s;
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), ESPERA_MAX_S);
}

/**
 * Polla `ler()` a cada ~3s até `ehTerminal(resposta)` ou estourar `segundos`.
 * Devolve SEMPRE a última resposta lida — estourar o teto não é erro, é "ainda
 * não terminou" (o agente repete a chamada e conta o progresso ao usuário).
 * A primeira leitura é imediata: com `esperar_s` num job já pronto a chamada
 * responde na hora, como o verbo sem espera.
 */
async function esperarAte(ler, ehTerminal, segundos) {
  const limite = Date.now() + segundos * 1000;
  let resposta = await ler();
  while (!ehTerminal(resposta)) {
    const restante = limite - Date.now();
    if (restante <= 0) break;
    await dormir(Math.min(ESPERA_PASSO_MS, restante));
    resposta = await ler();
  }
  return resposta;
}

/** listar_jobs {resumo: true}: a leva em NÚMEROS. Em campo (03/09/2026) cada
 *  checagem arrastava a lista inteira (70 jobs, 35 kB) só pra contar prontos. */
/** Job de MÍDIA = tem prompt_seq. Os outros (create_project, create_google_project,
 *  image_upload…) são SETUP: existem, ocupam a fila, mas não são cena. */
const ehJobDeMidia = (j) => !!j && j.prompt_seq != null && String(j.prompt_seq) !== '';
/** CAUSA provável do erro de um job, pela string que o backend grava (não há
 *  campo categórico na API). A conduta por causa vai nas descrições dos verbos. */
function causaDoErro(texto) {
  const t = String(texto || '');
  if (!t) return null;
  if (/get_token|session_expired|SessionExpired|session dead|sem token|refresh falhou|\b401\b|\b403\b/i.test(t)) return 'sessao';
  if (/Limite di[aá]rio|DAILY_QUOTA|\bquota\b|insufficient|cr[eé]ditos? insuficientes/i.test(t)) return 'quota';
  if (/UNSAFE_GENERATION|SEXUAL|DANGER_FILTER|PROMINENT_PEOPLE|\bMINOR\b|AUDIO_FILTERED|pol[ií]ticas|policies/i.test(t)) return 'filtro';
  if (/UNUSUAL_ACTIVITY|cooldown|rate ?limit|too many|\b429\b/i.test(t)) return 'cooldown';
  if (/n[aã]o existe\. V[aá]lidos|value_error|\b422\b|modelo inv[aá]lido/i.test(t)) return 'configuracao';
  if (/getaddrinfo|timeout|timed out|ECONN|network|conex[aã]o/i.test(t)) return 'rede';
  return 'outro';
}
function resumirJobs(lista) {
  const vivos = lista.filter((j) => j && j.status !== 'deleted');
  const midias = vivos.filter(ehJobDeMidia);
  const setup = vivos.filter((j) => !ehJobDeMidia(j));
  const por = {};
  for (const j of midias) por[j.status] = (por[j.status] || 0) + 1;
  const seqs = {};
  for (const j of midias) { const k = String(j.prompt_seq).split('.')[0]; if (k) seqs[k] = (seqs[k] || 0) + 1; }
  const duplicados = Object.keys(seqs).filter((k) => seqs[k] > 1).sort((x, y) => Number(x) - Number(y));
  const causas = {};
  for (const j of midias) if (j.status === 'failed') { const c = causaDoErro(j.error) || 'outro'; causas[c] = (causas[c] || 0) + 1; }
  return {
    // NÚMEROS DE MÍDIA (cenas): setup fica fora — 'prontos 160' de 158 cenas era o create_project contando.
    total: midias.length,
    prontos: por.done || 0,
    gerando: (por.pending || 0) + (por.processing || 0),
    falhos: por.failed || 0,
    na_lixeira: lista.length - vivos.length,
    ...(setup.length ? { setup: { total: setup.length, prontos: setup.filter((j) => j.status === 'done').length, gerando: setup.filter((j) => j.status === 'pending' || j.status === 'processing').length, falhos: setup.filter((j) => j.status === 'failed').length } } : {}),
    gerando_numeros: midias.filter((j) => j.status === 'pending' || j.status === 'processing').map((j) => j.prompt_seq).slice(0, 40),
    falhas: midias.filter((j) => j.status === 'failed').slice(0, 20).map((j) => ({ id: j.id, prompt_seq: j.prompt_seq, prompt: String(j.prompt || '').slice(0, 80), erro: String(j.error || '').slice(0, 120), causa: causaDoErro(j.error) })),
    ...(Object.keys(causas).length ? { causas } : {}),
    duplicados,
    nota: duplicados.length ? 'números com mais de um job: confira com listar_jobs e mande os ids sobrando em excluir_jobs.' : undefined,
  };
}
/** F0.3 (04/09/2026): editar sem mídia é o erro do fluxo de produção
 *  (Antigravity vinculou narração e aplicou direção com zero cena). O verbo
 *  não recusa — editar enquanto gera é permitido quando o usuário pediu — mas
 *  devolve o aviso, que no tema `producao` vira porta. */
const SEM_MIDIA = 'este projeto não tem cena com mídia: no fluxo de produção a edição só começa depois da porta de mídia (listar_jobs {resumo: true} com todos os números prontos e o projeto aberto no Studio pelo Creator). Editar antes só se o usuário pediu explicitamente.';
const comAvisoDeMidia = (resto, vazio) => (vazio ? { ...resto, aviso: resto && resto.aviso ? `${resto.aviso}; ${SEM_MIDIA}` : SEM_MIDIA } : resto);
/** Frase que o esperar_s devolve quando o teto estourou — ensina o passo seguinte. */
const NOTA_AINDA = (s) =>
  `Ainda não terminou depois de ${s}s de espera. NÃO encerre o turno prometendo voltar depois — ` +
  'você não acorda sozinho. Chame informar_progresso com UMA linha curta (não escreva uma mensagem: ela vira bolha nova) ' +
  'e chame este verbo de novo com ' + ESPERA_DICA + '.';

// ─── Helpers de argumentos ────────────────────────────────────────────────────

function exigirInteiro(args, campo) {
  const v = args[campo];
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (!Number.isInteger(n)) throw new ErroApi(`Argumento "${campo}" é obrigatório e deve ser um número inteiro.`);
  return n;
}

function exigirTexto(args, campo) {
  const v = args[campo];
  if (typeof v !== 'string' || !v.trim()) throw new ErroApi(`Argumento "${campo}" é obrigatório (texto não vazio).`);
  return v;
}

// ─── Shape público de um job (whitelist) ──────────────────────────────────────
// A linha crua de /api/projects/{id}/jobs é o SELECT * da tabela: params e result
// VIVOS. Params são mutados in-place pelo dispatch (o resolver apenda refs, o failover
// re-minta ids, o heal apaga campos) e o result cru traz workflow_id/fife_url/
// thumbnail_url — e, em image_upscale, o response INTEIRO do Google.
// docs/API_EXPOSICAO.md §1: eco = SNAPSHOT do submit, nunca params vivos.
//
// O snapshot `_echo` da §1 AINDA NÃO EXISTE no backend (é o item 2 da ordem sugerida).
// Até ele existir, montamos aqui a whitelist do que a §1 permite — de propósito SEM
// `start_image_id`/`end_image_id`/`reference_image_ids`: esses três só são seguros no
// snapshot; lidos VIVOS eles denunciam o resolver tag→referência e o failover
// multi-conta (§1, "Por que snapshot e não whitelist-do-vivo").
const JOB_PARAMS_PUBLICOS = [
  'prompt', 'quality', 'aspect_ratio', 'duration', 'seed', 'model',
  'ingredient_name', 'voice', 'voice_id',
  'animate', 'animate_quality', 'upscale',
  'provider', 'kind',
];

// Campos do `status` do diagnóstico que o agente PODE ver: são os que o guia ensina a
// ler (fila parada, extensão caída, disco cheio). Ficam de fora `logged_in`,
// `server_key_fresh`, `ws_clients`, `native_global`, o payload cru da extensão e a
// escada `tier_*`/`captcha_*` (esta última o scrubber também derruba).
const STATUS_PUBLICO = [
  'orchestrator_started', 'consumer_running', 'workers_running', 'workers_total',
  'accounts_active', 'accounts_total', 'accounts_reconnect', 'grok_logged_out',
  'jobs_pending', 'no_credit_video', 'extension_connected', 'rescue_active', 'disk_low',
];

/** result: PICK ESTRITO por chave — nunca spread do parsed (§1). */
const JOB_RESULT_PUBLICO = ['media_id', 'seed'];

/** params/result vêm como TEXT (JSON cru) na linha do banco — o scrubber não enxerga
 *  dentro de string, por isso a whitelist daqui é a única defesa nesses dois campos. */
function comoObjeto(v) {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? v[0] : null;
  return v && typeof v === 'object' ? v : null;
}

/** Monta o job público a partir da linha crua + (opcional) o resumo de /api/jobs/{id}. */
function jobPublico(linha, resumo) {
  const base = resumo ? { ...resumo } : {};
  const params = {};
  const p = comoObjeto(linha && linha.params) || {};
  const ehVideo = String((linha && linha.type) || (resumo && resumo.type) || '').startsWith('video');
  for (const c of JOB_PARAMS_PUBLICOS) {
    // `model` só existe em imagem: em vídeo quem escolhe o modelo é `quality` e o
    // params.model é IGNORADO — ecoá-lo entregaria uma model key de vídeo do Google.
    if (c === 'model' && ehVideo) continue;
    if (p[c] !== undefined && p[c] !== null) params[c] = p[c];
  }
  // Vocabulário do app, nunca o interno: 'lite_relaxed' se chama 'relaxed' aqui fora.
  if (params.quality === 'lite_relaxed') params.quality = 'relaxed';
  const result = {};
  const r = comoObjeto(linha && linha.result) || {};
  for (const c of JOB_RESULT_PUBLICO) if (r[c] !== undefined && r[c] !== null) result[c] = r[c];
  return {
    id: linha && linha.id !== undefined ? linha.id : base.id,
    type: linha && linha.type !== undefined ? linha.type : base.type,
    status: linha && linha.status !== undefined ? linha.status : base.status,
    prompt_seq: linha ? linha.prompt_seq : undefined,
    media_id: base.media_id !== undefined ? base.media_id : result.media_id,
    error: linha && linha.error !== undefined ? linha.error : base.error,
    causa_provavel: causaDoErro((linha && linha.error !== undefined ? linha.error : base.error) || ''),
    file_path: linha && linha.file_path !== undefined ? linha.file_path : base.file_path,
    created_at: linha ? linha.created_at : base.created_at,
    updated_at: linha ? linha.updated_at : base.updated_at,
    source_snapshot: base.source_snapshot,
    params,
    result,
  };
}

// ─── Ferramentas ──────────────────────────────────────────────────────────────
// A DESCRIÇÃO é o manual do agente: diz o que a ferramenta faz, o que ela devolve
// e as armadilhas já pagas (ver docs/CICATRIZES.md e os gotchas do agent_docs.py).

const FERRAMENTAS = [
  {
    name: 'listar_projetos',
    description:
      'Lista todos os projetos do Creator (id, nome, status, conta vinculada, pasta de saída, prioridade, pausado). ' +
      'Use SEMPRE antes de qualquer ação que precise de project_id — nunca chute o id. ' +
      'account_id null significa projeto sem conta Google (projeto Grok-only).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => get('/api/projects'),
  },

  {
    name: 'criar_projeto',
    description:
      'Cria um projeto novo no Creator. Devolve { project_id, name, account_id, output_path }. ' +
      'account_id É O E-MAIL da conta Google (ex: fulano@gmail.com) — liste em contas_disponiveis. ' +
      'Se omitir, o app escolhe uma conta ativa e informa qual usou. ' +
      'ARMADILHA: criar projeto numa conta com can_generate:false é aceito, mas os jobs ficam pending PARA SEMPRE, sem erro — ' +
      'cheque contas_disponiveis antes. Nomes com acento viram pasta sem acento; nomes reservados (ex: "ingredients") são recusados.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do projeto (vira também o nome da pasta, sanitizado).' },
        account_id: { type: 'string', description: 'Opcional. E-mail da conta Google que vai executar TODOS os jobs deste projeto.' },
        pasta: { type: 'string', description: 'Opcional. Pasta COMPLETA onde as mídias deste projeto vão nascer (produção de canal: <pasta do canal>\\videos\\NN-slug\\midias). Sem cópia depois: elas já ficam lá.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    executar: (a) => {
      const corpo = { name: exigirTexto(a, 'name') };
      if (a.account_id) corpo.account_id = String(a.account_id);
      if (typeof a.pasta === 'string' && a.pasta.trim()) corpo.custom_path = a.pasta.trim();
      return post('/api/projects', corpo);
    },
  },

  {
    name: 'contas_disponiveis',
    description:
      'Contas Google que podem receber jobs: [{ account_id (o e-mail), status: active|quota_reached|reconnect|disabled, ' +
      'can_generate, cooldown_minutes }]. Consulte ANTES de criar projeto ou de mandar uma leva grande de prompts: ' +
      'can_generate:false = a conta não vai gerar agora (cota estourada ou precisa reconectar).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => get('/api/accounts/summary'),
  },

  {
    name: 'diagnosticar',
    description:
      'Diagnóstico completo do app numa chamada — use SEMPRE que o usuário disser que "travou", "não está gerando" ou ' +
      '"deu erro": workers/orquestrador/extensão/disco, contas (status, can_generate, cooldown_minutes), fila por status, ' +
      'últimas 10 falhas com o erro, e jobs processing parados há 10+ min. O guia do consultar_docs (seção ' +
      '"Suporte ao usuário") diz como interpretar cada campo e qual receita aplicar.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    // WHITELIST: o /api/status/diagnostico cru traz tier+credits por conta (a matriz
    // tier×custo é o ativo caro — §3) e, dentro de `status`, a escada de captcha/VPN
    // (`tier_active_id` chega a valer "vpn:<provedor>") — §2 diz que nada disso sai.
    // As contas vêm da rota que JÁ é whitelist estrita (/api/accounts/summary, §3).
    executar: async () => {
      const d = (await get('/api/status/diagnostico')).json || {};
      const st = d.status || {};
      const status = {};
      for (const c of STATUS_PUBLICO) if (st[c] !== undefined) status[c] = st[c];
      let contas = [];
      try {
        contas = (await get('/api/accounts/summary')).json || [];
      } catch {
        // summary indisponível: melhor diagnosticar sem contas do que devolver as cruas.
        contas = [];
      }
      return {
        json: {
          status,
          contas,
          fila: d.fila || {},
          falhas_recentes: d.falhas_recentes || [],
          possiveis_travados: d.possiveis_travados || [],
        },
      };
    },
  },

  {
    name: 'logs_recentes',
    description:
      'Os últimos eventos da tela Logs do app, com contexto (projeto, job, conta mascarada, tipo, provedor): job iniciado/' +
      'gerando/pronto/falhou (com o código do erro), cooldown de conta, sessão expirada, fila pausada/retomada, Grok. ' +
      'Use depois do diagnosticar pra ver O QUE aconteceu e quando — é a linha do tempo. nivel="warn" traz só avisos+erros; ' +
      'projeto filtra pelo nome. A resposta inclui o catálogo (código → significado).',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: 'Quantos eventos (padrão 100, máx 2000).' },
        nivel: { type: 'string', description: '"warn" = avisos + erros; "error" = só erros. Vazio = tudo.' },
        projeto: { type: 'string', description: 'Filtra pelo nome do projeto (contém, sem diferenciar maiúsculas).' },
      },
      additionalProperties: false,
    },
    executar: (a) => {
      const q = new URLSearchParams();
      q.set('n', String(a.n || 100));
      if (a.nivel) q.set('nivel', String(a.nivel));
      if (a.projeto) q.set('projeto', String(a.projeto));
      return get(`/api/logs/recentes?${q}`);
    },
  },

  {
    name: 'listar_jobs',
    description:
      'Lista os jobs (imagens/vídeos) de um projeto com status: pending | processing | done | failed | deleted. ' +
      'Por padrão traz a versão ENXUTA (id, tipo, status, prompt_seq, prompt cortado em 200 chars, arquivo, datas) — é a que você quer ' +
      'para ver o andamento sem arrastar JSONs gigantes. Passe completo:true só quando precisar dos params (prompt, qualidade, aspecto…) ' +
      'de vários jobs de uma vez (payload pesado). Para investigar UM job falhado, prefira detalhe_job. ' +
      'ACOMPANHAR UMA LEVA GERANDO: use ' + ESPERA_DICA + ' e REPITA a chamada até ninguém mais estar pending/processing — ' +
      'o verbo segura a resposta esperando aqui dentro, em vez de você chamar em rajada. A cada volta chame ' +
      'informar_progresso com UMA linha curta ("12/16 mídias prontas") — ela se sobrescreve; mandar mensagem a cada ' +
      'checagem enche a conversa de bolhas. E nunca encerre o turno prometendo conferir depois.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer', description: 'Id do projeto (veja listar_projetos).' },
        completo: { type: 'boolean', description: 'true = cada job com params/result públicos (prompt, qualidade, aspecto, media_id). Padrão false.' },
        resumo: { type: 'boolean', description: 'true = só CONTAGENS por status, números gerando, falhas (id + nº + prompt curto) e números DUPLICADOS — o que uma leva em andamento precisa, sem a lista inteira. Combine com esperar_s.' },
        esperar_s: {
          type: 'integer',
          description:
            `Segundos de espera DENTRO da chamada (máx ${ESPERA_MAX_S}) até nenhum job estar pending/processing. ` +
            'Esgotado o tempo, devolve o estado atual sem erro — chame de novo. Ausente = responde na hora, como sempre. ' +
            'Projeto sem job nenhum conta como terminal (volta na hora).',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const id = exigirInteiro(a, 'project_id');
      const espera = segundosDeEspera(a);
      // Polling na rota MAGRA (/jobs/bin) mesmo quando o pedido é `completo`: ela
      // já traz `status`, que é tudo que a espera precisa, e não arrasta
      // params/result a cada 3s. O payload pesado é buscado UMA vez, no fim.
      const lerBin = () => get(`/api/projects/${id}/jobs/bin`);
      // Estados vivos da tabela jobs: pending | processing (done | failed |
      // deleted são terminais). Lista vazia = nada gerando.
      const emVoo = (r) => (Array.isArray(r && r.json) ? r.json : [])
        .filter((j) => j && (j.status === 'pending' || j.status === 'processing')).length;
      // Sem `_nota` de teto estourado aqui de propósito: a resposta é um ARRAY e
      // embrulhá-la num objeto só quando o tempo acaba daria dois shapes pro
      // mesmo verbo. Quem ensina a repetir é a descrição.
      const ultimo = espera ? await esperarAte(lerBin, (r) => emVoo(r) === 0, espera) : null;
      if (a.resumo) { const r = ultimo || await lerBin(); return { json: resumirJobs(Array.isArray(r && r.json) ? r.json : []) }; }
      if (!a.completo) return ultimo || lerBin();
      // MESMA whitelist do detalhe_job: a rota /jobs devolve o SELECT * com params e
      // result VIVOS pro token de sessão. Passar isso adiante entregaria o gpid e o
      // response cru do Google em lote (docs/API_EXPOSICAO.md §1).
      const lista = (await get(`/api/projects/${id}/jobs`)).json;
      return { json: (Array.isArray(lista) ? lista : []).map((j) => jobPublico(j, null)) };
    },
  },

  {
    name: 'excluir_jobs',
    description:
      'Manda VÁRIOS jobs de uma vez para a lixeira do projeto (restaurável pela tela) — o mesmo que o DELETE /api/jobs/{id} um a um, ' +
      'sem 70 chamadas. Use depois de listar_jobs {resumo: true} apontar números duplicados: liste os jobs, escolha os ids sobrando e mande aqui. ' +
      'Até 100 ids por chamada. Não é irreversível, mas confirme com o usuário antes de apagar o que ele gerou de propósito.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Ids dos jobs (como vêm em listar_jobs).' },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const ids = Array.isArray(a.ids) ? a.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      if (!ids.length) throw new ErroApi('mande pelo menos um id em ids.');
      if (ids.length > 100) throw new ErroApi('no máximo 100 ids por chamada.');
      const excluidos = [];
      const falhas = [];
      for (const id of ids) {
        if (/[\\/]|\.\./.test(id)) { falhas.push({ id, erro: 'id inválido' }); continue; }
        try { await chamar('DELETE', `/api/jobs/${encodeURIComponent(id)}`); excluidos.push(id); }
        catch (e) { falhas.push({ id, erro: String((e && e.message) || e).slice(0, 160) }); }
      }
      return { json: { excluidos: excluidos.length, ids_excluidos: excluidos, falhas } };
    },
  },

  {
    name: 'detalhe_job',
    description:
      'Detalhe de UM job: status, error, media_id, file_path, tipo e datas. É por aqui que se lê o motivo de um job FALHADO ' +
      'antes de reescrever o prompt (fluxo de auto-cura: detalhe_job → reescrever → reenviar_prompt_do_job). ' +
      'IMPORTANTE: passe project_id junto para receber TAMBÉM params e result completos (prompt original, modelo, aspect ratio, ' +
      'referências) — sem project_id a API só devolve o resumo público, que não inclui o prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Id (uuid) do job.' },
        project_id: { type: 'integer', description: 'Opcional, mas recomendado: projeto dono do job, para vir com params/result completos.' },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const jobId = exigirTexto(a, 'job_id');
      const resumo = (await get(`/api/jobs/${encodeURIComponent(jobId)}`)).json;
      if (a.project_id === undefined || a.project_id === null) {
        return {
          json: {
            ...resumo,
            _nota:
              'Resumo público (sem params/result). Chame de novo com project_id para receber o prompt original e o result completos.',
          },
        };
      }
      const pid = exigirInteiro(a, 'project_id');
      const lista = (await get(`/api/projects/${pid}/jobs`)).json;
      const linha = Array.isArray(lista) ? lista.find((j) => String(j.id) === String(jobId)) : null;
      if (!linha) {
        return { json: { ...resumo, _nota: `O job não está no projeto ${pid} — confira o project_id.` } };
      }
      // MESMO shape do resumo público + params/result por WHITELIST (jobPublico).
      // Antes daqui saía a linha crua do banco: params vivos (com o gpid do Google
      // gravado como `project_id`) e result cru (workflow_id, fife_url, thumbnail_url
      // e, no upscale, o response inteiro do Google). Ver docs/API_EXPOSICAO.md §1.
      return { json: jobPublico(linha, resumo) };
    },
  },

  {
    name: 'enviar_prompts_texto',
    description:
      'Envia prompts para um projeto ESCREVENDO NA TELA do Creator — o texto entra no campo de prompts exatamente como o ' +
      'usuário colaria, e o app aplica TODAS as regras da tela (tags [i]/[v]/[iv], aspecto, modelos, qualidade, ingredientes ' +
      '[Nome], pares imagem+animação na mesma linha). REGRA DE OURO: repasse o texto CRU, do jeito que o usuário escreveu — ' +
      'um prompt por linha, na ordem — e NUNCA interprete, reescreva ou divida as tags você mesmo: quem entende o formato é o ' +
      'app, não você. O retorno confirma a ENTREGA à tela (com o nº de linhas), não a criação dos jobs — confirme com ' +
      'listar_jobs. Requer a janela do app aberta; a tela navega sozinha até o projeto. ' +
      'A TELA ENVIA O LOTE SOZINHA — NÃO existe botão a clicar. A resposta traz `jobs_criados` (quantos jobs nasceram de verdade): ' +
      '0 = nada foi gerado (a tela recusou ou não respondeu) — leia o erro e NUNCA reenvie às cegas, reenviar duplica o lote. ' +
      'PREFIRA `arquivo`: escreva os prompts num .txt na pasta do projeto (um por linha, na ordem) e passe o CAMINHO — o lote não viaja pela chamada e o arquivo fica de registro.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer', description: 'Id do projeto que vai receber os prompts (confira com listar_projetos).' },
        arquivo: { type: 'string', description: 'Caminho COMPLETO de um .txt com os prompts, um por linha, tags intactas. Vale no lugar de `texto` (até 400 kB).' },
        texto: {
          type: 'string',
          minLength: 1,
          description: 'O texto CRU dos prompts, um por linha, com as tags do usuário intactas. Não normalize nada.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const pid = exigirInteiro(a, 'project_id');
      let texto = typeof a.texto === 'string' ? a.texto : '';
      if (!texto.trim() && a.arquivo) {
        const caminho = String(a.arquivo).trim();
        if (!fsMod.existsSync(caminho)) throw new ErroApi(`arquivo não encontrado: ${caminho}`);
        if (fsMod.statSync(caminho).size > 400000) throw new ErroApi('arquivo grande demais (máx 400 kB).');
        texto = fsMod.readFileSync(caminho, 'utf-8').replace(/^\uFEFF/, '');
      }
      if (!texto.trim()) throw new ErroApi('mande os prompts em `texto` ou o caminho em `arquivo`.');
      const porta = String(process.env.DARKPLANNER_PONTE_PORT || '').trim();
      const token = String(process.env.DARKPLANNER_PONTE_TOKEN || '').trim();
      if (!porta || !token) {
        throw new ErroApi('O envio pela tela não está disponível nesta sessão (app desatualizado ou ponte indisponível) — peça ao usuário pra atualizar e reabrir o app.');
      }
      // CONFIRMAÇÃO DE FATO (F0.1, 04/09/2026): a tela envia sozinha, mas cria
      // os jobs UM A UM; lidos cedo demais, "fila vazia" virou "basta clicar em
      // Gerar" (Antigravity). O verbo conta os jobs ANTES, entrega o texto e
      // espera os jobs NASCEREM no /jobs/bin — só então devolve ok, com o número.
      const lerBin = () => get(`/api/projects/${pid}/jobs/bin`);
      // Só jobs de MÍDIA contam (têm prompt_seq): o create_project e o
      // provisionamento da 2ª conta entravam na conta (159 pra 158 linhas).
      const contar = (resp) => (Array.isArray(resp && resp.json) ? resp.json : []).filter((j) => j && j.status !== 'deleted' && ehJobDeMidia(j)).length;
      let antes = null;
      try { antes = contar(await lerBin()); } catch { antes = null; }
      const r = await fetch(`http://127.0.0.1:${porta}/enviar-prompts-texto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deleg-token': token },
        body: JSON.stringify({ project_id: pid, texto }),
      });
      const dados = await r.json().catch(() => null);
      // F0.1 (05/09/2026): a ponte responde em DUAS FASES — `aceito` (colou e
      // disparou) e `resultado` (quantos POSTs o backend aceitou + o primeiro
      // erro normalizado). "158 entregues, 0 jobs" era o aceite chegando antes
      // de os 158 POSTs voltarem 422 — e o erro real morria num toast.
      const linhas = Number(dados && dados.linhas) || 0;
      const sub = dados && Number.isFinite(+dados.submetidos) ? +dados.submetidos : null;
      const primeiro = dados && dados.primeiroErro && typeof dados.primeiroErro === 'object' ? dados.primeiroErro : null;
      const erroReal = primeiro ? `${primeiro.status ? primeiro.status + ': ' : ''}${primeiro.texto || ''}`.trim() : null;
      const falhosReais = dados && dados.falhos != null ? Number(dados.falhos) || 0 : 0;
      if (!dados || dados.ok !== true) {
        if (sub === 0 || (sub === null && primeiro)) {
          return {
            parcial: true,
            json: {
              ok: false, linhas_entregues: linhas, submetidos: 0, falhos: falhosReais || linhas, jobs_criados: 0,
              erro: erroReal || (dados && dados.erro) || 'a tela não submeteu nenhum job',
              causa: (primeiro && primeiro.categoria) || null,
              config: (dados && dados.config) || null,
              proximo_passo: 'NADA foi gasto. Corrija a CAUSA antes de qualquer reenvio (causa "configuracao" = modelo/aspecto inválidos: confira config_de_geracao/configurar_geracao; "autenticacao" = conta sem sessão: diagnosticar + logs_recentes). NUNCA reenvie os mesmos parâmetros; confira listar_jobs {resumo: true}.',
            },
          };
        }
        if (sub === null) throw new ErroApi(`A tela não aceitou o envio: ${(dados && dados.erro) || `HTTP ${r.status}`}`);
      }
      const esperados = sub !== null ? sub : linhas;
      const teto = Math.min(60, ESPERA_MAX_S);
      let criados = null;
      if (antes !== null && esperados > 0) {
        const depois = await esperarAte(lerBin, (resp) => contar(resp) >= antes + esperados, teto);
        criados = Math.max(0, contar(depois) - antes);
      }
      if (criados === 0 && esperados > 0) {
        return {
          parcial: true,
          json: {
            ok: false, linhas_entregues: linhas, submetidos: sub, falhos: falhosReais, jobs_criados: 0, config: (dados && dados.config) || null,
            causa: (primeiro && primeiro.categoria) || null,
            erro: erroReal || `a tela disparou o lote, mas NENHUM job de mídia apareceu na fila em ${teto}s — confira listar_jobs {resumo: true, esperar_s} ANTES de qualquer reenvio (reenviar duplica o lote)`,
          },
        };
      }
      // `config` = a MESMA configuração que o config_de_geracao devolve, tirada
      // da tela no instante do envio. Vem junto de propósito: se o agente pulou
      // a conferência prévia, ele descobre AQUI que a tela estava em N variações
      // — e não três verbos depois, com o lote inteiro já criado.
      const faltando = criados === null ? null : Math.max(0, esperados - criados);
      return {
        ...(falhosReais ? { parcial: true } : {}),
        json: {
          ok: falhosReais === 0,
          linhas_entregues: linhas,
          ...(sub !== null ? { submetidos: sub, falhos: falhosReais } : {}),
          ...(falhosReais ? { primeiro_erro: erroReal, causa: (primeiro && primeiro.categoria) || null, nota_falhas: `${falhosReais} linha(s) foram RECUSADAS pelo backend (veja primeiro_erro/causa) — corrija só essas; as outras já estão na fila` } : {}),
          ...(criados === null ? { nota: 'não deu pra contar os jobs (API fora?): confirme com listar_jobs {resumo: true}' } : { jobs_criados: criados }),
          ...(faltando ? { faltando, nota: `a tela ainda está criando os jobs (${criados}/${linhas}): acompanhe com listar_jobs {resumo: true, esperar_s}` } : {}),
          config: dados.config || null,
          proximo_passo:
            'confira a config aplicada acima (se as variações não forem o que o usuário quer, AVISE ele agora) e ' +
            'acompanhe a leva com listar_jobs {resumo: true, esperar_s} até ninguém mais estar gerando',
        },
      };
    },
  },

  {
    name: 'config_de_geracao',
    description:
      'SÓ LEITURA: o que a TELA do Creator aplicaria num envio AGORA — o MOTOR (quem gera, no vocabulário das tags) e ' +
      'quais motores esta tela oferece (`motores_disponiveis`), ' +
      'variações (cópias) por prompt, modelo e ' +
      'aspecto de imagem, qualidade/aspecto/duração de vídeo, upscale automático e imagens de referência na tela. ' +
      'CHAME ANTES de enviar_prompts_texto e confirme com o usuário em UMA linha quantas gerações vão sair ' +
      '("a tela está em 4 variações por prompt: 106 prompts viram ~424 gerações; mando assim?"). Existe porque as ' +
      'VARIAÇÕES por prompt NÃO têm tag de texto — são um ajuste da tela, e foi assim que um lote de 106 prompts virou ' +
      '424 gerações sem ninguém perceber. Você NÃO muda esses ajustes: o que estiver diferente do que o usuário quer, ' +
      'peça pra ele ajustar na tela. O que é controlado por TAG no próprio texto (tipo, aspecto, qualidade, duração, ' +
      'modelo) vem listado na resposta.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const porta = String(process.env.DARKPLANNER_PONTE_PORT || '').trim();
      const token = String(process.env.DARKPLANNER_PONTE_TOKEN || '').trim();
      if (!porta || !token) {
        throw new ErroApi('A configuração da tela não está disponível nesta sessão (app desatualizado ou ponte indisponível) — peça ao usuário pra atualizar e reabrir o app.');
      }
      let r;
      try {
        r = await fetch(`http://127.0.0.1:${porta}/config-de-geracao`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-deleg-token': token },
          body: '{}',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new ErroApi(`Não consegui falar com o Dark Planner: ${String((e && e.message) || e)}.\nVerifique se o app está ABERTO.`);
      }
      const dados = await r.json().catch(() => null);
      if (!dados || dados.ok !== true) {
        throw new ErroApi(`A tela não devolveu a configuração: ${(dados && dados.erro) || `HTTP ${r.status}`}`);
      }
      return {
        json: {
          ...(dados.config || {}),
          proximo_passo:
            'diga ao usuário, em UMA linha, o que vai acontecer (nº de prompts × variações = nº de gerações) e só envie depois do ok',
        },
      };
    },
  },

  {
    name: 'configurar_geracao',
    description:
      'APLICA na TELA do Creator os ajustes que o usuário confirmou (o irmão que escreve do config_de_geracao): o MOTOR ' +
      '(quem gera), variações ' +
      '(cópias) por prompt, imagens por geração, tipo padrão, qualidade, aspecto, duração, modelo de imagem e upscale ' +
      'automático. É por aqui que o motor muda de verdade: escrever a tag na linha não mexe no chip que o usuário vê. ' +
      'Fluxo obrigatório: config_de_geracao → CONFIRME com o usuário em UMA linha → configurar_geracao com o ' +
      'que ele confirmou → confira a resposta → só então enviar_prompts_texto. NUNCA mude um ajuste por iniciativa própria: ' +
      'só entra aqui o que o usuário pediu ou confirmou. Todos os campos são opcionais — mande SÓ os que mudam. A resposta é ' +
      'a configuração EFETIVA relida da tela, mais `aplicados` e `ignorados`: campo que a tela não aceitou (valor fora das ' +
      'opções dela, ou limite da própria tela, como uma duração que ela mantém no padrão) aparece em `ignorados` e você DIZ ' +
      'isso ao usuário — não finja que pegou. Os valores válidos são os que o config_de_geracao acabou de devolver.',
    inputSchema: {
      type: 'object',
      properties: {
        motor: { type: 'string', enum: ['flow', 'grok'], description: 'Quem gera (o motor da tela — o mesmo das tags [flow]/[grok]). Trocar o motor muda as opções dos outros campos: confira a resposta relida. Só peça um motor que a leitura mostrou em `motores_disponiveis` — "grok" só existe quando o usuário tem conta Grok; fora disso o pedido volta em `ignorados`.' },
        variacoes_por_prompt: { type: 'integer', minimum: 1, maximum: 4, description: 'Cópias de CADA prompt (1 a 4). É o número que multiplica a conta.' },
        imagens_por_geracao: { type: 'integer', enum: [4, 8, 12], description: 'Imagens que UMA geração de imagem traz. Só existe quando a leitura mostrou esse ajuste.' },
        tipo_padrao: { type: 'string', enum: ['imagem', 'video', 'imagem_animacao'], description: 'O que a tela faz com uma linha SEM tag.' },
        qualidade: { type: 'string', description: 'Qualidade do vídeo, no rótulo que o config_de_geracao mostrou (é ela que manda; não existe escolher modelo de vídeo por nome).' },
        aspecto: { type: 'string', description: 'Proporção, como aparece na tela (ex.: "16:9").' },
        duracao_s: { type: 'integer', minimum: 1, description: 'Duração do vídeo em segundos, entre as que a tela oferece.' },
        modelo_imagem: { type: 'string', description: 'Modelo de imagem, no rótulo que o config_de_geracao mostrou.' },
        upscale_automatico_de_imagem: { type: 'string', enum: ['2k', '4k', 'desligado'], description: 'Upscale aplicado depois de cada imagem. Só ajustável com a tela do Creator aberta.' },
        upscale_automatico_de_video: { type: 'string', enum: ['1080p', '4k', 'desligado'], description: 'Upscale aplicado depois de cada vídeo. Só ajustável com a tela do Creator aberta.' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const campos = a && typeof a === 'object' ? a : {};
      if (Object.keys(campos).length === 0) {
        throw new ErroApi('Diga o que mudar: mande só os campos que o usuário confirmou (ex.: { "variacoes_por_prompt": 1 }). Pra apenas OLHAR a tela, use config_de_geracao.');
      }
      const dados = await chamarPonteDaTela('configurar-geracao', campos);
      return {
        json: {
          ...(dados.config || {}),
          aplicados: dados.aplicados || [],
          ignorados: dados.ignorados || [],
          proximo_passo: (dados.ignorados && dados.ignorados.length)
            ? 'a tela NÃO aceitou tudo: diga ao usuário, em uma linha, o que ficou como está (veja `ignorados`) antes de enviar'
            : 'confirme em uma linha o que ficou valendo e siga pro enviar_prompts_texto',
        },
      };
    },
  },

  {
    name: 'plano_conversa',
    description:
      'CHECKLIST DE FASES na conversa (card que o usuário vê): todo trabalho com MAIS DE UMA fase começa por aqui — as fases na ordem, ' +
      'o que já existe na pasta (materiais) e as estimativas — e é ATUALIZADO a cada fase fechada (chame de novo com os estados novos: ' +
      'o card se redesenha no lugar, não cria outro). Sem botões e sem aprovação: o processo é automático. Estados: feita · atual · pendente · ' +
      'bloqueada (com `detalhe` dizendo o motivo — skill ausente, porta reprovada, projeto sem mídia). Trabalho de fase única não usa isto (use informar_progresso). ' +
      'O card volta quando o usuário reabre a conversa; `limpar: true` o remove ao terminar tudo.',
    inputSchema: {
      type: 'object',
      properties: {
        fases: {
          type: 'array', minItems: 2, maxItems: 12,
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string', description: 'Nome curto da fase ("Roteiro", "Narração e SRT", "Prompts", "Mídia", "Edição", "Render").' },
              estado: { type: 'string', enum: ['feita', 'atual', 'pendente', 'bloqueada'] },
              detalhe: { type: 'string', description: 'Uma linha: o que foi feito, o que falta ou o MOTIVO do bloqueio.' },
            },
            required: ['nome', 'estado'],
            additionalProperties: false,
          },
        },
        materiais: { type: 'array', items: { type: 'string' }, description: 'O que já existe (ex.: "roteiro: 10-roteiro.md (usuário)", "narração: job tts-…").' },
        estimativas: { type: 'object', additionalProperties: { type: 'string' }, description: 'Números curtos: {"duracao": "6 min", "cenas": "45", "jobs": "45"}.' },
        projeto: { type: 'string', description: 'Pasta ou projeto a que o checklist pertence.' },
        limpar: { type: 'boolean', description: 'true = remove o card (trabalho encerrado).' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const r = await chamarPonteDaTela('fases', { conversaId: CONVERSA, ...args }, 'A tela não mostrou o checklist de fases');
      return {
        json: {
          ok: true,
          ...(r && r.fases ? { fases: r.fases } : {}),
          proximo_passo: args.limpar
            ? 'checklist removido'
            : 'siga o trabalho; a cada fase fechada chame plano_conversa de novo com os estados atualizados (o card se redesenha no lugar)',
        },
      };
    },
  },
  {
    name: 'informar_progresso',
    description:
      'Atualiza a LINHA DE PROGRESSO do chat: uma linha só, que se SOBRESCREVE a cada chamada — o jeito certo de '
      + 'acompanhar fila/narração (com esperar_s) sem encher a conversa. Mensagem normal fica pra marcos (começo, '
      + 'problema, fim). Chame a cada volta do esperar_s com o número da vez ("28 de 40 mídias prontas") em vez de '
      + 'escrever isso ao usuário: escrever cria uma bolha nova por checagem e enterra a conversa.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: `A linha de agora, curta (até ${PROGRESSO_MAX} caracteres; o resto é cortado). Ex.: "28 de 40 mídias prontas".` },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const texto = exigirTexto(a, 'texto').trim().slice(0, PROGRESSO_MAX);
      await chamarPonteDaTela('progresso', { conversaId: CONVERSA, texto }, 'A tela não mostrou a linha de progresso');
      return {
        json: {
          ok: true,
          proximo_passo: 'siga o trabalho e chame de novo pra ATUALIZAR esta mesma linha — não mande uma mensagem por checagem',
        },
      };
    },
  },

  // ─── Studio: leitura + olhos (F2.1 de docs/STUDIO-MCP.md) ────────────
  // O documento do editor vive no renderer (localStorage), então TODOS estes
  // verbos passam pela ponte. Estes cinco NÃO editam nada — a edição é a F2.2,
  // logo abaixo. O contrato é a whitelist do renderer — o agente vê a língua do
  // editor (cena, camada, texto, legenda, áudio, faixa, segundos), nunca o
  // documento cru nem o vocabulário de quem gera a mídia.

  {
    name: 'studio_projetos',
    description:
      'Lista os projetos do Studio (o editor de vídeo do app): id, nome e quando cada um foi mexido pela última vez. '
      + 'É o PRIMEIRO passo de qualquer trabalho no Studio: você escolhe o projeto aqui, confirma com o usuário qual é, '
      + 'e abre com studio_abrir. Não precisa do editor aberto na tela.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const dados = await chamarPonteDoStudio('projetos', {});
      return {
        json: limpar({
          projetos: dados.projetos || [],
          aberto: dados.aberto || null,
          proximo_passo: 'confirme com o usuário qual projeto é e abra com studio_abrir',
        }),
      };
    },
  },

  {
    name: 'studio_criar_projeto',
    description:
      'Cria um projeto NOVO do Studio (o editor de vídeo do app), vazio, PRO TRABALHO EM SEGUNDO PLANO. '
      + 'Ele nasce fechado: este verbo NÃO abre a tela — abra com studio_abrir só se o usuário quiser VER o projeto. '
      + 'É assim que uma esteira de vários vídeos começa: cria um projeto por vídeo e edita cada um pelos bastidores '
      + '(studio_editar, studio_aplicar_template, studio_exportar aceitam `projeto` com o editor fechado). '
      + 'O NOME é como o usuário vai reconhecer o projeto na grade: use o título/slug do vídeo, curto (teto de 60 caracteres). '
      + 'Nome que JÁ EXISTE é recusado com o projeto existente na resposta — não crie um segundo com o mesmo nome: os outros '
      + 'verbos resolvem projeto por nome e dois iguais deixariam tudo ambíguo. Se o vídeo já tem projeto, use studio_projetos '
      + 'e trabalhe nele em vez de criar outro.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do projeto na grade (ex.: "Ep 03 — Pirâmides"). Até 60 caracteres, único entre os projetos do Studio. Use o MESMO nome do projeto do Creator (cortado em 60).' },
        creator_project_id: { type: ['integer', 'string'], description: 'OPCIONAL: project_id do Creator com as mídias deste vídeo — vincula os dois projetos (grade mostra o selo e o export cai na pasta do Creator).' },
      },
      required: ['nome'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const nome = exigirTexto(a, 'nome');
      const dados = await chamarPonteDoStudio('criar_projeto', { nome, ...(a.creator_project_id != null && a.creator_project_id !== '' ? { creator_project_id: a.creator_project_id } : {}) });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo:
            'o projeto está VAZIO e FECHADO: monte a timeline em segundo plano (studio_importar_midia, '
            + 'studio_vincular_narracao, studio_editar — todos aceitam `projeto`) e só abra com studio_abrir se o usuário quiser ver',
        }),
      };
    },
  },

  {
    name: 'studio_fechar',
    description:
      'FECHA o projeto que está aberto no Studio e volta pra grade de projetos — a mesma coisa que o usuário faz clicando '
      + 'em "Projetos Studio" na barra do editor. A última edição é salva antes de fechar, e o projeto continua editável '
      + 'em segundo plano depois (studio_editar com `projeto`). '
      + 'SÓ FECHE por pedido do usuário, ou quando um verbo EXIGIR — hoje só studio_restaurar exige, porque restaurar um '
      + 'ponto salvo com o projeto aberto seria apagado pelo salvamento automático. Nesse caso AVISE o usuário que você vai '
      + 'fechar o editor dele antes de fazer, e diga depois que fechou. Fechar a tela de alguém sem avisar é mexer no que ele '
      + 'está olhando. Se não houver projeto aberto, o verbo não faz nada e diz isso (não é erro).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const dados = await chamarPonteDoStudio('fechar', {});
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: dados.fechado
            ? 'o editor está na grade: siga o que você ia fazer (studio_restaurar, ou trabalhar em outro projeto)'
            : 'não havia nada aberto — siga o que você ia fazer',
        }),
      };
    },
  },

  {
    name: 'studio_abrir',
    description:
      'Abre um projeto no Studio: navega até o editor e carrega o projeto, como o usuário faria clicando na grade. '
      + 'Aceita o id (de studio_projetos) ou o NOME — nome que casa com mais de um projeto volta com os candidatos pra '
      + 'você PERGUNTAR ao usuário, nunca escolher por ele. A resposta já é o resumo do projeto aberto (duração, '
      + 'aspecto, contagens por tipo, faixas). Abrir dá a captura EXATA (studio_capturar fotografa o preview de verdade); '
      + 'com o editor fechado studio_capturar ainda funciona, montando o quadro nos bastidores.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou nome do projeto do Studio (studio_projetos lista os dois).' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const projeto = exigirTexto(a, 'projeto');
      const dados = await chamarPonteDoStudio('abrir', { projeto });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...comAvisoDeMidia(resto, !(resto && resto.contagens && resto.contagens.cena)),
          proximo_passo: 'leia os clipes com studio_estado (nivel "clipes", com filtro) e VEJA o resultado com studio_capturar',
        }),
      };
    },
  },

  {
    name: 'studio_estado',
    description:
      'Lê o projeto do Studio em três níveis, do mais barato pro mais caro: "resumo" (duração, aspecto, se há narração '
      + 'vinculada, quantos itens de cada tipo e as faixas com mudo/volume), "faixas" (só o mapa das faixas) e "clipes" '
      + '(a lista de itens com id, tipo, faixa, início e duração em segundos, mais as propriedades principais de cada tipo). '
      + 'COMECE pelo resumo e só desça pra "clipes" com filtro — por tipo (kind) e/ou por janela de tempo (deS/ateS) — '
      + 'senão a resposta vem cortada num teto e você perde o que importa. Os ids que voltam aqui são os que os outros '
      + 'verbos aceitam. Um clipe com `midia_faltando: true` é o VERMELHO que o usuário vê na timeline: o arquivo daquela '
      + 'mídia não está mais no disco (o projeto guarda o caminho do original, não uma cópia). Avise o usuário — ele repõe '
      + 'o arquivo no lugar de origem, ou aquele trecho sai preto no vídeo. '
      + 'Dois níveis são o MAPA para a ação "inteligente" de studio_destaques: "roteiro" devolve um bloco por fala com o '
      + '`id` (é o blocoId da proposta), o texto, o `grupo` de vizinhos (blocos do mesmo grupo podem virar UM destaque via '
      + 'blocoIds), os `sinais` que o motor detectou (ano, número, pergunta, nome, referência bíblica… com o token) e o '
      + 'destaque que o bloco já tem; "destaques" lista os destaques com estilo, origem (ia/sorteio/manual), bloco e a '
      + 'âncora na palavra dita. O resumo traz o `idioma` do roteiro (proponha textos NESSE idioma) e a `predefinicao` ativa. '
      + 'Sem `projeto`, vale o que estiver aberto no editor.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou nome do projeto. Sem isto, o que estiver aberto no Studio.' },
        nivel: { type: 'string', enum: ['resumo', 'faixas', 'clipes', 'roteiro', 'destaques'], description: 'Quanto detalhe (padrão: resumo). "roteiro" e "destaques" são os mapas para propor destaques.' },
        filtro: {
          type: 'object',
          description: 'Para nivel "clipes", "roteiro" e "destaques": recorta o que volta (kind só em clipes).',
          properties: {
            kind: { type: 'string', enum: ['cena', 'camada', 'avatar', 'texto', 'legenda', 'audio', 'forma', 'composto', 'efeito'], description: 'Só itens deste tipo.' },
            deS: { type: 'number', minimum: 0, description: 'Só itens que existem a partir deste segundo.' },
            ateS: { type: 'number', minimum: 0, description: 'Só itens que começam antes deste segundo.' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('estado', {
        projeto: args.projeto,
        nivel: args.nivel,
        filtro: args.filtro,
      });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: resto.aviso
            ? 'a lista veio cortada: refine o filtro (kind, deS, ateS) antes de decidir qualquer coisa'
            : 'peça um item específico com studio_clipe e confira o resultado com os olhos (studio_capturar)',
        }),
      };
    },
  },

  {
    name: 'studio_clipe',
    description:
      'Detalha UM item da timeline do Studio: os mesmos campos da lista mais estilo, transformações, ajustes de cor, '
      + 'animações e as CURVAS de keyframes completas ({propriedade: [{emS, valor}]}, com emS contado do início do clipe). '
      + 'Chame ANTES de mexer numa animação que já existe: "definir_keyframes" substitui a curva inteira, então você '
      + 'precisa ler o que há hoje pra não apagar pontos sem querer. O par tipo+id vem do studio_estado nivel "clipes".',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['cena', 'camada', 'avatar', 'texto', 'legenda', 'audio', 'forma', 'composto', 'efeito'], description: 'O tipo do item, como veio no studio_estado.' },
        id: { type: 'string', description: 'O id do item, como veio no studio_estado.' },
        projeto: { type: 'string', description: 'Id ou nome do projeto. Sem isto, o que estiver aberto no Studio.' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('clipe', { kind: args.kind, id: args.id, projeto: args.projeto });
      const { ok, ...resto } = dados;
      return { json: limpar(resto) };
    },
  },

  {
    name: 'studio_capturar',
    description:
      'Os SEUS OLHOS no editor: devolve o CAMINHO de um PNG do quadro — abra esse arquivo como IMAGEM pra realmente ver '
      + '(ler o caminho não mostra nada). Com `atS`, o quadro daquele segundo; sem, o quadro em que a agulha está. '
      + 'FUNCIONA NOS DOIS MODOS: com o projeto ABERTO no editor é a FOTO do preview (a composição real, tudo desenhado); '
      + 'com o editor FECHADO, mande `projeto` e eu monto o quadro NOS BASTIDORES com o motor de render — sem abrir nada, '
      + 'sem tirar o usuário da tela dele. O still do bastidor é o mesmo desenho do preview NAQUILO QUE O MOTOR COBRE; '
      + 'quando o trecho tem algo que ele não desenha (template, efeito de shader, destaque em selo, legenda muito '
      + 'customizada) a resposta vem com `aproximado: true` e `motivo` — nesse caso NÃO garanta ao usuário que conferiu '
      + 'aquele detalhe: ou abra o projeto com studio_abrir e capture de novo, ou diga a ele o que ficou de fora. '
      + 'MÍDIA POR REFERÊNCIA: o projeto aponta pros arquivos no disco do usuário — arquivo movido ou apagado rende o '
      + 'clipe PRETO no still, igual ao que sairia no vídeo exportado (é achado, não bug do olho). '
      + 'Use depois de editar pra CONFERIR o que mudou (legenda cobrindo o rosto, texto fora do quadro, cena preta) em '
      + 'vez de garantir ao usuário um resultado que você não viu. As capturas são temporárias: só as últimas ficam no disco.',
    inputSchema: {
      type: 'object',
      properties: {
        atS: { type: 'number', minimum: 0, description: 'Segundo do vídeo a ver. Sem isto, o quadro em que a agulha já está (ou o segundo 0, no bastidor).' },
        projeto: { type: 'string', description: 'Id ou nome do projeto. Necessário quando o editor NÃO está aberto nele — é o que liga o still de bastidor.' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const pedido = {};
      if (args.atS !== undefined) pedido.atS = args.atS;
      if (args.projeto !== undefined) pedido.projeto = args.projeto;
      const dados = await chamarPonteDoStudio('capturar', pedido);
      const bastidor = dados.origem === 'bastidor';
      return {
        json: limpar({
          caminho: dados.caminho,
          atS: dados.atS,
          origem: dados.origem || null,
          aproximado: dados.aproximado === true ? true : null,
          motivo: dados.motivo || null,
          falhas: dados.falhas || null,
          proximo_passo: dados.aproximado
            ? 'ABRA o PNG pra ver o quadro, mas NÃO afirme nada sobre o que o `motivo` diz que ficou de fora — pra isso, studio_abrir e capture de novo'
            : (bastidor
              ? 'ABRA esse arquivo como imagem pra ver o quadro (montado nos bastidores, com o editor fechado); se algo estiver errado, conserte e capture de novo'
              : 'ABRA esse arquivo como imagem pra ver o quadro; se algo estiver errado, conserte e capture de novo'),
        }),
      };
    },
  },

  // ─── Studio: edição em lote (F2.2 de docs/STUDIO-MCP.md) ─────────────
  // O coração do contrato. Cada operação vira a MESMA action que o clique do
  // usuário dispara — os gates do editor continuam mandando, e o que eles
  // recusarem volta em `rejeitadas` com o motivo, nunca como erro mudo.

  {
    name: 'studio_editar',
    description:
      'EDITA a timeline do Studio: um LOTE de operações aplicadas em ordem, cada uma igual ao gesto que o usuário faria '
      + 'na mão (mover, aparar, dividir, remover, duplicar, ajustar propriedades, adicionar texto/forma/áudio/legenda/cenas, '
      + 'volume e mudo de faixa, recolar, aplicar legendas, converter cena↔camada, ANIMAR por keyframes). '
      + 'Os IDS VÁLIDOS de efeito, filtro, transição, animação, estilo, fonte e Look vêm do studio_catalogo — id inventado '
      + 'é aceito pelo campo e não vira nada na tela. '
      + 'KEYFRAMES (em cena E em camada — numa camada x/y são deslocamento em % sobre pos e scale multiplica o tamanho): "definir_keyframes" SUBSTITUI a curva de UMA propriedade '
      + '(x, y, scale, rotate, opacity e as da máscara), com `pontos: [{emS, valor}]` — e `emS` é contado do INÍCIO DO '
      + 'CLIPE, não da régua do vídeo (ponto fora da duração do clipe é recusado). Zoom animado (Ken Burns) é '
      + '{"op":"definir_keyframes","kind":"cena","id":"sc1","propriedade":"scale","pontos":[{"emS":0,"valor":1},{"emS":5,"valor":1.2}]}. '
      + '"limpar_keyframes" sem `propriedade` apaga TODAS as curvas daquele clipe. A curva atual você lê no studio_clipe. '
      + 'FAIXA AVATAR (vídeo pronto, sem gerar): adicionar_avatar com nome do vídeo do bin e modo "inteiro" coloca desde zero; "distribuir" com pct seleciona cenas completas por DURAÇÃO no prefixo coberto; "primeira" escolhe exatamente a primeira cena; "intercalar" usa início/intervalo/quantidade; "cenas" exige ids ou números 1-based; "selecao" usa ids explícitos ou a seleção atual; "agulha" usa emS (ou a agulha do Studio aberto). Cenas inválidas, sobrepostas, travadas, sob template normal ou fora da duração da fonte são recusadas/relatadas; candidatos válidos podem ser aplicados. seed torna o sorteio repetível. cortar_avatar com cenaId divide o avatar nas DUAS bordas dessa cena num gesto, preservando o trecho-fonte; id opcional limita o clipe alvo. Os itens são kind "avatar", faixa "avatar:0", áudio inicialmente mudo. Ajustes visuais e keyframes são próprios; transição nos campos do avatar exige cenaId e edita somente a junção da cena de baixo, com um som. Leia matriz tema "avatar". '
      + 'AVATAR (HeyGen): "reservar_avatar" marca as cenas dos `ids` como RESERVADAS pro avatar falante (a lacuna que a '
      + 'narração vira depois) — {"op":"reservar_avatar","ids":["sc5","sc12"],"avatar":"Gertrudes"}. O avatar é o NOME (ou '
      + 'id) de um avatar da conta HeyGen; conta desconectada ou nome que não existe é recusado com a lista. "limpar_avatar" '
      + 'com `ids` tira a reserva. A GERAÇÃO/preenchimento do vídeo do avatar é um passo à parte — aqui só se reserva. '
      + 'RETEMPORIZAR é o jeito CERTO de casar as cenas com o mapa de tempo da narração (o srt de sincronia): '
      + '{"op":"retemporizar","itens":[{"id":"sc1","emS":0,"duracaoS":4.2},{"id":"sc2","emS":4.2,"duracaoS":3.8}, …]} — '
      + 'TODAS as cenas numa ÚNICA operação (até 200), num passo de desfazer só. NUNCA re-temporize cena a cena com '
      + '"mover"/"aparar_direita": 58 cenas viram 58 operações, dezenas de lotes e meia hora de trabalho para o que é uma chamada. '
      + 'REGRAS QUE VALEM SEMPRE: (1) chame studio_estado ANTES — todo alvo é por id REAL e todo tempo é em SEGUNDOS '
      + 'absolutos da régua do vídeo, nunca "o terceiro clipe" nem posição de tela; (2) lotes PEQUENOS e conferidos: '
      + 'edite poucas coisas, chame studio_capturar e VEJA o resultado antes de continuar; (3) `rejeitadas` NÃO é erro — '
      + 'é o editor dizendo que aquilo não cabia (colisão, mínimo de 0,5s, id que sumiu). Leia o motivo, conte ao usuário '
      + 'o que entrou e o que não entrou, e não invente que deu tudo certo; (4) operações DESTRUTIVAS (substituir_cenas, '
      + 'resetar_estilos, faixa_remover, e remover com mais de 10 ids) exigem que você PERGUNTE ao usuário na conversa e '
      + 'só então reenvie a operação com confirmacao: true; (5) errou? studio_desfazer volta atrás. '
      + 'O lote inteiro costuma virar UM passo de desfazer. '
      + 'EM MASSA (M5): {"op":"aplicar_por_cena","eixo":"movimento|overlays|transicoes|animacoes|filtro|limpar","conjunto":"<id da matriz>" | "itens":[ids],"pct":30,"alvo":{"kind":"imagem|video","deS","ateS","ids","excluirTemplates"},"seed"} '
      + 'faz "movimento em todas as cenas", "overlays em 30%", "troque as transições por fades" ou "entradas em pares" NUMA operação: a distribuição '
      + '(rotação sem repetir vizinho, overlays espaçados por contagem, transições por junção, pares harmônicos, só imagem para movimento, fora de '
      + 'template) é do editor, determinística pela seed; `aplicadas[].nota` conta o que entrou e o que ficou de fora. Os conjuntos estão em matriz '
      + '{tema:"conjuntos"}; "filtro" leva `id` (+`forca`); "limpar" leva `de` (o eixo a limpar). '
      + 'FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a edição acontece em SEGUNDO PLANO, sem tirar o '
      + 'usuário da tela em que ele está — ele pode estar gerando um projeto, ajustando contas ou pedindo outro vídeo '
      + 'noutro chat. Se ele ABRIR esse projeto, passa a ver a edição AO VIVO daí em diante (a troca é automática, lote '
      + 'a lote). Com o editor fechado NÃO há Ctrl+Z: a volta atrás é o studio_restaurar, e todo lote em segundo plano '
      + 'salva sozinho um ponto "antes-do-lote". Um projeto só aceita UM chat editando por vez.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto a editar (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a edição roda em segundo plano.' },
        operacoes: {
          type: 'array',
          minItems: 1,
          maxItems: 40,
          description: 'As operações, na ordem em que devem acontecer (máximo 40 por chamada).',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'mover', 'aparar_direita', 'aparar_esquerda', 'dividir', 'remover', 'duplicar',
                  'vincular', 'desvincular', 'ajustar',
                  'adicionar_texto', 'adicionar_forma', 'adicionar_audio', 'adicionar_legenda', 'adicionar_cenas', 'adicionar_camada',
                  'faixa_volume', 'faixa_silenciar', 'faixa_remover', 'recolar', 'aplicar_srt', 'retemporizar',
                  'converter_em_camada', 'converter_em_cena', 'legenda_para_texto',
                  'definir_keyframes', 'limpar_keyframes',
                  'reservar_avatar', 'limpar_avatar', 'adicionar_avatar', 'cortar_avatar',
                  'substituir_cenas', 'resetar_estilos',
                ],
                description: 'O que fazer.',
              },
              kind: { type: 'string', enum: ['cena', 'camada', 'avatar', 'texto', 'legenda', 'audio', 'forma', 'composto', 'efeito'], description: 'O tipo do item, como veio no studio_estado.' },
              modo: { type: 'string', enum: ['inteiro', 'distribuir', 'primeira', 'intercalar', 'cenas', 'selecao', 'agulha'], description: 'Em adicionar_avatar: inteiro desde zero; distribuir por porcentagem; primeira = cena 1; intercalar = início/intervalo/quantidade; cenas = ids ou números 1-based; selecao = ids ou seleção atual; agulha = emS ou agulha do Studio.' },
              pct: { type: 'number', minimum: 0, maximum: 100, description: 'Em adicionar_avatar modo distribuir: porcentagem de DURAÇÃO, escolhendo cenas inteiras dentro do prefixo coberto pelo avatar.' },
              seed: { type: 'string', description: 'Semente do sorteio de avatar; mesma entrada e seed mantêm a seleção.' },
              ids: { type: 'array', items: { type: 'string' }, description: 'Cenas candidatas explícitas para selecao; em modo cenas, exclusivo de numeros.' },
              numeros: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Números 1-based das cenas para modo cenas; não misture com ids.' },
              inicioCena: { type: 'integer', minimum: 1, description: 'Modo intercalar: primeira posição 1-based.' },
              intervalo: { type: 'integer', minimum: 1, description: 'Modo intercalar: passo entre cenas.' },
              quantidade: { type: ['integer', 'null'], minimum: 1, description: 'Modo intercalar: número de cenas; nulo = todas as válidas.' },
              emS: { type: 'number', minimum: 0, description: 'Modo agulha: tempo explícito em segundos; obrigatório no Studio fechado.' },
              cenaId: { type: 'string', description: 'Id real da cena principal em cortar_avatar ou ao ajustar uma transição de kind avatar. A cena fornece os dois limites ou a junção compartilhada.' },
              id: { type: 'string', description: 'Id do item alvo (studio_estado nivel "clipes").' },
              ids: { type: 'array', items: { type: 'string' }, description: 'Vários alvos do MESMO tipo (remover, duplicar, ajustar).' },
              todos: { type: 'boolean', description: 'Em "ajustar": aplica em TODOS os itens do tipo (ex.: baixar o volume de todos os áudios).' },
              emS: { type: 'number', minimum: 0, description: 'Tempo em segundos ABSOLUTOS da régua: destino do "mover", ponto do "dividir", onde nasce o item novo.' },
              duracaoS: { type: 'number', minimum: 0.1, description: 'Em "aparar_direita": a duração FINAL do clipe. Em "adicionar_*": quanto o item dura. CENA DE VÍDEO: duração e velocidade são ACOPLADAS — aparar_direita pra uma duração nova recalcula a velocidade sozinho pra caber o MESMO conteúdo (é o "esticar" de editor: encurtou = acelera, alongou = desacelera). Pra casar uma cena de vídeo com o tempo de uma fala, este é o jeito certo — não precisa mexer em velocidade na mão (mas dá, via ajustar {velocidade}, se quiser o efeito de câmera lenta/rápida por si só). Se o alongamento não pegar por colisão com o vizinho, reposicione os clipes de trás pra frente e tente de novo.' },
              deltaS: { type: 'number', description: 'Em "aparar_esquerda": quanto a borda esquerda anda (positivo encurta, negativo estica).' },
              faixa: {
                oneOf: [{ type: 'integer', minimum: 0, maximum: 7 }, { type: 'string' }],
                description: 'Número da faixa (0 a 7) nas operações de item; nas de faixa é a chave que o studio_estado mostra, ex.: "audio:0".',
              },
              ripple: { type: 'boolean', description: 'Em "remover": fecha o buraco deixado (as cenas seguintes puxam pra trás).' },
              campos: { type: 'object', description: 'Em "ajustar" (e opcional nos "adicionar_*"): as propriedades a mudar, com os MESMOS nomes que o studio_clipe mostra (volume, velocidade, filtro, efeito, transicaoOut, transformacao {x,y,scale} = o zoom do clipe, mascara = o recorte, ajustes {brilho,contraste,saturacao,temperatura}, pos, cor, texto…). Os ids de catálogo vêm do studio_catalogo. Campo desconhecido derruba a operação inteira, com a lista do que dá pra mexer.' },
              porKind: { type: 'object', description: 'Em "vincular"/"desvincular": os ids por tipo, ex.: {"cena":["sc1"],"audio":["au1"]}. Itens vinculados andam e somem juntos.' },
              midias: { type: 'array', items: { type: 'string' }, description: 'Em "adicionar_cenas"/"substituir_cenas": os NOMES dos arquivos já importados no projeto (nome ambíguo ou inexistente volta com a lista do que existe).' },
              texto: { type: 'string', description: 'Em "adicionar_texto"/"adicionar_legenda": o conteúdo.' },
              forma: { type: 'string', enum: ['rect', 'ellipse', 'line'], description: 'Em "adicionar_forma": retângulo, elipse ou linha.' },
              nome: { type: 'string', description: 'Em "adicionar_audio": o NOME do arquivo de áudio já importado no projeto. Em "adicionar_camada": o NOME da imagem/vídeo do projeto (inclusive os vídeos de avatar que o studio_avatar acao "midias" registra) que vai pra uma faixa de CIMA como camada — PiP, card, lado a lado. Uma camada aceita TUDO que uma cena aceita (mesmo vocabulário do studio_clipe), via "ajustar" ou nos `campos` da criação: transformacao {x,y,scale} = posição e tamanho da mídia no quadro (x/y em % do quadro a partir do centro; scale 1 = tela cheia e cobre a de baixo, 0.3 = PiP pequeno) — `pos` {x,y} em % do quadro e `scale` continuam aceitos como atalho e viram esse transform —, opacidade, rotacao, espelhado, enquadramento, mascara (tipos: circle pra bolinha, rect pra card com `round`, linear/mirror pra recorte, star, heart, text {texto} — o texto vira o recorte —, poly {pontos:[{x,y}] em % do quadro} e brush {tracos:[{w, pts}]}; campos x/y/w/h/rotate/feather/invert) e mascaras (lista de até 3 máscaras EXTRAS em união com a principal), corte {l,t,r,b} = recorte por lado em % da caixa da mídia (0–45; as alças laterais do gizmo), efeito/efeitosExtras, filtro/forcaDoFiltro, ajustes {brilho,contraste,saturacao,temperatura}, animIn/animOut/animDurS e keyframes (definir_keyframes com kind "camada", mesmas propriedades da cena). Isso é o que o CapCut faz com uma mídia em outra track — a composição (onde, tamanho, quando é PiP e quando é tela cheia) é sua decisão pelo conteúdo.' },
              pos: { type: 'object', description: 'Em "adicionar_camada": {x, y} em % do quadro onde fica o CENTRO da mídia (50/50 = meio; 85/18 = canto superior direito). Atalho: vira o transform da camada.' },
              scale: { type: 'number', minimum: 0.05, maximum: 1.5, description: 'Em "adicionar_camada": tamanho da mídia no quadro (0.3 = PiP pequeno, 0.5 = metade, 1 = tela cheia). Atalho: vira o transform.scale da camada. Padrão 1.' },
              avatar: { type: 'string', description: 'Em "reservar_avatar": o NOME (ou id) do avatar da conta HeyGen que vai preencher estas cenas. Nome ambíguo ou inexistente volta com a lista dos avatares da conta.' },
              volume: { type: 'number', minimum: 0, maximum: 4, description: 'Em "faixa_volume": 0 é mudo, 1 é o normal, 4 é o teto (+12 dB).' },
              silenciar: { type: 'boolean', description: 'Em "faixa_silenciar": true põe no mudo, false devolve o som (repetir não inverte).' },
              itens: {
                type: 'array',
                maxItems: 200,
                description: 'Em "retemporizar": TODAS as cenas e seus tempos numa lista só — [{id, emS, duracaoS}]. É o jeito certo de casar as cenas com o mapa de tempo (o srt de sincronia da narração): 58 cenas em UMA operação, nunca uma a uma.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Id da CENA (studio_estado nivel "clipes").' },
                    emS: { type: 'number', minimum: 0, description: 'Início da cena em segundos ABSOLUTOS da régua.' },
                    duracaoS: { type: 'number', minimum: 0.5, description: 'Duração da cena em segundos (opcional: sem ela, só o início muda).' },
                  },
                  required: ['id', 'emS'],
                  additionalProperties: false,
                },
              },
              blocos: {
                type: 'array',
                description: 'Em "aplicar_srt": as falas com tempo próprio [{iniS, fimS, texto}] — substitui as legendas de fala do projeto.',
                items: {
                  type: 'object',
                  properties: {
                    iniS: { type: 'number', minimum: 0 },
                    fimS: { type: 'number', minimum: 0 },
                    texto: { type: 'string' },
                  },
                  required: ['iniS', 'fimS', 'texto'],
                  additionalProperties: false,
                },
              },
              propriedade: {
                type: 'string',
                enum: ['x', 'y', 'scale', 'rotate', 'opacity', 'maskX', 'maskY', 'maskW', 'maskH', 'maskRot', 'maskFeather'],
                description: 'Em "definir_keyframes"/"limpar_keyframes": qual propriedade da cena ou camada é animada. Em "limpar_keyframes" é opcional (sem ela, apaga todas).',
              },
              pontos: {
                type: 'array',
                maxItems: 200,
                description: 'Em "definir_keyframes": a curva INTEIRA daquela propriedade — [{emS, valor}], com emS em segundos contados do INÍCIO do clipe (0 = primeiro quadro dele).',
                items: {
                  type: 'object',
                  properties: {
                    emS: { type: 'number', minimum: 0, description: 'Segundos DENTRO do clipe (0 até a duração dele).' },
                    valor: { type: 'number', description: 'Valor da propriedade nesse instante (scale 0.2 a 4, opacity 0 a 1, rotate em graus, x/y em % do quadro).' },
                  },
                  required: ['emS', 'valor'],
                  additionalProperties: false,
                },
              },
              confirmacao: { type: 'boolean', description: 'Só para as destrutivas, e SÓ depois de o usuário confirmar na conversa.' },
            },
            required: ['op'],
            additionalProperties: false,
          },
        },
      },
      required: ['operacoes'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('editar', { operacoes: args.operacoes, projeto: args.projeto });
      const { ok, ...resto } = dados;
      const rejeitadas = Array.isArray(resto.rejeitadas) ? resto.rejeitadas : [];
      return {
        json: limpar({
          ...resto,
          proximo_passo: rejeitadas.length
            ? 'CONTE ao usuário quais operações não entraram e por quê (o motivo está em `rejeitadas`) — não trate como se tivesse dado tudo certo'
            : (resto.bastidor
              ? 'editado em SEGUNDO PLANO (o editor está fechado): confira pelo `resumo` e VEJA o quadro com studio_capturar passando `projeto` (o still sai do motor, sem abrir o editor). Se ficou ruim, studio_restaurar volta pro ponto "antes-do-lote"'
              : 'confira o resultado com os OLHOS (studio_capturar) antes de seguir; se ficou ruim, studio_desfazer volta atrás'),
        }),
      };
    },
  },

  {
    name: 'studio_configurar',
    description:
      'Muda os ajustes do PROJETO inteiro no Studio (não de um clipe): formato do quadro, Look, template de estilo dos '
      + 'textos e das legendas, posição e caixa da legenda na tela, a configuração dos destaques e a TIPOGRAFIA '
      + '(fonte, tamanho, cor, contorno, sombra, brilho…) das legendas e dos textos livres. '
      + 'TUDO AQUI É GLOBAL: `tipografia_legenda` vale para TODAS as legendas do vídeo e `tipografia_texto` para TODOS '
      + 'os textos livres — para mexer em UM item só, use studio_editar com a operação "ajustar". '
      + 'Os objetos são MESCLADOS com o que já existe (mandar só a cor não apaga a fonte); mandar null no lugar do '
      + 'objeto inteiro volta ao padrão do estilo, e null num campo limpa só aquele campo. '
      + 'Cores em hex ("#FFD60A") ou rgba(); os ids (fonte, estilo, animação, Look) vêm do studio_catalogo — não invente. '
      + 'É o mesmo caminho dos painéis, então o editor clampa o que estiver fora de faixa e IGNORA o que não reconhecer — '
      + 'por isso a resposta diz o que foi `aplicados`, o que ficou `ignorados` e quais campos ele não conhecia (`avisos`): '
      + 'confie nela, não no que você pediu. '
      + 'Depois de mudar formato ou legenda, VEJA o resultado com studio_capturar: mudar o quadro reposiciona tudo. '
      + 'FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a mudança acontece em segundo plano; se o usuário '
      + 'abrir esse projeto, ele passa a ver as mudanças ao vivo.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto a configurar (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a mudança roda em segundo plano.' },
        aspecto: { type: 'string', description: 'Formato do quadro, ex.: "16:9", "9:16", "1:1".' },
        look: { type: 'string', description: 'Look do projeto (o mesmo nome do seletor do editor).' },
        estilo_texto: { type: 'string', description: 'Template de estilo dos textos livres.' },
        estilo_legenda: { type: 'string', description: 'Template de estilo das legendas.' },
        legenda_sob_templates: { type: 'string', enum: ['auto', 'mostrar', 'ocultar'], description: 'A legenda de fala sob templates: "auto" (padrão: some só onde o template já mostra a fala), "mostrar" (nunca some) ou "ocultar" (some sob qualquer template). Por bloco: studio_editar ajustar kind "composto" campos {legenda}.' },
        pos_legenda: {
          type: 'object',
          description: 'Posição da legenda na tela, em % do quadro.',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          additionalProperties: false,
        },
        caixa_legenda: {
          type: 'object',
          description: 'Caixa da legenda em % do quadro (largura manda na quebra de linha).',
          properties: { w: { type: 'number' }, h: { type: 'number' } },
          additionalProperties: false,
        },
        config_destaques: { type: 'object', description: 'Configuração dos destaques (as mesmas chaves do painel). Junta-se ao que já existe em vez de substituir tudo.' },
        tipografia_legenda: { type: ['object', 'null'], description: 'Tipografia GLOBAL de TODAS as legendas. Campos: fonte (id do studio_catalogo tipo "fontes"), tamanho (16 a 400), cor, fundo, negrito, italico, sublinhado, caixa ("upper"/"lower"/"title"), espacamento, altura_linha, contorno, contorno_cor, contorno_largura, sombra, sombra_cor, sombra_desfoque, sombra_distancia, sombra_angulo, brilho, brilho_cor, brilho_forca, opacidade_texto, gradiente, animacao, predefinicao. null volta ao padrão do estilo.' },
        tipografia_texto: { type: ['object', 'null'], description: 'Tipografia GLOBAL de TODOS os textos livres. Campos: fonte (id do studio_catalogo tipo "fontes"), tamanho (16 a 400), cor, fundo, negrito, italico, sublinhado, caixa ("upper"/"lower"/"title"), espacamento, altura_linha, contorno, contorno_cor, contorno_largura, sombra, sombra_cor, sombra_desfoque, sombra_distancia, sombra_angulo, brilho, brilho_cor, brilho_forca, opacidade_texto, gradiente, animacao, predefinicao. null volta ao padrão do estilo.' },
        animacao_legenda: {
          type: ['object', 'null'],
          description: 'Animação de entrada/saída da FAIXA DE LEGENDAS: {"entrada": id, "saida": id}. Os ids vêm do studio_catalogo tipo "animacoes". null tira as duas.',
          properties: { entrada: { type: ['string', 'null'] }, saida: { type: ['string', 'null'] } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('configurar', args);
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: resto.bastidor
            ? 'configurado em SEGUNDO PLANO (editor fechado): confira pelo `aplicados`/`resumo` e VEJA o quadro com studio_capturar passando `projeto` — mudar formato/legenda mexe no enquadramento de tudo'
            : 'veja o quadro com studio_capturar — mudança de formato/legenda mexe no enquadramento de tudo',
        }),
      };
    },
  },

  {
    name: 'studio_catalogo',
    description:
      'Lista os IDS que o editor aceita — o dicionário de que os outros verbos do Studio precisam. Os catálogos são: '
      + '"efeitos" (movimento do clipe), "filtros" (cor), "transicoes" (entre cenas, mais os sons de transição), '
      + '"animacoes" (entrada/saída de clipe e da legenda), "estilos_texto", "estilos_legenda" (inclui os de KARAOKÊ, '
      + 'marcados com exige_narracao: sem narração vinculada eles não têm palavra pra pintar), "looks" (o preset que '
      + 'restiliza o vídeo inteiro), "fontes", "destaques" (os estilos de destaque com papel, forma, faixa de palavras e se '
      + 'entram no automático — o contrato completo de cada um está em consultar_biblioteca), "predefinicoes" (as do sistema e '
      + 'as do usuário: nome, universo, ritmo, densidade e o que cada uma carrega — o nome entra em studio_aplicar_direcao) e '
      + '"templates" (o acervo físico: nome, cenas, duração — o nome entra em studio_aplicar_template). '
      + 'CHAME ANTES de mandar qualquer id em studio_editar ("ajustar" com efeito/filtro/transicaoOut/animIn/estilo) ou '
      + 'em studio_configurar (look, estilo_texto, estilo_legenda, tipografia): id inventado é aceito pelo campo e '
      + 'simplesmente não vira nada na tela, e você acharia que aplicou. '
      + 'Cada item traz o `id` (é ele que entra nos outros verbos) e as bandeiras que ajudam a escolher — em "efeitos", '
      + '`vale_para` diz se aquele efeito serve em vídeo ou só em imagem. '
      + 'É leitura pura: não precisa de projeto aberto e não muda nada.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['efeitos', 'filtros', 'transicoes', 'animacoes', 'estilos_texto', 'estilos_legenda', 'looks', 'fontes', 'destaques', 'predefinicoes', 'templates'],
          description: 'Qual catálogo listar.',
        },
      },
      required: ['tipo'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('catalogo', { tipo: args.tipo });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: 'use o `id` EXATO em studio_editar ("ajustar") ou studio_configurar, e confira o resultado com studio_capturar',
        }),
      };
    },
  },

  {
    name: 'studio_desfazer',
    description:
      'DESFAZ os últimos passos no Studio — o mesmo Ctrl+Z do usuário, no mesmo histórico. É a sua rede de segurança: '
      + 'errou a edição, desfaz e refaz direito, em vez de tentar "editar de volta" (o que empilharia mais passos). '
      + 'A resposta diz quantos passos ANDARAM de verdade: pedir 5 quando só havia 2 desfaz 2 e avisa. '
      + 'Um lote do studio_editar costuma ser UM passo só. '
      + 'SÓ VALE NO PROJETO ABERTO no editor: o histórico de Ctrl+Z vive na tela. Para o que foi editado em segundo '
      + 'plano (editor fechado), a volta atrás é studio_snapshots + studio_restaurar.',
    inputSchema: {
      type: 'object',
      properties: {
        passos: { type: 'integer', minimum: 1, maximum: 20, description: 'Quantos passos desfazer (padrão 1, teto 20).' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('desfazer', args.passos === undefined ? {} : { passos: args.passos });
      const { ok, ...resto } = dados;
      return { json: limpar({ ...resto, proximo_passo: 'confira com studio_estado (ou studio_capturar) que a timeline voltou ao que você esperava' }) };
    },
  },

  {
    name: 'studio_refazer',
    description:
      'REFAZ o que foi desfeito no Studio (o Ctrl+Shift+Z do usuário). Só funciona enquanto nada novo foi editado depois '
      + 'do desfazer — editar apaga o caminho de volta. A resposta diz quantos passos andaram de verdade.',
    inputSchema: {
      type: 'object',
      properties: {
        passos: { type: 'integer', minimum: 1, maximum: 20, description: 'Quantos passos refazer (padrão 1, teto 20).' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('refazer', args.passos === undefined ? {} : { passos: args.passos });
      const { ok, ...resto } = dados;
      return { json: limpar({ ...resto, proximo_passo: 'confira com studio_estado (ou studio_capturar) que a timeline está como você queria' }) };
    },
  },

  // ─── Studio: snapshots (F2.6a) — o desfazer do BASTIDOR ──────────────
  // O Ctrl+Z do editor é uma pilha que vive na TELA: com o projeto fechado ela
  // não existe. Estes três verbos são a rede de segurança equivalente pra
  // edição em segundo plano — ponto salvo em disco, no app, sem tocar no
  // arquivo de ninguém.

  {
    name: 'studio_snapshot',
    description:
      'SALVA um ponto de retorno do projeto no Studio — uma foto do documento inteiro, pra poder voltar depois. '
      + 'É o equivalente ao desfazer para quem edita com o editor FECHADO (o Ctrl+Z do studio_desfazer só existe no '
      + 'projeto aberto na tela). Use ANTES de uma mudança grande ou arriscada, e ponha um `rotulo` que descreva o '
      + 'estado ("antes de trocar as cenas"), porque é por ele que você vai reconhecer o ponto na lista. '
      + 'Todo lote do studio_editar em segundo plano já salva um "antes-do-lote" sozinho — este verbo é pros pontos '
      + 'que VOCÊ escolhe. Ficam os 20 mais novos por projeto; os mais velhos somem.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.' },
        rotulo: { type: 'string', description: 'Como você vai reconhecer este ponto depois, ex.: "antes de trocar as cenas".' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('snapshot', { projeto: args.projeto, rotulo: args.rotulo });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: 'guarde o `id`: é ele que volta no studio_restaurar (studio_snapshots relista quando você esquecer)',
        }),
      };
    },
  },

  {
    name: 'studio_snapshots',
    description:
      'LISTA os pontos de retorno salvos de um projeto do Studio, do mais novo pro mais velho, com `id`, `rotulo` e '
      + 'quando foram salvos. Chame ANTES do studio_restaurar — é daqui que sai o `id`. Os pontos "antes-do-lote" são '
      + 'os que o studio_editar salvou sozinho antes de cada lote em segundo plano. É leitura pura: não muda nada.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('snapshots', { projeto: args.projeto });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: (resto.total || 0)
            ? 'para voltar a um deles, chame studio_restaurar com o `id` — e AVISE o usuário antes, porque a edição feita depois daquele ponto se perde'
            : 'ainda não há ponto salvo neste projeto — studio_snapshot cria um agora',
        }),
      };
    },
  },

  {
    name: 'studio_restaurar',
    description:
      'VOLTA o projeto do Studio para um ponto salvo — o desfazer do bastidor. Substitui o documento inteiro pelo do '
      + 'snapshot, então TUDO que foi editado depois daquele ponto se perde: PERGUNTE ao usuário antes, sempre, e diga '
      + 'qual ponto (rotulo e hora) você vai restaurar. O `id` vem do studio_snapshots. '
      + 'Só funciona com o projeto FECHADO no editor: com ele aberto, o Studio tem o documento na memória e o '
      + 'salvamento automático dele jogaria a restauração fora — nesse caso, AVISE o usuário e feche o editor com '
      + 'studio_fechar (a última edição é salva antes), ou peça o Ctrl+Z na tela (ou use studio_desfazer, que é o '
      + 'histórico de verdade).',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.' },
        id: { type: 'string', description: 'O `id` do ponto salvo, como veio no studio_snapshots.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('restaurar', { projeto: args.projeto, id: args.id });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo: 'confira o `resumo` e CONTE ao usuário o que voltou — a edição feita depois daquele ponto não existe mais',
        }),
      };
    },
  },

  // ─── Studio: conteúdo (F2.3 de docs/STUDIO-MCP.md) ───────────────────
  // Os verbos que trazem MATÉRIA PRIMA e ESTILO pro projeto. Cada um aperta o
  // MESMO botão do editor que o usuário aperta (regra de ouro do contrato:
  // botão e verbo = uma implementação), então o resultado é idêntico ao da mão.
  //
  // A ORDEM que funciona, e que as descrições ensinam:
  //   importar mídia → ler o estado → vincular a narração → destaques/direção
  //   → editar o que faltar → CAPTURAR e ver com os próprios olhos.

  {
    name: 'studio_importar_midia',
    description:
      'IMPORTA arquivos do computador do usuário para o projeto aberto no Studio: imagens (jpg, png, webp), vídeos '
      + '(mp4, mov, webm) e áudios (mp3, wav, m4a). Os arquivos entram na "gaveta" de mídia do projeto e, se você pedir '
      + '(na_timeline), já entram na timeline: imagens e vídeos viram cenas na trilha principal, áudios entram numa faixa '
      + 'nova. O arquivo NÃO É COPIADO: o projeto guarda o CAMINHO dele e toca direto de lá, então mover ou apagar o '
      + 'original deixa o clipe VERMELHO na timeline (e `midia_faltando: true` no studio_estado). '
      + 'Só arquivos que o usuário indicou, com o caminho COMPLETO — pastas do próprio app são recusadas, e um '
      + 'arquivo que falhar não derruba os outros (volta em `nao_importados` com o motivo). Máximo 20 por chamada. '
      + 'FUNCIONA COM O EDITOR FECHADO (bastidor): mande `projeto` e a mídia entra em SEGUNDO PLANO, sem tirar o usuário '
      + 'da tela em que ele está. Com isso a ESTEIRA INTEIRA roda sem tela — studio_criar_projeto → studio_importar_midia '
      + '→ studio_editar → studio_capturar → studio_exportar, do projeto vazio ao arquivo pronto, sem abrir o editor '
      + 'nenhuma vez (quem quiser ver, studio_abrir). Antes de cada lote em segundo plano o app salva sozinho um ponto '
      + '"antes-do-lote", e um projeto só aceita UM chat por vez. '
      + 'Depois de importar: confira com studio_estado e VEJA com studio_capturar. Se um dos áudios for uma narração '
      + 'gerada aqui no app, vincule com studio_vincular_narracao ANTES de mexer nos destaques.',
    inputSchema: {
      type: 'object',
      properties: {
        caminhos: {
          type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' },
          description: 'Os caminhos COMPLETOS dos arquivos no computador do usuário.',
        },
        na_timeline: { type: 'boolean', description: 'true = além de guardar na gaveta, já põe na timeline. Padrão: só guarda.' },
        em_s: { type: 'number', minimum: 0, description: 'Com na_timeline: em que segundo da régua o material entra (padrão: cenas no fim do vídeo, áudio no zero).' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto que recebe a mídia (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a importação roda em segundo plano.' },
      },
      required: ['caminhos'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('importar_midia', {
        caminhos: args.caminhos,
        ...(args.na_timeline === undefined ? {} : { na_timeline: args.na_timeline }),
        ...(args.em_s === undefined ? {} : { em_s: args.em_s }),
        ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
      });
      const { ok, ...resto } = dados;
      const falhou = Array.isArray(resto.nao_importados) && resto.nao_importados.length;
      return {
        json: limpar({
          ...resto,
          proximo_passo: falhou
            ? 'CONTE ao usuário quais arquivos não entraram e por quê (veja `nao_importados`) antes de seguir'
            : 'confira o que entrou com studio_estado e VEJA o quadro com studio_capturar',
        }),
      };
    },
  },

  {
    name: 'studio_vincular_narracao',
    description:
      'VINCULA uma narração já pronta (a lista sai em narracoes_geradas) ao projeto aberto no Studio: as cenas são '
      + 're-temporizadas para casar com a fala, as legendas entram com o tempo exato de cada palavra e o karaokê fica '
      + 'disponível. É o passo que dá RITMO ao vídeo — faça-o ANTES dos destaques e da direção, porque os dois se '
      + 'apoiam nas legendas que este verbo cria (sem elas, não há o que destacar). Repetir com o mesmo id RE-sincroniza '
      + 'em vez de duplicar. A resposta diz quantas cenas foram sincronizadas e quantas legendas existem agora — conte '
      + 'isso ao usuário em vez de dizer só "pronto". FUNCIONA COM O EDITOR FECHADO: mande `projeto` e a narração é '
      + 'vinculada em segundo plano (com a timeline vazia as cenas não são montadas — a resposta diz quantas falas ficaram sem cena).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'O id da narração pronta, como veio em narracoes_geradas.' },
        offset_s: { type: 'number', minimum: 0, description: 'Em que segundo da régua a narração começa (padrão 0).' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO a narração é vinculada em segundo plano.' },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('vincular_narracao', {
        job_id: args.job_id,
        ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
        ...(args.offset_s === undefined ? {} : { offset_s: args.offset_s }),
      });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...comAvisoDeMidia(resto, resto && Number(resto.cenasSincronizadas) === 0),
          proximo_passo: 'agora sim os destaques fazem sentido (studio_destaques) — e confira o resultado com studio_capturar',
        }),
      };
    },
  },

  {
    name: 'studio_aplicar_template',
    description:
      'Aplica um TEMPLATE (bloco pronto de abertura/apresentação, com mídia, texto e som já montados) num ponto da '
      + 'régua do vídeo, exatamente como o clique no acervo do editor. Aceita o nome do template — nome ambíguo volta '
      + 'com os candidatos pra você PERGUNTAR ao usuário, nunca escolher por ele. O bloco vira UM item na timeline, que '
      + 'o usuário pode editar depois. Alguns moldes se montam sobre o que já existe (cenas ou legendas de fala naquele '
      + 'trecho): sem material ali, o verbo recusa e explica. Aplicar de novo no mesmo lugar SUBSTITUI o bloco anterior, '
      + 'nunca duplica. CAMPOS DE TEXTO: todo rótulo de fábrica ("CAPÍTULO", "TÓPICO", "PERFIL"…) é um LUGAR para o texto do roteiro — '
      + 'leia as chaves e a instrução em studio_catalogo {tipo:"templates"} e mande `campos`; a resposta lista em `campos.deFabrica` o '
      + 'que ficou sem texto (corrija). O template que mostra a FALA (campo "legenda") cobre a legenda padrão no trecho — o editor '
      + 'esconde a legenda ali sozinho, não duplique. FUNCIONA COM O EDITOR FECHADO: mande `projeto` e o bloco é montado em segundo plano.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Nome (ou id) do template do acervo.' },
        em_s: { type: 'number', minimum: 0, description: 'Em que segundo da régua o bloco entra.' },
        duracao_s: { type: 'number', exclusiveMinimum: 0, description: 'Somente para templates Avatar: janela explícita desde em_s. Pode atravessar cenas e clipes Avatar adjacentes, sem preencher lacunas ou alterar a duração das fontes. Omitir usa a janela automática do Avatar/cena.' },
        campos: { type: 'object', additionalProperties: { type: 'string' }, description: 'O texto de cada campo do template pela CHAVE (rótulo de fábrica como "CAPÍTULO", ou "legenda"/"legenda:1" para o rótulo de fala). As chaves e a instrução de cada campo vêm de studio_catalogo {tipo:"templates"}. Rótulo de fábrica NÃO é conteúdo: mande o texto do roteiro.' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO o template é montado em segundo plano.' },
      },
      required: ['template', 'em_s'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('aplicar_template', { template: args.template, em_s: args.em_s, ...(args.duracao_s === undefined ? {} : { duracao_s: args.duracao_s }), ...(args.campos === undefined ? {} : { campos: args.campos }), ...(args.projeto === undefined ? {} : { projeto: args.projeto }) });
      const { ok, ...resto } = dados;
      return { json: limpar({ ...resto, proximo_passo: 'VEJA o bloco com studio_capturar nesse tempo; se não ficou bom, studio_desfazer volta atrás' }) };
    },
  },

  {
    name: 'studio_aplicar_direcao',
    description:
      'Aplica uma PREDEFINIÇÃO DE EDIÇÃO no vídeo inteiro: é a "direção editorial" do editor — destaques, blocos '
      + 'prontos, transições entre cenas, efeitos de movimento, entradas/saídas e filtro de cor, tudo de uma vez e '
      + 'coerente entre si. Aceita o nome da predefinição (as do sistema e as que o usuário salvou). É a maneira mais '
      + 'rápida de dar acabamento a um vídeo cru — faça DEPOIS de ter as cenas e a narração no lugar. O editor VALIDA o '
      + 'plano antes de encostar na timeline: plano reprovado não muda nada e volta com o motivo. Tudo entra num passo só '
      + 'de desfazer. PERGUNTE ao usuário qual predefinição ele quer: é decisão de gosto, não sua. '
      + 'FUNCIONA COM O EDITOR FECHADO: mande `projeto` e a direção é aplicada em segundo plano.',
    inputSchema: {
      type: 'object',
      properties: {
        predef: { type: 'string', description: 'Nome (ou id) da predefinição de edição.' },
        definicao: { type: 'object', description: 'Predefinição INLINE (V3: intensidade, conjuntos, eixos) aplicada sem salvar — alternativa a `predef`.' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio.' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('aplicar_direcao', { ...(args.predef === undefined ? {} : { predef: args.predef }), ...(args.definicao === undefined ? {} : { definicao: args.definicao }), ...(args.projeto === undefined ? {} : { projeto: args.projeto }) });
      const { ok, ...resto } = dados;
      return { json: limpar({ ...comAvisoDeMidia(resto, resto && Number(resto.cenasAjustadas) === 0 && !(resto.problemas && resto.problemas.length)), proximo_passo: 'confira alguns pontos do vídeo com studio_capturar; se o usuário não gostou, studio_desfazer volta tudo num passo' }) };
    },
  },

  // ─── A MATRIZ DE EDIÇÃO (M2 de docs/MATRIZ-EDICAO-IA.md) ─────────────────
  // O MÉTODO do editor, embarcado no app (resources/matriz/): índice, fluxos,
  // skills por eixo, verbos gerados do schema, contrato, conjuntos e recusas.
  // Leitura pura de arquivo — sem backend, sem tela. A pasta do usuário
  // (DARKPLANNER_MATRIZ, <raiz>\matriz\skills\) sobrepõe por nome de arquivo.
  {
    name: 'matriz',
    description:
      'A MATRIZ DE EDIÇÃO do editor (Studio): o método que você segue para editar sem se perder — o que ler, em que '
      + 'ordem chamar os verbos studio_*, os conjuntos de ids que combinam e o que conferir antes de entregar. '
      + 'Para QUALQUER trabalho no editor, chame {tema: "indice"} ANTES do primeiro verbo studio_* (uma vez por conversa) '
      + 'e siga o fluxo que o índice indicar para a sua tarefa. Para PRODUZIR um vídeo do título ao render (roteiro → narração → prompts → mídia → edição), '
      + 'leia {tema: "producao"} ANTES do primeiro passo. Depois leia só os temas que a tarefa pedir: '
      + '"fluxo_edicao" (edição completa com predefinição), "fluxo_comando" (um pedido direto: movimento em todas, overlays '
      + 'em 30%…), "projetos" (mais de um projeto / retomar), "roteiro_destaques", "templates", "movimento", "overlays", '
      + '"transicoes", "animacoes", "predefinicoes", "verbos" (todos os verbos com campos), "contrato" (regras e '
      + 'vocabulário dos destaques), "conferencia", "recusas" (cada motivo de recusa → causa → correção) e "conjuntos" '
      + '(com `id`: transicoes | animacoes | movimento | overlays | destaques — JSON com os ids que combinam). '
      + 'Os textos estão em português; traduza para o usuário se a conversa for noutro idioma. É leitura pura: não muda nada.',
    inputSchema: {
      type: 'object',
      properties: {
        tema: {
          type: 'string',
          enum: ['indice', 'producao', 'fluxo_edicao', 'fluxo_comando', 'projetos', 'roteiro_destaques', 'templates', 'movimento', 'overlays', 'avatar', 'transicoes', 'animacoes', 'predefinicoes', 'verbos', 'contrato', 'conferencia', 'recusas', 'conjuntos'],
          description: 'Qual tema ler (comece por "indice").',
        },
        id: { type: 'string', description: 'Só com tema "conjuntos": qual conjunto (transicoes, animacoes, movimento, overlays, destaques, intensidade).' },
      },
      required: ['tema'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const tema = String(args.tema || '').trim();
      const r = lerMatriz(tema, args.id);
      if (r.erro) throw new ErroApi(r.erro);
      return { json: limpar(r) };
    },
  },

  // ─── PROJETOS EM ANDAMENTO (M7): o registro por projeto, no disco do usuário ─
  // <matriz do usuário>/projetos/<projetoId>.json — é o que faz a IA RETOMAR um
  // vídeo noutra conversa sem se perder: identidade (nome, canal, predefinição,
  // idioma), os seis passos com status/quando/nota e observações datadas.
  {
    name: 'studio_plano',
    description:
      'O REGISTRO de um vídeo em andamento no editor (Studio): identidade (nome, canal, predefinição, idioma), os passos '
      + '(narracao → sincronia → direcao → destaques → conferencia → export) com status e nota, e observações. É como você '
      + 'RETOMA de onde parou — nesta ou noutra conversa: "ler" {projeto} ANTES de mexer num projeto (devolve o registro, ou '
      + 'existe:false, e o `proximo_passo`); "gravar" {projeto, nome?, canal?, predefinicao?, idioma?, observacao?} ao começar e '
      + 'a cada decisão; "passo" {projeto, passo, status: feito|pulado|pendente, nota?} ao concluir cada etapa; "listar" mostra '
      + 'os projetos em andamento com o próximo passo de cada um. SEMPRE pelo ID do projeto (studio_projetos) — nunca pelo nome. '
      + 'O registro vive na pasta DarkPlanner do usuário (matriz\\projetos) e não muda a timeline. Divergência entre o registro '
      + 'e o studio_estado (o usuário editou na mão) = informe e siga do documento, atualizando o registro.',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['ler', 'gravar', 'passo', 'listar'], description: 'O que fazer.' },
        projeto: { type: 'string', description: 'O ID do projeto do Studio (studio_projetos). Obrigatório fora de "listar".' },
        nome: { type: 'string', description: 'gravar: o nome do projeto/vídeo (como o usuário chama).' },
        canal: { type: 'string', description: 'gravar: o canal, se houver.' },
        predefinicao: { type: 'string', description: 'gravar: a predefinição escolhida (nome).' },
        idioma: { type: 'string', description: 'gravar: o idioma do roteiro (pt, en, es…).' },
        observacao: { type: 'string', description: 'gravar: uma linha datada anexada às observações (decisão, aviso ao usuário, o que ficou de fora).' },
        passo: { type: 'string', enum: ['narracao', 'sincronia', 'direcao', 'destaques', 'conferencia', 'export'], description: 'passo: qual etapa.' },
        status: { type: 'string', enum: ['feito', 'pulado', 'pendente'], description: 'passo: o estado da etapa.' },
        nota: { type: 'string', description: 'passo: o que aconteceu (ex.: "12 destaques, 2 descartes").' },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const r = operarPlano(args);
      if (r.erro) throw new ErroApi(r.erro);
      return { json: limpar(r) };
    },
  },

  // ─── Studio: PREDEFINIÇÃO (M5) — ler, criar, ajustar, simular, aplicar ────
  {
    name: 'studio_predefinicao',
    description:
      'A PREDEFINIÇÃO de edição (direção editorial) por nome, na forma V3: `intensidade` (0..100: 20 calmo · 50 equilibrado · '
      + '75 dinâmico · 95 muito dinâmico — deriva ritmo, densidade e a frequência de cada eixo), `conjuntos` por eixo '
      + '(transicoes, animacoes, movimento, overlays — os ids estão em matriz {tema:"conjuntos"}), e os eixos com `pct` e itens '
      + '(destaques com kit e densidade, templates, efeitos, overlays com maxPorCena, transicoes, entradas/saidas, pares com modo '
      + 'livre|pares|alternado, filtros, cores). AÇÕES: "listar" (sistema + do usuário, com o resumo dos eixos); "ler" {nome} '
      + '(o modelo inteiro + cobertura do kit + problemas); "criar" {predef, base?} (valida ids contra os catálogos e RECUSA id '
      + 'fantasma; `base` copia uma existente); "atualizar" {nome, patch}; "excluir" {nome, confirmacao:true}; "simular" '
      + '{nome | predef, projeto?} (o que a direção faria neste projeto — contagens por eixo, destaques por papel, cobertura, '
      + 'avisos — SEM tocar na timeline: mostre ao usuário em uma linha antes de aplicar); "aplicar" {nome | predef, projeto?} '
      + '(= studio_aplicar_direcao; re-sorteia os destaques automáticos — avise). Traduzir um pedido de clima ("mais calma", '
      + '"só fades", "poucos destaques") em predefinição está em matriz {tema: "predefinicoes"}. As do sistema não se editam. '
      + 'FUNCIONA COM O EDITOR FECHADO (mande `projeto` em simular/aplicar).',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['listar', 'ler', 'criar', 'atualizar', 'excluir', 'simular', 'aplicar'], description: 'O que fazer.' },
        nome: { type: 'string', description: 'Nome (ou id) da predefinição — em ler/atualizar/excluir/simular/aplicar.' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto (simular/aplicar). Sem ele, vale o que estiver aberto no Studio.' },
        predef: { type: 'object', description: 'A definição: em "criar" é a predefinição nova; em "simular"/"aplicar" é uma definição INLINE (sem salvar).' },
        base: { type: 'string', description: 'Só em "criar": copia esta predefinição (nome ou id) e aplica `predef` por cima.' },
        patch: { type: 'object', description: 'Só em "atualizar": os campos a mudar (mesma forma de `predef`).' },
        seed: { type: 'string', description: 'Só em simular/aplicar: semente determinística.' },
        confirmacao: { type: 'boolean', description: 'Só em "excluir": true depois de o usuário confirmar na conversa.' },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      if (args.acao === 'aplicar') {
        const dados = await chamarPonteDoStudio('aplicar_direcao', {
          ...(args.nome === undefined ? {} : { predef: args.nome }),
          ...(args.predef === undefined ? {} : { definicao: args.predef }),
          ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
        });
        const { ok, ...resto } = dados;
        return { json: limpar({ ...resto, proximo_passo: 'confira com studio_estado nivel "destaques" e studio_capturar; o usuário pode pedir "gerar novamente" (nova seed)' }) };
      }
      const dados = await chamarPonteDoStudio('predefinicao', {
        acao: args.acao,
        ...(args.nome === undefined ? {} : { nome: args.nome }),
        ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
        ...(args.predef === undefined ? {} : { predef: args.predef }),
        ...(args.base === undefined ? {} : { base: args.base }),
        ...(args.patch === undefined ? {} : { patch: args.patch }),
        ...(args.seed === undefined ? {} : { seed: args.seed }),
        ...(args.confirmacao === undefined ? {} : { confirmacao: args.confirmacao }),
      });
      const { ok, ...resto } = dados;
      const passo = args.acao === 'simular'
        ? 'diga ao usuário em uma linha o que a predefinição faria (contagens) e só aplique com o OK dele'
        : args.acao === 'listar' || args.acao === 'ler'
          ? 'escolha pelo NOME; para aplicar, studio_predefinicao {acao:"aplicar", nome, projeto}'
          : 'simule antes de aplicar (acao "simular")';
      return { json: limpar({ ...resto, proximo_passo: passo }) };
    },
  },

  // ─── Studio: a BIBLIOTECA EDITORIAL dos destaques ────────────────────────
  // PORQUÊ: a ação "inteligente" do studio_destaques manda o AGENTE escolher o
  // estilo de cada bloco de fala — e até aqui ele escolhia às cegas, testando
  // ids e colecionando `descartes`. A biblioteca é o contrato que o editor já
  // publica (desktop/templates/): um ÍNDICE que cabe no contexto e um arquivo
  // completo que NÃO cabe (só os destaques dão ~118 mil tokens). Por isso o
  // verbo tem três modos e nunca serve o arquivo inteiro.
  {
    name: 'consultar_biblioteca',
    description:
      'A BIBLIOTECA dos destaques do vídeo: o que cada estilo é, quando usar, quando NÃO usar, quantas palavras aceita, '
      + 'que papel cumpre na narrativa — mais as regras de ritmo/tempo, os catálogos de transição, efeito e filtro, as '
      + 'predefinições e o esquema exato da proposta. É a fonte da verdade de studio_destaques na ação "inteligente". '
      + 'FLUXO: leia o ÍNDICE PRIMEIRO ({indice: true}) — UMA vez por conversa basta, ele foi feito para caber no seu '
      + 'contexto e traz uma linha por estilo (id, categoria, papel, faixa de palavras, para que serve), o esquema da '
      + 'proposta e os motivos de recusa. Escolha os estilos e os blocos POR ELE. Só então aprofunde, e só no que você '
      + 'realmente vai usar: {id: "glow_01"} traz o contrato completo daquele estilo (ou de um template, item de catálogo '
      + 'ou predefinição), {secao: "rules"} traz um capítulo do contrato. NUNCA chute um id: os ids vivem no índice, e id '
      + 'inventado vira descarte. '
      + 'As seções são: purpose, glossary, v2, roles, subtypes, colorSystem, guidance, rules, catalogs, presets, intake. '
      + '`catalogs` é grande — use `parte` para recortar ("transitions", "effects", "entrances", "filters"). '
      + 'A biblioteca está em INGLÊS (os rótulos e amostras dos estilos são em português): traduza para o usuário, não '
      + 'devolva o jargão cru. É leitura pura: não precisa de projeto aberto e não muda nada no editor.',
    inputSchema: {
      type: 'object',
      properties: {
        indice: { type: 'boolean', description: 'true = o ÍNDICE inteiro (comece SEMPRE por aqui; uma vez por conversa basta).' },
        id: { type: 'string', description: 'Id de UM item para aprofundar (estilo de destaque, template, item de catálogo ou predefinição) — o id vem do índice.' },
        secao: {
          type: 'string',
          enum: ['purpose', 'glossary', 'v2', 'roles', 'subtypes', 'colorSystem', 'guidance', 'rules', 'catalogs', 'presets', 'intake'],
          description: 'Um capítulo do contrato completo (rules = as regras de seleção/tempo/texto; intake = o esquema da proposta e os motivos de recusa).',
        },
        parte: { type: 'string', description: 'Só com `secao`: a sub-chave a recortar (ex.: secao "catalogs", parte "transitions").' },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const modos = [];
      if (args.indice === true) modos.push('indice');
      if (typeof args.id === 'string' && args.id.trim()) modos.push('id');
      if (typeof args.secao === 'string' && args.secao.trim()) modos.push('secao');
      if (modos.length === 0) {
        throw new ErroApi(
          'Diga O QUE consultar: {indice: true} (comece por aqui), {id: "<id do índice>"} ou {secao: "<nome>"}.\n'
            + 'Se ainda não leu o índice nesta conversa, leia-o: é dele que saem os ids e os nomes de seção.'
        );
      }
      if (modos.length > 1) {
        throw new ErroApi(
          `Um modo POR CHAMADA — você mandou ${modos.join(' + ')}. Peça um de cada vez: primeiro {indice: true}, `
            + 'depois {id} ou {secao} no que interessar.'
        );
      }
      if (args.parte !== undefined && modos[0] !== 'secao') {
        throw new ErroApi('`parte` só existe junto de `secao` (ex.: {secao: "catalogs", parte: "transitions"}).');
      }
      if (modos[0] === 'indice') {
        const r = await get('/api/studio/biblioteca/indice');
        return {
          json: limpar({
            ...r.json,
            proximo_passo: 'escolha os estilos POR AQUI e proponha com studio_destaques {acao:"inteligente"}; aprofunde com consultar_biblioteca {id} ou {secao} só no que precisar',
          }),
        };
      }
      if (modos[0] === 'id') {
        const r = await get(`/api/studio/biblioteca/item?id=${encodeURIComponent(args.id.trim())}`);
        return { json: limpar({ ...r.json, proximo_passo: 'use o `id` EXATO na proposta de studio_destaques — respeitando a faixa de palavras e o "quando NÃO usar"' }) };
      }
      const parte = typeof args.parte === 'string' && args.parte.trim() ? `?parte=${encodeURIComponent(args.parte.trim())}` : '';
      const r = await get(`/api/studio/biblioteca/secao/${encodeURIComponent(args.secao.trim())}${parte}`);
      return { json: limpar({ ...r.json, proximo_passo: 'volte ao índice para escolher os estilos e proponha com studio_destaques {acao:"inteligente"}' }) };
    },
  },

  {
    name: 'studio_destaques',
    description:
      'Mexe nos DESTAQUES do vídeo — as palavras e frases que aparecem grandes na tela, com animação e som, em cima da '
      + 'fala. Quatro ações: "sortear" analisa as LEGENDAS DE FALA do projeto e escolhe sozinho o que merece destaque (só '
      + 'funciona se houver fala: vincule a narração antes, com studio_vincular_narracao); "importar_srt" transforma CADA '
      + 'bloco de um arquivo .srt que o usuário te deu num destaque, no tempo do arquivo; "limpar" apaga todos os destaques '
      + 'do projeto — e como isso é destrutivo, só passa depois de o usuário CONFIRMAR na conversa, com confirmacao: true. '
      + 'Sortear de novo re-sorteia tudo, e o que o usuário tinha ajustado à mão nos destaques anteriores se perde — '
      + 'avise ANTES de sortear pela segunda vez. '
      + 'ANTES de propor na ação "inteligente", LEIA consultar_biblioteca {indice: true}: os estilos que existem (com o que '
      + 'cada um é, a faixa de palavras e o quando NÃO usar), os papéis, o esquema exato da proposta e os motivos de recusa '
      + 'estão todos lá — propor sem ler o índice é chutar, e chute volta como `descartes`. '
      + '"inteligente" é VOCÊ escolhendo em vez do sorteio: mande `propostas` por bloco de fala ({ blocoId, estilo, texto?, '
      + 'campos?, palavra?, palavraIdx?, pos?, tam? }); o tempo você NUNCA propõe — o motor de regras recalcula início/fim '
      + 'pela fala e recusa o que não cabe. A resposta traz `criados` e `descartes` com o motivo de cada recusa: corrija e '
      + 'reenvie os descartados. "validar" é o ENSAIO A SECO da "inteligente": as mesmas propostas, os mesmos motivos de '
      + 'recusa, SEM tocar na timeline — use antes de aplicar e só mande "inteligente" com zero descartes. '
      + 'Os ids de estilo vêm do catálogo do editor (não invente); os ids dos blocos vêm do studio_estado nivel "clipes", tipo "legenda". '
      + 'FUNCIONA COM O EDITOR FECHADO: mande `projeto` e tudo roda nos bastidores (a resposta vem com bastidor: true).',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['sortear', 'importar_srt', 'limpar', 'inteligente', 'validar'], description: 'O que fazer com os destaques.' },
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que estiver aberto no Studio. Com o projeto FECHADO tudo roda em segundo plano.' },
        propostas: { type: 'array', description: 'Nas ações "inteligente" e "validar": uma proposta por bloco de fala — { blocoId | blocoIds (vizinhos que viram UM destaque), estilo, texto?, campos?, palavra?, palavraIdx?, pos?, tam? }. Texto autoral precisa de `palavra` (a âncora na fala). Máximo 60 por chamada.', items: { type: 'object' } },
        opcoes: {
          type: 'object',
          description: 'Só em "inteligente"/"validar". Por padrão o universo vem da PREDEFINIÇÃO ativa do projeto (kit marcado = estrito).',
          properties: {
            substituir_lote: { type: 'boolean', description: 'true = remove o lote automático anterior (como o botão Inteligentes) antes de aplicar; padrão false (convive com o que já está).' },
            seed: { type: 'string', description: 'Semente determinística (mesma semente, mesmo resultado).' },
            universo_estrito: { type: 'boolean', description: 'true = só os estilos do kit da predefinição; false = qualquer estilo automático.' },
            estilos: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Kit explícito de estilos permitidos (sobrepõe o da predefinição).' },
          },
          additionalProperties: false,
        },
        config: {
          type: 'object',
          description: 'Só em "sortear": ajustes deste sorteio (não mudam o gosto salvo do usuário).',
          properties: {
            densidade: { type: 'string', enum: ['minimal', 'equilibrado', 'dinamico', 'maximo'], description: 'Quantos destaques por minuto de vídeo.' },
            estilos: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Os estilos de destaque permitidos neste sorteio.' },
          },
          additionalProperties: false,
        },
        srt: { type: 'string', description: 'Só em "importar_srt": o CONTEÚDO do arquivo .srt (cada bloco vira um destaque).' },
        confirmacao: { type: 'boolean', description: 'Só em "limpar", e SÓ depois de o usuário confirmar na conversa.' },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('destaques', {
        acao: args.acao,
        ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
        ...(args.propostas === undefined ? {} : { propostas: args.propostas }),
        ...(args.opcoes === undefined ? {} : { opcoes: args.opcoes }),
        ...(args.config === undefined ? {} : { config: args.config }),
        ...(args.srt === undefined ? {} : { srt: args.srt }),
        // 'inteligente': as propostas por bloco — o pré-cabeamento pôs o campo
        // no SCHEMA e esqueceu DESTE repasse; o teste da integração pegou o
        // lote chegando vazio na tela (recusa genérica, 4 tentativas do agente).
        ...(args.propostas === undefined ? {} : { propostas: args.propostas }),
        ...(args.confirmacao === undefined ? {} : { confirmacao: args.confirmacao }),
      });
      const { ok, ...resto } = dados;
      return { json: limpar({ ...resto, proximo_passo: 'VEJA um destaque com studio_capturar (o tempo sai no studio_estado, tipo "legenda") antes de dizer que ficou pronto' }) };
    },
  },

  // ─── Studio: export + fila (F2.4 de docs/STUDIO-MCP.md) ──────────────
  // O fim do ciclo: o vídeo sai do editor como arquivo. Duas coisas importam
  // no desenho destes dois verbos:
  //   · o export é ASSÍNCRONO. Ele entra numa fila e leva minutos; `studio_exportar`
  //     volta na hora com o destino, e quem acompanha é `studio_fila` (esperar_s).
  //   · nenhum diálogo do sistema aparece. O arquivo cai na pasta do projeto,
  //     com o nome que o agente deu — sem sobrescrever nada.

  {
    name: 'studio_exportar',
    description:
      'EXPORTA um projeto do Studio como um arquivo de vídeo .mp4. Funciona nos DOIS modos: com o projeto ABERTO no editor '
      + '(sem `projeto`, é o projeto da tela) e TAMBÉM em SEGUNDO PLANO, com o editor fechado — nesse caso mande `projeto` '
      + '(id ou nome) e o vídeo é montado e enfileirado sem abrir tela nenhuma. É isso que permite tocar vários vídeos em '
      + 'paralelo: criar (studio_criar_projeto), montar e exportar cada um pelos bastidores. '
      + 'O arquivo cai na pasta do projeto do usuário '
      + '(a mesma que o botão Exportar sugere) e NUNCA sobrescreve um arquivo existente: se o nome já estiver ocupado, '
      + 'o novo sai com um número no fim — quando isso acontecer, conte ao usuário. '
      + 'A DURAÇÃO do vídeo é a do item que termina MAIS TARDE na timeline — um áudio maior que as cenas ESTICA o vídeo '
      + '(fim congelado) em vez de ser cortado. Antes de exportar, confira a duração no studio_estado e, se o áudio passar '
      + 'das cenas, apare-o com studio_editar aparar_direita (ou avise o usuário e pergunte o que ele prefere). '
      + 'O export é ASSÍNCRONO: este verbo devolve { na_fila: true, destino } na hora e o vídeo ainda está sendo feito. '
      + 'ACOMPANHE NO MESMO TURNO com studio_fila ' + ESPERA_DICA + ', repetindo até o item sair de "renderizando", e a cada '
      + 'volta chame informar_progresso com UMA linha curta ("exportando 40%…") — nunca encerre o turno prometendo '
      + 'conferir depois, você não acorda sozinho. Só diga que o vídeo está pronto quando a fila disser "concluido". '
      + 'MÍDIA QUE SUMIU DO DISCO: as mídias do projeto são REFERÊNCIAS ao arquivo original do usuário — se ele apagou ou moveu '
      + 'algum, o verbo RECUSA a exportação e devolve a lista. Nesse caso PERGUNTE ao usuário se ele quer repor os arquivos ou '
      + 'exportar assim mesmo (aqueles trechos saem PRETOS) e só reenvie com continuar_sem_midias: true se ele confirmar. '
      + 'ANTES de exportar, VEJA o resultado com studio_capturar (ele também funciona com o editor fechado): exportar um vídeo '
      + 'errado gasta minutos da máquina do usuário. '
      + 'Se a resposta trouxer `avisos`, REPASSE ao usuário: são diferenças reais do vídeo que saiu (ex.: legenda de karaokê '
      + 'sem a pintura palavra a palavra), não recado interno. '
      + 'CANCELADO É ORDEM: se o item aparecer como "cancelado" na fila e não foi VOCÊ quem cancelou, foi o USUÁRIO — '
      + 'isso é uma ORDEM dele. NUNCA reenfileire, nunca re-exporte, nunca "tente de novo": pergunte a ele o que quer '
      + 'fazer. O "acompanhe até concluir" vale para o vídeo que está sendo feito, nunca para ressuscitar um cancelado.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto a exportar (studio_projetos lista os dois). Ausente = o projeto aberto no editor. Com o editor fechado, ou aberto em OUTRO projeto, o export roda em segundo plano.' },
        resolucao: { type: 'string', enum: ['720p', '1080p', '2k', '4k'], description: 'Tamanho do vídeo final (padrão 1080p). 4K demora bem mais.' },
        qualidade: { type: 'string', enum: ['rapido', 'alta'], description: '"rapido" (padrão) ou "alta" (arquivo maior, render mais demorado).' },
        nome: { type: 'string', description: 'Nome do ARQUIVO, sem pasta e sem extensão (ex.: "episodio-03"). Ausente = o nome do projeto.' },
        pasta: { type: 'string', description: 'Opcional. Pasta de DESTINO, caminho completo (na produção de canal: <pasta do canal>\\videos\\NN-slug\\final). Ausente = a pasta de exports do projeto.' },
        continuar_sem_midias: {
          type: 'boolean',
          description: 'Exportar MESMO com mídias que sumiram do disco (esses trechos saem pretos). Só depois de o usuário confirmar na conversa — nunca por iniciativa sua.',
        },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const dados = await chamarPonteDoStudio('exportar', {
        ...(args.projeto === undefined ? {} : { projeto: args.projeto }),
        ...(args.resolucao === undefined ? {} : { resolucao: args.resolucao }),
        ...(args.qualidade === undefined ? {} : { qualidade: args.qualidade }),
        ...(args.nome === undefined ? {} : { nome: args.nome }),
        ...(args.pasta === undefined ? {} : { pasta: args.pasta }),
        ...(args.continuar_sem_midias === undefined ? {} : { continuar_sem_midias: args.continuar_sem_midias }),
      });
      const { ok, ...resto } = dados;
      return {
        json: limpar({
          ...resto,
          proximo_passo:
            'o vídeo AINDA NÃO existe: acompanhe com studio_fila ' + ESPERA_DICA + ' (repetindo até sair de "renderizando"), '
            + 'chamando informar_progresso a cada volta — e só então diga que ficou pronto',
        }),
      };
    },
  },

  {
    name: 'studio_fila',
    description:
      'Mostra a FILA DE EXPORTAÇÃO do app: cada vídeo que está sendo gerado ou já saiu, com nome, situação '
      + '("aguardando", "renderizando", "concluido", "cancelado", "erro"), em que fase está, a porcentagem e, quando '
      + 'termina, o CAMINHO do arquivo — é esse caminho que você registra no canal. Funciona mesmo com o editor fechado. '
      + 'USE COM ' + ESPERA_DICA + ' depois de studio_exportar: o verbo segura a resposta aqui dentro enquanto ainda houver '
      + 'vídeo sendo feito, e a cada volta você chama informar_progresso com UMA linha curta (ela se sobrescreve; '
      + 'mensagem a cada checagem vira uma bolha nova). Nunca encerre o turno prometendo conferir depois. '
      + 'A ação "cancelar" ABORTA o vídeo que está sendo exportado agora e joga fora os minutos de máquina já gastos: '
      + 'é DESTRUTIVA e só pode ser usada depois de o usuário PEDIR ou CONFIRMAR o cancelamento na conversa — nunca por '
      + 'iniciativa sua, nem "pra tentar de novo mais rápido". Sem ação, o verbo só lê. '
      + 'ITEM "cancelado" QUE VOCÊ NÃO CANCELOU = o USUÁRIO cancelou, e isso é ORDEM: NUNCA reenfileire nem re-exporte '
      + 'aquele vídeo (o item vem com a nota "cancelado pelo usuário — não reenfileire"). Pare, conte o que aconteceu e '
      + 'PERGUNTE a ele o que quer fazer.',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['cancelar'], description: 'Só "cancelar" (o vídeo em andamento), e SÓ depois de o usuário confirmar na conversa. Ausente = apenas ler a fila.' },
        esperar_s: {
          type: 'integer',
          description:
            `Segundos de espera DENTRO da chamada (máx ${ESPERA_MAX_S}) até a fila não ter mais nada em andamento. `
            + 'Esgotado o tempo, devolve a fila do jeito que está, sem erro — chame de novo. Ausente = responde na hora.',
        },
      },
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const pedido = args.acao === undefined ? {} : { acao: args.acao };
      const ler = () => chamarPonteDoStudio('fila', pedido);
      const espera = segundosDeEspera(args);
      // cancelar não espera: a espera é pra ACOMPANHAR o render, e um cancelamento
      // já é o fim da história do item.
      if (!espera || args.acao) {
        const { ok, ...resto } = await ler();
        return { json: limpar({ ...resto, proximo_passo: args.acao ? 'conte ao usuário o que foi cancelado' : 'se ainda estiver renderizando, chame de novo com ' + ESPERA_DICA + ' e informe o progresso ao usuário' }) };
      }
      // Terminal = nada mais aguardando nem renderizando. Fila PAUSADA com item
      // parado também é terminal: esperar por algo que ninguém vai começar é
      // tempo jogado fora (o agente avisa o usuário e pede o play). A primeira
      // leitura é imediata — fila vazia responde na hora, como o verbo sem espera.
      const terminou = (x) => !x || !x.processando || (x.pausada && !x.ativo);
      const r = await esperarAte(ler, terminou, espera);
      const { ok, ...resto } = r || {};
      if (r && r.processando && !(r.pausada && !r.ativo)) {
        return { json: limpar({ ...resto, _nota: NOTA_AINDA(espera) }) };
      }
      if (r && r.pausada && r.processando) {
        return { json: limpar({ ...resto, _nota: 'a fila de exportação está PAUSADA e o vídeo não vai começar sozinho — peça ao usuário pra dar o play na fila de exportação.' }) };
      }
      return { json: limpar({ ...resto, proximo_passo: 'terminou: diga ao usuário onde o arquivo ficou (o caminho está na fila) e registre o passo "montagem" no canal, se for vídeo de canal' }) };
    },
  },

  {
    name: 'studio_avatar',
    description:
      'GERA os vídeos de AVATAR falante (HeyGen) das cenas RESERVADAS e PREENCHE a timeline com eles. É o passo que fecha '
      + 'o avatar: primeiro você RESERVA as cenas com studio_editar (op reservar_avatar, endereçando o avatar por nome); '
      + 'depois este verbo. Três ações: '
      + '"gerar" — junta as cenas reservadas + a narração do projeto, recorta o áudio e dispara os jobs no HeyGen (devolve '
      + 'job_id e o modo escolhido); as cenas passam a pulsar em azul (gerando). '
      + '"status" — acompanha a fila. USE COM esperar_s=25: o verbo segura a resposta enquanto ainda estiver "gerando"/'
      + '"baixando", e a cada volta você chama informar_progresso com UMA linha curta (ela se sobrescreve) — a geração leva '
      + 'MINUTOS (acompanhe pela porcentagem real que o "status" devolve), então nunca encerre o turno prometendo conferir depois. '
      + '"preencher" — quando o status virar "pronto", cola os vídeos nas cenas (cada lacuna vira cena de vídeo do avatar). '
      + 'A narração PRECISA existir (a fala do avatar sai dela). Funciona com o editor aberto ou fechado.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Id ou NOME do projeto (studio_projetos lista). Sem ele, vale o que está aberto no Studio.' },
        acao: { type: 'string', enum: ['gerar', 'status', 'preencher', 'midias', 'prontos'], description: 'prontos lista os vídeos completos disponíveis no histórico, sem gerar nem aplicar; para usar um deles na faixa Avatar, chame studio_editar op adicionar_avatar pelo nome e modo inteiro/distribuir (matriz tema avatar). gerar dispara os vídeos; status acompanha a fila; preencher cola os prontos FULLSCREEN nas cenas reservadas; midias põe os recortes prontos no BIN do projeto SEM colar — para compor em camada/template pelo mapa temporal retornado. Recortes e concatenações não são fontes integrais sincronizadas desde zero.' },
        modo: { type: 'string', enum: ['A', 'B', 'C'], description: 'OPCIONAL, só no "gerar": força o modo de áudio (A = 1 job por trecho; B = narração inteira; C = trechos concatenados num job). Ausente = o app decide pela heurística (documentada em docs/HEYGEN.md).' },
        job_id: { type: 'string', description: 'OPCIONAL, só no "preencher": o job a colar (o "gerar" devolve job_id). Ausente = o job mais recente do projeto — com DUAS gerações no mesmo projeto, mire o job certo por aqui. A resposta traz `falhadas` (cenas cujo vídeo falhou; voltaram a "reservado" — gere de novo) e `desalinhadas` (cenas movidas/redimensionadas DEPOIS de gerar; o áudio é o de onde estavam — regere essas).' },
        esperar_s: {
          type: 'integer',
          description:
            `Só no "status": segundos de espera DENTRO da chamada (máx ${ESPERA_MAX_S}) até sair de "gerando"/"baixando". `
            + 'Esgotado o tempo, devolve o status do jeito que está, sem erro — chame de novo. Ausente = responde na hora.',
        },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const args = a && typeof a === 'object' ? a : {};
      const acao = String(args.acao || '');
      const pedido = { acao, projeto: args.projeto };
      if (args.modo) pedido.modo = args.modo;
      if (args.job_id) pedido.job_id = String(args.job_id);
      const ler = () => chamarPonteDoStudio('avatar', pedido);
      const espera = segundosDeEspera(args);
      const emAndamento = (x) => ['aguardando', 'gerando', 'baixando'].includes(String((x && x.status) || ''));
      if (acao !== 'status' || !espera) {
        const { ok, ...resto } = await ler();
        const passo = acao === 'prontos' ? 'leia matriz tema avatar; aplique o vídeo pelo nome com studio_editar op adicionar_avatar, modo inteiro ou distribuir, confirmando que usa a mesma narração'
          : acao === 'gerar'
          ? 'acompanhe com acao "status" e esperar_s=25 (a geração leva minutos); quando ficar "pronto", chame acao "preencher"'
          : acao === 'preencher'
            ? 'as lacunas viraram vídeo do avatar — confira o preview com studio_capturar/studio_estado'
            : (emAndamento(resto) ? 'ainda gerando: chame de novo com esperar_s=25 e informe o progresso' : 'quando "pronto", chame acao "preencher"');
        return { json: limpar({ ...resto, proximo_passo: passo }) };
      }
      const r = await esperarAte(ler, (x) => !emAndamento(x), espera);
      const { ok, ...resto } = r || {};
      if (emAndamento(r)) return { json: limpar({ ...resto, _nota: NOTA_AINDA(espera) }) };
      const passo = String((r && r.status) || '') === 'pronto'
        ? 'ficou PRONTO — chame studio_avatar com acao "preencher" pra colar os vídeos na timeline'
        : 'a geração terminou; confira o status e conte ao usuário';
      return { json: limpar({ ...resto, proximo_passo: passo }) };
    },
  },

  {
    name: 'reenviar_prompt_do_job',
    description:
      'Reescreve o prompt de um job (normalmente um que FALHOU) e o re-enfileira, mantendo params originais e a posição no grid. ' +
      'Segunda metade do fluxo de auto-cura: detalhe_job (ler o error e o prompt) → reenviar_prompt_do_job (prompt corrigido). ' +
      'Se o job já tinha arquivo, o antigo vai para a Lixeira do sistema.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Id (uuid) do job a reescrever.' },
        prompt: { type: 'string', description: 'Novo prompt, já corrigido. Vazio é recusado.' },
      },
      required: ['job_id', 'prompt'],
      additionalProperties: false,
    },
    executar: (a) =>
      post(`/api/jobs/${encodeURIComponent(exigirTexto(a, 'job_id'))}/edit-prompt`, { prompt: exigirTexto(a, 'prompt') }),
  },

  {
    name: 'mudar_numero_do_item',
    description:
      'Muda o NÚMERO (a posição) de um item do projeto — é esse número que ordena as mídias e casa cada uma com o ' +
      'trecho da narração na hora de montar o vídeo. Vale pra item pronto também. Renumerar leva junto o upscale, a ' +
      'animação e as cópias do mesmo prompt (compartilham o número de propósito) e RENOMEIA os arquivos no disco. ' +
      'Recusa se o item estiver sendo gerado nesse instante, se o número de destino já estiver em uso, se já houver ' +
      'arquivo com o nome de destino, ou se algum arquivo estiver aberto em outro programa — nesses casos nada muda. ' +
      'Uma timeline do Studio já montada não é rearranjada por isso — a ordem vale pro painel de mídias e pras ' +
      'montagens seguintes.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Id (uuid) do item.' },
        numero: { type: 'string', description: 'O novo número, inteiro: "30".' },
      },
      required: ['job_id', 'numero'],
      additionalProperties: false,
    },
    executar: (a) =>
      post(`/api/jobs/${encodeURIComponent(exigirTexto(a, 'job_id'))}/seq`, { seq: exigirTexto(a, 'numero') }),
  },

  {
    name: 'listar_vozes_tts',
    description:
      'Catálogo de vozes do gerador de narração do Studio (TTS), com id e nome de cada uma. O voice_id daqui é o que vai em gerar_narracao. ' +
      'Se a resposta vier com needs_key:true, o usuário ainda não configurou a chave do serviço de TTS nas Settings — avise em vez de tentar gerar. ' +
      'ATENÇÃO: é um catálogo DIFERENTE do de vozes de personagem do Creator (esse fica no consultar_docs, rota /api/voices).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => get('/api/tts/vozes'),
  },

  {
    name: 'cota_narracao',
    description:
      'Cota do TTS ANTES de gastar: { used_today, limit, remaining, can_generate, plan_type, max_characters_per_audio }. ' +
      'Consulte aqui antes de gerar_narracao — em especial antes de LOTE: se remaining não cobre o lote planejado, avise o usuário em vez de ' +
      'falhar no meio, e respeite max_characters_per_audio ao fatiar roteiros longos. needs_key:true = chave não configurada.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => get('/api/tts/usage'),
  },

  {
    name: 'gerar_narracao',
    description:
      'Gera uma narração (TTS) no Studio a partir de um roteiro. Devolve { job_id, job } — NÃO é síncrono: acompanhe com status_narracao. ' +
      'Texto mínimo de 10 caracteres; o teto máximo é o do plano (veja cota_narracao, que também diz quantas gerações restam hoje). Escolha o voice_id em listar_vozes_tts. ' +
      'A legenda (SRT normal + SRT "Tempo VEO", que é o que o Studio usa para sincronizar cena com fala) sai junto por padrão. ' +
      'O SYNC TEMPO (subtitle_veo_min/max) é a ESPINHA DORSAL do pipeline: é ele que corta a fala em blocos, cada bloco vira ' +
      'um prompt, cada mídia gerada casa com o bloco dela, e a montagem re-temporiza as cenas por esse mesmo SRT. Por isso a ' +
      'janela NUNCA é assumida: num canal, use a do `## Narração` do canal.md; num pedido avulso, PERGUNTE ao usuário qual ' +
      'janela ele quer (curta = mais cenas e mais dinâmico; longa = menos cenas e mais barato) ANTES de gerar — trocar depois ' +
      'significa regenerar prompts e mídias.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Roteiro a narrar. Mínimo 10 caracteres.' },
        voice_id: { type: 'string', description: 'Id da voz (veja listar_vozes_tts).' },
        title: { type: 'string', description: 'Título do áudio na lista de gerados (até 120 chars).' },
        voice_name: { type: 'string', description: 'Nome amigável da voz, só para exibição.' },
        speed: { type: 'number', description: 'Velocidade da fala. Intervalo 0.5–1.5 (fora disso = 400).' },
        volume: { type: 'number', description: 'Volume. Intervalo 0.5–2.0.' },
        subtitle: { type: 'boolean', description: 'Gerar legendas junto. Padrão true.' },
        subtitle_words: { type: 'integer', description: 'Palavras por bloco na legenda normal. 1–15.' },
        subtitle_veo_words: { type: 'integer', description: 'Palavras por bloco no SRT Tempo VEO. 1–15.' },
        subtitle_veo_min: { type: 'integer', description: 'Duração MÍNIMA (segundos) de um bloco Tempo VEO. 1–60.' },
        subtitle_veo_max: { type: 'integer', description: 'Duração MÁXIMA (segundos) de um bloco Tempo VEO. 1–60.' },
        subtitle_case: { type: 'string', enum: ['normal', 'upper', 'lower'], description: 'Caixa do texto da legenda.' },
        is_multivoice: { type: 'boolean', description: 'Roteiro com marcação de múltiplas vozes.' },
        esperar_s: {
          type: 'integer',
          description: `Segundos de espera DENTRO da chamada (máx ${ESPERA_MAX_S}) já acompanhando a narração recém-criada — poupa a primeira ida-e-volta do status_narracao.`,
        },
      },
      required: ['text', 'voice_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const corpo = { text: exigirTexto(a, 'text'), voice_id: exigirTexto(a, 'voice_id') };
      for (const campo of [
        'title', 'voice_name', 'speed', 'volume', 'subtitle', 'subtitle_words',
        'subtitle_veo_words', 'subtitle_veo_min', 'subtitle_veo_max', 'subtitle_case', 'is_multivoice',
      ]) {
        if (a[campo] !== undefined && a[campo] !== null) corpo[campo] = a[campo];
      }
      const criado = await post('/api/tts', corpo);
      const dados = (criado && criado.json) || {};
      const jobId = dados.job_id || (dados.job && dados.job.job_id) || null;
      // O próximo passo vai NA RESPOSTA: em campo (03/09/2026) o agente chamou o
      // status uma vez e foi caçar o mp3 no disco com find/ls — minutos e turnos
      // a mais. O job pronto já traz arquivo e pasta; ninguém precisa do disco.
      const PROXIMO = 'NÃO procure o áudio no disco nem espere fora do verbo: chame status_narracao {job_id, ' + ESPERA_DICA + '} e repita até "done" — a resposta pronta traz arquivo e pasta; o job_id é o que narracoes_geradas e studio_vincular_narracao usam. NÃO copie nem mova o arquivo para a pasta do projeto: anote o caminho (referência, nunca cópia).';
      const espera = segundosDeEspera(a);
      if (!espera || !jobId) return { json: { ...dados, proximo: PROXIMO } };
      const ler = () => get(`/api/tts/${encodeURIComponent(jobId)}`);
      const fim = await esperarAte(ler, (r) => r && r.json && r.json.status !== 'processing', espera);
      const st = (fim && fim.json) || {};
      return { json: { ...st, job_id: jobId, proximo: st.status === 'processing' ? NOTA_AINDA(espera) : PROXIMO } };
    },
  },

  {
    name: 'status_narracao',
    description:
      'Estado de uma narração: { status: processing | done | error | unknown, job, detail }. Pergunte aqui em vez de esperar às cegas. ' +
      '"unknown" = job_id inexistente. "error" traz detail com o motivo. Quando "done", o job traz o nome do arquivo e a pasta na lista de gerados. ' +
      'NARRAÇÃO DEMORA MINUTOS: para acompanhar sem gastar chamadas, use ' + ESPERA_DICA + ' e REPITA até o status sair de "processing" — ' +
      'o verbo segura a resposta esperando aqui dentro. A cada volta chame informar_progresso com UMA linha curta ' +
      '(ela se sobrescreve — mensagem a cada checagem vira uma bolha nova por checagem) e ' +
      'nunca encerre o turno prometendo conferir depois (você não acorda sozinho).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'job_id devolvido por gerar_narracao.' },
        esperar_s: {
          type: 'integer',
          description:
            `Segundos de espera DENTRO da chamada (máx ${ESPERA_MAX_S}) até o status deixar de ser "processing". ` +
            'Esgotado o tempo, devolve o estado atual sem erro — chame de novo. Ausente = responde na hora, como sempre.',
        },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const id = exigirTexto(a, 'job_id');
      if (/[\\/]|\.\./.test(id)) throw new ErroApi('job_id inválido.');
      const ler = () => get(`/api/tts/${encodeURIComponent(id)}`);
      const espera = segundosDeEspera(a);
      if (!espera) return ler();
      // Terminal = qualquer coisa que NÃO seja "processing": done, error e também
      // unknown (job_id que não existe nunca vai virar outra coisa — esperar 25s
      // por um id errado seria só tempo jogado fora).
      const r = await esperarAte(ler, (x) => String((x && x.json && x.json.status) || '') !== 'processing', espera);
      if (r && r.json && r.json.status === 'processing') {
        return { json: { ...r.json, _nota: NOTA_AINDA(espera) } };
      }
      return r;
    },
  },

  {
    name: 'narracoes_geradas',
    description:
      'Lista as narrações já geradas (inclusive as feitas no site e espelhadas): título, voz, status, arquivo, pasta, se tem SRT. ' +
      'Devolve também "dir", a pasta absoluta onde os áudios vivem no disco — use quando o usuário quiser abrir/mover os arquivos. ' +
      'O roteiro completo NÃO vem nesta lista (pode ter 150k chars): para lê-lo, chame status_narracao com o job_id. ' +
      'arquivo_removido:true = a entrada existe mas o áudio sumiu do disco.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => get('/api/tts/gerados'),
  },

  {
    name: 'consultar_docs',
    description:
      'Documentação viva do Dark Planner em markdown, em dois temas: "api" (padrão) = guia COMPLETO da API interna — rotas, catálogo ' +
      'atual de modelos, vozes, receitas passo a passo, gotchas e a seção de suporte (diagnóstico, receitas por erro, configs). ' +
      '"app" = manual da INTERFACE (telas e fluxos, gerado do tour guiado) — use quando o usuário perguntar COMO FAZER algo na tela ' +
      '(onde clicar, o que cada botão faz). Nunca chute id de modelo nem invente botão: os dois temas são a fonte da verdade.',
    inputSchema: {
      type: 'object',
      properties: {
        tema: { type: 'string', enum: ['api', 'app'], description: 'api = rotas/modelos/receitas (padrão) · app = telas e fluxos da interface.' },
      },
      additionalProperties: false,
    },
    // sem_chave=1: a key REAL não precisa entrar no contexto do agente (viraria
    // segredo espalhado em transcrito) — o acesso total vem pelo chamar_api,
    // que autentica por dentro. Decisão do dono em 2026-08-18.
    executar: (a) => get(a && a.tema === 'app' ? '/api/docs/app' : '/api/docs/guide?sem_chave=1'),
  },

  // ─── Ações de remediação (MUDAM o estado do app) ────────────────────────────
  // Regra do guia: confirme na conversa antes de qualquer uma destas, e depois de
  // agir re-rode diagnosticar/logs_recentes pra dizer se resolveu.

  {
    name: 'pausar_fila',
    description:
      'PARA a esteira GLOBAL de geração — TODOS os projetos param de despachar (o que já está rodando termina). Contas e ' +
      'navegadores continuam de pé. É a medida mais drástica daqui: use SOMENTE com ordem explícita do usuário NESTA ' +
      'conversa — pergunte e ESPERE o sim; agir antes da resposta é proibido, mesmo com a melhor das intenções ("pra não ' +
      'queimar a fila"). Problema localizado num projeto? O certo é pausar_projeto, que não para a produção dos outros. ' +
      'Reversível com retomar_fila.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => post('/api/workers/pause'),
  },

  {
    name: 'retomar_fila',
    description:
      'Volta a despachar jobs — a partir daqui o app gera e GASTA CRÉDITO do Google. Use depois de pausar_fila, ou quando o ' +
      'diagnóstico mostrar a fila com pending mas o consumidor parado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => post('/api/workers/play'),
  },

  {
    name: 'pausar_projeto',
    description:
      'Pausa UM projeto: os jobs DELE param de ser despachados e o resto do app segue gerando normal. É o jeito certo de ' +
      'conter um problema localizado (uma leva caindo no gerador errado, prompts a revisar) sem parar a produção inteira — ' +
      'prefira-o SEMPRE ao pausar_fila. Confirme com o usuário antes. Reversível com retomar_projeto.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer', description: 'Id do projeto a pausar (veja listar_projetos).' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    executar: (a) => patch(`/api/projects/${encodeURIComponent(exigirInteiro(a, 'project_id'))}/paused`, { paused: true }),
  },

  {
    name: 'retomar_projeto',
    description:
      'Volta a despachar os jobs de UM projeto pausado — a partir daí ele gera e GASTA CRÉDITO de novo. O par do pausar_projeto.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer', description: 'Id do projeto a retomar.' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    executar: (a) => patch(`/api/projects/${encodeURIComponent(exigirInteiro(a, 'project_id'))}/paused`, { paused: false }),
  },

  {
    name: 'reprocessar_job',
    description:
      'Manda um job que FALHOU de volta pra fila com os mesmos params. GASTA CRÉDITO quando rodar. Só aceita status failed — ' +
      'se o job está preso em processing, cancelar_job primeiro. NÃO corrige a causa: se o erro foi filtro de conteúdo ' +
      '(UNSAFE_GENERATION, SEXUAL, MINOR…), reprocessar do jeito que está falha de novo — use reenviar_prompt_do_job com o prompt ajustado.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Id (uuid) do job com erro.' } },
      required: ['job_id'],
      additionalProperties: false,
    },
    executar: (a) => post(`/api/jobs/${encodeURIComponent(exigirTexto(a, 'job_id'))}/retry`),
  },

  {
    name: 'cancelar_job',
    description:
      'Cancela um job (vira "falhou"), inclusive se estiver preso em processing. NÃO gasta crédito. É o passo 1 pra destravar ' +
      '(cancelar_job → reprocessar_job). Job que já terminou com sucesso não pode ser cancelado.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Id (uuid) do job.' } },
      required: ['job_id'],
      additionalProperties: false,
    },
    executar: (a) => post(`/api/jobs/${encodeURIComponent(exigirTexto(a, 'job_id'))}/cancel`),
  },

  {
    name: 'destravar_jobs',
    description:
      'Auto-cura dos jobs presos em processing há 10+ min (os que o diagnosticar lista em possiveis_travados): cancela e ' +
      're-enfileira cada um. GASTA CRÉDITO ao reprocessar. CONFIRME antes, dizendo QUANTOS são (rode diagnosticar e conte). ' +
      'O watchdog do app costuma resolver sozinho — use quando o mesmo job aparece travado há muito tempo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const d = (await get('/api/status/diagnostico')).json || {};
      const travados = Array.isArray(d.possiveis_travados) ? d.possiveis_travados : [];
      if (!travados.length) return { json: { destravados: 0, _nota: 'Nenhum job travado — nada a fazer.' } };
      const feitos = [];
      for (const j of travados) {
        const id = j.id || j.job_id;
        if (!id) continue;
        try {
          await post(`/api/jobs/${encodeURIComponent(id)}/cancel`);
          await post(`/api/jobs/${encodeURIComponent(id)}/retry`);
          feitos.push({ job: String(id).slice(0, 8), ok: true });
        } catch (e) {
          feitos.push({ job: String(id).slice(0, 8), ok: false, erro: String(e.message || e) });
        }
      }
      return { json: { destravados: feitos.filter((f) => f.ok).length, total: travados.length, resultados: feitos } };
    },
  },

  {
    name: 'reprocessar_falhos',
    description:
      'Re-enfileira TODOS os jobs com erro de um projeto. GASTA CRÉDITO (um por job). CONFIRME antes dizendo QUANTOS são. ' +
      'Se a causa for filtro de conteúdo, reprocessar sem mexer no prompt falha de novo — nesses conserte o prompt ' +
      '(reenviar_prompt_do_job) um a um. Devolve o que foi reprocessado e o que recusou.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer', description: 'Id do projeto (veja listar_projetos).' },
        limite: { type: 'integer', description: 'Teto de jobs a reprocessar nesta chamada (padrão 50).' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const pid = exigirInteiro(a, 'project_id');
      const teto = Math.max(1, Math.min(Number(a.limite) || 50, 200));
      const r = (await get(`/api/projects/${pid}/jobs/bin`)).json;
      const jobs = (Array.isArray(r) ? r : r?.jobs || []).filter((j) => j.status === 'failed');
      if (!jobs.length) return { json: { reprocessados: 0, _nota: 'Nenhum job com erro nesse projeto.' } };
      const alvos = jobs.slice(0, teto);
      const feitos = [];
      for (const j of alvos) {
        try {
          await post(`/api/jobs/${encodeURIComponent(j.id)}/retry`);
          feitos.push({ job: String(j.id).slice(0, 8), ok: true });
        } catch (e) {
          feitos.push({ job: String(j.id).slice(0, 8), ok: false, erro: String(e.message || e) });
        }
      }
      return {
        json: {
          reprocessados: feitos.filter((f) => f.ok).length,
          com_erro_no_projeto: jobs.length,
          nao_processados: Math.max(0, jobs.length - alvos.length),
          resultados: feitos,
        },
      };
    },
  },

  {
    name: 'liberar_cooldown',
    description:
      'Tira uma conta do cooldown NA HORA e volta a usá-la. ATENÇÃO: o cooldown existe porque o Google sinalizou atividade ' +
      'incomum (UNUSUAL_ACTIVITY); forçar cedo demais costuma render outro cooldown, mais longo. Explique isso e só use se o ' +
      'usuário insistir. O normal é esperar o cooldown_until do diagnóstico.',
    inputSchema: {
      type: 'object',
      properties: { conta: { type: 'string', description: 'E-mail da conta (o account_id do diagnosticar).' } },
      required: ['conta'],
      additionalProperties: false,
    },
    executar: (a) => post(`/api/accounts/${encodeURIComponent(exigirTexto(a, 'conta'))}/clear-cooldown`),
  },

  {
    name: 'ativar_conta',
    description:
      'Deixa uma conta disponível pro dispatch de novo (status active) e sobe o worker dela. Idempotente: se já estiver ativa, ' +
      'não faz nada. Conta em "reconnect" pode voltar sozinha por aqui; se o login do Google morreu de vez, o app remarca ' +
      'reconnect e aí o usuário precisa reconectar na aba Contas (você NÃO faz login por ele).',
    inputSchema: {
      type: 'object',
      properties: { conta: { type: 'string', description: 'E-mail da conta.' } },
      required: ['conta'],
      additionalProperties: false,
    },
    executar: (a) => alternarConta(exigirTexto(a, 'conta'), true),
  },

  {
    name: 'desativar_conta',
    description:
      'Tira uma conta do dispatch (status disabled) e para o worker dela na hora — jobs pendentes dela vão pras outras contas. ' +
      'CONFIRME antes. Idempotente: já desativada, não faz nada. Não remove a conta (remover conta é operação da aba Contas, ' +
      'nunca sua).',
    inputSchema: {
      type: 'object',
      properties: { conta: { type: 'string', description: 'E-mail da conta.' } },
      required: ['conta'],
      additionalProperties: false,
    },
    executar: (a) => alternarConta(exigirTexto(a, 'conta'), false),
  },

  {
    name: 'testar_proxy',
    description:
      'Testa se um proxy alcança o Google e mostra o IP de saída. NÃO altera nada e não mexe na conta — é diagnóstico. ' +
      'Proxy é OPCIONAL no app: só faz sentido sugerir quando a conta vive caindo em cooldown.',
    inputSchema: {
      type: 'object',
      properties: { proxy_url: { type: 'string', description: 'Ex.: http://usuario:senha@host:porta' } },
      required: ['proxy_url'],
      additionalProperties: false,
    },
    executar: (a) => post('/api/accounts/test-proxy', { proxy_url: exigirTexto(a, 'proxy_url') }),
  },

  {
    name: 'alterar_config',
    description:
      'Muda uma configuração OPERACIONAL do app (as mesmas da tela Configurações que o usuário mexe no dia a dia): ' +
      'job_dispatch_delay (segundos entre despachos, "5" ou "5-15"), max_concurrent_per_account (paralelismo por conta), ' +
      'job_poll_interval, flow_dispatch_mode / grok_dispatch_mode (off|sequential|parallel|auto) e seus thresholds, ' +
      'gemini_model (modelo da IA de reescrita), gemini_max_rewrites, language, file_name_pattern, ' +
      'delete_source_on_animate, audio_failure_preference. CONFIRME antes de mudar. ' +
      'Dica de suporte: cooldown por ritmo (transient_throttle) melhora aumentando job_dispatch_delay. ' +
      'Ajustes de ENGENHARIA (chaves de API, pasta raiz dos projetos, modo debug, captcha, transporte nativo, ' +
      'temporização anti-detecção, prompt de sistema do Gemini) NÃO passam por aqui — são calibrados pela equipe; ' +
      'oriente o usuário a mexer na tela dele ou a falar com o suporte.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'object', description: 'Objeto {chave: valor} só com as chaves operacionais listadas acima.' },
      },
      required: ['updates'],
      additionalProperties: false,
    },
    executar: (a) => {
      if (!a.updates || typeof a.updates !== 'object' || !Object.keys(a.updates).length) {
        throw new ErroApi('updates precisa ser um objeto com ao menos uma chave.');
      }
      const proibidas = Object.keys(a.updates).filter((k) => !CONFIG_DO_AGENTE.has(k));
      if (proibidas.length) {
        throw new ErroApi(
          `Recusado: ${proibidas.join(', ')} — ajuste interno do app, calibrado pela equipe do DarkPlanner. ` +
            'Diga ao usuário apenas que isso é interno e que o suporte resolve: NÃO repita esses nomes técnicos ' +
            'pra ele nem explique o mecanismo. Não tente por outro caminho (chamar_api também recusa).'
        );
      }
      return chamar('PUT', '/api/config', { updates: a.updates });
    },
  },

  {
    name: 'chamar_api',
    description:
      'Chama as rotas da API do Dark Planner documentadas no consultar_docs, já autenticada — é por aqui que você opera o que não tem ' +
      'verbo próprio. Prefira as ferramentas dedicadas quando existirem (respostas mais enxutas); use esta para o resto. ' +
      'Algumas rotas são RECUSADAS (configuração crua, login/assinatura, catálogo interno de modelos, estado bruto do sistema, ' +
      'leitura de arquivo por caminho): a mensagem de erro diz qual verbo usar no lugar. Não tente contorná-las. ' +
      'Rotas destrutivas (DELETE, alterações de config): confirme a intenção do usuário na conversa antes de chamar. ' +
      'NUNCA chame, nem se pedirem: DELETE de conta ou de projeto, /purge, /empty-trash, /config/regenerate-key — são ' +
      'irreversíveis e não são sua alçada. E NUNCA use esta ferramenta pra driblar o alterar_config: as configurações de ' +
      'engenharia (chaves de API, projects_root_dir, debug_mode, captcha_browser_count, flow_native_*, ' +
      'gemini_system_prompt, google_api_stagger_*) são calibradas pela equipe e não se mexem pelo chat. ' +
      'Nesses casos oriente o usuário a fazer na tela, ou a falar com o suporte.',
    inputSchema: {
      type: 'object',
      properties: {
        metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'Método HTTP.' },
        caminho: {
          type: 'string',
          description: 'Rota começando com /api/ — inclua a query string se houver (ex.: /api/projects/2/files-info).',
        },
        corpo: { type: 'object', description: 'Body JSON para POST/PUT/PATCH.' },
      },
      required: ['metodo', 'caminho'],
      additionalProperties: false,
    },
    executar: (a) => {
      const caminho = String(a.caminho || '');
      const metodo = String(a.metodo || 'GET').toUpperCase();
      // Trava barata: só a API local — nada de virar cliente HTTP genérico.
      if (!caminho.startsWith('/api/')) {
        throw new ErroApi('O caminho deve começar com /api/ — esta ferramenta só fala com a API local do Dark Planner.');
      }
      // Denylist de rotas PRIMEIRO: o token de sessão alcança rotas Internal que a chave
      // pública não alcança — as que expõem segredo, arquitetura ou setup ficam fora do chat.
      conferirRotaNegada(metodo, caminho);
      // Configuração NÃO se escreve por aqui: as operacionais têm verbo próprio
      // (alterar_config) e as de engenharia são calibradas pela equipe. Sem esta
      // trava, a allowlist do alterar_config seria contornável por um PUT cru.
      if (metodo !== 'GET' && caminho.startsWith('/api/config')) {
        throw new ErroApi(
          'Configuração não se altera por aqui — use alterar_config, que aceita só as opções do dia a dia. ' +
            'O resto é ajuste interno calibrado pela equipe do DarkPlanner: diga ao usuário apenas que é interno ' +
            'e que o suporte resolve, sem citar nomes técnicos.'
        );
      }
      return chamar(metodo, caminho, a.corpo);
    },
  },
];


/**
 * Configurações que o AGENTE pode mudar: só as operacionais (as que o usuário mexe
 * no dia a dia). O backend aceita mais chaves, mas as de engenharia — chaves de API,
 * projects_root_dir, debug_mode, captcha_browser_count, flow_native_*, gemini_system_prompt,
 * google_api_stagger_* — são calibradas pela equipe e ficam FORA do alcance do chat.
 */
/**
 * ROTAS QUE O `chamar_api` NÃO ALCANÇA — 1ª camada (a 2ª é o scrubber `limpar`).
 *
 * O MCP autentica com o token de SESSÃO, então ele chega em TODA rota `Internal` —
 * inclusive as que a X-API-Key pública nunca alcançou. Com IAs externas plugadas aqui,
 * o que sai vira documentação da arquitetura pro concorrente. Cada item tem o PORQUÊ e,
 * quando existe, o caminho legítimo (o verbo dedicado). Ver docs/API_EXPOSICAO.md.
 *
 * `metodo: '*'` = todos. O `re` casa o caminho SEM a query string.
 */
const ROTAS_NEGADAS = [
  { metodo: 'GET', re: /^\/api\/capabilities$/,
    motivo: 'catálogo interno de modelos (inclusive as model keys de vídeo do Google), matriz tier×custo e versão do rules. Para o que o app aceita, leia o guia (consultar_docs).' },
  { metodo: '*', re: /^\/api\/status(\/diagnostico)?$/,
    motivo: 'traz tier e crédito por conta e a escada interna de captcha/rede. Use o verbo diagnosticar, que devolve o mesmo diagnóstico sem esses campos.' },
  { metodo: '*', re: /^\/api\/config(\/.*)?$/,
    motivo: 'a tabela de configuração crua carrega SEGREDOS (a chave de API do app e a chave do Gemini) e ajustes de engenharia. Use alterar_config.' },
  { metodo: '*', re: /^\/api\/auth\//,
    motivo: 'login/sessão da assinatura do usuário (e-mail, device_id, limites do plano). Nada disso é sua alçada.' },
  { metodo: '*', re: /^\/api\/sync\/(media|thumbnail)$/,
    motivo: 'recebem um caminho de arquivo e devolvem o arquivo — viraria leitura de arquivo arbitrário da máquina do usuário.' },
  { metodo: 'GET', re: /^\/api\/accounts$/,
    motivo: 'linha crua da conta (proxy, tier, crédito, estatísticas por modelo). Use contas_disponiveis.' },
  { metodo: '*', re: /^\/api\/accounts\/login$/,
    motivo: 'abre o fluxo de login do Google — operação da aba Contas, feita pelo usuário.' },
  { metodo: '*', re: /^\/api\/accounts\/[^/]+\/flow-native$/,
    motivo: 'ajuste interno de transporte, calibrado pela equipe.' },
  { metodo: '*', re: /^\/api\/grok\/accounts(\/.*)?$/,
    motivo: 'linha crua da conta Grok (pasta de perfil do navegador, tier) e login. Operação da aba Contas.' },
  { metodo: '*', re: /^\/api\/extension\/status$/,
    motivo: 'estado interno da extensão/ponte. O que interessa pro suporte já vem no diagnosticar.' },
  { metodo: '*', re: /^\/api\/internal\//,
    motivo: 'rotas de serviço do próprio app (desligamento, log interno) — não são operação de usuário.' },
  { metodo: 'GET', re: /^\/api\/projects\/[^/]+\/jobs$/,
    motivo: 'devolve a linha inteira do banco, com os params e o result INTERNOS do job. Use listar_jobs (completo:true) ou detalhe_job, que trazem os mesmos jobs no formato público.' },
];

function conferirRotaNegada(metodo, caminho) {
  const semQuery = caminho.split('?')[0].replace(/\/+$/, '') || '/';
  for (const r of ROTAS_NEGADAS) {
    if (r.metodo !== '*' && r.metodo !== metodo) continue;
    if (!r.re.test(semQuery)) continue;
    throw new ErroApi(
      `Recusado: ${metodo} ${semQuery} não é acessível pelo chat — ${r.motivo}\n` +
        'Não tente por outro caminho: explique ao usuário que isso é interno do DarkPlanner ' +
        'e, se ele precisar mesmo, oriente a fazer na tela do app ou falar com o suporte.'
    );
  }
}

const CONFIG_DO_AGENTE = new Set([
  'job_dispatch_delay',
  'max_concurrent_per_account',
  'job_poll_interval',
  'flow_dispatch_mode',
  'flow_parallel_threshold',
  'grok_dispatch_mode',
  'grok_parallel_threshold',
  'gemini_model',
  'gemini_max_rewrites',
  'language',
  'file_name_pattern',
  'delete_source_on_animate',
  'audio_failure_preference',
]);
/**
 * Ativa/desativa conta de forma IDEMPOTENTE. A rota do app é um TOGGLE cego
 * (active↔disabled): chamada duas vezes desfaz o que fez. Lemos o status antes e
 * só alternamos quando é preciso — assim o agente nunca desativa sem querer.
 */
async function alternarConta(conta, ativar) {
  const d = (await get('/api/status/diagnostico')).json || {};
  const linha = (d.contas || []).find((c) => c.account_id === conta);
  if (!linha) {
    const nomes = (d.contas || []).map((c) => c.account_id).join(', ') || '(nenhuma)';
    throw new ErroApi(`Conta "${conta}" não existe no app. Contas cadastradas: ${nomes}`);
  }
  const st = String(linha.status || '');
  if (st === 'deleted') throw new ErroApi(`A conta "${conta}" foi removida do app.`);
  const jaAtiva = st === 'active' || st === 'cooldown';
  if (jaAtiva === ativar) {
    return { json: { conta, status: st, alterado: false, _nota: ativar ? 'Já estava ativa.' : 'Já estava desativada.' } };
  }
  const r = await post(`/api/accounts/${encodeURIComponent(conta)}/toggle`);
  return { json: { conta, status: (r.json || {}).status, alterado: true, status_anterior: st } };
}

// ─── Verbos de CANAL (maestro conversacional, F5.1) ───────────────────────────
// docs/CHAT-MAESTRO.md. O main é o DONO ÚNICO dos arquivos do canal: este
// processo nunca escreve em disco — pede pela ponte HTTP local (a mesma do
// enviar_prompts_texto, com o token que TODO turno recebe; o de delegação só
// existe no Modo Time, e trabalhar num canal não é Modo Time).
async function chamarPonteCanais(rota, corpo) {
  const porta = String(process.env.DARKPLANNER_PONTE_PORT || '').trim();
  const token = String(process.env.DARKPLANNER_PONTE_TOKEN || '').trim();
  if (!porta || !token) {
    throw new ErroApi('Os canais não estão disponíveis nesta sessão (app desatualizado ou ponte indisponível) — peça ao usuário pra atualizar e reabrir o app.');
  }
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${porta}/canais/${rota}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deleg-token': token },
      body: JSON.stringify(corpo || {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ErroApi(`Não consegui falar com o Dark Planner (canais/${rota}): ${String((e && e.message) || e)}.\nVerifique se o app está ABERTO.`);
  }
  const dados = await r.json().catch(() => null);
  if (!dados || dados.ok !== true) throw new ErroApi((dados && dados.erro) || `HTTP ${r.status}`);
  return dados.dados;
}

// A MESMA ponte serve a TELA (config_de_geracao e configurar_geracao): o main
// pergunta ao renderer e devolve o que ela respondeu. Aqui só a ida e a volta.
async function chamarPonteDaTela(rota, corpo, queixa = 'A tela não aplicou a configuração', { retentativas = 0 } = {}) {
  const porta = String(process.env.DARKPLANNER_PONTE_PORT || '').trim();
  const token = String(process.env.DARKPLANNER_PONTE_TOKEN || '').trim();
  if (!porta || !token) {
    throw new ErroApi('A configuração da tela não está disponível nesta sessão (app desatualizado ou ponte indisponível) — peça ao usuário pra atualizar e reabrir o app.');
  }
  let r;
  // M7: LEITURA repete uma vez se a conexão cair (o app pode estar recarregando);
  // escrita NUNCA repete sozinha — poderia aplicar duas vezes
  for (let tentativa = 0; ; tentativa++) {
    try {
      r = await fetch(`http://127.0.0.1:${porta}/${rota}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deleg-token': token },
        body: JSON.stringify(corpo || {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      break;
    } catch (e) {
      if (tentativa < retentativas) { await new Promise((ok) => setTimeout(ok, 600)); continue; }
      throw new ErroApi(`Não consegui falar com o Dark Planner: ${String((e && e.message) || e)}.
Verifique se o app está ABERTO.`);
    }
  }
  const dados = await r.json().catch(() => null);
  if (!dados || dados.ok !== true) {
    throw new ErroApi(`${queixa}: ${(dados && dados.erro) || `HTTP ${r.status}`}`);
  }
  return dados;
}

// Os verbos studio_* passam por UMA rota (/studio) com { acao, args }: os cinco
// falam com a MESMA tela pelo mesmo intent carimbado, e o main é quem fotografa
// no `studio_capturar`. Erro do editor (projeto inexistente, nome ambíguo, tela
// fechada) volta como recado legível, nunca como stack trace.
// ─── MATRIZ DE EDIÇÃO: leitura dos arquivos (embarcados + do usuário) ────────
const MATRIZ_TEMAS = {
  indice: '00-INDICE.md', producao: '05-PRODUCAO.md', fluxo_edicao: '10-FLUXO-EDICAO-COMPLETA.md', fluxo_comando: '11-FLUXO-COMANDO-DIRETO.md',
  projetos: '12-PROJETOS-EM-ANDAMENTO.md', roteiro_destaques: '20-SKILL-ROTEIRO-DESTAQUES.md', templates: '30-SKILL-TEMPLATES.md',
  movimento: '40-SKILL-MOVIMENTO.md', overlays: '41-SKILL-OVERLAYS.md', avatar: '42-SKILL-AVATAR.md', transicoes: '50-SKILL-TRANSICOES.md',
  animacoes: '51-SKILL-ANIMACOES.md', predefinicoes: '60-PREDEFINICOES.md', verbos: '70-VERBOS.md', contrato: '80-CONTRATO.md',
  conferencia: '90-CONFERENCIA-E-ENTREGA.md', recusas: '99-RECUSAS.md',
};
const MATRIZ_CONJUNTOS = ['transicoes', 'animacoes', 'movimento', 'overlays', 'destaques', 'intensidade'];
const MATRIZ_MAX = 120000; // um tema nunca passa disto (70-VERBOS ≈ 50 KB)
const MATRIZ_APP = pathMod.join(__dirname, '..', 'matriz');
const MATRIZ_USUARIO = String(process.env.DARKPLANNER_MATRIZ || '').trim();

function lerArquivoDaMatriz(rel) {
  // a pasta do usuário sobrepõe por NOME (skills/<arquivo>), depois a do app
  const candidatos = [];
  if (MATRIZ_USUARIO) candidatos.push([pathMod.join(MATRIZ_USUARIO, 'skills', rel), 'usuario'], [pathMod.join(MATRIZ_USUARIO, rel), 'usuario']);
  candidatos.push([pathMod.join(MATRIZ_APP, rel), 'app']);
  for (const [p, origem] of candidatos) {
    try {
      const st = fsMod.statSync(p);
      if (!st.isFile()) continue;
      const texto = fsMod.readFileSync(p, 'utf8');
      return { texto: texto.length > MATRIZ_MAX ? `${texto.slice(0, MATRIZ_MAX)}\n…(cortado)` : texto, origem, arquivo: rel };
    } catch { /* próximo candidato */ }
  }
  return null;
}

function lerMatriz(tema, id) {
  if (tema === 'conjuntos') {
    const qual = String(id || '').trim();
    if (!MATRIZ_CONJUNTOS.includes(qual)) {
      return { erro: `diga qual conjunto em \`id\`: ${MATRIZ_CONJUNTOS.join(', ')} (tema "conjuntos")` };
    }
    const r = lerArquivoDaMatriz(`conjuntos/${qual}.json`);
    if (!r) return { erro: `o conjunto "${qual}" não está nesta instalação — rode a geração da matriz (npm run gerar:matriz) ou reinstale` };
    let conjunto = null;
    try { conjunto = JSON.parse(r.texto); } catch { return { erro: `o conjunto "${qual}" está corrompido nesta instalação` }; }
    return { tema, id: qual, origem: r.origem, conjunto, proximo_passo: 'escolha UM conjunto e use só os ids dele; a skill do eixo (matriz {tema}) diz como distribuir' };
  }
  const rel = MATRIZ_TEMAS[tema];
  if (!rel) return { erro: `tema "${tema || '(vazio)'}" não existe — os temas são: ${Object.keys(MATRIZ_TEMAS).join(', ')}, conjuntos` };
  const r = lerArquivoDaMatriz(rel);
  if (!r) return { erro: `o tema "${tema}" (${rel}) não está nesta instalação — a matriz embarcada está incompleta; avise o usuário` };
  return {
    tema, arquivo: r.arquivo, origem: r.origem, texto: r.texto,
    proximo_passo: tema === 'indice'
      ? 'ache a sua tarefa na tabela do índice, leia o tema indicado e só então chame o primeiro verbo studio_*'
      : 'siga os passos numerados na ordem; a cada verbo de escrita, leia descartes/rejeitadas/problemas antes do próximo',
  };
}

// ─── PROJETOS EM ANDAMENTO (M7): o registro em <matriz>/projetos/<id>.json ──
const PASSOS_PLANO = ['narracao', 'sincronia', 'direcao', 'destaques', 'conferencia', 'export'];
const STATUS_PLANO = ['feito', 'pulado', 'pendente'];
const RE_ID_PROJETO = /^[\w.:-]{1,64}$/;
const PLANO_TEXTO_MAX = 400;
const PLANO_OBS_MAX = 40;

function pastaDosPlanos() {
  if (!MATRIZ_USUARIO) return null;
  return pathMod.join(MATRIZ_USUARIO, 'projetos');
}
function registroVazio(projetoId) {
  return {
    projeto: projetoId, nome: null, canal: null, predefinicao: null, idioma: null,
    passos: Object.fromEntries(PASSOS_PLANO.map((p) => [p, { status: 'pendente', quando: null, nota: null }])),
    observacoes: [], criadoEm: new Date().toISOString(), atualizadoEm: null, ultimaAcao: null,
  };
}
function lerPlano(projetoId) {
  const pasta = pastaDosPlanos();
  if (!pasta) return null;
  try {
    const bruto = JSON.parse(fsMod.readFileSync(pathMod.join(pasta, `${projetoId}.json`), 'utf8'));
    const base = registroVazio(projetoId);
    const passos = { ...base.passos };
    for (const p of PASSOS_PLANO) {
      const x = bruto?.passos?.[p];
      if (x && typeof x === 'object') passos[p] = { status: STATUS_PLANO.includes(x.status) ? x.status : 'pendente', quando: x.quando || null, nota: x.nota || null };
    }
    return {
      ...base, ...bruto, projeto: projetoId, passos,
      observacoes: Array.isArray(bruto?.observacoes) ? bruto.observacoes.slice(-PLANO_OBS_MAX) : [],
    };
  } catch { return null; }
}
function gravarPlano(registro) {
  const pasta = pastaDosPlanos();
  fsMod.mkdirSync(pasta, { recursive: true });
  const alvo = pathMod.join(pasta, `${registro.projeto}.json`);
  const tmp = `${alvo}.tmp`;
  fsMod.writeFileSync(tmp, JSON.stringify(registro, null, 2), 'utf8');
  fsMod.renameSync(tmp, alvo);
}
const proximoPasso = (reg) => PASSOS_PLANO.find((p) => reg.passos[p].status === 'pendente') || null;
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, PLANO_TEXTO_MAX) : null);

function operarPlano(args) {
  const acao = String(args.acao || '').trim();
  if (!pastaDosPlanos()) return { erro: 'o registro de projetos não está disponível nesta sessão (app desatualizado: falta a pasta da matriz do usuário) — siga pelo studio_estado e avise o usuário' };
  if (acao === 'listar') {
    let nomes = [];
    try { nomes = fsMod.readdirSync(pastaDosPlanos()).filter((f) => f.endsWith('.json')); } catch { nomes = []; }
    const projetos = nomes.map((f) => lerPlano(f.slice(0, -5))).filter(Boolean)
      .sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')))
      .map((r) => ({ projeto: r.projeto, nome: r.nome, canal: r.canal, predefinicao: r.predefinicao, proximo: proximoPasso(r), ultimaAcao: r.ultimaAcao, atualizadoEm: r.atualizadoEm }));
    return { projetos, proximo_passo: projetos.length ? 'para retomar um, studio_plano {acao:"ler", projeto} e siga do `proximo`' : 'nenhum vídeo em andamento registrado — ao começar um, studio_plano {acao:"gravar", projeto, nome}' };
  }
  const projeto = String(args.projeto || '').trim();
  if (!projeto || !RE_ID_PROJETO.test(projeto) || /\s/.test(projeto)) {
    return { erro: 'diga o `projeto` pelo ID (o id de studio_projetos, ex.: "sp_a1") — o registro é por id, nunca por nome' };
  }
  const atual = lerPlano(projeto);
  if (acao === 'ler') {
    if (!atual) return { existe: false, projeto, proximo_passo: `nenhum registro para ${projeto}: comece com studio_plano {acao:"gravar", projeto, nome, predefinicao?} e o primeiro passo é "${PASSOS_PLANO[0]}"` };
    const prox = proximoPasso(atual);
    return { existe: true, registro: atual, proximo: prox, proximo_passo: prox ? `retome pelo passo "${prox}" (confira antes com studio_estado {projeto, nivel:"resumo"} que o documento bate com o registro)` : 'todos os passos concluídos — se o usuário quer mudar algo, registre a observação e marque o passo como pendente' };
  }
  const reg = atual || registroVazio(projeto);
  const agora = new Date().toISOString();
  if (acao === 'gravar') {
    for (const campo of ['nome', 'canal', 'predefinicao', 'idioma']) if (args[campo] !== undefined) reg[campo] = texto(args[campo]);
    const obs = texto(args.observacao);
    if (obs) reg.observacoes = [...(reg.observacoes || []), { quando: agora, texto: obs }].slice(-PLANO_OBS_MAX);
    reg.ultimaAcao = obs ? 'observação' : 'identidade';
    reg.atualizadoEm = agora;
    gravarPlano(reg);
    return { registro: reg, proximo: proximoPasso(reg), proximo_passo: `siga pelo passo "${proximoPasso(reg) || 'nenhum'}" e marque-o com studio_plano {acao:"passo"} ao concluir` };
  }
  if (acao === 'passo') {
    const passo = String(args.passo || '').trim();
    if (!PASSOS_PLANO.includes(passo)) return { erro: `passo "${passo || '(vazio)'}" não existe — os passos são: ${PASSOS_PLANO.join(', ')}` };
    const status = STATUS_PLANO.includes(args.status) ? args.status : 'feito';
    reg.passos[passo] = { status, quando: status === 'pendente' ? null : agora, nota: texto(args.nota) };
    reg.ultimaAcao = `${passo}: ${status}`;
    reg.atualizadoEm = agora;
    gravarPlano(reg);
    const prox = proximoPasso(reg);
    return { registro: reg, proximo: prox, proximo_passo: prox ? `próximo passo: "${prox}"` : 'todos os passos concluídos — entregue (matriz {tema:"conferencia"})' };
  }
  return { erro: `ação "${acao || '(vazio)'}" não existe — as ações são: ler, gravar, passo, listar` };
}

const STUDIO_SO_LEITURA = new Set(['projetos', 'estado', 'clipe', 'catalogo', 'snapshots', 'resolver']);
function chamarPonteDoStudio(acao, args) {
  // O conversaId viaja junto desde a F2.6a: com a edição em SEGUNDO PLANO, dois
  // chats podem pedir para editar o mesmo projeto ao mesmo tempo, e a trava de
  // posse do main precisa saber quem é quem. Sem ele o app trata o pedido como
  // anônimo (conservador: dois anônimos no mesmo projeto se recusam).
  const leitura = STUDIO_SO_LEITURA.has(acao) || (acao === 'predefinicao' && ['listar', 'ler', 'simular'].includes(args?.acao));
  return chamarPonteDaTela('studio', { acao, args: args || {}, conversaId: CONVERSA }, 'O Studio não atendeu o pedido', { retentativas: leitura ? 1 : 0 });
}

/** Whitelist do PONTEIRO de canal — o que o modelo vê de um canal na lista. */
function canalPublico(c) {
  return { nome: c && c.nome, slug: c && c.slug, pasta: c && c.pasta, criado_em: (c && c.criadoEm) || null };
}

/**
 * Resolução malsucedida (não achou / ambíguo) NÃO é falha de ferramenta: é a
 * deixa pro agente PERGUNTAR ao usuário. Volta como json normal, com candidatos.
 */
function canalNaoResolvido(d) {
  if (!d || !d.erro) return null;
  if (d.erro === 'ambiguo') {
    return { json: { ambiguo: true, candidatos: d.candidatos, proximo_passo: 'pergunte ao usuário qual desses é o canal — não escolha por ele' } };
  }
  return { json: { encontrado: false, canais: d.candidatos || [], proximo_passo: 'nenhum canal com esse nome; confirme com o usuário ou conduza a criação (guia_canal → criar_canal)' } };
}

const FERRAMENTAS_CANAIS = [
  {
    name: 'guia_canal',
    description:
      'Devolve o PLAYBOOK de como conduzir o canal de vídeos do usuário: as regras de conversa, as perguntas de abertura, ' +
      'o pipeline de um vídeo (roteiro → narração → prompts → geração → montagem) e como retomar em conversa nova. ' +
      'CHAME ANTES de criar um canal ou de conduzir qualquer trabalho de canal — é o manual do fluxo, e seguir de memória ' +
      'faz pular passo. NÃO chame em conversa que não é sobre canal (é texto longo, custa cota do usuário à toa).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => ({ texto: String((await chamarPonteCanais('guia', {})).guia || '') }),
  },

  {
    name: 'listar_canais',
    description:
      'Lista os canais que o usuário já tem cadastrados: [{ nome, slug, pasta, criado_em }]. Pasta que sumiu do disco cai da ' +
      'lista sozinha (o canal É a pasta). Use pra saber se o canal que ele citou existe ANTES de perguntar qualquer coisa — ' +
      'lista vazia é o caso de abertura (guia_canal e conduza a criação).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const d = await chamarPonteCanais('listar', {});
      return { json: { canais: (d.canais || []).map(canalPublico) } };
    },
  },

  {
    name: 'criar_canal',
    description:
      'Cria a pasta de um canal novo (canal.md, estado.json, memoria.md, a pasta skills/ já com a skill de organização padrão ' +
      'e a pasta videos/, onde cada vídeo ganha a sua NN-slug/) e registra o ponteiro no app. Chame SÓ depois de fazer as ' +
      'perguntas de abertura do guia_canal (onde salvar, nome, skill de roteiro, voz + configuração da narração, organização) ' +
      '— o que o usuário respondeu vai em narrador/narracao/geracao/regras/agentes. Recusa nome de canal que já existe. ' +
      'Se a pasta apontada já tiver arquivos do usuário, nada é sobrescrito: só ACRESCENTA o que falta.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do canal como o usuário o chama (vira também o nome da pasta, sanitizado).' },
        pasta: { type: 'string', description: 'Opcional. Caminho ABSOLUTO onde o usuário quer o canal. Omita para a pasta padrão do Dark Planner.' },
        narrador: { type: 'string', description: 'Opcional. A voz escolhida, em uma frase para o humano ler (seção "## Narrador" do canal.md).' },
        narracao: {
          type: 'object',
          description:
            'Opcional. Configuração FIXA da narração deste canal (seção "## Narração" do canal.md): os nomes são os mesmos ' +
            'parâmetros de gerar_narracao, e é isso que o estado_do_canal devolve pronto para você repassar. Preencha com o ' +
            'que o usuário confirmou no passo da voz (sugestão do guia: blocos de legenda de 3 a 8 segundos).',
          properties: {
            voice_id: { type: 'string', description: 'Id da voz escolhida (de listar_vozes_tts).' },
            voice_name: { type: 'string', description: 'Nome da voz, para o usuário reconhecer.' },
            speed: { type: 'number', description: 'Velocidade da fala. 0.5–1.5 (normal = 1).' },
            subtitle_veo_min: { type: 'integer', description: 'Duração MÍNIMA (segundos) de um bloco da legenda por tempo. 1–60.' },
            subtitle_veo_max: { type: 'integer', description: 'Duração MÁXIMA (segundos) de um bloco da legenda por tempo. 1–60.' },
            subtitle_veo_words: { type: 'integer', description: 'Palavras por bloco da legenda por tempo. 1–15.' },
            subtitle_case: { type: 'string', enum: ['normal', 'upper', 'lower'], description: 'Caixa do texto da legenda.' },
          },
          additionalProperties: false,
        },
        geracao: {
          type: 'object',
          description:
            'Opcional. Configuração FIXA da GERAÇÃO das cenas deste canal (seção "## Geração" do canal.md), proposta junto com a voz na ' +
            'abertura. Dela você monta as TAGS do texto dos prompts a cada vídeo, e é ela que o estado_do_canal devolve pronta. ' +
            'Guarde as ESCOLHAS do usuário no vocabulário do app — quais tipos, aspectos, qualidades e modelos existem está no guia do ' +
            'consultar_docs, que é a fonte da verdade (não invente valor). ' +
            'ATENÇÃO: "variacoes" NÃO tem tag — é ajuste da tela do Creator; o canal guarda o que o usuário quer e você CONFERE com ' +
            'config_de_geracao antes de enviar, avisando quando divergir.',
          properties: {
            variacoes: { type: 'integer', description: 'Quantas cópias de CADA prompt. Inteiro a partir de 1 — é o que multiplica a conta (padrão sensato: 1).' },
            tipo: { type: 'string', description: 'O que cada prompt gera (ex.: "imagem", "video", "imagem_animacao"). Vira a tag de tipo do texto.' },
            qualidade: { type: 'string', description: 'Qualidade/modelo do vídeo, no nome que o app usa. Vira a tag de qualidade.' },
            aspecto: { type: 'string', description: 'Formato da tela (ex.: "16:9"). Vira a tag de aspecto.' },
            duracao_s: { type: 'integer', description: 'Opcional. Segundos de cada vídeo. Vira a tag de duração. Sem isto, quem decide é a tela.' },
            modelo_imagem: { type: 'string', description: 'Opcional. Modelo de imagem, no nome que o app usa. Vira a tag de modelo.' },
          },
          additionalProperties: false,
        },
        edicao: {
          type: 'object',
          description:
            'Opcional. ESTILO DE EDIÇÃO fixo deste canal (seção "## Edição" do canal.md), proposto em UMA frase na abertura junto com a voz e a ' +
            'geração ("edito assim: legenda X, transições suaves variadas, ken burns sutil, destaques equilibrados — fechado?"). ' +
            'É o que faz a MONTAGEM (passo 5) aplicar o padrão do canal em vez de decidir tipografia, transição e densidade do zero a cada vídeo. ' +
            'Os ids de estilo e de fonte são os do studio_catalogo ("estilos_legenda" e "fontes") — confira lá, id inventado não vira nada na tela. ' +
            'Guarde só o que o usuário disse: familia_transicoes, ken_burns e densidade_destaques têm padrão, o resto fica vazio de propósito. ' +
            'O gosto em PROSA ("cortes secos nos sustos") não vem aqui: vai na skills\\edicao.md, semeada com o canal.',
          properties: {
            estilo_legenda: { type: 'string', description: 'Id do estilo de legenda (studio_catalogo tipo "estilos_legenda").' },
            fonte_legenda: { type: 'string', description: 'Id da fonte da legenda (studio_catalogo tipo "fontes").' },
            cor_legenda: { type: 'string', description: 'Cor do texto da legenda (hex "#FFD60A" ou o nome que o usuário usa).' },
            contorno_legenda: { type: 'string', description: 'Contorno/borda da legenda (ex.: "preto 4px").' },
            familia_transicoes: { type: 'string', description: 'O jeito das transições, em prosa curta (ex.: "suaves variadas", "cortes secos"). Padrão: "suaves variadas".' },
            ken_burns: { type: 'string', description: 'Quanto zoom lento nas cenas: "sutil", "medio" ou "forte". Padrão: "sutil".' },
            densidade_destaques: { type: 'string', description: 'Quanta ênfase o sorteio põe: "minimal", "equilibrado", "dinamico" ou "maximo". Vai no config_destaques do studio_configurar. Padrão: "equilibrado".' },
            titulo_abertura: { type: 'string', description: 'Opcional. O FORMATO da abertura (ex.: "TITULO DO VIDEO em caps, 4s"). Sem isto, não há abertura padrão.' },
            trilha: { type: 'string', description: 'Opcional. Volume/ducking padrão da trilha (ex.: "-18 dB, abaixa na fala").' },
          },
          additionalProperties: false,
        },
        regras: { type: 'string', description: 'Opcional. Tom, idioma, formato, duração — o que o usuário disser sobre o canal (seção "## Regras").' },
        agentes: { type: 'string', description: 'Opcional. Agente por papel, SÓ se o usuário pediu (ex.: "roteiro: claude (reserva: codex)").' },
      },
      required: ['nome'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const d = await chamarPonteCanais('criar', {
        nome: exigirTexto(a, 'nome'),
        pasta: a.pasta ? String(a.pasta) : undefined,
        narrador: a.narrador ? String(a.narrador) : undefined,
        narracao: a.narracao && typeof a.narracao === 'object' && !Array.isArray(a.narracao) ? a.narracao : undefined,
        geracao: a.geracao && typeof a.geracao === 'object' && !Array.isArray(a.geracao) ? a.geracao : undefined,
        edicao: a.edicao && typeof a.edicao === 'object' && !Array.isArray(a.edicao) ? a.edicao : undefined,
        regras: a.regras ? String(a.regras) : undefined,
        agentes: a.agentes ? String(a.agentes) : undefined,
      });
      return {
        json: {
          ...canalPublico(d),
          criados: d.criados || [],
          subpastas: d.subpastas || [],
          narracao: d.narracao || null,
          geracao: d.geracao || null,
          edicao: d.edicao || null,
          proximo_passo: 'pergunte se ele quer fazer o primeiro vídeo agora e qual o tema',
        },
      };
    },
  },

  {
    name: 'estado_do_canal',
    description:
      'FONTE DA VERDADE do canal — chame SEMPRE ao retomar ("vídeo do canal X") antes de perguntar qualquer coisa, e nunca ' +
      'refaça a abertura para um canal que existe. Devolve: identidade (narrador, regras, agentes por papel), a configuração ' +
      'de "narracao" já pronta para repassar ao gerar_narracao, a de "geracao" (de onde saem as TAGS dos prompts e o nº de ' +
      'variações que você confere com config_de_geracao antes de enviar), a de "edicao" (o ESTILO DE EDIÇÃO do canal — leia ANTES de montar, ' +
      'junto com a skills\\edicao.md, em vez de escolher tipografia, transição e densidade do zero), as skills que o usuário tem (inclusive organizacao.md, que ' +
      'descreve onde os arquivos vão), os arquivos de cada pasta de vídeo, os vídeos e o que está PELA METADE (ex.: roteiro ' +
      'sem narração) com o próximo passo de cada um, e os últimos registros da memória. O que vale é o que foi REGISTRADO ' +
      '(registrar_no_canal); a varredura das pastas só cobre vídeo que ninguém registrou — cada vídeo diz em "origem" de onde ' +
      'veio. Nome parecido resolve sozinho; ambíguo devolve os candidatos para você PERGUNTAR. O que vem daqui vence a sua ' +
      'lembrança da conversa.',
    inputSchema: {
      type: 'object',
      properties: {
        canal: { type: 'string', description: 'Nome do canal como o usuário falou (aceita parcial: "galinha" acha "Galinha Pintadinha").' },
      },
      required: ['canal'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const d = await chamarPonteCanais('estado', { canal: exigirTexto(a, 'canal') });
      const naoResolvido = canalNaoResolvido(d);
      if (naoResolvido) return naoResolvido;
      return {
        json: {
          canal: d.canal, slug: d.slug, pasta: d.pasta,
          narrador: d.narrador, narracao: d.narracao || null, geracao: d.geracao || null, edicao: d.edicao || null, regras: d.regras, agentes: d.agentes,
          canal_md: d.canal_md,
          skills: d.skills || [],
          skills_faltando: d.skills_faltando || [], // roteiro/prompts: obrigatórias do usuário (F2)
          agentes_por_etapa: d.agentes_por_etapa || {}, // F3: { roteiro: {agente, reserva?}, … } — delegue a etapa ao agente marcado
          arquivos: d.arquivos || {},
          videos: d.videos || [],
          videos_concluidos: d.videos_concluidos || [],
          pela_metade: d.pela_metade || [],
          memoria_recente: d.memoria_recente || [],
        },
      };
    },
  },

  {
    name: 'adicionar_videos_ao_canal',
    description:
      'Coloca TÍTULOS na fila do canal: cria uma pasta videos\\NN-slug\\ por título (numeração continua da última) e guarda o título no estado — ' +
      'é o que deixa o usuário entregar dez títulos e dizer "produz". Título repetido não vira dois vídeos. ' +
      'Use ao ADAPTAR uma pasta que ainda não era canal (os títulos de um arquivo de títulos que você encontrou) ou quando o usuário mandar títulos novos. ' +
      'Nada é apagado nem movido: só acrescenta.',
    inputSchema: {
      type: 'object',
      properties: {
        canal: { type: 'string', description: 'Nome do canal (como no estado_do_canal).' },
        titulos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200, description: 'Os títulos, um por item, na ordem em que devem ser produzidos.' },
      },
      required: ['canal', 'titulos'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const d = await chamarPonteCanais('adicionar-videos', { canal: exigirTexto(a, 'canal'), titulos: Array.isArray(a.titulos) ? a.titulos : [] });
      const naoResolvido = canalNaoResolvido(d);
      if (naoResolvido) return naoResolvido;
      return { json: { canal: d.canal, pasta: d.pasta, videos: d.videos || [], proximo_passo: 'estado_do_canal mostra a fila com os títulos; "produz" segue a ordem numérica' } };
    },
  },

  {
    name: 'registrar_no_canal',
    description:
      'Fecha um passo do vídeo: grava o passo e o arquivo no estado do canal e apenda uma linha datada na memória dele. ' +
      'Chame DEPOIS de salvar o arquivo do passo e ANTES de começar o próximo — é o que permite retomar do ponto certo se a ' +
      'conversa cair, e é a FONTE DA VERDADE do estado_do_canal (passo não registrado é passo que vai ser refeito). ' +
      'Use a convenção NN-slug no nome do vídeo (ex.: "04-gato-de-chapeu"), a mesma da pasta dele. Mande em "caminho" o ' +
      'arquivo REAL que você salvou (ex.: "videos/04-gato-de-chapeu/roteiro.md"), mesmo que o usuário tenha mudado a ' +
      'organização. O caminho tem de estar DENTRO da pasta do canal (relativo a ela); qualquer coisa fora é recusada.',
    inputSchema: {
      type: 'object',
      properties: {
        canal: { type: 'string', description: 'Nome do canal (o mesmo que você usou no estado_do_canal).' },
        video: { type: 'string', description: 'Identificador do vídeo na convenção NN-slug, ex.: "04-gato-de-chapeu" — o mesmo nome da pasta dele. Sem barras.' },
        passo: { type: 'string', enum: ['roteiro', 'narracao', 'prompts', 'geracao', 'montagem'], description: 'O passo que acabou de ser concluído.' },
        dados: {
          type: 'object',
          description: 'Opcional. { caminho: "videos/04-gato-de-chapeu/roteiro.md", resumo: "uma frase do que ficou pronto" } e o que mais ajudar a retomar. PORTAS por passo (o registro CONFERE e recusa): roteiro → caminho existe (+ mínimo de palavras se a skill declarar); narracao → job_id (done) OU audio existente, tempo_srt opcional; prompts → caminho existe, N linhas = N trechos do srt de tempo registrado, cada linha dentro do limite de palavras da skill de prompts; geracao → project_id com a leva toda pronta; montagem → caminho do .mp4 existente. origem: "usuario" quando o artefato veio de fora.',
          properties: {
            caminho: { type: 'string', description: 'Arquivo do passo, relativo à pasta do canal.' },
            resumo: { type: 'string', description: 'Uma frase sobre o que ficou pronto (vai para a memória do canal).' },
          },
          additionalProperties: true,
        },
      },
      required: ['canal', 'video', 'passo'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const passo = exigirTexto(a, 'passo');
      const dados = a.dados && typeof a.dados === 'object' ? { ...a.dados } : {};
      // PORTAS que dependem da API (F2, 04/09/2026): o registro só fecha a etapa
      // com o fato conferido — foi editar sem mídia e "basta clicar em Gerar"
      // que quebraram o fluxo no teste ao vivo. As portas de disco (arquivo
      // existe, linhas × trechos, limite da skill) ficam no main (canais.js).
      if (passo === 'geracao') {
        const pid = Number(dados.project_id);
        if (!Number.isInteger(pid) || pid <= 0) throw new ErroApi('registrar "geracao" exige dados.project_id (o projeto do Creator): é pela fila dele que a porta confere se a leva terminou.');
        const r = await get(`/api/projects/${pid}/jobs/bin`);
        const res = resumirJobs(Array.isArray(r && r.json) ? r.json : []);
        if (res.total === 0 || res.gerando > 0 || res.falhos > 0) {
          throw new ErroApi(`porta da mídia reprovada: ${res.prontos} prontos, ${res.gerando} gerando, ${res.falhos} falhos${res.total === 0 ? ' (nenhum job no projeto)' : ''} — a etapa só fecha com tudo pronto e zero falhas (detalhe_job + reenviar_prompt_do_job nos falhos; listar_jobs {resumo: true, esperar_s} para acompanhar).`);
        }
        dados.jobs_prontos = res.prontos;
      }
      if (passo === 'narracao' && dados.job_id && !dados.audio) {
        const st = await get(`/api/tts/${encodeURIComponent(String(dados.job_id))}`);
        const j = st && st.json;
        if (!j || j.status !== 'done') throw new ErroApi(`porta da narração reprovada: o job ${dados.job_id} está "${(j && j.status) || 'desconhecido'}" — registre só com status done (status_narracao {esperar_s}).`);
        // PONTEIROS, nunca cópia: o registro guarda ONDE o app gravou o áudio e o
        // srt de tempo (é dele que saem os prompts e a sincronia).
        try {
          const g = await get('/api/tts/gerados');
          const dir = g && g.json && g.json.dir;
          const lista = g && g.json && Array.isArray(g.json.jobs) ? g.json.jobs : [];
          const item = lista.find((x) => x && x.job_id === dados.job_id) || (j.job || {});
          if (dir && item.arquivo) {
            const base = item.pasta ? pathMod.join(dir, item.pasta) : dir;
            dados.audio = pathMod.join(base, item.arquivo);
            const srts = Array.isArray(item.srts) ? item.srts.filter(Boolean) : [];
            const tempo = srts.find((n) => /tempo|veo|sync/i.test(String(n))) || null;
            if (tempo) dados.tempo_srt = pathMod.join(base, tempo);
            const legenda = srts.find((n) => n !== tempo) || null;
            if (legenda) dados.legenda_srt = pathMod.join(base, legenda);
          }
        } catch { /* sem os ponteiros do app, o agente informa audio/tempo_srt */ }
      }
      const d = await chamarPonteCanais('registrar', {
        canal: exigirTexto(a, 'canal'),
        video: exigirTexto(a, 'video'),
        passo,
        dados,
        conversa: CONVERSA || undefined, // o DONO do vídeo (paralelismo entre conversas)
      });
      const naoResolvido = canalNaoResolvido(d);
      if (naoResolvido) return naoResolvido;
      return { json: { canal: d.canal, video: d.video, passo: d.passo, registrado_em: d.registrado_em, linha: d.linha, ...(d.ponteiros ? { ponteiros: d.ponteiros } : {}), proximo_passo: 'atualize o checklist (plano_conversa) e siga para a próxima etapa do tema producao' } };
    },
  },

  {
    name: 'atualizar_edicao_do_canal',
    description:
      'O canal APRENDE com a aprovação: quando o usuário aprova a montagem ("ficou ótimo", "pode exportar") ou pede uma correção de ESTILO ' +
      '("menos zoom", "fonte maior", "não gostei dessa transição"), grave aquilo como o padrão do canal — não como ajuste de um vídeo só. ' +
      'É a mesma regra do "o último usado vira o padrão" dos agentes, aplicada à edição, e é o que faz cada vídeo ficar mais rápido que o anterior. ' +
      'Escreve na seção "## Edição" do canal.md (MERGE: o que você não mandar continua valendo) e, com "skill", apenda a regra em prosa na ' +
      'skills\\edicao.md com a data. DEPOIS avise o usuário em UMA frase o que ficou anotado ("anotei: ken burns fica sutil daqui pra frente") — ' +
      'uma frase, nunca a configuração inteira. Na dúvida se aquilo vale pro canal ou só pra este vídeo, PERGUNTE antes em uma linha.',
    inputSchema: {
      type: 'object',
      properties: {
        canal: { type: 'string', description: 'Nome do canal (o mesmo que você usou no estado_do_canal).' },
        campos: {
          type: 'object',
          description:
            'O que mudou no "## Edição" — SÓ os campos que mudaram, os outros ficam como estão. Mesmos nomes do criar_canal. ' +
            'Ids de estilo e fonte vêm do studio_catalogo.',
          properties: {
            estilo_legenda: { type: 'string', description: 'Id do estilo de legenda (studio_catalogo tipo "estilos_legenda").' },
            fonte_legenda: { type: 'string', description: 'Id da fonte da legenda (studio_catalogo tipo "fontes").' },
            cor_legenda: { type: 'string', description: 'Cor do texto da legenda.' },
            contorno_legenda: { type: 'string', description: 'Contorno/borda da legenda.' },
            familia_transicoes: { type: 'string', description: 'O jeito das transições, em prosa curta.' },
            ken_burns: { type: 'string', description: '"sutil", "medio" ou "forte".' },
            densidade_destaques: { type: 'string', description: '"minimal", "equilibrado", "dinamico" ou "maximo".' },
            titulo_abertura: { type: 'string', description: 'O formato da abertura.' },
            trilha: { type: 'string', description: 'Volume/ducking padrão da trilha.' },
          },
          additionalProperties: false,
        },
        skill: {
          type: 'string',
          description:
            'Opcional. A REGRA em prosa, uma ou duas linhas ("cortes secos nos sustos", "nunca zoom em rosto"), apendada em skills\\edicao.md ' +
            'com a data. É pro gosto que não cabe em campo — não escreva o vídeo inteiro aqui.',
        },
      },
      required: ['canal'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const d = await chamarPonteCanais('atualizar-edicao', {
        canal: exigirTexto(a, 'canal'),
        campos: a.campos && typeof a.campos === 'object' && !Array.isArray(a.campos) ? a.campos : undefined,
        skill: a.skill ? String(a.skill) : undefined,
      });
      const naoResolvido = canalNaoResolvido(d);
      if (naoResolvido) return naoResolvido;
      return {
        json: {
          canal: d.canal,
          edicao: d.edicao || null,
          mudou: d.mudou || {},
          skill_atualizada: !!d.skill_atualizada,
          proximo_passo: 'diga ao usuário em UMA frase o que ficou anotado (ex.: "anotei: ken burns fica sutil daqui pra frente") — não repita a configuração inteira',
        },
      };
    },
  },
];

// Whitelist na saída como no resto do servidor: `limpar` roda em TODA resposta.
for (const f of FERRAMENTAS_CANAIS) {
  const cru = f.executar;
  f.executar = async (a) => {
    const saida = await cru(a);
    return saida && saida.json !== undefined ? { json: limpar(saida.json) } : saida;
  };
  FERRAMENTAS.push(f);
}

// ─── Verbo `delegar` — SÓ no Modo Time (a ponte do Electron está injetada) ─────
// Manda uma subtarefa pra OUTRO agente do usuário executar (cota própria dele).
// Ausente fora do Modo Time e no turno DELEGADO (sem cascata infinita).
async function chamarPonteDelegacao(rota, corpo, prazoMs) {
  const r = await fetch(`http://127.0.0.1:${DELEG_PORT}/${rota}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-deleg-token': DELEG_TOKEN },
    body: JSON.stringify({ ...corpo, maestroConversaId: DELEG_CONVERSA }),
    signal: AbortSignal.timeout(prazoMs),
  });
  const dados = await r.json().catch(() => ({ isError: true, erro: `HTTP ${r.status}` }));
  if (dados.isError) throw new ErroApi(dados.erro || 'a delegação falhou');
  return dados;
}

// Os agentes que PODEM ser delegados vêm do app (adaptadores instalados ≠ o
// maestro) — inclusive o claude quando o maestro é o GPT/Gemini. Sem a env
// (CLI avulso) vale a lista clássica.
const AGENTES_DELEGAVEIS = String(process.env.DELEGACAO_AGENTES || 'codex,agy,grok').split(',').map((x) => x.trim()).filter(Boolean);

if (DELEG_PORT && DELEG_TOKEN) {
  FERRAMENTAS.push({
    name: 'delegar',
    description:
      'MODO TIME: abre um TICKET para outro agente do usuário executar uma SUBTAREFA e devolve `delegacao_id` NA HORA — a tarefa roda ' +
      'em segundo plano. Acompanhe com delegacao_status {delegacao_id, ' + ESPERA_DICA + '} até estado "concluido" (ou "erro"/"cancelada"/"ocupado"/"orfao"); ' +
      'só então leia o artefato e o `texto`. NUNCA repita a tarefa por causa de tempo: o ticket continua vivo. ' +
      'Cada agente tem cota própria, então delegar poupa a SUA. A tarefa deve ser AUTOSSUFICIENTE — o executor NÃO vê esta conversa: ' +
      'ele recebe as MESMAS ferramentas mcp__darkplanner__* (menos delegar), roda na pasta desta conversa e não vê sua memória — ' +
      'escreva objetivo, caminhos ABSOLUTOS, a skill do usuário a seguir (só o caminho) e o critério de pronto. Apelidos: GPT/ChatGPT = codex, ' +
      'Gemini/Antigravity = agy, Grok = grok. Quando o usuário nomeia o agente de uma etapa, delegar é ORDEM. ' +
      'Use `chave` (ex.: "005:revisao") como identidade da intenção: repetir a chamada com a mesma chave devolve o MESMO ticket (sem duplicar trabalho); ' +
      'mesma chave com outra tarefa é recusada. `continuar` retoma a sessão nativa de um ticket anterior do mesmo agente. ' +
      'Passe `reserva` com OUTRO agente para não parar no meio: se a cota do principal já acabou (ou o turno dele falhar por limite), ' +
      'o app roda a MESMA tarefa na reserva e devolve trocou_para/motivo no status — conte a troca ao usuário em uma linha. ' +
      'Se o delegado pedir permissão, o card aparece NESTA conversa (aguardando_decisao: true no status) — o usuário decide.',
    inputSchema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: AGENTES_DELEGAVEIS, description: 'Qual agente executa (agy = Antigravity/Gemini, codex = GPT).' },
        tarefa: { type: 'string', description: 'A subtarefa COMPLETA e autossuficiente (mín. 20 caracteres).' },
        reserva: { type: 'string', enum: AGENTES_DELEGAVEIS, description: 'OPCIONAL: agente de reserva, usado se a cota do principal tiver acabado. Precisa ser diferente do `agente`; reserva inválida é ignorada com aviso.' },
        chave: { type: 'string', description: 'OPCIONAL: identidade da intenção (ex.: "005:prompts"). Mesma chave = mesmo ticket; não duplica trabalho.' },
        continuar: { type: 'string', description: 'OPCIONAL: delegacao_id de um ticket anterior do MESMO agente cuja sessão nativa deve ser retomada.' },
        etapa: { type: 'string', description: 'OPCIONAL: rótulo da etapa (roteiro, revisao, prompts, midia, edicao…) só para registro.' },
      },
      required: ['agente', 'tarefa'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const t = await chamarPonteDelegacao('delegar', {
        agente: String(a.agente || ''), tarefa: String(a.tarefa || ''), reserva: a.reserva ? String(a.reserva) : undefined,
        chave: a.chave ? String(a.chave) : undefined, continuar: a.continuar ? String(a.continuar) : undefined, etapa: a.etapa ? String(a.etapa) : undefined,
      }, 30000);
      const { ok, ...ticket } = t;
      return { json: { ...ticket, proximo_passo: `acompanhe com delegacao_status {delegacao_id: "${ticket.delegacao_id}", ${ESPERA_DICA}} e informar_progresso; só use o artefato depois de estado "concluido"` } };
    },
  });
  FERRAMENTAS.push({
    name: 'delegacao_status',
    description:
      'MODO TIME: consulta um ticket aberto por `delegar`. Com `esperar_s` (até ' + ESPERA_MAX_S + ') a chamada espera o ticket terminar; ' +
      'estados: rodando · concluido (com `texto`) · erro · cancelada · ocupado (tente_em_s) · orfao (o app reiniciou no meio: confira o artefato no disco antes de repetir). ' +
      '`aguardando_decisao: true` = o delegado pediu permissão e o card está nesta conversa esperando o usuário. Repita a chamada enquanto "rodando".',
    inputSchema: {
      type: 'object',
      properties: {
        delegacao_id: { type: 'string', description: 'O id devolvido pelo delegar.' },
        esperar_s: { type: 'integer', minimum: 0, maximum: 600, description: 'Segundos a esperar por um estado terminal (teto ' + ESPERA_MAX_S + ').' },
      },
      required: ['delegacao_id'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const esperar = segundosDeEspera(a);
      const t = await chamarPonteDelegacao('delegar/status', { delegacao_id: String(a.delegacao_id || ''), esperar_s: esperar }, (esperar + 15) * 1000);
      const { ok, ...ticket } = t;
      return {
        json: {
          ...ticket,
          ...(ticket.estado === 'rodando' ? { _nota: `ainda rodando (${ticket.duracao_s}s) — chame de novo com ${ESPERA_DICA}` } : {}),
          ...(ticket.estado === 'concluido' ? { proximo_passo: 'leia o artefato pedido no disco e confira o critério de pronto; o `texto` é o relato do executor' } : {}),
        },
      };
    },
  });
}

// ─── Verbo `producao` — o serviço local de produção autônoma ───────────────────
// A conversa manda comandos e lê o estado persistido; quem executa é o serviço
// no app (continua com a janela fechada; retoma sozinho depois de reinício).
if (String(process.env.DARKPLANNER_PONTE_PORT || '').trim()) {
  FERRAMENTAS.push({
    name: 'producao',
    description:
      'PRODUÇÃO AUTÔNOMA de vídeos pelo SERVIÇO do app (não por você): o usuário configura a pasta (skills, voz, títulos) e o serviço executa ' +
      'roteiro → revisão (se configurada) → narração → prompts → mídia → edição → validação → render → validação → entrega, ' +
      'com validação de cada entrega, retomada após reinício e sem depender desta conversa ficar aberta. ' +
      'Ações: "preparar" {pasta} mostra o que foi encontrado na pasta, os bloqueios (skill ambígua/ausente, voz não configurada) e o exemplo de producao.json; ' +
      '"iniciar" {pasta, escolhas?, videos?} inicia UMA execução por vídeo (mesmo vídeo pedido de novo = a execução existente); ' +
      '"estado" {run_id} e "listar" {pasta?} mostram etapas, bloqueios e artefatos; ' +
      '"comando" {tipo: pausar|retomar|cancelar|decidir, run_id, dados?} controla (decidir = {step_id, decisao: aprovar|negar}); "status" = saúde do serviço. ' +
      'Nunca refaça etapas por fora do serviço; se algo estiver bloqueado, conte o motivo ao usuário. Configuração fica em <pasta>\\.darkplanner\\producao.json.',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['preparar', 'iniciar', 'estado', 'listar', 'comando', 'status'] },
        pasta: { type: 'string', description: 'Pasta do canal/vídeos (absoluta). Padrão: a pasta desta conversa.' },
        escolhas: { type: 'object', description: 'Escolhas explícitas (mesmos campos de producao.json → escolhas): voz, skillRoteiro, skillPrompts, trilha, agente, executores, revisaoRoteiro…', additionalProperties: true },
        videos: { type: 'array', items: { type: 'string' }, description: 'Títulos (um por vídeo). Padrão: o arquivo de títulos da pasta.' },
        run_id: { type: 'string' },
        tipo: { type: 'string', enum: ['pausar', 'retomar', 'cancelar', 'decidir'] },
        dados: { type: 'object', additionalProperties: true },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    executar: async (a) => {
      const acao = String(a.acao || '');
      const pasta = a.pasta ? String(a.pasta) : (process.env.DARKPLANNER_PASTA || process.cwd() || null);
      const corpo = acao === 'preparar' ? { pasta, escolhas: a.escolhas || {} }
        : acao === 'iniciar' ? { pasta, escolhas: a.escolhas || {}, videos: a.videos || null, origem_conversa: CONVERSA || null }
        : acao === 'estado' ? { run_id: String(a.run_id || '') }
        : acao === 'listar' ? { pasta }
        : acao === 'comando' ? { tipo: a.tipo, run_id: a.run_id, dados: a.dados || null, origem: CONVERSA || 'mcp' }
        : {};
      if ((acao === 'preparar' || acao === 'iniciar') && !pasta) throw new ErroApi('diga a `pasta` (absoluta) ou anexe uma pasta à conversa.');
      const r = await chamarPonteDaTela(`producao/${acao}`, corpo, 'O serviço de produção recusou');
      const d = r.dados;
      if (acao === 'iniciar' && d && d.ok === false) {
        return { parcial: true, json: { ...d, proximo_passo: 'resolva os bloqueios (crie/aponte o producao.json com o exemplo) e chame producao {acao: "iniciar"} de novo — o app não adivinha skill, voz nem trilha' } };
      }
      return { json: { ...d, ...(acao === 'iniciar' ? { proximo_passo: 'o serviço já está executando; acompanhe com producao {acao: "estado", run_id} (a cada checagem, informar_progresso em uma linha). Fechar a janela ou esta conversa NÃO para a produção.' } : {}) } };
    },
  });
}

const PORNOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));

// ─── Camada JSON-RPC ──────────────────────────────────────────────────────────

function enviar(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function responder(id, result) {
  enviar({ jsonrpc: '2.0', id, result });
}

function responderErro(id, code, message, data) {
  const erro = { code, message };
  if (data !== undefined) erro.data = data;
  enviar({ jsonrpc: '2.0', id, error: erro });
}

async function executarFerramenta(id, params) {
  const nome = params && params.name;
  const ferramenta = PORNOME.get(nome);
  if (!ferramenta) {
    responderErro(id, -32602, `Ferramenta desconhecida: ${nome}`, {
      disponiveis: FERRAMENTAS.map((f) => f.name),
    });
    return;
  }
  const args = (params && params.arguments) || {};
  try {
    const saida = await ferramenta.executar(args);
    const texto = saida && saida.texto !== undefined ? saida.texto : JSON.stringify(saida ? saida.json : null, null, 2);
    responder(id, {
      content: [{ type: 'text', text: texto }],
      isError: Boolean(saida && saida.parcial),
    });
  } catch (e) {
    // Falha de ferramenta NÃO é erro de protocolo: volta como isError pro agente ler e se corrigir.
    const msg = e instanceof ErroApi ? e.message : `Falha inesperada em ${nome}: ${String((e && e.stack) || e)}`;
    log(`falha em ${nome}:`, String((e && e.message) || e));
    responder(id, { content: [{ type: 'text', text: msg }], isError: true });
  }
}

async function tratar(msg) {
  const { id, method, params } = msg;
  const ehNotificacao = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      responder(id, {
        // Ecoa a versão do cliente: se ele fala um protocolo mais novo que o nosso
        // vocabulário (initialize/tools), a conversa segue igual — o que usamos não mudou.
        protocolVersion: (params && params.protocolVersion) || PROTOCOLO_PADRAO,
        capabilities: { tools: {} },
        serverInfo: { name: NOME_SERVIDOR, version: VERSAO },
      });
      return;

    case 'notifications/initialized':
    case 'initialized':
    case 'notifications/cancelled':
      return; // notificações: nada a responder

    case 'ping':
      if (!ehNotificacao) responder(id, {});
      return;

    case 'tools/list':
      responder(id, {
        tools: FERRAMENTAS.map((f) => ({
          name: f.name,
          description: f.description,
          inputSchema: f.inputSchema,
        })),
      });
      return;

    case 'tools/call':
      await executarFerramenta(id, params);
      return;

    default:
      if (!ehNotificacao) responderErro(id, -32601, `Método não suportado: ${method}`);
      return;
  }
}

// ─── Loop de stdin (NDJSON) ───────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (pedaco) => {
  buffer += pedaco;
  let quebra;
  while ((quebra = buffer.indexOf('\n')) !== -1) {
    const linha = buffer.slice(0, quebra).replace(/\r$/, '').trim();
    buffer = buffer.slice(quebra + 1);
    if (!linha) continue;

    let msg;
    try {
      msg = JSON.parse(linha);
    } catch {
      responderErro(null, -32700, 'JSON inválido na linha recebida');
      continue;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      responderErro(null, -32600, 'Mensagem JSON-RPC inválida');
      continue;
    }
    // Resposta do cliente a alguma requisição nossa: não emitimos nenhuma, ignora.
    if (msg.method === undefined) continue;

    tratar(msg).catch((e) => {
      log('erro não tratado:', String((e && e.stack) || e));
      if (msg.id !== undefined && msg.id !== null) {
        responderErro(msg.id, -32603, `Erro interno: ${String((e && e.message) || e)}`);
      }
    });
  }
});

process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', (e) => {
  log('erro no stdin:', String((e && e.message) || e));
  process.exit(1);
});

// stdout fechado (o CLI morreu) não pode virar crash barulhento.
process.stdout.on('error', () => process.exit(0));
process.on('uncaughtException', (e) => log('exceção não capturada:', String((e && e.stack) || e)));
process.on('unhandledRejection', (e) => log('promessa rejeitada:', String((e && e.stack) || e)));

log(`pronto — API em ${BASE}, ${FERRAMENTAS.length} ferramentas`);

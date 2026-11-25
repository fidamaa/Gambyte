/* ==============================================================
   MODULE: stockfish-manager.js
   Comunicação com o Stockfish (Web Workers).
   Requer: stockfish-18-lite-single.js/.wasm e stockfish-18-single.js
   na mesma pasta do index.html (o .wasm completo vem do bucket R2).

   ── Motores ────────────────────────────────────────────────────
   • Lite (rede neural menor, .wasm de ~7 MB servido pelo próprio site):
     pronto em segundos, então o site já analisa logo ao abrir.
   • Completo (~108 MB, do bucket R2): baixa em segundo plano, fica
     guardado no navegador (Cache Storage) para as próximas visitas e,
     quando pronto, assume no lugar do Lite ENTRE uma busca e outra
     (nunca no meio de uma). Se não carregar, o Lite segue sozinho. Se a
     passada final de uma análise já começou com o Lite, a troca espera
     a análise acabar (segurarTroca).

   ── Um motor por vez ───────────────────────────────────────────
   Só um motor calcula: o completo, assim que estiver pronto (a análise
   refaz com ele o que tinha saído do Lite); o Lite é o reserva quando o
   completo não carrega, a internet está lenta ou o download para.
   ============================================================== */
const StockfishManager = (() => {
  const usingMulti = false;
  const threadCount = 1;

  // Fila de buscas. Itens "fundo" (posições adiantadas pela análise) vão
  // para o fim; os demais entram antes deles; os "live" (Modo Livre) na
  // frente de tudo.
  let analysisQueue = [];

  // O .wasm completo tem ~108 MB — passa do limite de 25 MB por arquivo do
  // Cloudflare Pages, então fica no bucket R2 (STOCKFISH_WASM_CDN_BASE_URL,
  // definida na página). Sem ela, tudo é servido localmente (dev).
  const WASM_CDN_BASE_URL = (typeof STOCKFISH_WASM_CDN_BASE_URL !== 'undefined' && STOCKFISH_WASM_CDN_BASE_URL) || '';
  const LITE_FILE = 'stockfish-18-lite-single.js';
  const FULL_FILE = 'stockfish-18-single.js';
  const FULL_WASM = 'stockfish-18-single.wasm';
  const CACHE_MOTOR = 'gambyte-motor-sf18-v1';

  const param = (nome) => (location.search.match(new RegExp('[?&]' + nome + '=([\\w.-]+)')) || [])[1];

  // Um motor só por vez (o completo manda; o rápido é o reserva).
  // Diagnóstico: ?motores=2 testa dois em paralelo.
  function _quantos() { return parseInt(param('motores'), 10) === 2 ? 2 : 1; }
  let ALVO = _quantos();   // init({ motores }) pode mudar (DNA: vários Lite em paralelo)

  // ── Motores (slots) ─────────────────────────────────────────
  // slot = { w, kind, busy, item, lines, onUpdate, finish }
  const slots = [];
  let pendingFull = [];        // workers completos prontos, esperando a vez
  let fullLoading = false;
  let fullFailed = false;
  let lenta = false;           // internet lenta demais para o completo
  // Se o resto do download do completo for levar mais que isto, desiste e
  // fica só com o Lite. Diagnóstico: ?limiteCompleto=segundos.
  const LIMITE_DOWNLOAD_S = (m => m ? +m[1] : 40)(location.search.match(/[?&]limiteCompleto=(\d+)/));
  let progresso = null;        // 0–100 do download do completo
  let doAparelho = false;      // completo veio do cache do navegador
  const nps = { lite: 0, full: 0 };   // velocidade média de cada tipo (por motor)

  const engineKind = () => (slots[0] ? slots[0].kind : null);

  // Avisa a página do estado dos motores (aviso embaixo do botão Analisar).
  function _avisar() {
    try {
      window.dispatchEvent(new CustomEvent('stockfish-motor', { detail: getEngineInfo() }));
    } catch (e) {}
  }

  // Cria um worker e faz o aperto de mão UCI; resolve com o worker pronto.
  function _startWorker(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let w, settled = false;
      try { w = new Worker(url); } catch (err) { reject(err); return; }
      const fail = (err) => { if (settled) return; settled = true; clearTimeout(t); try { w.terminate(); } catch (e) {} reject(err); };
      const t = setTimeout(() => fail(new Error('Timeout aguardando Stockfish inicializar')), timeoutMs);
      w.onmessage = (e) => {
        const msg = typeof e.data === 'string' ? e.data : String(e.data);
        if (msg === 'uciok') {
          w.postMessage(`setoption name Threads value ${threadCount}`);
          // Com dois motores, cada um fica com metade da tabela de hash.
          w.postMessage(`setoption name Hash value ${ALVO > 1 ? 64 : 128}`);
          w.postMessage('isready');
        } else if (msg === 'readyok' && !settled) {
          settled = true; clearTimeout(t); resolve(w);
        }
      };
      w.onerror = (e) => fail(new Error('Stockfish worker error: ' + (e && e.message)));
      w.postMessage('uci');
    });
  }

  function _ligar(slot) {
    slot.w.onmessage = (ev) => handleMessage(slot, typeof ev.data === 'string' ? ev.data : String(ev.data));
    slot.w.onerror = (e) => console.error('[Stockfish] Erro no worker:', e && e.message);
  }

  function _novoSlot(w, kind) {
    const slot = { w, kind, busy: false, item: null, lines: [], onUpdate: null, finish: null };
    slots.push(slot);
    _ligar(slot);
    console.log(`[Stockfish] motor ${slots.length} pronto: ${kind}`);
    _avisar();
    _runNext();
    return slot;
  }

  // Na reta final de uma análise feita com o Lite, a troca espera a análise
  // acabar: trocar ali faria a pessoa esperar mais (o completo é ~2x mais
  // lento por posição) para quase nenhuma diferença no resultado.
  let segurar = false;
  function segurarTroca(v) { segurar = !!v; if (!segurar) _trySwap(); _avisar(); }

  // Troca motores Lite parados pelos completos já prontos. Só começa
  // quando todos os completos estão prontos, para não misturar os dois
  // por muito tempo.
  function _trySwap() {
    if (segurar || !pendingFull.length) return;
    const lites = slots.filter(s => s.kind === 'lite');
    if (pendingFull.length < Math.min(ALVO, Math.max(1, lites.length))) return;
    for (const s of lites) {
      if (s.busy || !pendingFull.length) continue;
      const antigo = s.w;
      s.w = pendingFull.shift();
      s.kind = 'full';
      s.elo = 0;               // motor novo começa com a força total
      _ligar(s);
      try { antigo.terminate(); } catch (e) {}
      console.log('[Stockfish] motor trocado para o completo');
    }
    // Sobrou completo pronto (ex.: só havia 1 Lite): vira motor novo.
    while (pendingFull.length && slots.length < ALVO) _novoSlot(pendingFull.shift(), 'full');
    _avisar();
  }

  // Baixa o .wasm completo uma vez e guarda no navegador; devolve a URL
  // a entregar ao worker (blob: do que está guardado, ou a do R2).
  async function _urlWasmCompleto() {
    const origem = WASM_CDN_BASE_URL ? WASM_CDN_BASE_URL.replace(/\/$/, '') + '/' + FULL_WASM : FULL_WASM;
    if (!('caches' in window) || !window.Blob || !URL.createObjectURL) return origem;
    try {
      const cache = await caches.open(CACHE_MOTOR);
      // Versões antigas do cache do motor saem.
      caches.keys().then(ks => ks.filter(k => k.startsWith('gambyte-motor-') && k !== CACHE_MOTOR).forEach(k => caches.delete(k))).catch(() => {});
      let blob = null;
      const guardado = await cache.match(origem);
      if (guardado) { blob = await guardado.blob(); doAparelho = true; progresso = 100; _avisar(); }
      else {
        const r = await fetch(origem, { mode: 'cors', credentials: 'omit' });
        if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
        const total = parseInt(r.headers.get('Content-Length'), 10) || 113000000;
        const leitor = r.body.getReader();
        const partes = []; let recebido = 0, ultimo = -1;
        const t0 = performance.now();
        for (;;) {
          // Download parado por 10 s (internet caiu): desiste e fica com o rápido.
          let parado;
          const { done, value } = await Promise.race([
            leitor.read(),
            new Promise((_, rej) => { parado = setTimeout(() => rej(new Error('download parado')), 10000); })
          ]).catch(err => { lenta = true; try { leitor.cancel(); } catch (e) {} throw err; })
            .finally(() => clearTimeout(parado));
          if (done) break;
          partes.push(value); recebido += value.length;
          // Diagnóstico: ?velocidadeTeste=bytes/s simula uma internet lenta.
          const vt = +(param('velocidadeTeste') || 0);
          if (vt) await new Promise(r => setTimeout(r, value.length / vt * 1000));
          // Depois de 3 s, mede a velocidade real: se o que falta for levar
          // mais que o limite, a internet não comporta o completo agora.
          const passou = (performance.now() - t0) / 1000;
          if (passou > 3) {
            const falta = (total - recebido) / (recebido / passou);
            if (falta > LIMITE_DOWNLOAD_S && slots.length) {
              try { leitor.cancel(); } catch (e) {}
              lenta = true;
              throw new Error(`internet lenta (faltariam ~${Math.round(falta)} s)`);
            }
          }
          const pct = Math.min(99, Math.floor(recebido / total * 100));
          if (pct !== ultimo) { ultimo = pct; progresso = pct; _avisar(); }
        }
        blob = new Blob(partes, { type: 'application/wasm' });
        progresso = 100; _avisar();
        cache.put(origem, new Response(blob, { headers: { 'Content-Type': 'application/wasm' } })).catch(() => {});
      }
      if (blob.size < 50000000) throw new Error('arquivo incompleto');
      return URL.createObjectURL(blob);
    } catch (err) {
      progresso = null;
      if (lenta) throw err;
      console.warn('[Stockfish] cache do motor indisponível, baixando direto:', err.message);
      return origem;
    }
  }

  async function _carregarCompleto() {
    if (fullLoading || slots.every(s => s.kind === 'full') && slots.length >= ALVO) return;
    // Quem pediu para economizar dados fica só com o Lite.
    if (navigator.connection && navigator.connection.saveData) { fullFailed = true; _avisar(); return; }
    fullLoading = true; _avisar();
    try {
      const wasm = await _urlWasmCompleto();
      const url = FULL_FILE + '#' + encodeURIComponent(wasm);
      // Diagnóstico: ?atrasoCompleto=ms simula uma internet lenta.
      const atraso = +(param('atrasoCompleto') || 0);
      if (atraso) await new Promise(r => setTimeout(r, atraso));
      for (let i = 0; i < ALVO; i++) pendingFull.push(await _startWorker(url, 300000));
      if (wasm.startsWith('blob:')) URL.revokeObjectURL(wasm);
    } catch (err) {
      fullFailed = true;
      console.warn('[Stockfish] completo não carregou, seguindo com o Lite:', err.message);
    }
    fullLoading = false;
    _trySwap();
    _avisar();
  }

  // opts.soRapido: só o Lite, sem baixar o completo (Jogar contra o bot: o
  // Lite já passa do nível mais alto do bot, e jogar não gasta 108 MB).
  // opts.motores: quantos motores em paralelo (o DNA analisa várias
  // partidas em fila e usa os núcleos livres do aparelho). ?motores=2 vence.
  async function init(opts = {}) {
    if (opts.motores && !param('motores') && !slots.length) ALVO = Math.max(1, Math.min(4, opts.motores | 0));
    // Diagnóstico: ?motor=lite ou ?motor=full força um dos dois.
    const forcado = param('motor') || (opts.soRapido ? 'lite' : null);
    if (forcado === 'lite' || forcado === 'full') {
      const url = forcado === 'lite' ? LITE_FILE : FULL_FILE + '#' + encodeURIComponent(await _urlWasmCompleto());
      try {
        for (let i = 0; i < ALVO; i++) _novoSlot(await _startWorker(url, 60000), forcado);
      } catch (err) {
        if (!opts.soRapido || slots.length) throw err;
        console.warn('[Stockfish] Lite falhou, carregando o completo:', err.message);
        _novoSlot(await _startWorker(FULL_FILE + '#' + encodeURIComponent(await _urlWasmCompleto()), 120000), 'full');
      }
      return;
    }
    // Diagnóstico: ?atrasoLite=ms simula o motor rápido demorando.
    const atrasoLite = +(param('atrasoLite') || 0);
    if (atrasoLite) await new Promise(r => setTimeout(r, atrasoLite));
    try {
      _novoSlot(await _startWorker(LITE_FILE, 20000), 'lite');
    } catch (err) {
      console.warn('[Stockfish] Lite falhou, carregando o completo:', err.message);
      _novoSlot(await _startWorker(FULL_FILE + '#' + encodeURIComponent(await _urlWasmCompleto()), 120000), 'full');
      return;
    }
    // Segundo Lite (computador) logo em seguida; depois o completo.
    (async () => {
      for (let i = 1; i < ALVO; i++) {
        try { _novoSlot(await _startWorker(LITE_FILE, 20000), 'lite'); } catch (e) { break; }
      }
      _carregarCompleto();
    })();
  }

  // ── Mensagens de cada motor ─────────────────────────────────
  function handleMessage(slot, data) {
    if (data.startsWith('info') && data.includes('score')) {
      slot.lines.push(data);
      if (slot.onUpdate) {
        const pvMatch      = data.match(/multipv (\d+)/);
        const pvNum        = pvMatch ? parseInt(pvMatch[1]) : 1;
        const scoreMatch   = data.match(/score (cp|mate) (-?\d+)/);
        const depthMatch   = data.match(/\bdepth (\d+)\b/);
        const pvLineMatch  = data.match(/\spv\s(.+)$/);
        if (pvNum === 1 && scoreMatch && pvLineMatch) {
          const type  = scoreMatch[1];
          const val   = parseInt(scoreMatch[2]);
          const depth = depthMatch ? parseInt(depthMatch[1]) : 0;
          const firstMove = pvLineMatch[1].trim().split(/\s+/)[0];
          let cpVal, mateN = null;
          if (type === 'mate') { mateN = val; cpVal = val > 0 ? (30000 - val) : -(30000 - Math.abs(val)); }
          else cpVal = val;
          const pv = pvLineMatch[1].trim().split(/\s+/);
          if (firstMove) slot.onUpdate({ bestMove: firstMove, eval: cpVal, mateN, depth, pv });
        }
      }
    }

    if (data.startsWith('bestmove')) {
      const finish = slot.finish;
      const lines = slot.lines;
      const item = slot.item;
      slot.finish = null; slot.lines = []; slot.onUpdate = null; slot.item = null; slot.busy = false;

      // Velocidade do motor (para a trava de tempo por aparelho).
      for (let k = lines.length - 1; k >= 0; k--) {
        const m = lines[k].match(/ nps (\d+)/), t = lines[k].match(/ time (\d+)/);
        if (m && t && +t[1] >= 100) { const v = +m[1]; nps[slot.kind] = nps[slot.kind] ? nps[slot.kind] * 0.8 + v * 0.2 : v; break; }
      }

      if (item && item.preempted) {
        // Interrompida por uma análise ao vivo: volta para a fila logo
        // depois dela e roda de novo do zero (o resultado parcial é descartado).
        // (Uma ao vivo interrompida por uma urgente volta logo depois das urgentes.)
        item.preempted = false;
        let pos = 0;
        while (pos < analysisQueue.length && (analysisQueue[pos].urgente || (!item.live && analysisQueue[pos].live))) pos++;
        analysisQueue.splice(pos, 0, item);
      } else if (finish) finish({ bestmove: data, infoLines: lines });

      _runNext();
    }
  }

  // ── Trava de tempo por aparelho ─────────────────────────────
  // Em vez de um tempo fixo, um "orçamento" de posições calculadas por
  // busca, igual ao que um computador comum faz em ~450 ms (profundidade
  // 16). Aparelho mais lento ganha mais tempo (até um teto), para a
  // qualidade não cair; o computador rápido termina antes.
  const ORCAMENTO = { 16: { lite: 430000, full: 215000, min: 300, max: 1100 },
                      18: { lite: 1700000, full: 860000, min: 1000, max: 3200 } };
  function _travaPara(depth, kind, padrao) {
    const o = ORCAMENTO[depth];
    if (!o || !nps[kind]) return padrao;
    return Math.round(Math.max(o.min, Math.min(o.max, o[kind] / nps[kind] * 1000)));
  }

  // Distribui a fila entre os motores livres.
  function _runNext() {
    _trySwap();
    for (const slot of slots) {
      if (!analysisQueue.length) return;
      if (slot.busy) continue;
      _rodar(slot, analysisQueue.shift());
    }
  }

  function _rodar(slot, item) {
    slot.busy = true;
    slot.item = item;
    const { fen, depth, multiPV, movesUCI, resolve, onUpdate } = item;
    const movetime = item.travaAuto ? _travaPara(depth, slot.kind, item.movetime) : item.movetime;
    slot.onUpdate = onUpdate || null;
    slot.lines = [];
    const movesSuffix = (movesUCI && movesUCI.length) ? ` moves ${movesUCI.join(' ')}` : '';

    slot.finish = (result) => {
      const pvMap = {};
      for (const line of result.infoLines) {
        const pvMatch    = line.match(/multipv (\d+)/);
        const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
        const depthMatch = line.match(/\bdepth (\d+)\b/);
        // Regex exige espaço ANTES de "pv" pra não casar com "multipv".
        const pvLineMatch = line.match(/\spv\s(.+)$/);
        if (pvMatch && scoreMatch) {
          const pvNum = parseInt(pvMatch[1]);
          const type  = scoreMatch[1];
          const val   = parseInt(scoreMatch[2]);
          const d     = depthMatch ? parseInt(depthMatch[1]) : 0;
          if (!pvMap[pvNum] || d >= (pvMap[pvNum].depth || 0)) {
            const cpVal = type === 'mate' ? (val > 0 ? (30000 - val) : -(30000 - Math.abs(val))) : val;
            pvMap[pvNum] = {
              val: cpVal,
              mateN: type === 'mate' ? val : null,
              depth: d,
              // Linha principal na maior profundidade vista até agora.
              pv: pvLineMatch ? pvLineMatch[1].trim() : (pvMap[pvNum] ? pvMap[pvNum].pv : null)
            };
          }
        }
      }
      const evals = [], mateNs = [], pvLines = [];
      for (let i = 1; i <= multiPV; i++) {
        evals.push(pvMap[i] ? pvMap[i].val : null);
        mateNs.push(pvMap[i] ? pvMap[i].mateN : null);
        pvLines.push(pvMap[i] ? (pvMap[i].pv || null) : null);
      }
      const bmMatch = result.bestmove.match(/bestmove (\S+)/);
      const bestMove = bmMatch ? bmMatch[1] : null;
      // Profundidade da linha principal efetivamente concluída. Com limite
      // de tempo (movetime), pode ficar abaixo da profundidade pedida.
      const reachedDepth = pvMap[1] ? pvMap[1].depth : 0;
      resolve({ evals, mateNs, pvLines, bestMove, reachedDepth, cancelled: !!item.cancelled, motor: slot.kind });
    };

    // Força limitada (Jogar contra o bot): vale só para a busca que pediu.
    // A próxima busca sem elo (análise, Modo Livre) volta à força total.
    const elo = item.elo ? Math.max(1320, Math.min(3190, Math.round(item.elo))) : 0;
    if (elo !== (slot.elo || 0)) {
      if (elo) {
        slot.w.postMessage('setoption name UCI_LimitStrength value true');
        slot.w.postMessage(`setoption name UCI_Elo value ${elo}`);
      } else slot.w.postMessage('setoption name UCI_LimitStrength value false');
      slot.elo = elo;
    }
    slot.w.postMessage(`setoption name MultiPV value ${multiPV}`);
    slot.w.postMessage(`position fen ${fen}${movesSuffix}`);
    // movetime é só uma trava de segurança: o motor para na profundidade
    // pedida OU quando o tempo acaba, o que vier primeiro.
    // searchmoves (se houver) fica por último: o motor lê tudo depois dele como lances.
    const busca = item.searchMoves && item.searchMoves.length ? ` searchmoves ${item.searchMoves.join(' ')}` : '';
    slot.w.postMessage(`go depth ${depth}` + (movetime ? ` movetime ${movetime}` : '') + busca);
  }

  /**
   * Enfileira análise de uma posição FEN.
   *
   * @param {string} fen        FEN da posição base
   * @param {number} depth      profundidade de busca
   * @param {number} multiPV    quantas linhas retornar
   * @param {string[]} movesUCI opcional. Lances extras (UCI) a aplicar a
   *                            partir do FEN antes de analisar.
   * @param {function} onUpdate opcional. Chamado a cada nova linha "info"
   *                            (multipv 1) DURANTE a busca, com
   *                            {bestMove, eval, mateN, depth}.
   * @param {object} opts       { movetime, travaAuto (trava pelo aparelho,
   *                            com movetime como padrão), fundo (vai para o
   *                            fim da fila: posições adiantadas), elo (força
   *                            limitada só nesta busca, UCI_Elo), searchMoves
   *                            (só estes lances são buscados) }
   */
  function analyzePosition(fen, depth, multiPV = 3, movesUCI = [], onUpdate = null, opts = {}) {
    return new Promise((resolve) => {
      if (!slots.length) {
        console.warn('[Stockfish] Worker não disponível, retornando eval 0');
        resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null });
        return;
      }
      const item = { fen, depth, multiPV, movesUCI, resolve, onUpdate, movetime: opts.movetime || 0, travaAuto: !!opts.travaAuto, fundo: !!opts.fundo,
                     elo: opts.elo || 0, searchMoves: opts.searchMoves || null, urgente: !!opts.urgente };
      if (item.urgente) {
        // Nota rápida do lance que a pessoa acabou de fazer: fura a fila,
        // inclusive a análise ao vivo, que volta logo depois (a tabela de
        // hash do motor guarda o que ela já tinha calculado).
        let pos = 0;
        while (pos < analysisQueue.length && analysisQueue[pos].urgente) pos++;
        analysisQueue.splice(pos, 0, item);
        if (!slots.some(sl => !sl.busy)) {
          const sl = slots.find(x => x.item && !x.item.urgente && !x.item.preempted);
          if (sl && slots.every(x => x.busy)) { sl.item.preempted = true; sl.onUpdate = null; sl.w.postMessage('stop'); }
        }
      } else if (item.fundo) analysisQueue.push(item);
      else {
        let pos = analysisQueue.findIndex(it => it.fundo);
        if (pos < 0) pos = analysisQueue.length;
        analysisQueue.splice(pos, 0, item);
      }
      _runNext();
    });
  }

  /**
   * Análise ao vivo do tabuleiro (o jogador acabou de mexer uma peça).
   * Tem prioridade sobre tudo: se não houver motor livre, a busca comum do
   * primeiro motor é interrompida e volta para a fila logo depois desta;
   * uma análise ao vivo anterior é simplesmente cancelada. Uma linha
   * (MultiPV 1) para responder rápido.
   */
  // opts.movesUCI: lances desde `fen` até a posição mostrada (o motor passa a
  // enxergar as repetições). opts.searchMoves: só estes lances são buscados.
  function analyzeLive(fen, depth, onUpdate, opts = {}) {
    return new Promise((resolve) => {
      if (!slots.length) { resolve(null); return; }
      analysisQueue = analysisQueue.filter(it => {
        if (!it.live) return true;
        it.resolve({ evals: [null], mateNs: [null], pvLines: [null], bestMove: null, cancelled: true });
        return false;
      });
      const item = { fen, depth, multiPV: 1, movesUCI: opts.movesUCI || [], searchMoves: opts.searchMoves || null, resolve, onUpdate, movetime: 0, live: true };
      // Na frente de tudo, menos das notas rápidas de lance (urgentes).
      let pos = 0;
      while (pos < analysisQueue.length && analysisQueue[pos].urgente) pos++;
      analysisQueue.splice(pos, 0, item);
      // Ao vivo anterior ainda rodando em algum motor: cancela.
      for (const s of slots) if (s.busy && s.item && s.item.live) { s.item.cancelled = true; s.item.preempted = false; s.onUpdate = null; s.w.postMessage('stop'); }
      const livre = slots.find(s => !s.busy);
      if (livre) { _runNext(); return; }
      const s = slots[0];
      if (s.item && !s.item.live && !s.item.urgente && !s.item.preempted) { s.item.preempted = true; s.onUpdate = null; s.w.postMessage('stop'); }
    });
  }

  /** Quebra uma PV do UCI ("e2e4 e7e5 ...") num array de lances. */
  function parsePV(pvString) {
    if (!pvString) return [];
    return pvString.trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Verificação de sacrifício-armadilha: joga o lance de captura hipotético
   * do adversário e analisa o que sobra.
   * @returns {Promise<{evalAfterCapture, mateAfterCapture, pvAfterCapture}>}
   *   evalAfterCapture já na NOSSA perspectiva (depois da captura, somos
   *   nós que jogamos de novo).
   */
  async function verifySacrificeTrap(fenAfterOurMove, captureMoveUCI, depth = 16) {
    const result = await analyzePosition(fenAfterOurMove, depth, 1, [captureMoveUCI]);
    return {
      evalAfterCapture: result.evals[0] ?? null,
      mateAfterCapture: result.mateNs[0] ?? null,
      pvAfterCapture:   parsePV(result.pvLines[0])
    };
  }

  /**
   * Interrompe as buscas em andamento e descarta a fila — usado quando o
   * usuário troca de contexto (Limpar, nova análise, sair do Modo Livre).
   */
  function abort() {
    const pending = analysisQueue;
    analysisQueue = [];
    for (const item of pending) {
      // Resolve com um resultado neutro em vez de deixar o `await` pendurado;
      // quem chamou já deve checar sua própria flag de cancelamento.
      item.resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null });
    }
    for (const s of slots) {
      if (!s.busy) continue;
      if (s.item) s.item.preempted = false;
      s.w.postMessage('stop'); // motor responde com "bestmove" quase na hora
    }
  }

  /** Tira da fila as posições adiantadas (de uma análise que acabou). */
  function descartarFundo() {
    analysisQueue = analysisQueue.filter(it => {
      if (!it.fundo) return true;
      it.resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null, cancelled: true });
      return false;
    });
  }

  function terminate() {
    for (const s of slots) { try { s.w.terminate(); } catch (e) {} }
    slots.length = 0;
  }

  function getEngineInfo() {
    return {
      usingMulti, threadCount, kind: engineKind(), motores: slots.length, alvo: ALVO,
      tipos: slots.map(s => s.kind),
      carregandoCompleto: fullLoading, esperando: pendingFull.length > 0, falhou: fullFailed, lenta,
      progresso, doAparelho, nps: { ...nps }
    };
  }

  function isReady() { return slots.length > 0; }

  return { init, segurarTroca, analyzePosition, analyzeLive, verifySacrificeTrap, parsePV, abort, descartarFundo, terminate, getEngineInfo, isReady };
})();

/* ==============================================================
   MODULE: stockfish-manager.js
   Handles communication with Stockfish via Web Worker
   Requer: stockfish-18-lite-single.js/.wasm e stockfish-18-single.js
   na mesma pasta do index.html (o .wasm completo vem do bucket R2).

   NOTA — multi-thread tentado e revertido: existe também
   stockfish-18-multi.js/.wasm (build com pthreads via
   SharedArrayBuffer) no repositório, mas ele NÃO é usado por padrão.
   Testado em dois ambientes reais diferentes (sandbox de
   desenvolvimento e um PC real de 16 núcleos lógicos/Windows) e em
   AMBOS o multi-thread produziu tempos por posição erráticos e piores
   que o single-thread (ex.: mesma profundidade e complexidade de
   posição variando de 3ms a 9200ms sem padrão) — contenção real entre
   as threads de busca e o resto do processo do navegador (UI, DOM,
   GC) competindo pelos mesmos núcleos físicos, anulando qualquer
   ganho teórico de paralelismo nesse contexto (motor rodando dentro
   de uma aba, não um benchmark isolado). Não vale o risco: o build
   single-thread é consistente e previsível.
   ============================================================== */
const StockfishManager = (() => {
  let worker = null;
  let ready = false;
  let fullyReady = false;   // true depois do readyok: pode receber buscas
  let currentResolve = null;
  let currentLines = [];
  let currentOnUpdate = null;
  const usingMulti = false;
  const threadCount = 1;
  // Fila de análises: garante que apenas UMA roda por vez no worker
  let analysisQueue = [];
  let analysisRunning = false;
  let currentItem = null;   // item da fila que está rodando agora

  // O .wasm do Stockfish tem ~108MB — passa de longe do limite de 25MB
  // por arquivo do Cloudflare Pages/Workers. Em produção ele fica num
  // bucket R2 à parte (bandwidth grátis, sem limite de tamanho); o site
  // continua servindo só o .js (esse sim, pequeno) normalmente.
  // Defina STOCKFISH_WASM_CDN_BASE_URL (ex. em index.html, antes deste
  // script) com a URL pública do bucket pra ativar isso; deixe vazio/
  // undefined pra servir tudo local (uso em desenvolvimento).
  const WASM_CDN_BASE_URL = (typeof STOCKFISH_WASM_CDN_BASE_URL !== 'undefined' && STOCKFISH_WASM_CDN_BASE_URL) || '';

  // stockfish-18-single.js (biblioteca de terceiros, nmrugg/stockfish.js)
  // lê a URL do .wasm a partir do fragmento (#) da própria URL do
  // Worker, se houver um — é o mecanismo que ela já expõe pra hospedar
  // o .wasm em outro lugar, sem precisar tocar no arquivo dela.
  function _workerUrl(file) {
    if (!WASM_CDN_BASE_URL) return file;
    const wasmUrl = WASM_CDN_BASE_URL.replace(/\/$/, '') + '/' + file.replace(/\.js$/, '.wasm');
    return file + '#' + encodeURIComponent(wasmUrl);
  }

  // ── Dois motores: Lite primeiro, completo depois ─────────────
  // O Lite (rede neural menor, .wasm de ~7 MB servido pelo próprio site)
  // carrega em segundos, então o site já analisa logo ao abrir. Em
  // seguida o completo (~108 MB, do bucket R2) baixa em segundo plano e,
  // quando fica pronto, assume o lugar do Lite ENTRE uma busca e outra
  // (nunca no meio de uma) — uma análise em andamento continua com ele.
  // Se o completo não carregar (internet lenta, aparelho fraco), o Lite
  // segue sozinho.
  const LITE_FILE = 'stockfish-18-lite-single.js';
  const FULL_FILE = 'stockfish-18-single.js';
  let engineKind = null;       // 'lite' | 'full'
  let pendingFull = null;      // worker completo pronto, esperando a vez
  let fullLoading = false;
  let fullFailed = false;

  // Avisa a página do estado dos motores (aviso embaixo do botão Analisar).
  function _avisar() {
    try {
      window.dispatchEvent(new CustomEvent('stockfish-motor', {
        detail: { kind: engineKind, carregandoCompleto: fullLoading, esperando: !!pendingFull, falhou: fullFailed }
      }));
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
          w.postMessage('setoption name Hash value 128');
          w.postMessage('isready');
        } else if (msg === 'readyok' && !settled) {
          settled = true; clearTimeout(t); resolve(w);
        }
      };
      w.onerror = (e) => fail(new Error('Stockfish worker error: ' + (e && e.message)));
      w.postMessage('uci');
    });
  }

  function _usar(w, kind) {
    const antigo = worker;
    worker = w;
    engineKind = kind;
    ready = fullyReady = true;
    worker.onmessage = (ev) => handleMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    worker.onerror = (e) => console.error('[Stockfish] Erro no worker:', e && e.message);
    if (antigo && antigo !== w) { try { antigo.terminate(); } catch (e) {} }
    console.log(`[Stockfish] motor em uso: ${kind}`);
    _avisar();
  }

  // Troca para o completo se ele já carregou e o motor está parado.
  // Na reta final de uma análise feita com o Lite, a troca espera a análise
  // acabar: trocar ali faria a pessoa esperar mais (o completo é ~2x mais
  // lento por posição) para quase nenhuma diferença no resultado.
  let segurar = false;
  function segurarTroca(v) { segurar = !!v; if (!segurar) _trySwap(); else _avisar(); }

  function _trySwap() {
    if (!pendingFull || analysisRunning || segurar) return;
    const w = pendingFull; pendingFull = null;
    _usar(w, 'full');
  }

  function _carregarCompleto() {
    if (fullLoading || engineKind === 'full') return;
    // Quem pediu para economizar dados fica só com o Lite.
    if (navigator.connection && navigator.connection.saveData) { fullFailed = true; _avisar(); return; }
    fullLoading = true;
    _avisar();
    _startWorker(_workerUrl(FULL_FILE), 300000)
      // Diagnóstico: ?atrasoCompleto=ms simula uma internet lenta.
      .then(w => new Promise(r => setTimeout(() => r(w), +((location.search.match(/[?&]atrasoCompleto=(\d+)/) || [])[1] || 0))))
      .then(w => { pendingFull = w; fullLoading = false; _trySwap(); })
      .catch(err => { fullFailed = true; console.warn('[Stockfish] completo não carregou, seguindo com o Lite:', err.message); })
      .finally(() => { fullLoading = false; _avisar(); });
  }

  async function init() {
    // Diagnóstico: ?motor=lite ou ?motor=full força um dos dois.
    const forcado = (location.search.match(/[?&]motor=(lite|full)/) || [])[1];
    if (forcado === 'full') { _usar(await _startWorker(_workerUrl(FULL_FILE), 60000), 'full'); return; }
    if (forcado === 'lite') { _usar(await _startWorker(LITE_FILE, 20000), 'lite'); return; }
    try {
      _usar(await _startWorker(LITE_FILE, 20000), 'lite');
    } catch (err) {
      console.warn('[Stockfish] Lite falhou, carregando o completo:', err.message);
      _usar(await _startWorker(_workerUrl(FULL_FILE), 60000), 'full');
      return;
    }
    _carregarCompleto();
  }

  // Chamado pelo worker.onmessage durante análise
  function handleMessage(data) {
    if (data.startsWith('info') && data.includes('score')) {
      currentLines.push(data);

      // Atualização progressiva: entrega o melhor lance ATUAL (multipv 1)
      // assim que uma nova linha "info ... pv ..." chega, sem esperar o
      // "go depth" terminar — usado pra seta do motor acompanhar a busca
      // em tempo real em vez de só aparecer no fim.
      if (currentOnUpdate) {
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
          if (firstMove) currentOnUpdate({ bestMove: firstMove, eval: cpVal, mateN, depth, pv });
        }
      }
    }

    if (data.startsWith('bestmove')) {
      console.log('[Stockfish ←] bestmove recebido, linhas coletadas:', currentLines.length);
      const resolve = currentResolve;
      const lines = [...currentLines];
      const item = currentItem;
      currentResolve = null;
      currentLines = [];
      currentOnUpdate = null;
      currentItem = null;
      analysisRunning = false;

      if (item && item.preempted) {
        // Interrompida por uma análise ao vivo: volta para a fila logo
        // depois dela e roda de novo do zero (o resultado parcial é descartado).
        item.preempted = false;
        let pos = 0;
        while (pos < analysisQueue.length && analysisQueue[pos].live) pos++;
        analysisQueue.splice(pos, 0, item);
      } else if (resolve) resolve({ bestmove: data, infoLines: lines });

      // Próximo item da fila
      _runNext();
    }
  }

  // Executa o próximo item da fila, se houver
  function _runNext() {
    if (analysisRunning) return;
    _trySwap();
    if (analysisQueue.length === 0) return;
    analysisRunning = true;

    const item = analysisQueue.shift();
    currentItem = item;
    const { fen, depth, multiPV, movesUCI, resolve, onUpdate, movetime } = item;
    currentOnUpdate = onUpdate || null;
    const movesSuffix = (movesUCI && movesUCI.length) ? ` moves ${movesUCI.join(' ')}` : '';
    console.log(
      `[Stockfish →] go depth ${depth} | multipv ${multiPV} | fen: ${fen.slice(0, 40)}…` +
      (movesSuffix ? ` | +moves: ${movesUCI.join(' ')}` : '')
    );

    currentLines = [];
    currentResolve = (result) => {
      const pvMap = {};
      for (const line of result.infoLines) {
        const pvMatch    = line.match(/multipv (\d+)/);
        const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
        const depthMatch = line.match(/\bdepth (\d+)\b/);
        // NOVO: captura a linha principal completa (lances UCI após "pv").
        // Regex exige espaço ANTES de "pv" pra não casar com "multipv".
        const pvLineMatch = line.match(/\spv\s(.+)$/);

        if (pvMatch && scoreMatch) {
          const pvNum = parseInt(pvMatch[1]);
          const type  = scoreMatch[1];
          const val   = parseInt(scoreMatch[2]);
          const d     = depthMatch ? parseInt(depthMatch[1]) : 0;
          if (!pvMap[pvNum] || d >= (pvMap[pvNum].depth || 0)) {
            let cpVal;
            if (type === 'mate') {
              cpVal = val > 0 ? (30000 - val) : -(30000 - Math.abs(val));
            } else {
              cpVal = val;
            }
            pvMap[pvNum] = {
              val: cpVal,
              mateN: type === 'mate' ? val : null,
              depth: d,
              // NOVO: linha principal na maior profundidade vista até agora.
              // Se esta linha específica não trouxe "pv" (raro, mas possível
              // em mensagens parciais), preserva a última PV válida guardada.
              pv: pvLineMatch ? pvLineMatch[1].trim() : (pvMap[pvNum] ? pvMap[pvNum].pv : null)
            };
          }
        }
      }

      const evals   = [];
      const mateNs  = [];
      const pvLines = [];  // NOVO: uma linha principal (string "e2e4 e7e5 ...") por multipv
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
      resolve({ evals, mateNs, pvLines, bestMove, reachedDepth, cancelled: !!item.cancelled });
    };

    worker.postMessage(`setoption name MultiPV value ${multiPV}`);
    worker.postMessage(`position fen ${fen}${movesSuffix}`);
    // movetime é só uma trava de segurança: o motor para na profundidade
    // pedida OU quando o tempo acaba, o que vier primeiro.
    worker.postMessage(`go depth ${depth}` + (movetime ? ` movetime ${movetime}` : ''));
  }

  /**
   * Enfileira análise de uma posição FEN.
   * Serializada: apenas uma análise roda no worker por vez.
   *
   * @param {string} fen        FEN da posição base
   * @param {number} depth      profundidade de busca
   * @param {number} multiPV    quantas linhas retornar
   * @param {string[]} movesUCI NOVO — opcional. Lances extras (UCI) a aplicar
   *                            a partir do FEN antes de analisar (via
   *                            "position fen ... moves ..."), sem precisar
   *                            recalcular o FEN manualmente no chamador.
   * @param {function}  onUpdate opcional. Chamado a cada nova linha "info"
   *                            (multipv 1) recebida DURANTE a busca, com
   *                            {bestMove, eval, mateN, depth} — permite
   *                            mostrar o melhor lance atual progressivamente,
   *                            sem esperar o "go depth" terminar.
   */
  function analyzePosition(fen, depth, multiPV = 3, movesUCI = [], onUpdate = null, opts = {}) {
    return new Promise((resolve) => {
      if (!worker) {
        console.warn('[Stockfish] Worker não disponível, retornando eval 0');
        resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null });
        return;
      }
      console.log(`[Stockfish] Enfileirando análise. Fila: ${analysisQueue.length + 1}`);
      analysisQueue.push({ fen, depth, multiPV, movesUCI, resolve, onUpdate, movetime: opts.movetime || 0 });
      _runNext();
    });
  }

  /**
   * Análise ao vivo do tabuleiro (o jogador acabou de mexer uma peça).
   * Tem prioridade sobre tudo: uma busca comum em andamento é interrompida
   * e volta para a fila logo depois desta; uma análise ao vivo anterior é
   * simplesmente cancelada. Uma linha (MultiPV 1) para responder rápido;
   * onUpdate recebe a linha prevista inteira a cada profundidade nova.
   */
  function analyzeLive(fen, depth, onUpdate) {
    return new Promise((resolve) => {
      if (!worker) { resolve(null); return; }
      // Ao vivo ainda na fila: descartadas (resolvem como canceladas).
      analysisQueue = analysisQueue.filter(it => {
        if (!it.live) return true;
        it.resolve({ evals: [null], mateNs: [null], pvLines: [null], bestMove: null, cancelled: true });
        return false;
      });
      const item = { fen, depth, multiPV: 1, movesUCI: [], resolve, onUpdate, movetime: 0, live: true };
      analysisQueue.unshift(item);
      if (analysisRunning && currentItem) {
        if (currentItem.live) currentItem.cancelled = true;
        else currentItem.preempted = true;
        currentOnUpdate = null;
        worker.postMessage('stop');
      } else {
        _runNext();
      }
    });
  }

  /**
   * NOVO: quebra uma string de PV do UCI ("e2e4 e7e5 g1f3 ...") num array
   * de lances individuais. Útil pra quem quiser mostrar a continuação
   * prevista na UI (ex.: "se Bxe5, então Qxe5#").
   */
  function parsePV(pvString) {
    if (!pvString) return [];
    return pvString.trim().split(/\s+/).filter(Boolean);
  }

  /**
   * NOVO: verificação RIGOROSA de sacrifício-armadilha.
   *
   * Em vez de inferir "é armadilha" só pelo gap entre a 1ª e a 2ª opção do
   * motor (o proxy indireto usado hoje em move-classifier.js), esta função
   * joga de fato o lance de captura hipotético do adversário a partir da
   * posição dada e manda o motor analisar o que sobra — permitindo checar
   * se existe mesmo um mate ou vantagem decisiva forçada como punição.
   *
   * @param {string} fenAfterOurMove  FEN logo após o NOSSO lance (vez do adversário)
   * @param {string} captureMoveUCI   lance de captura hipotético do adversário (ex.: "e5d4")
   * @param {number} depth            profundidade de busca (padrão 16 — acha mates
   *                                  curtos/médios sem pesar demais no worker)
   * @returns {Promise<{evalAfterCapture: number|null, mateAfterCapture: number|null,
   *                     pvAfterCapture: string[]}>}
   *
   *   evalAfterCapture:  eval (cp) após a captura, JÁ NA NOSSA perspectiva —
   *                      depois da jogada extra do adversário, quem move somos
   *                      nós de novo, então "positivo" volta a significar "bom pra nós".
   *   mateAfterCapture:  se não-nulo, nº de lances até o mate (positivo = nós matamos).
   *   pvAfterCapture:    continuação prevista pelo motor após a captura, já
   *                      quebrada em lances UCI (parsePV aplicado).
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
   * Interrompe a análise em andamento e descarta a fila — usado quando o
   * usuário troca de contexto (Limpar, nova Análise, sair do Modo Livre)
   * e o cálculo que estava rolando deixou de fazer sentido. Sem isso, o
   * motor continuava rodando em segundo plano até terminar o "go depth"
   * inteiro, mesmo depois do usuário já ter saído da tela que pediu aquilo.
   */
  function abort() {
    const pending = analysisQueue;
    analysisQueue = [];
    if (currentItem) currentItem.preempted = false;
    for (const item of pending) {
      // Resolve com um resultado neutro em vez de deixar o `await` de quem
      // pediu pendurado pra sempre — quem chamou já deve checar sua própria
      // flag de cancelamento antes de usar isso.
      item.resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null });
    }
    if (analysisRunning && worker) {
      worker.postMessage('stop'); // motor responde com "bestmove" quase na hora
    }
  }

  function terminate() {
    if (worker) { worker.terminate(); worker = null; ready = false; }
  }

  function getEngineInfo() { return { usingMulti, threadCount, kind: engineKind, carregandoCompleto: fullLoading, esperando: !!pendingFull, falhou: fullFailed }; }

  function isReady() { return fullyReady && !!worker; }

  return { init, segurarTroca, analyzePosition, analyzeLive, verifySacrificeTrap, parsePV, abort, terminate, getEngineInfo, isReady };
})();
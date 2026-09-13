/* ==============================================================
   MODULE: stockfish-manager.js
   Handles communication with Stockfish via Web Worker
   Requer: stockfish-18-single.js/.wasm na mesma pasta do index.html.

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
  let currentResolve = null;
  let currentLines = [];
  let currentOnUpdate = null;
  const usingMulti = false;
  const threadCount = 1;
  // Fila de análises: garante que apenas UMA roda por vez no worker
  let analysisQueue = [];
  let analysisRunning = false;

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

  function init() {
    return new Promise((resolve, reject) => {
      try {
        const file = 'stockfish-18-single.js';
        console.log(`[Stockfish] Criando Web Worker: ${file}` + (WASM_CDN_BASE_URL ? ` (wasm via CDN: ${WASM_CDN_BASE_URL})` : ''));
        worker = new Worker(_workerUrl(file));

        let settled = false;

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            console.error('[Stockfish] Timeout: nenhuma resposta em 20s');
            reject(new Error('Timeout aguardando Stockfish inicializar'));
          }
        }, 20000);

        worker.onmessage = (e) => {
          const msg = typeof e.data === 'string' ? e.data : String(e.data);
          console.log('[Stockfish ←]', msg.slice(0, 120));

          if (msg === 'uciok') {
            console.log(`[Stockfish] uciok recebido → configurando Threads=${threadCount}, Hash e enviando isready`);
            ready = true;
            // Build single: Threads max=1 no próprio motor, então o "1" é
            // só formalidade. Build multi: usa pthreads de verdade — isso
            // é o que efetivamente "força mais uso de CPU" pedido, não só
            // profundidade. Hash maior com mais threads evita que elas
            // fiquem competindo por poucas entradas de transposição.
            worker.postMessage(`setoption name Threads value ${threadCount}`);
            worker.postMessage(`setoption name Hash value ${usingMulti ? 256 : 128}`);
            worker.postMessage('isready');

          } else if (msg === 'readyok') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              console.log('[Stockfish] readyok recebido → pronto para análise!');
              worker.onmessage = (ev) => handleMessage(
                typeof ev.data === 'string' ? ev.data : String(ev.data)
              );
              resolve();
            }
          }
        };

        worker.onerror = (e) => {
          console.error('[Stockfish] Erro no worker:', e.message, e);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error('Stockfish worker error: ' + e.message));
          }
        };

        console.log('[Stockfish] Enviando comando: uci');
        worker.postMessage('uci');

      } catch (err) {
        console.error('[Stockfish] Exceção ao criar worker:', err);
        reject(err);
      }
    });
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
          if (firstMove) currentOnUpdate({ bestMove: firstMove, eval: cpVal, mateN, depth });
        }
      }
    }

    if (data.startsWith('bestmove')) {
      console.log('[Stockfish ←] bestmove recebido, linhas coletadas:', currentLines.length);
      const resolve = currentResolve;
      const lines = [...currentLines];
      currentResolve = null;
      currentLines = [];
      currentOnUpdate = null;
      analysisRunning = false;

      if (resolve) resolve({ bestmove: data, infoLines: lines });

      // Próximo item da fila
      _runNext();
    }
  }

  // Executa o próximo item da fila, se houver
  function _runNext() {
    if (analysisRunning || analysisQueue.length === 0) return;
    analysisRunning = true;

    const { fen, depth, multiPV, movesUCI, resolve, onUpdate } = analysisQueue.shift();
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

      resolve({ evals, mateNs, pvLines, bestMove });
    };

    worker.postMessage(`setoption name MultiPV value ${multiPV}`);
    worker.postMessage(`position fen ${fen}${movesSuffix}`);
    worker.postMessage(`go depth ${depth}`);
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
  function analyzePosition(fen, depth, multiPV = 3, movesUCI = [], onUpdate = null) {
    return new Promise((resolve) => {
      if (!worker) {
        console.warn('[Stockfish] Worker não disponível, retornando eval 0');
        resolve({ evals: [0], mateNs: [null], pvLines: [null], bestMove: null });
        return;
      }
      console.log(`[Stockfish] Enfileirando análise. Fila: ${analysisQueue.length + 1}`);
      analysisQueue.push({ fen, depth, multiPV, movesUCI, resolve, onUpdate });
      _runNext();
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

  function getEngineInfo() { return { usingMulti, threadCount }; }

  return { init, analyzePosition, verifySacrificeTrap, parsePV, abort, terminate, getEngineInfo };
})();
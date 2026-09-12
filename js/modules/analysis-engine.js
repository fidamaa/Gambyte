/* ==============================================================
   MODULE: analysis-engine.js
   Orchestrates the two-phase progressive analysis.
   Depende de: stockfish-manager.js, opening-detector.js,
               move-classifier.js
   ============================================================== */
const AnalysisEngine = (() => {

  // Phase 1: quick pass
  const PHASE1_DEPTH = 7;
  // Phase 2: refinement depths — depth 20 apenas se PRO ativado
  const PHASE2_DEPTHS_FREE = [10, 14];
  const PHASE2_DEPTHS_PRO  = [10, 14, 20];
  const STABILITY_THRESHOLD = 30; // cp change below which we stop refining
  const MULTIPV = 3;

  let onProgress = null;
  let onMoveUpdate = null;
  let onComplete = null;
  let aborted = false;

  // ── Material real capturável (usado por Gafe e Brilhante) ─────────
  // Extraído da resposta REAL do motor (bestMove da posição pós-lance),
  // não de um gerador de lances próprio — evita reimplementar regras de
  // xeque/pinos/etc. só pra saber "o que está pendurado".
  const PIECE_VALUES = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

  function pieceValueAtSquare(fen, square) {
    const board = fen.split(' ')[0].split('/');
    const col = square.charCodeAt(0) - 97;
    const row = 8 - parseInt(square[1], 10);
    let file = 0;
    for (const ch of board[row]) {
      if (/\d/.test(ch)) { file += parseInt(ch, 10); }
      else {
        if (file === col) return PIECE_VALUES[ch.toLowerCase()] || 0;
        file++;
      }
    }
    return 0;
  }

  // Valor do que o adversário realmente captura, segundo a própria
  // continuação principal do motor na posição pós-lance (fenAfterOurMove).
  function computeImmediateCaptureValue(fenAfterOurMove, opponentBestMoveUCI) {
    // Stockfish retorna "bestmove (none)" quando não há lances legais
    // (posição de xeque-mate/afogamento) — não é um UCI válido, ignorar.
    if (!opponentBestMoveUCI || !/^[a-h][1-8][a-h][1-8]/.test(opponentBestMoveUCI)) return 0;
    const toSquare = opponentBestMoveUCI.slice(2, 4);
    return pieceValueAtSquare(fenAfterOurMove, toSquare);
  }

  function setCallbacks(callbacks) {
    onProgress = callbacks.onProgress;
    onMoveUpdate = callbacks.onMoveUpdate;
    onComplete = callbacks.onComplete;
  }

  function abort() { aborted = true; }

  /**
   * Main analysis entry point
   */
  async function analyze(parsedGame) {
    aborted = false;

    const { moves, fensBefore, fensAfter, headers } = parsedGame;
    const total = moves.length;
    const movesData = new Array(total).fill(null).map((_, i) => ({
      index: i,
      san: moves[i],
      color: i % 2 === 0 ? 'white' : 'black',
      moveIndex: i,
      evalBefore: null,
      evalAfter: null,
      bestEval: null,
      bestMoveUCI: null,
      playedMoveUCI: null,    // FIX 3: UCI do lance jogado (para comparar com bestMoveUCI)
      multiPVEvals: null,
      mateNs: null,           // FIX 2: profundidade real do mate por PV
      classification: null,
      isBook: false,
      isCheckmate: false      // FIX 5: lance final de xeque-mate
    }));

    // Positional cache: fen -> analysis result
    const cache = new Map();

    async function getAnalysis(fen, depth) {
      const key = `${fen}@${depth}`;
      if (cache.has(key)) return cache.get(key);
      const result = await StockfishManager.analyzePosition(fen, depth, MULTIPV);
      cache.set(key, result);
      return result;
    }

    // Set up book tracker usando a Trie do OpeningDetector (O(1) por lance)
    // Caminha pela Trie conforme os lances são jogados; para ao sair do livro.
    // FIX BOOK: marca como livro TODOS os lances enquanto ainda há nó filho correspondente
    // (não apenas folhas), garantindo que sequências longas de abertura sejam reconhecidas.
    OpeningDetector.build(); // garante que a Trie está pronta
    let _bookNode   = OpeningDetector.getRootNode();
    let _outOfBook  = false;
    const bookTracker = {
      addMove(san) {
        if (_outOfBook || !_bookNode) return false;
        const clean = san.replace(/[+#!?]/g, '');
        const next  = _bookNode.children.get(clean);
        if (!next) {
          // Antes de desistir, tenta normalizar promoção (ex: e8=Q → e8Q)
          const altClean = clean.replace('=', '');
          const altNext  = _bookNode.children.get(altClean);
          if (!altNext) { _outOfBook = true; return false; }
          _bookNode = altNext;
        } else {
          _bookNode = next;
        }
        // É livro se o nó existe na Trie (com ou sem dado de abertura no nó)
        return true;
      }
    };

    // --- PHASE 1 ---
    if (onProgress) onProgress({ phase: 1, done: 0, total, depth: PHASE1_DEPTH });

    let brilliantsUsed = 0;

    for (let i = 0; i < total; i++) {
      if (aborted) return;

      const fenBefore = fensBefore[i];
      const fenAfter  = fensAfter[i];

      // Book detection
      const inBook = bookTracker.addMove(moves[i]);
      movesData[i].isBook = inBook;

      // FIX 5: Detectar xeque-mate final — o lance contém '#' na notação SAN
      // ou é o último lance e o resultado é 1-0 / 0-1
      const sanRaw = moves[i];
      const isCheckmateMove = sanRaw.includes('#') ||
        (i === total - 1 && (
          headers.Result === '1-0' || headers.Result === '0-1'
        ));
      movesData[i].isCheckmate = isCheckmateMove;

      // Analyze before and after positions — sequencial (worker single-threaded)
      const beforeResult = await getAnalysis(fenBefore, PHASE1_DEPTH);
      const afterResult  = await getAnalysis(fenAfter,  PHASE1_DEPTH);

      // evalBefore e bestEval: perspectiva do lado a mover (positivo = bom para quem joga)
      // evalAfter: Stockfish retorna da perspectiva do OPONENTE após o lance
      //   → negamos para converter à perspectiva do jogador atual
      const evalBefore = beforeResult.evals[0] ?? 0;

      // FIX 5: Se é xeque-mate, não usar a eval "after" (seria 0 ou errada)
      // Tratar como vitória máxima: evalAfter = +29999 (melhor resultado possível)
      const rawEvalAfter = isCheckmateMove ? 29999 : -(afterResult.evals[0] ?? 0);
      const evalAfter    = rawEvalAfter;

      const bestEval   = beforeResult.evals[0] ?? 0;
      const multiPV    = beforeResult.evals;

      // FIX 3: Detectar o lance jogado em UCI para comparar com bestMoveUCI
      // Extraímos das moveSquares do parsedGame (from/to squares)
      const moveSquare = parsedGame.moveSquares ? parsedGame.moveSquares[i] : null;
      const playedMoveUCI = (moveSquare && moveSquare.from && moveSquare.to)
        ? (moveSquare.from + moveSquare.to)
        : null;

      // Material real que o adversário captura na resposta do motor à
      // posição pós-lance, e se essa resposta é um mate forçado contra nós.
      const immediateCaptureValue = computeImmediateCaptureValue(fenAfter, afterResult.bestMove);
      const opponentMateN         = afterResult.mateNs ? afterResult.mateNs[0] : null;
      const opponentGetsMate      = opponentMateN != null && opponentMateN > 0;
      const mateForMover          = beforeResult.mateNs ? beforeResult.mateNs[0] : null;

      // Saldo líquido do lance: o que o adversário recaptura MENOS o que o
      // próprio jogador capturou neste mesmo lance. Uma troca simples
      // (Bxf3 Nxf3) dá saldo ~0 — não é sacrifício, é só uma troca.
      const capturedByMoverValue = playedMoveUCI
        ? pieceValueAtSquare(fenBefore, playedMoveUCI.slice(2, 4))
        : 0;
      const sacrificeValue = immediateCaptureValue - capturedByMoverValue;

      movesData[i].evalBefore    = evalBefore;
      movesData[i].evalAfter     = evalAfter;  // já na perspectiva do jogador
      movesData[i].bestEval      = bestEval;
      movesData[i].bestMoveUCI   = beforeResult.bestMove;
      movesData[i].playedMoveUCI = playedMoveUCI;
      movesData[i].multiPVEvals  = multiPV;
      movesData[i].mateNs        = beforeResult.mateNs || null;
      movesData[i].immediateCaptureValue = immediateCaptureValue;

      console.log(
        `[Phase1 lance ${i} ${movesData[i].color} "${moves[i]}"]`,
        `evalBefore=${evalBefore}  evalAfter(jogador)=${evalAfter}  loss=${Math.max(0, evalBefore - evalAfter).toFixed(0)}cp`,
        `playedUCI=${playedMoveUCI}  bestUCI=${beforeResult.bestMove}`,
        isCheckmateMove ? '★ CHECKMATE' : ''
      );

      // Classify
      if (!inBook) {
        // Stalemate detection
        const likelyStalemateOrDraw = (
          evalBefore > 150 &&
          Math.abs(evalAfter) < 30 &&
          !moves[i].includes('+') && !moves[i].includes('#')
        );
        const cls = MoveClassifier.classify({
          san: moves[i],
          evalBefore,
          evalAfter,
          bestEval,
          bestMoveUCI:   beforeResult.bestMove,
          playedMoveUCI: playedMoveUCI,
          multiPVEvals:  multiPV,
          isBook:        false,
          isWhite:       movesData[i].color === 'white',
          brilliantsUsed,
          moveIndex:     i,
          isStalemate:   likelyStalemateOrDraw,
          isCheckmate:   isCheckmateMove,
          immediateCaptureValue,
          sacrificeValue,
          mateForMover,
          opponentGetsMate,
          depth: PHASE1_DEPTH
        });
        movesData[i].classification = cls;
        if (cls === 'brilliant') brilliantsUsed++;
      } else {
        movesData[i].classification = 'book';
      }

      if (onProgress) onProgress({
        phase: 1,
        done: i + 1,
        total,
        depth: PHASE1_DEPTH,
        movesData: [...movesData]
      });

      if (onMoveUpdate) onMoveUpdate(movesData[i], [...movesData]);
    }

    // --- PHASE 2: Refinement ---
    // Prioritize moves with high loss or interesting evaluations
    const candidates = movesData
      .filter(m => !m.isBook && m.evalBefore !== null)
      .map(m => ({
        index: m.index,
        priority: Math.abs(m.bestEval - m.evalAfter)  // raw loss (evalAfter já na perspectiva do jogador)
      }))
      .sort((a, b) => b.priority - a.priority);

    brilliantsUsed = 0; // reset for phase 2

    const isProMode = document.getElementById('pro-deep-toggle')?.checked ?? false;
    const PHASE2_DEPTHS = isProMode ? PHASE2_DEPTHS_PRO : PHASE2_DEPTHS_FREE;
    for (const depth of PHASE2_DEPTHS) {
      if (aborted) return;

      if (onProgress) onProgress({ phase: 2, done: 0, total: candidates.length, depth });

      for (let ci = 0; ci < candidates.length; ci++) {
        if (aborted) return;

        const i = candidates[ci].index;
        const m = movesData[i];
        if (m.isBook) continue;

        // Pular lances já estabilizados em depth anterior
        if (m._stable && depth > PHASE1_DEPTH) continue;

        const fenBefore = fensBefore[i];
        const fenAfter  = fensAfter[i];

        // Only refine if not stable
        const prevBestEval = m.bestEval;

        const bRes = await getAnalysis(fenBefore, depth);
        const aRes = await getAnalysis(fenAfter,  depth);

        const newBestEval  = bRes.evals[0] ?? m.bestEval;
        const newEvalAfter = aRes.evals[0] ?? m.evalAfter;

        // Check stability — se a avaliação mudou menos que o threshold, não refinar mais
        const change = Math.abs(newBestEval - prevBestEval);
        const isStable = change < STABILITY_THRESHOLD && depth > PHASE1_DEPTH;

        // ── IMPORTANTE: evalBefore NÃO é sobrescrito aqui ──────────────────
        // evalBefore representa a eval da posição ANTES do lance (context de decisão),
        // usada para detectar posições decididas e classificar a dificuldade.
        // Só bestEval e evalAfter são refinados com profundidade maior.
        // FIX 5: Se é xeque-mate, não usar a eval "after" — manter como vitória máxima
        m.bestEval     = newBestEval;
        m.evalAfter    = m.isCheckmate ? 29999 : -(newEvalAfter);  // ← perspectiva do jogador
        m.bestMoveUCI  = bRes.bestMove ?? m.bestMoveUCI;
        m.multiPVEvals = bRes.evals;
        m.mateNs       = bRes.mateNs || m.mateNs;
        m._stable      = isStable;
        // m.evalBefore mantém o valor original da Phase 1 — NÃO atualizar aqui

        // Material real capturável e mate, recalculados nesta profundidade
        m.immediateCaptureValue = computeImmediateCaptureValue(fenAfter, aRes.bestMove);
        const opponentMateN2    = aRes.mateNs ? aRes.mateNs[0] : null;
        const opponentGetsMate2 = opponentMateN2 != null && opponentMateN2 > 0;
        const mateForMover2     = bRes.mateNs ? bRes.mateNs[0] : null;
        const capturedByMoverValue2 = m.playedMoveUCI
          ? pieceValueAtSquare(fenBefore, m.playedMoveUCI.slice(2, 4))
          : 0;
        const sacrificeValue2   = m.immediateCaptureValue - capturedByMoverValue2;

        // Reclassify
        const likelyStalemateOrDraw2 = (
          m.evalBefore > 150 &&
          Math.abs(m.evalAfter) < 30 &&
          !moves[i].includes('+') && !moves[i].includes('#')
        );
        const newCls = MoveClassifier.classify({
          san:           moves[i],
          evalBefore:    m.evalBefore,
          evalAfter:     m.evalAfter,
          bestEval:      m.bestEval,
          bestMoveUCI:   m.bestMoveUCI,
          playedMoveUCI: m.playedMoveUCI,
          multiPVEvals:  m.multiPVEvals,
          isBook:        false,
          isWhite:       m.color === 'white',
          brilliantsUsed,
          moveIndex:     i,
          isStalemate:   likelyStalemateOrDraw2,
          isCheckmate:   m.isCheckmate,
          immediateCaptureValue: m.immediateCaptureValue,
          sacrificeValue: sacrificeValue2,
          mateForMover:  mateForMover2,
          opponentGetsMate: opponentGetsMate2,
          depth
        });

        if (newCls !== m.classification) {
          m.classification = newCls;
          if (newCls === 'brilliant') brilliantsUsed++;
          if (onMoveUpdate) onMoveUpdate(m, [...movesData]);
        }

        if (onProgress) onProgress({
          phase: 2,
          done: ci + 1,
          total: candidates.length,
          depth,
          movesData: [...movesData]
        });
      }

      // ── Dispara evento explícito ao concluir cada depth ──────────
      // Isso garante que o trigger de insights progressivos funcione
      // mesmo quando muitos lances foram pulados por estabilidade.
      if (onProgress) onProgress({
        phase: 2,
        done: candidates.length,
        total: candidates.length,
        depth,
        depthComplete: true,          // ← sinaliza fim de depth
        movesData: [...movesData]
      });
    }

    if (onComplete) onComplete([...movesData]);
  }

  return { analyze, setCallbacks, abort };
})();

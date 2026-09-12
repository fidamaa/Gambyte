/* ==============================================================
   MODULE: analysis-engine.js
   Orchestrates the two-phase progressive analysis + Fase 3
   (detecção/confirmação de sacrifícios brilhantes).
   Depende de: stockfish-manager.js, opening-detector.js,
               move-classifier.js
   NOVO: chess.js (opcional) — só pra Fase 3. Sem ele, a Fase 3
   é pulada e nenhum lance vira 'brilliant' (fica no que já era:
   'best-move'/'excellent'/'very-good' etc — nunca pior por causa disso).
   ============================================================== */
const AnalysisEngine = (() => {

  const PHASE1_DEPTH = 7;
  const PHASE2_DEPTHS_FREE = [10, 14];
  const PHASE2_DEPTHS_PRO  = [10, 14, 20];
  const STABILITY_THRESHOLD = 30;
  const MULTIPV = 3;
  const SACRIFICE_VERIFY_DEPTH = 16;

  // NOVO: valores de peça em "cp equivalente", usados em dois lugares:
  //  1) immediateCaptureValue — o que o adversário realmente captura no
  //     lance seguinte (decide Erro vs Gafe em move-classifier.js).
  //  2) detecção de sacrifício material na Fase 3 (decide candidato a Brilhante).
  const PIECE_VALUES = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

  let onProgress = null;
  let onMoveUpdate = null;
  let onComplete = null;
  let aborted = false;

  function setCallbacks(callbacks) {
    onProgress = callbacks.onProgress;
    onMoveUpdate = callbacks.onMoveUpdate;
    onComplete = callbacks.onComplete;
  }

  function abort() { aborted = true; }

  /**
   * NOVO: lê a peça numa casa de um FEN, sem precisar de chess.js.
   * Retorna o caractere da peça (ex.: 'P', 'n', 'Q') ou null se vazia.
   */
  function getPieceAt(fen, square) {
    if (!square || square.length < 2) return null;
    const file = square.charCodeAt(0) - 97; // 'a' = 0
    const rank = parseInt(square[1], 10);
    if (isNaN(rank) || file < 0 || file > 7) return null;
    const rows = fen.split(' ')[0].split('/'); // rows[0]=rank8 ... rows[7]=rank1
    const rowStr = rows[8 - rank];
    if (!rowStr) return null;
    let col = 0;
    for (const ch of rowStr) {
      if (ch >= '1' && ch <= '8') {
        col += parseInt(ch, 10);
      } else {
        if (col === file) return ch;
        col++;
      }
    }
    return null;
  }

  /**
   * NOVO: valor (cp equivalente) do que o adversário captura de verdade,
   * jogando `opponentReplyUCI` a partir da posição `fenAfterOurMove`.
   * Usa o tabuleiro real (getPieceAt), não a queda de avaliação — é isso
   * que corrige "rei mais exposto" sendo confundido com "perdeu uma peça".
   */
  function immediateCaptureValue(fenAfterOurMove, opponentReplyUCI) {
    if (!opponentReplyUCI || opponentReplyUCI.length < 4) return 0;
    const destSquare = opponentReplyUCI.slice(2, 4);
    const piece = getPieceAt(fenAfterOurMove, destSquare);
    if (!piece) return 0;
    return PIECE_VALUES[piece.toLowerCase()] || 0;
  }

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
      playedMoveUCI: null,
      opponentBestReplyUCI: null,  // NOVO — resposta real do motor após nosso lance
      multiPVEvals: null,
      mateNs: null,
      classification: null,
      isBook: false,
      isCheckmate: false
    }));

    const cache = new Map();

    async function getAnalysis(fen, depth) {
      const key = `${fen}@${depth}`;
      if (cache.has(key)) return cache.get(key);
      const result = await StockfishManager.analyzePosition(fen, depth, MULTIPV);
      cache.set(key, result);
      return result;
    }

    OpeningDetector.build();
    let _bookNode   = OpeningDetector.getRootNode();
    let _outOfBook  = false;
    const bookTracker = {
      addMove(san) {
        if (_outOfBook || !_bookNode) return false;
        const clean = san.replace(/[+#!?]/g, '');
        const next  = _bookNode.children.get(clean);
        if (!next) {
          const altClean = clean.replace('=', '');
          const altNext  = _bookNode.children.get(altClean);
          if (!altNext) { _outOfBook = true; return false; }
          _bookNode = altNext;
        } else {
          _bookNode = next;
        }
        return true;
      }
    };

    /**
     * NOVO: detecção de xeque-mate robusta. Antes: "último lance de partida
     * decisiva" — falso positivo pra desistências, e nem sempre disparava
     * (dependia de headers.Result existir). Agora: '#' no SAN (confiável)
     * ou verificação real via chess.js, se disponível.
     */
    function detectCheckmate(sanRaw, fenAfter) {
      if (sanRaw.includes('#')) return true;
      if (typeof Chess !== 'undefined') {
        try {
          const c = new Chess(fenAfter);
          if (typeof c.isCheckmate === 'function') return c.isCheckmate();
          if (typeof c.in_checkmate === 'function') return c.in_checkmate();
        } catch (e) { /* ignora */ }
      }
      return false;
    }

    // --- PHASE 1 ---
    if (onProgress) onProgress({ phase: 1, done: 0, total, depth: PHASE1_DEPTH });

    for (let i = 0; i < total; i++) {
      if (aborted) return;

      const fenBefore = fensBefore[i];
      const fenAfter  = fensAfter[i];

      const inBook = bookTracker.addMove(moves[i]);
      movesData[i].isBook = inBook;

      const sanRaw = moves[i];
      const isCheckmateMove = detectCheckmate(sanRaw, fenAfter);
      movesData[i].isCheckmate = isCheckmateMove;

      const beforeResult = await getAnalysis(fenBefore, PHASE1_DEPTH);
      const afterResult  = await getAnalysis(fenAfter,  PHASE1_DEPTH);

      const evalBefore = beforeResult.evals[0] ?? 0;
      const rawEvalAfter = isCheckmateMove ? 29999 : -(afterResult.evals[0] ?? 0);
      const evalAfter    = rawEvalAfter;

      const bestEval   = beforeResult.evals[0] ?? 0;
      const multiPV    = beforeResult.evals;

      const moveSquare = parsedGame.moveSquares ? parsedGame.moveSquares[i] : null;
      const playedMoveUCI = (moveSquare && moveSquare.from && moveSquare.to)
        ? (moveSquare.from + moveSquare.to)
        : null;

      movesData[i].evalBefore           = evalBefore;
      movesData[i].evalAfter            = evalAfter;
      movesData[i].bestEval             = bestEval;
      movesData[i].bestMoveUCI          = beforeResult.bestMove;
      movesData[i].playedMoveUCI        = playedMoveUCI;
      movesData[i].opponentBestReplyUCI = afterResult.bestMove || null;
      movesData[i].multiPVEvals         = multiPV;
      movesData[i].mateNs               = beforeResult.mateNs || null;

      console.log(
        `[Phase1 lance ${i} ${movesData[i].color} "${moves[i]}"]`,
        `evalBefore=${evalBefore}  evalAfter(jogador)=${evalAfter}  loss=${Math.max(0, evalBefore - evalAfter).toFixed(0)}cp`,
        `playedUCI=${playedMoveUCI}  bestUCI=${beforeResult.bestMove}`,
        isCheckmateMove ? '★ CHECKMATE' : ''
      );

      if (!inBook) {
        const likelyStalemateOrDraw = (
          evalBefore > 150 &&
          Math.abs(evalAfter) < 30 &&
          !moves[i].includes('+') && !moves[i].includes('#')
        );
        const capValue = isCheckmateMove ? 0 : immediateCaptureValue(fenAfter, afterResult.bestMove);
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
          moveIndex:     i,
          isStalemate:   likelyStalemateOrDraw,
          isCheckmate:   isCheckmateMove,
          immediateCaptureValue: capValue
        });
        movesData[i].classification = cls;
      } else {
        movesData[i].classification = 'book';
      }

      if (onProgress) onProgress({
        phase: 1, done: i + 1, total, depth: PHASE1_DEPTH, movesData: [...movesData]
      });
      if (onMoveUpdate) onMoveUpdate(movesData[i], [...movesData]);
    }

    // --- PHASE 2: Refinement ---
    const candidates = movesData
      .filter(m => !m.isBook && m.evalBefore !== null)
      .map(m => ({
        index: m.index,
        priority: Math.abs(m.bestEval - m.evalAfter)
      }))
      .sort((a, b) => b.priority - a.priority);

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
        if (m._stable && depth > PHASE1_DEPTH) continue;

        const fenBefore = fensBefore[i];
        const fenAfter  = fensAfter[i];
        const prevBestEval = m.bestEval;

        const bRes = await getAnalysis(fenBefore, depth);
        const aRes = await getAnalysis(fenAfter,  depth);

        const newBestEval  = bRes.evals[0] ?? m.bestEval;
        const newEvalAfter = aRes.evals[0] ?? m.evalAfter;

        const change = Math.abs(newBestEval - prevBestEval);
        const isStable = change < STABILITY_THRESHOLD && depth > PHASE1_DEPTH;

        m.bestEval             = newBestEval;
        m.evalAfter            = m.isCheckmate ? 29999 : -(newEvalAfter);
        m.bestMoveUCI          = bRes.bestMove ?? m.bestMoveUCI;
        m.opponentBestReplyUCI = aRes.bestMove ?? m.opponentBestReplyUCI;
        m.multiPVEvals         = bRes.evals;
        m.mateNs               = bRes.mateNs || m.mateNs;
        m._stable              = isStable;

        const likelyStalemateOrDraw2 = (
          m.evalBefore > 150 &&
          Math.abs(m.evalAfter) < 30 &&
          !moves[i].includes('+') && !moves[i].includes('#')
        );
        const capValue2 = m.isCheckmate ? 0 : immediateCaptureValue(fenAfter, m.opponentBestReplyUCI);
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
          moveIndex:     i,
          isStalemate:   likelyStalemateOrDraw2,
          isCheckmate:   m.isCheckmate,
          immediateCaptureValue: capValue2
        });

        if (newCls !== m.classification) {
          m.classification = newCls;
          if (onMoveUpdate) onMoveUpdate(m, [...movesData]);
        }

        if (onProgress) onProgress({
          phase: 2, done: ci + 1, total: candidates.length, depth, movesData: [...movesData]
        });
      }

      if (onProgress) onProgress({
        phase: 2, done: candidates.length, total: candidates.length,
        depth, depthComplete: true, movesData: [...movesData]
      });
    }

    // ── NOVO: análise extra garantida no último lance de partidas decisivas ──
    // PGNs terminados por desistência não têm o resto da sequência vencedora
    // registrado. Sem isso, o motor pode não enxergar a vantagem completa na
    // profundidade padrão e o lance final parece "perder tudo" (falso Gafe).
    // Como é só 1 posição, vale a análise extra — sem forçar nenhum valor,
    // é o motor mesmo respondendo com mais profundidade.
    const lastIdx = total - 1;
    const lastMove = movesData[lastIdx];
    const gameDecisive = headers.Result === '1-0' || headers.Result === '0-1';
    if (gameDecisive && lastMove && !lastMove.isBook && !lastMove.isCheckmate && !aborted) {
      const deepDepth = Math.max(...PHASE2_DEPTHS, 18);
      const bRes = await getAnalysis(fensBefore[lastIdx], deepDepth);
      const aRes = await getAnalysis(fensAfter[lastIdx],  deepDepth);

      lastMove.bestEval             = bRes.evals[0] ?? lastMove.bestEval;
      lastMove.evalAfter            = -(aRes.evals[0] ?? 0);
      lastMove.bestMoveUCI          = bRes.bestMove ?? lastMove.bestMoveUCI;
      lastMove.opponentBestReplyUCI = aRes.bestMove ?? lastMove.opponentBestReplyUCI;
      lastMove.multiPVEvals         = bRes.evals;

      const capValueLast = immediateCaptureValue(fensAfter[lastIdx], lastMove.opponentBestReplyUCI);
      const likelyStalemateOrDrawLast = (
        lastMove.evalBefore > 150 &&
        Math.abs(lastMove.evalAfter) < 30 &&
        !moves[lastIdx].includes('+') && !moves[lastIdx].includes('#')
      );
      lastMove.classification = MoveClassifier.classify({
        san: moves[lastIdx],
        evalBefore: lastMove.evalBefore,
        evalAfter:  lastMove.evalAfter,
        bestEval:   lastMove.bestEval,
        bestMoveUCI: lastMove.bestMoveUCI,
        playedMoveUCI: lastMove.playedMoveUCI,
        multiPVEvals: lastMove.multiPVEvals,
        isBook: false,
        isWhite: lastMove.color === 'white',
        moveIndex: lastIdx,
        isStalemate: likelyStalemateOrDrawLast,
        isCheckmate: false,
        immediateCaptureValue: capValueLast
      });
      if (onMoveUpdate) onMoveUpdate(lastMove, [...movesData]);
    }

    // ── FASE 3: detecção e confirmação de sacrifícios Brilhantes ────────────
    await verifyBrilliantMoves(movesData);

    if (onComplete) onComplete([...movesData]);

    function getCaptureMovesUCI(fen, destSquare) {
      if (typeof Chess === 'undefined') return null;
      try {
        const chess = new Chess(fen);
        return chess.moves({ verbose: true })
          .filter(mv => mv.to === destSquare && mv.captured)
          .map(mv => mv.from + mv.to + (mv.promotion || ''));
      } catch (e) {
        console.warn('[AnalysisEngine] Falha ao gerar capturas p/ verificação de sacrifício:', e);
        return null;
      }
    }

    /**
     * NOVO: Fase 3, reescrita do zero.
     *
     * Em vez de confiar num heurístico de SAN (que rejeitava qualquer lance
     * de captura, matando Bxh7+ e sacrifícios de qualidade/torre), agora:
     *
     *  1. Varre TODOS os lances já classificados como fortes (best-move,
     *     excellent, very-good, good) — não mais só os que já vieram
     *     'brilliant' de algum heurístico prévio, porque agora NADA vem
     *     'brilliant' antes desta fase.
     *  2. Pra cada um, replica o lance com chess.js e calcula o material
     *     de verdade: valor da peça que se moveu vs valor do que ela
     *     capturou (0 se não capturou nada). Se o saldo, numa recaptura
     *     simples, for uma perda líquida relevante (≤ -150), é candidato.
     *  3. Acha TODAS as capturas possíveis na casa de destino.
     *  4. Manda o motor testar cada uma de verdade (verifySacrificeTrap).
     *  5. Só vira 'brilliant' se TODAS as capturas forem punidas (mate a
     *     nosso favor ou vantagem mantida) — se uma escapar, não é
     *     armadilha de verdade, e o lance fica com a classificação que já
     *     tinha (nunca piora por causa disso).
     */
    async function verifyBrilliantMoves(data) {
      if (typeof Chess === 'undefined') {
        console.warn('[AnalysisEngine] chess.js indisponível — pulando Fase 3 (detecção de sacrifícios brilhantes).');
        return;
      }

      const eligibleClasses = ['best-move', 'excellent', 'very-good', 'good'];
      const candidates = data
        .map((m, i) => ({ m, i }))
        .filter(({ m }) =>
          !m.isBook &&
          !m.isCheckmate &&
          eligibleClasses.includes(m.classification) &&
          Math.abs(m.evalBefore) < 600 &&
          !MoveClassifier.isForcedMove(m.multiPVEvals)
        );

      if (candidates.length === 0) return;

      if (onProgress) onProgress({ phase: 3, done: 0, total: candidates.length });

      let brilliantsFound = 0;
      let done = 0;

      for (const { m, i } of candidates) {
        if (aborted) return;
        if (brilliantsFound >= 2) break; // limite de brilhantes por partida

        let moveObj = null;
        try {
          const chess = new Chess(fensBefore[i]);
          moveObj = chess.move(moves[i]);
        } catch (e) { /* segue sem candidatar este lance */ }

        if (moveObj) {
          const ourValue        = PIECE_VALUES[moveObj.piece] || 0;
          const capturedByUs    = moveObj.captured ? (PIECE_VALUES[moveObj.captured] || 0) : 0;
          const netIfRecaptured = capturedByUs - ourValue;

          // Só segue se for uma perda líquida de material relevante
          // (cobre TANTO capturas como Bxh7+ QUANTO ofertas silenciosas).
          if (netIfRecaptured <= -150) {
            const fenAfter    = fensAfter[i];
            const destSquare  = moveObj.to;
            const captures    = getCaptureMovesUCI(fenAfter, destSquare);

            if (captures && captures.length > 0) {
              let trapHolds = true;
              for (const capUCI of captures) {
                const r = await StockfishManager.verifySacrificeTrap(fenAfter, capUCI, SACRIFICE_VERIFY_DEPTH);
                const confirmado =
                  (r.mateAfterCapture != null && r.mateAfterCapture > 0) ||
                  (r.evalAfterCapture  != null && r.evalAfterCapture >= m.evalBefore - 40);
                if (!confirmado) { trapHolds = false; break; }
              }

              if (trapHolds) {
                m.classification = 'brilliant';
                brilliantsFound++;
                console.log(`[AnalysisEngine] Fase 3: lance ${i} (${m.san}) confirmado BRILHANTE — sacrifício real de ${ourValue}cp por ${capturedByUs}cp, todas as ${captures.length} captura(s) punida(s).`);
                if (onMoveUpdate) onMoveUpdate(m, [...data]);
              }
            }
          }
        }

        done++;
        if (onProgress) onProgress({ phase: 3, done, total: candidates.length, movesData: [...data] });
      }
    }
  }

  return { analyze, setCallbacks, abort };
})();
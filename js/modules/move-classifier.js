/* ==============================================================
   MODULE: move-classifier.js
   Simple opening book detection helpers + move classification
   (Brilhante, Excelente, Melhor Lance, Boa, Erro, Gafe, etc.)
   Depende de: rating-model.js
   ============================================================== */
const MoveClassifier = (() => {

  // ── Thresholds de perda em centipawns ────────────────────────
  // Hierarquia: Brilhante > Excelente > Melhor Lance > Muito Boa > Boa > Imprecisão > Erro > Gafe
  //
  // NOVO: "Melhor Lance" NÃO usa mais teto de cp-loss — ver isBestMoveMatch
  // no classify(). Bater com a seta do motor já é prova definitiva; comparar
  // cp entre duas análises independentes (antes/depois) é ruidoso demais em
  // profundidade baixa e fazia "Melhor Lance" quase nunca aparecer.
  const THRESHOLDS = {
    excellent:  15,   // ≤15cp  → Excelente (quase tão bom quanto o melhor, raro/difícil)
    very_good:  25,   // ≤25cp  → Muito Boa
    good:       70,   // ≤70cp  → Boa
    inaccuracy: 150,  // ≤150cp → Imprecisão
    mistake:    300   // ≤300cp → Erro
  };

  // NOVO: Gafe agora é decidido por MATERIAL REAL capturável no lance
  // seguinte (immediateCaptureValue, calculado pelo AnalysisEngine a partir
  // da resposta de verdade do motor), não mais pela queda de avaliação.
  // BLUNDER_SWING_THRESHOLD = valor mínimo de peça pra contar como "perdeu
  // peça de verdade" — mesma escala de PIECE_VALUES do analysis-engine.js
  // (peão=100, peça menor=300, torre=500, dama=900).
  const BLUNDER_SWING_THRESHOLD = 300;  // ~valor de uma peça menor
  const BLUNDER_WINNING_TO_LOST = 100;

  function normalizeLoss(rawLoss, evalBefore) {
    const contextFactor = 1 + (Math.abs(evalBefore) / 400);
    return rawLoss / contextFactor;
  }

  function isForcedMove(multiPVEvals) {
    if (!multiPVEvals || multiPVEvals.length < 2) return true;
    const best = multiPVEvals[0];
    const second = multiPVEvals[1];
    if (best === null || second === null) return true;
    return Math.abs(best - second) > 200;
  }

  function isBestMoveMatch(playedMoveUCI, bestMoveUCI) {
    if (!playedMoveUCI || !bestMoveUCI) return false;
    function normCastle(uci) {
      const f = uci.slice(0,2).toLowerCase(), t = uci.slice(2,4).toLowerCase();
      if (f==="e1"&&t==="h1") return "e1g1";
      if (f==="e1"&&t==="a1") return "e1c1";
      if (f==="e8"&&t==="h8") return "e8g8";
      if (f==="e8"&&t==="a8") return "e8c8";
      return f+t;
    }
    return normCastle(playedMoveUCI) === normCastle(bestMoveUCI);
  }

  function checkDrawPenalty(evalBefore, isStalemate) {
    if (!isStalemate) return null;
    if (evalBefore > 300) return 'blunder';
    if (evalBefore > 150) return 'mistake';
    return null;
  }

  /**
   * NOVO: Erro vs Gafe, decidido por captura REAL disponível pro adversário
   * (immediateCaptureValue), não pela magnitude da queda de avaliação.
   *
   * Um rei mais exposto, uma combinação de vários lances, "não ver" um mate
   * distante — nada disso é Gafe se o adversário não tiver, JÁ NO LANCE
   * SEGUINTE, uma captura direta valendo pelo menos uma peça menor.
   */
  function classifyBlunderOrMistake(evalBefore, evalAfter, forced, immediateCaptureValue) {
    if (forced) return 'mistake';

    const perdeuPecaDeVerdade = (immediateCaptureValue ?? 0) >= BLUNDER_SWING_THRESHOLD;
    if (!perdeuPecaDeVerdade) return 'mistake';

    const wasWinning  = evalBefore >= BLUNDER_WINNING_TO_LOST;
    const isNowLosing = evalAfter  <= -50;
    if (wasWinning && isNowLosing) return 'blunder';
    if (Math.abs(evalBefore) < 600) return 'blunder';
    return 'mistake';
  }

  /**
   * Main classification function
   * @param {object} params
   *   - san, evalBefore, evalAfter, bestEval, bestMoveUCI, playedMoveUCI,
   *     multiPVEvals, isBook, isWhite, moveIndex, isStalemate, isCheckmate
   *   - immediateCaptureValue: NOVO. Valor (escala 100/300/500/900) do que o
   *     adversário realmente captura no lance seguinte, segundo o motor.
   *     Calculado pelo AnalysisEngine via posição real do tabuleiro — não
   *     é mais inferido pela queda de cp.
   *
   * NOTA: 'brilliant' NÃO é mais retornado por esta função. A detecção de
   * sacrifício genuíno agora exige verificação com o motor jogando a
   * captura de verdade (não dá pra fazer isso de forma síncrona, lance a
   * lance) — isso é feito à parte, na Fase 3 do AnalysisEngine, que
   * sobrescreve `classification` diretamente quando confirma um sacrifício.
   */
  function classify(params) {
    const {
      san, evalBefore, evalAfter, bestEval,
      bestMoveUCI, playedMoveUCI,
      multiPVEvals, isBook, isWhite,
      moveIndex,
      isStalemate,
      isCheckmate,
      immediateCaptureValue
    } = params;

    if (isBook) return 'book';

    if (isCheckmate) {
      // Xeque-mate: por definição, o melhor lance possível. Nunca penalizar.
      // Se ESTE lance também foi um sacrifício genuíno, isso já deveria ter
      // sido confirmado antes, no lance que ofereceu o material (Fase 3).
      return 'best-move';
    }

    const drawPenalty = checkDrawPenalty(evalBefore, !!isStalemate);
    if (drawPenalty) return drawPenalty;

    const playedIsBest = isBestMoveMatch(playedMoveUCI, bestMoveUCI);

    // ── MELHOR LANCE ── bateu com a seta do motor. Sem teto de cp extra
    // (ver nota no topo do arquivo).
    if (playedIsBest) {
      return 'best-move';
    }

    if (Math.abs(evalBefore) > 900) {
      const rawLoss900 = Math.max(0, bestEval - evalAfter);
      const forced900  = isForcedMove(multiPVEvals);
      if (rawLoss900 <= 60)  return 'very-good';
      if (rawLoss900 <= 180) return 'inaccuracy';
      if (rawLoss900 <= 400 || forced900) return 'mistake';
      return classifyBlunderOrMistake(evalBefore, evalAfter, forced900, immediateCaptureValue);
    }

    const playedEval  = evalAfter;
    const rawLoss     = bestEval - playedEval;
    const clampedLoss = Math.max(0, rawLoss);
    const loss        = normalizeLoss(clampedLoss, evalBefore);
    const forced      = isForcedMove(multiPVEvals);

    // ── EXCELENTE ── quase tão bom quanto o melhor, raro/difícil
    if (
      loss <= THRESHOLDS.excellent &&
      !forced &&
      Math.abs(evalBefore) < 500 &&
      multiPVEvals && multiPVEvals.length >= 2 &&
      multiPVEvals[1] !== null &&
      Math.abs(multiPVEvals[0] - multiPVEvals[1]) > 40
    ) {
      return 'excellent';
    }

    if (loss <= THRESHOLDS.very_good)  return 'very-good';
    if (loss <= THRESHOLDS.good)       return 'good';
    if (loss <= THRESHOLDS.inaccuracy) return 'inaccuracy';

    return classifyBlunderOrMistake(evalBefore, evalAfter, forced, immediateCaptureValue);
  }

  /**
   * Compute ACPL and rating estimate for a player's moves
   * (sem alterações — mantido igual ao original)
   */
  function computeStats(movesData, isWhite) {
    const color = isWhite ? 'white' : 'black';

    function normEval(v) {
      if (v == null) return null;
      if (Math.abs(v) >= 29000) return v > 0 ? 900 : -900;
      return Math.max(-900, Math.min(900, v));
    }

    const eligibleMoves = movesData.filter(m =>
      m.color === color &&
      m.evalBefore !== null &&
      m.evalAfter  !== null &&
      m.bestEval   !== null
    );

    if (eligibleMoves.length === 0) {
      return { acpl: 0, rating: 1500, accuracy: 100 };
    }

    let weightedScoreSum = 0;
    let weightSum        = 0;
    let acplNumerator    = 0;
    let acplDenominator  = 0;
    const rawCplsForCV   = [];

    for (const m of eligibleMoves) {
      if (m.classification === 'book') continue;
      if (m.isCheckmate) {
        weightedScoreSum += 100 * 1.0;
        weightSum        += 1.0;
        rawCplsForCV.push(0);
        continue;
      }

      const evalPlayed = normEval(m.evalAfter);
      const evalBest   = normEval(m.bestEval);
      if (evalPlayed == null || evalBest == null) continue;

      const pv1 = normEval(m.multiPVEvals?.[0]);
      const pv2 = normEval(m.multiPVEvals?.[1]);
      const isOnlyMove = (
        pv1 != null && pv2 != null &&
        Math.abs(pv1 - pv2) > 400
      );

      let rawLoss = m.classification === 'best-move'
        ? 0
        : Math.max(0, evalBest - evalPlayed);

      rawLoss = Math.min(rawLoss, 300);
      if (isOnlyMove) rawLoss = Math.min(rawLoss, 30);

      rawCplsForCV.push(rawLoss);

      const evalBeforeNorm = normEval(m.evalBefore) ?? 0;
      const isDecided = Math.abs(evalBeforeNorm) > 700;
      const weight    = isDecided ? 0.3 : 1.0;

      const t_score  = Math.max(0, Math.min(1, 1 - rawLoss / 80));
      const divisor  = 118 + t_score * 15;
      const moveScore = Math.max(5, 100 * Math.exp(-rawLoss / divisor));

      weightedScoreSum += moveScore * weight;
      weightSum        += weight;

      if (!isDecided) {
        acplNumerator   += rawLoss;
        acplDenominator += 1;
      }
    }

    let accuracy = weightSum > 0
      ? weightedScoreSum / weightSum
      : 100;
    accuracy = Math.max(20, Math.min(100, accuracy));

    const acpl = acplDenominator > 0
      ? acplNumerator / acplDenominator
      : 0;

    const blunders = eligibleMoves.filter(m => m.classification === 'blunder').length;
    const mistakes = eligibleMoves.filter(m => m.classification === 'mistake').length;

    const rating = RatingModel.fromACPL(acpl, rawCplsForCV, acplDenominator, accuracy, blunders, mistakes);

    console.log(
      `[computeStats ${color}] n=${eligibleMoves.length}` +
      ` acpl=${acpl.toFixed(1)}cp accuracy=${accuracy.toFixed(1)}%` +
      ` blunders=${blunders} mistakes=${mistakes} rating=${rating}`
    );

    return {
      acpl:      Math.round(acpl),
      rating:    rating,
      accuracy:  Math.round(accuracy * 10) / 10,
      blunders:  blunders,
      mistakes:  mistakes
    };
  }

  const LABELS = {
    book:        'Livro',
    brilliant:   'Brilhante',
    excellent:   'Excelente',
    'best-move': 'Melhor Lance',
    'very-good': 'Muito Boa',
    good:        'Boa',
    inaccuracy:  'Imprecisão',
    mistake:     'Erro',
    blunder:     'Gafe'
  };

  // NOVO: isForcedMove exportado — o AnalysisEngine usa isso na Fase 3
  // pra excluir lances forçados da varredura de sacrifícios.
  return { classify, computeStats, LABELS, normalizeLoss, isForcedMove, isBestMoveMatch };
})();
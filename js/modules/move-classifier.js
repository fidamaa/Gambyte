/* ==============================================================
   MODULE: move-classifier.js
   Move classification usando o modelo "Expected Points" (EP),
   aproximação da filosofia do Chess.com Game Review V2.

   Fonte da fórmula EP: fórmula pública de win% do Lichess
   (winPercent = 50 + 50·(2/(1+e^-0.00368208·cp) − 1)). O Chess.com
   não publica a fórmula exata do seu modelo proprietário — esta é
   a aproximação documentada mais próxima disponível publicamente.

   Categorias: Livro, Brilhante, Ótimo (Great), Chance Perdida (Miss),
   Melhor Lance, Excelente, Boa, Imprecisão, Erro, Gafe.

   Depende de: rating-model.js
   ============================================================== */
const MoveClassifier = (() => {

  // ── EP_loss thresholds (NÃO são centipawns — ver epFromCp) ───
  // A mesma perda de cp tem impacto MUITO diferente dependendo da EP
  // de partida (perder 100cp num +5.0 é irrelevante; num 0.0 é grave).
  const EP_THRESHOLDS = {
    excellent:  0.02,  // EP_loss < 0.02  → Excelente
    good:       0.05,  // EP_loss < 0.05  → Boa
    inaccuracy: 0.10,  // EP_loss < 0.10  → Imprecisão
    mistake:    0.20   // EP_loss < 0.20  → Erro; acima disso é candidato a Gafe
  };

  // Gafe só é Gafe com PERDA MATERIAL REAL (immediateCaptureValue,
  // calculado pelo AnalysisEngine a partir da resposta de verdade do
  // motor) ou mate forçado contra o jogador — nunca só por EP_loss alto.
  const BLUNDER_SWING_THRESHOLD = 300;  // ~valor de uma peça menor
  const BLUNDER_WINNING_TO_LOST = 100;

  // Profundidade mínima pra confiar numa detecção de sacrifício (Brilhante).
  // Na Fase 1 (depth 7) a leitura tática ainda é rasa demais — só
  // reclassificamos como Brilhante a partir da Fase 2.
  const BRILLIANT_MIN_DEPTH = 10;

  /**
   * Converte centipawns em Expected Points (0..1), a fórmula de win%
   * do Lichess. cp já deve estar na perspectiva do jogador em questão.
   */
  function epFromCp(cp) {
    if (cp == null) return 0.5;
    const winPct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    return winPct / 100;
  }

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

  // Margem dentro da qual uma posição já "empatada antes" não rende bônus
  // por buscar o empate (não fugia de nada) — só perdas de verdade acima
  // disso contam como "estava perdendo e salvou um empate".
  const DRAW_EQUAL_MARGIN = 5;

  function checkDrawPenalty(evalBefore, isStalemate) {
    if (!isStalemate) return null;
    // Estava ganhando e jogou fora a vantagem transformando em empate.
    if (evalBefore > 300) return 'blunder';
    if (evalBefore > 150) return 'mistake';
    // Estava perdendo de verdade (além da margem de "já tava equilibrado")
    // e conseguiu o empate — ex.: 1 dama contra 3 torres+dama e força
    // afogamento/repetição. Isso é um resultado ÓTIMO, não neutro.
    if (evalBefore < -DRAW_EQUAL_MARGIN) return 'great';
    return null;
  }

  /**
   * Erro vs Gafe: Gafe exige PERDA MATERIAL REAL (immediateCaptureValue,
   * calculado pelo AnalysisEngine a partir da resposta de verdade do motor
   * à posição resultante) ou mate forçado contra o jogador. Um EP_loss alto
   * sozinho, sem uma dessas duas coisas, fica classificado como Erro.
   */
  function classifyBlunderOrMistake(evalBefore, immediateCaptureValue, opponentGetsMate) {
    if (opponentGetsMate) return 'blunder';

    const perdeuPecaDeVerdade = (immediateCaptureValue ?? 0) >= BLUNDER_SWING_THRESHOLD;
    if (!perdeuPecaDeVerdade) return 'mistake';

    return 'blunder';
  }

  /**
   * Um sacrifício "funciona" quando o jogador abre mão de material REAL
   * NO SALDO — não confundir com uma troca simples (ex.: Bxf3 Nxf3, onde
   * o "material que o adversário recaptura" é só a peça que o próprio
   * jogador acabou de capturar, saldo zero). sacrificeValue já vem líquido
   * do AnalysisEngine: (o que o adversário recaptura) − (o que o jogador
   * capturou neste mesmo lance). Só saldo líquido negativo relevante
   * conta como sacrifício de verdade.
   */
  function isGenuineSacrifice(evalAfter, sacrificeValue, pieceIsHanging, sacrificeIsRecapturable) {
    // Se o próprio jogador recaptura na mesma casa na hora, é só uma troca
    // (o material volta), não importa quão grande pareça o saldo momentâneo.
    if (sacrificeIsRecapturable) return false;
    if ((sacrificeValue ?? 0) >= BLUNDER_SWING_THRESHOLD && evalAfter >= -50) return true;
    // "Sacrifício de mentirinha": a peça jogada fica geometricamente
    // pendurada (atacável), mas o motor ainda considera o lance ótimo —
    // ou seja, capturá-la seria ruim pro adversário. Não aparece no
    // sacrificeValue porque o motor (corretamente) evita cair na armadilha.
    if (pieceIsHanging && evalAfter >= -50) return true;
    return false;
  }

  /**
   * BRILHANTE (aproximação): o lance precisa ser o melhor (ou quase) E
   * envolver sacrifício genuíno E a posição não podia já estar
   * esmagadoramente ganha antes do lance (senão qualquer sacrifício seria
   * "de graça"). Só avaliado a partir de BRILLIANT_MIN_DEPTH — na Fase 1
   * (depth 7) a leitura tática é rasa demais e geraria falsos positivos.
   */
  function isBrilliantMove(params) {
    const { playedIsBest, epLoss, evalBefore, evalAfter, sacrificeValue, pieceIsHanging, sacrificeIsRecapturable, depth } = params;
    if ((depth ?? 0) < BRILLIANT_MIN_DEPTH) return false;
    if (!(playedIsBest || epLoss < EP_THRESHOLDS.excellent)) return false;
    if (!isGenuineSacrifice(evalAfter, sacrificeValue, pieceIsHanging, sacrificeIsRecapturable)) return false;
    if (Math.abs(evalBefore) >= 600) return false; // já ganhando de goleada: sac é trivial
    return true;
  }

  /**
   * ÓTIMO / GREAT (aproximação): lance que muda o curso da partida —
   * perdendo→igual, igual→ganhando, ou a única jogada boa numa posição
   * tensa (gap grande entre PV1 e PV2). O Chess.com documenta Great como
   * "a única jogada boa" mesmo quando não é tecnicamente a #1 do motor —
   * por isso aceitamos também EP_loss muito pequeno (quase-melhor), não só
   * playedIsBest estrito.
   */
  function isGreatMove(params) {
    const { playedIsBest, epLoss, evalBefore, evalAfter, forced } = params;
    if (!(playedIsBest || epLoss < EP_THRESHOLDS.excellent)) return false;
    const wasLosing  = evalBefore <= -150;
    const wasEqual   = Math.abs(evalBefore) <= 50;
    const nowEqual   = evalAfter >= -60;
    const nowWinning = evalAfter >= 150;
    if (wasLosing && nowEqual) return true;
    if (wasEqual && nowWinning) return true;
    if (forced && Math.abs(evalBefore) < 400) return true; // única jogada boa
    return false;
  }

  /**
   * CHANCE PERDIDA / MISS (aproximação): havia mate ou vantagem decisiva
   * disponível na posição (EP≥0.85 ou mate encontrado pelo motor) e o
   * lance jogado desperdiça boa parte dela — mesmo sem perder material,
   * o que a diferencia de um Erro/Gafe comum.
   *
   * NOTA: a definição "oficial" do Chess.com também considera se o
   * ADVERSÁRIO acabou de cometer um erro no lance anterior. Esta versão
   * usa apenas o estado da posição atual (mais simples, sem precisar de
   * contexto do lance anterior) — aproximação documentada, não o critério
   * exato do Chess.com.
   */
  function isMissedWin(params) {
    const { epBefore, epAfter, epLoss, mateForMover } = params;
    const hadWinningChance = epBefore >= 0.85 || (mateForMover != null && mateForMover > 0);
    return hadWinningChance && epLoss >= 0.15 && epAfter < 0.75;
  }

  /**
   * Main classification function
   * @param {object} params
   *   - san, evalBefore, evalAfter, bestEval, bestMoveUCI, playedMoveUCI,
   *     multiPVEvals, isBook, isWhite, moveIndex, isStalemate, isCheckmate
   *   - immediateCaptureValue: valor (escala 100/300/500/900) do que o
   *     adversário realmente captura no lance seguinte, segundo o motor.
   *     Calculado pelo AnalysisEngine a partir da posição real do tabuleiro.
   *   - sacrificeValue: saldo material líquido do lance (o que o adversário
   *     recaptura MENOS o que o jogador capturou neste mesmo lance) — usado
   *     só para Brilhante/Ótimo, pra não confundir troca simples com sacrifício.
   *   - mateForMover: mate em N a favor do jogador ANTES do lance (ou null).
   *   - opponentGetsMate: true se, depois do lance, o adversário tem mate forçado.
   *   - depth: profundidade de busca usada nesta (re)classificação — usada
   *     para não confirmar Brilhante em profundidade rasa demais.
   *
   * Ordem de prioridade: Livro → Brilhante → Ótimo → Chance Perdida →
   * Melhor Lance → escada de EP_loss (Excelente/Boa/Imprecisão/Erro/Gafe).
   */
  function classify(params) {
    const {
      san, evalBefore, evalAfter, bestEval,
      bestMoveUCI, playedMoveUCI,
      multiPVEvals, isBook, isWhite,
      moveIndex,
      isStalemate,
      isCheckmate,
      immediateCaptureValue,
      sacrificeValue,
      pieceIsHanging,
      sacrificeIsRecapturable,
      mateForMover,
      opponentGetsMate,
      depth
    } = params;

    if (isBook) return 'book';

    if (isCheckmate) {
      // Xeque-mate: por definição, o melhor lance possível. Nunca penalizar.
      return 'best-move';
    }

    // Pode retornar 'blunder'/'mistake' (jogou fora uma vantagem) ou
    // 'great' (salvou um empate estando realmente perdendo — ver
    // DRAW_EQUAL_MARGIN) — qualquer valor não-null já decide a classificação.
    const drawPenalty = checkDrawPenalty(evalBefore, !!isStalemate);
    if (drawPenalty) return drawPenalty;

    const playedIsBest = isBestMoveMatch(playedMoveUCI, bestMoveUCI);
    const forced       = isForcedMove(multiPVEvals);

    const epBefore = epFromCp(evalBefore);
    const epAfter  = epFromCp(evalAfter);
    const epLoss   = Math.max(0, epBefore - epAfter);

    // ── BRILHANTE ──────────────────────────────────────────────
    if (isBrilliantMove({ playedIsBest, epLoss, evalBefore, evalAfter, sacrificeValue, pieceIsHanging, sacrificeIsRecapturable, depth })) {
      return 'brilliant';
    }

    // ── ÓTIMO (Great) ──────────────────────────────────────────
    if (isGreatMove({ playedIsBest, epLoss, evalBefore, evalAfter, forced })) {
      return 'great';
    }

    // ── CHANCE PERDIDA (Miss) ──────────────────────────────────
    if (isMissedWin({ epBefore, epAfter, epLoss, mateForMover })) {
      return 'miss';
    }

    // ── MELHOR LANCE ── bateu com a seta do motor NESTA profundidade.
    if (playedIsBest) {
      return 'best-move';
    }

    // ── Escada de EP_loss ──────────────────────────────────────
    if (epLoss < EP_THRESHOLDS.excellent)  return 'excellent';
    if (epLoss < EP_THRESHOLDS.good)       return 'good';
    if (epLoss < EP_THRESHOLDS.inaccuracy) return 'inaccuracy';
    if (epLoss < EP_THRESHOLDS.mistake)    return 'mistake';

    return classifyBlunderOrMistake(evalBefore, immediateCaptureValue, opponentGetsMate);
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
    great:       'Ótimo',
    excellent:   'Excelente',
    'best-move': 'Melhor Lance',
    good:        'Boa',
    inaccuracy:  'Imprecisão',
    mistake:     'Erro',
    miss:        'Chance Perdida',
    blunder:     'Gafe'
  };

  return { classify, computeStats, LABELS, normalizeLoss, isForcedMove, isBestMoveMatch, epFromCp };
})();
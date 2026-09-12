/* ==============================================================
   MODULE: insights-engine.js
   Cálculos de precisão por fase, DNA do jogador, sugestões,
   momento crítico, maior erro, estimativa de rating, etc.
   Depende de: rating-model.js
   ============================================================== */
const InsightsEngine = (() => {

  // ── FIX 1: Usa EXATAMENTE o mesmo algoritmo do card de jogadores (computeStats)
  // Assim precisão global e por fase são sempre coerentes entre si.
  function _computeAccuracyForSlice(movesSlice) {
    // Replica a lógica de MoveClassifier.computeStats para um subconjunto de lances
    const eligible = movesSlice.filter(m =>
      m.evalBefore !== null && m.evalAfter !== null && m.bestEval !== null
    );
    if (!eligible.length) return null;

    let weightedScoreSum = 0;
    let weightSum = 0;

    for (const m of eligible) {
      if (m.classification === 'book') continue;
      if (m.isCheckmate) {
        weightedScoreSum += 100 * 1.0;
        weightSum += 1.0;
        continue;
      }
      const evalPlayed = m.evalAfter;
      const evalBest   = m.bestEval;
      const isOnlyMove = (
        m.multiPVEvals && m.multiPVEvals.length >= 2 &&
        m.multiPVEvals[1] !== null &&
        Math.abs(evalBest - m.multiPVEvals[1]) > 500
      );
      let rawLoss = m.classification === 'best-move'
        ? 0
        : Math.max(0, evalBest - evalPlayed);
      if (isOnlyMove) rawLoss = Math.min(rawLoss, 30);
      const isDecided = Math.abs(m.evalBefore) > 800;
      const weight    = isDecided ? 0.3 : 1.0;
      const t_score   = Math.max(0, Math.min(1, 1 - rawLoss / 80));
      const divisor   = 118 + t_score * 15;
      const moveScore = Math.max(5, 100 * Math.exp(-rawLoss / divisor));
      weightedScoreSum += moveScore * weight;
      weightSum        += weight;
    }

    if (!weightSum) return null;
    return Math.round(Math.max(20, Math.min(100, weightedScoreSum / weightSum)));
  }

  // Precisão geral — espelha computeStats para manter valores idênticos
  function calcAccuracy(moves, color) {
    const slice = moves.filter(m => m.color === color);
    const acc = _computeAccuracyForSlice(slice);
    return acc ?? 0;
  }

  // ── FIX 2: Fases baseadas no número total de lances da partida, separado por cor
  // Abertura: lances 1–10 de cada cor | Meio-jogo: 11–30 | Final: 31+
  // (baseado em índice sequencial do lance, não percentual)
  function calcPhaseAccuracy(moves, color) {
    const cm = moves.filter(m => m.color === color);
    // Atribui índice sequencial por cor (0,1,2,...)
    const opening = cm.filter((_, i) => i < 10);
    const midgame = cm.filter((_, i) => i >= 10 && i < 30);
    const endgame = cm.filter((_, i) => i >= 30);
    return {
      opening: _computeAccuracyForSlice(opening),
      midgame: _computeAccuracyForSlice(midgame),
      endgame: _computeAccuracyForSlice(endgame),
    };
  }

  // ── FIX 3: Maior erro — clamp de mate values, usa rawLoss real
  function findBiggestBlunder(moves) {
    let worst = null, maxLoss = 0;
    for (const m of moves) {
      if (m.isBook || m.evalBefore == null || m.evalAfter == null) continue;
      if (m.isCheckmate) continue; // xeque-mate não é erro
      // Clamp: valores de mate (≥9000cp) são limitados a 800cp para exibição
      const rawBefore = Math.min(Math.abs(m.evalBefore), 800) * Math.sign(m.evalBefore);
      const rawAfter  = Math.min(Math.abs(m.evalAfter),  800) * Math.sign(m.evalAfter);
      const loss = rawBefore - rawAfter;
      if (loss > maxLoss) { maxLoss = loss; worst = m; }
    }
    if (!worst) return null;
    // Loss display também clampado
    const displayLoss = Math.min(maxLoss, 800);
    return { move: worst, loss: displayLoss };
  }

  function findCriticalMoment(moves) {
    let maxDrop = 0, critical = null;
    for (const m of moves) {
      if (m.evalBefore == null || m.evalAfter == null || m.isCheckmate) continue;
      const before = Math.min(Math.abs(m.evalBefore), 800) * Math.sign(m.evalBefore);
      const after  = Math.min(Math.abs(m.evalAfter),  800) * Math.sign(m.evalAfter);
      const drop = before - after;
      if (drop > maxDrop) { maxDrop = drop; critical = m; }
    }
    return critical;
  }

  function estimateRating(moves) {
    // Usa o RatingModel CPL-contextual para cada cor separadamente,
    // depois mostra o da partida como o melhor dos dois (quem jogou melhor define o nível)
    const wMoves = moves.filter(m => m.color === 'white' && !m.isBook &&
      m.evalBefore != null && m.evalAfter != null && m.bestEval != null);
    const bMoves = moves.filter(m => m.color === 'black' && !m.isBook &&
      m.evalBefore != null && m.evalAfter != null && m.bestEval != null);

    const wRatingRaw = wMoves.length ? RatingModel.fromMoves(wMoves) : null;
    const bRatingRaw = bMoves.length ? RatingModel.fromMoves(bMoves) : null;

    // ── Correlação de nível entre os dois lados (ver rating-model.js) ──
    // Evita que o lado mais fraco caia artificialmente baixo só por
    // enfrentar um oponente muito forte, quando o próprio desempenho
    // (precisão, ausência de blunders) mostra que ele sustentou um
    // nível alto na partida. Nunca mexe no lado com rating maior.
    let wRating = wRatingRaw, bRating = bRatingRaw;
    if (wRatingRaw != null && bRatingRaw != null) {
      const wSelfStats = {
        accuracy: calcAccuracy(moves, 'white'),
        blunders: wMoves.filter(m => m.classification === 'blunder').length,
        mistakes: wMoves.filter(m => m.classification === 'mistake').length
      };
      const bSelfStats = {
        accuracy: calcAccuracy(moves, 'black'),
        blunders: bMoves.filter(m => m.classification === 'blunder').length,
        mistakes: bMoves.filter(m => m.classification === 'mistake').length
      };
      wRating = RatingModel.correlateOpponents(wRatingRaw, wSelfStats, bRatingRaw);
      bRating = RatingModel.correlateOpponents(bRatingRaw, bSelfStats, wRatingRaw);
    }

    // Média entre os dois lados representa o nível geral da partida
    let gameRating;
    if (wRating && bRating) gameRating = Math.round((wRating + bRating) / 2 / 25) * 25;
    else gameRating = wRating ?? bRating ?? 1500;

    const info = RatingModel.toRange(gameRating);
    return {
      rating: info.label,
      range:  info.range,
      emoji:  info.emoji,
      wRating, bRating, gameRating
    };
  }

  function playerProfile(moves, color) {
    const cm = moves.filter(m => m.color === color && !m.isBook);
    const blunders   = cm.filter(m => m.classification === 'blunder').length;
    const mistakes   = cm.filter(m => m.classification === 'mistake').length;
    const inac       = cm.filter(m => m.classification === 'inaccuracy').length;
    const brilliants = cm.filter(m => m.classification === 'brilliant').length;
    const best       = cm.filter(m => m.classification === 'best-move').length;
    const total      = cm.length || 1;
    const errorRate  = (blunders + mistakes) / total;
    const brilliantRate = brilliants / total;
    const precisionRate = (best + brilliants) / total;

    if (brilliantRate > 0.05 && errorRate < 0.15)   return { profile: 'Tático Criativo',  emoji: '⚡', tags: ['Tático','Criativo','Agressivo'] };
    if (precisionRate > 0.35 && errorRate < 0.1)    return { profile: 'Sólido & Preciso', emoji: '🏆', tags: ['Preciso','Sólido','Controlado'] };
    if (errorRate > 0.4)                             return { profile: 'Imprudente',        emoji: '🎲', tags: ['Impreciso','Apressado','Alto Risco'] };
    if (errorRate > 0.25)                            return { profile: 'Instável',          emoji: '⚠️', tags: ['Inconsistente','Erros Táticos'] };
    if (inac / total > 0.35 && errorRate < 0.15)    return { profile: 'Cauteloso/Passivo', emoji: '🐢', tags: ['Passivo','Conservador','Evita Risco'] };
    if (errorRate < 0.1)                             return { profile: 'Sólido & Preciso', emoji: '🏆', tags: ['Preciso','Sólido','Controlado'] };
    return { profile: 'Equilibrado', emoji: '⚖️', tags: ['Equilibrado','Versátil'] };
  }

  // ── FIX 4: Gráfico com identificação de COR ──────────────────
  // evalAfter está na perspectiva do jogador que moveu → convertemos para brancas
  function _whiteEval(m) {
    return m.color === 'white' ? m.evalAfter : -m.evalAfter;
  }

  function chartInsights(moves) {
    const insights = [];
    const valid = moves.filter(m => m.evalAfter != null && !m.isCheckmate);
    if (valid.length < 4) return insights;

    const total = valid.length;
    const t1 = Math.floor(total / 3);
    const t2 = Math.floor(total * 2 / 3);

    function segAvg(start, end) {
      const seg = valid.slice(start, end);
      if (!seg.length) return 0;
      return seg.reduce((s, m) => s + _whiteEval(m), 0) / seg.length;
    }
    const s1 = segAvg(0, t1), s2 = segAvg(t1, t2), s3 = segAvg(t2, total);

    // Queda brusca — identificar quem perdeu
    if (s1 > s2 + 80) {
      const who = s1 > 30 ? 'Brancas perderam vantagem no meio-jogo' : 'Pretas recuperaram no meio-jogo';
      insights.push({ text: who, type: 'bad' });
    }
    if (s2 > s1 + 80) {
      insights.push({ text: 'Brancas construíram vantagem no meio-jogo', type: 'good' });
    }
    if (s1 < s2 - 80) {
      insights.push({ text: 'Pretas perderam vantagem no meio-jogo', type: 'bad' });
    }

    // Dominância na abertura
    if (s1 > 80)  insights.push({ text: 'Brancas dominaram a abertura',  type: 'good' });
    if (s1 < -80) insights.push({ text: 'Pretas dominaram a abertura',   type: 'info' });
    if (Math.abs(s1) < 40) insights.push({ text: 'Abertura equilibrada entre os dois lados', type: 'good' });

    // Final de jogo
    if (s3 > s2 + 100) insights.push({ text: 'Brancas melhoraram muito no final',  type: 'good' });
    if (s3 < s2 - 100) insights.push({ text: 'Pretas se saíram melhor no final',    type: 'info' });
    if (Math.abs(s3) < 50 && total > 30) insights.push({ text: 'Final jogado de forma equilibrada', type: 'good' });

    // Queda e recuperação
    if (s2 < s1 - 100 && s3 > s2 + 100) {
      const who = s1 > 0 ? 'Brancas caíram no meio-jogo mas se recuperaram' : 'Pretas caíram no meio-jogo mas se recuperaram';
      insights.push({ text: who, type: 'info' });
    }

    // Pressão constante
    if (s1 > 60 && s2 > 60 && s3 > 60) insights.push({ text: 'Brancas mantiveram pressão constante', type: 'good' });
    if (s1 < -60 && s2 < -60 && s3 < -60) insights.push({ text: 'Pretas mantiveram pressão constante', type: 'info' });

    return insights.slice(0, 5);
  }

  // ── FIX 5: Padrões recorrentes robustos ──────────────────────
  function detectPatterns(moves) {
    const patterns = [];

    for (const color of ['white', 'black']) {
      const label = color === 'white' ? 'Brancas' : 'Pretas';
      const cm    = moves.filter(m => m.color === color && !m.isBook);
      const total = cm.length || 1;

      const blunders     = cm.filter(m => m.classification === 'blunder');
      const mistakes     = cm.filter(m => m.classification === 'mistake');
      const inaccuracies = cm.filter(m => m.classification === 'inaccuracy');
      const brilliants   = cm.filter(m => m.classification === 'brilliant');
      const bestMoves    = cm.filter(m => m.classification === 'best-move');
      const goodMoves    = cm.filter(m => ['best-move','excellent','very-good'].includes(m.classification));

      // Erros graves frequentes
      if (blunders.length >= 3)
        patterns.push(`${label}: ${blunders.length} gafes — perde material ou posição repetidamente`);
      else if (blunders.length === 2)
        patterns.push(`${label}: 2 gafes — vulnerabilidade tática`);

      // Muitos erros médios
      if (mistakes.length / total > 0.18)
        patterns.push(`${label}: alta taxa de erros (${mistakes.length} erros) — dificuldade de calcular variações`);

      // Imprecisões em série
      if (inaccuracies.length / total > 0.30)
        patterns.push(`${label}: jogo impreciso e passivo — muitas jogadas subótimas`);

      // Erros no final
      const endgameMoves = cm.filter((_, i) => i >= 30);
      const endgameErrors = endgameMoves.filter(m => ['blunder','mistake'].includes(m.classification));
      if (endgameMoves.length >= 5 && endgameErrors.length / endgameMoves.length > 0.25)
        patterns.push(`${label}: dificuldades no final de jogo — erros frequentes após o lance 30`);

      // Erros na abertura (primeiros 10 lances)
      const openingMoves  = cm.filter((_, i) => i < 10);
      const openingErrors = openingMoves.filter(m => ['blunder','mistake','inaccuracy'].includes(m.classification));
      if (openingMoves.length >= 5 && openingErrors.length / openingMoves.length > 0.3)
        patterns.push(`${label}: abertura problemática — erro em mais de 30% dos lances iniciais`);

      // Queda sob pressão (blunders em posição boa)
      const blundersFromGood = blunders.filter(m => (m.evalBefore ?? 0) > 100);
      if (blundersFromGood.length >= 2)
        patterns.push(`${label}: perde vantagem sob pressão — gafes a partir de posição ganhante`);

      // Criatividade tática
      if (brilliants.length >= 2)
        patterns.push(`${label}: ${brilliants.length} lances brilhantes — forte intuição tática`);

      // Alta precisão consistente
      if (goodMoves.length / total > 0.55 && blunders.length === 0)
        patterns.push(`${label}: jogo consistente e preciso ao longo de toda a partida`);

      // Domínio de melhor lance
      if (bestMoves.length / total > 0.25)
        patterns.push(`${label}: encontra frequentemente o melhor lance — forte cálculo`);

      // Instabilidade (erros alternando com ótimos lances)
      let instableCount = 0;
      for (let i = 1; i < cm.length - 1; i++) {
        const prev = cm[i-1].classification;
        const curr = cm[i].classification;
        if (['blunder','mistake'].includes(curr) && ['best-move','excellent','brilliant'].includes(prev))
          instableCount++;
      }
      if (instableCount >= 2)
        patterns.push(`${label}: jogo instável — alterna entre lances excelentes e erros graves`);

      // Erros em lances longos (>= índice 20, posição presumivelmente complexa)
      const midErrors = cm.filter((_, i) => i >= 10 && i < 30)
                          .filter(m => ['blunder','mistake'].includes(m.classification));
      if (midErrors.length >= 3)
        patterns.push(`${label}: dificuldade em posições complexas de meio-jogo`);
    }

    // Padrões gerais da partida
    const totalMoves  = moves.filter(m => !m.isBook).length || 1;
    const totalErrors = moves.filter(m => ['blunder','mistake'].includes(m.classification)).length;
    if (totalErrors / totalMoves < 0.05 && totalMoves > 20)
      patterns.push('Partida de alto nível — pouquíssimos erros de ambos os lados');

    const bookMoves = moves.filter(m => m.isBook).length;
    if (bookMoves >= 8)
      patterns.push(`Abertura teórica sólida — ${bookMoves} lances dentro da teoria`);
    else if (bookMoves <= 2 && moves.length > 15)
      patterns.push('Abertura fora da teoria — os dois lados saíram do livro cedo');

    return patterns.length ? patterns : ['Nenhum padrão negativo recorrente detectado. Jogo equilibrado!'];
  }

  function dna(moves) {
    const wProfile  = playerProfile(moves, 'white');
    const bProfile  = playerProfile(moves, 'black');
    const patterns  = detectPatterns(moves);
    return { white: wProfile, black: bProfile, patterns };
  }

  function suggestions(moves, color) {
    const s = [];
    const cm    = moves.filter(m => m.color === color && !m.isBook);
    const total = cm.length || 1;
    const blunders     = cm.filter(m => m.classification === 'blunder').length;
    const mistakes     = cm.filter(m => m.classification === 'mistake').length;
    const inaccuracies = cm.filter(m => m.classification === 'inaccuracy').length;
    const phase = calcPhaseAccuracy(moves, color);

    if (blunders / total > 0.1)    s.push({ text: 'Reduza erros graves: analise cada gafe desta partida e entenda por que aconteceu.', level: 'high' });
    if (mistakes / total > 0.15)   s.push({ text: 'Treine táticas diariamente para reduzir erros táticos no meio-jogo.', level: 'high' });
    if (inaccuracies / total > 0.3) s.push({ text: 'Foque em precisão: pause antes de mover e analise a resposta do adversário.', level: 'mid' });
    if (phase.endgame != null && phase.endgame < 70) s.push({ text: 'Estude finais básicos (Rei+Torre, oposição de reis) para melhorar o final de jogo.', level: 'mid' });
    if (phase.opening != null && phase.opening < 75) s.push({ text: 'Aprenda os princípios de abertura: controle do centro, desenvolvimento rápido, segurança do rei.', level: 'low' });
    if (phase.midgame != null && phase.midgame < 70) s.push({ text: 'Pratique mais cálculo de táticas (garfos, cravadas, raios-X) para o meio-jogo.', level: 'mid' });
    if (!s.length) s.push({ text: 'Ótimo desempenho! Continue analisando suas partidas para manter a consistência.', level: 'low' });
    return s.slice(0, 4);
  }

  // ── FIX 6: CP loss display — clamp de mate values ────────────
  function _displayLoss(evalBefore, evalAfter) {
    if (evalBefore == null || evalAfter == null) return 0;
    const clampedBefore = Math.max(-800, Math.min(800, evalBefore));
    const clampedAfter  = Math.max(-800, Math.min(800, evalAfter));
    return Math.max(0, clampedBefore - clampedAfter);
  }

  function moveInsight(move) {
    if (!move) return null;
    const cls  = move.classification;
    const loss = _displayLoss(move.evalBefore, move.evalAfter);
    const flags = [];
    let comment = '';

    if (cls === 'brilliant')   comment = '✨ Lance brilhante! Sacrifício ou jogada genial que muda o rumo da partida.';
    else if (cls === 'excellent')  comment = '✅ Excelente jogada! Uma das melhores opções nesta posição.';
    else if (cls === 'best-move')  comment = '🏆 Melhor lance possível! A engine concorda com você.';
    else if (cls === 'very-good')  comment = '🎯 Muito boa jogada! Mantém a vantagem ou pressão ideal.';
    else if (cls === 'good')       comment = '👍 Boa jogada. Sólida, mas havia opções ligeiramente melhores.';
    else if (cls === 'inaccuracy') comment = `⚠️ Imprecisão. Perdeu ${loss.toFixed(0)}cp de vantagem. Havia um lance melhor.`;
    else if (cls === 'mistake')    comment = `❌ Erro! Perdeu ${loss.toFixed(0)}cp. Um lance muito melhor estava disponível.`;
    else if (cls === 'blunder')    comment = `💀 Gafe grave! Perdeu ${loss.toFixed(0)}cp de vantagem. Erro decisivo na partida.`;
    else if (cls === 'book')       comment = '📖 Lance de abertura teórico. Conforme a teoria.';
    else comment = 'Analisando posição…';

    if (loss > 200) flags.push({ text: 'Perdeu material', type: 'danger' });
    if (loss > 100 && cls !== 'blunder') flags.push({ text: 'Havia tática melhor', type: 'warning' });
    if (move.bestMoveUCI && move.playedMoveUCI && move.bestMoveUCI !== move.playedMoveUCI && loss > 50)
      flags.push({ text: 'Melhor lance ignorado', type: 'info' });

    return { comment, flags, loss };
  }

  return {
    calcAccuracy, calcPhaseAccuracy, findCriticalMoment,
    findBiggestBlunder, estimateRating, playerProfile,
    chartInsights, suggestions, dna, moveInsight, detectPatterns
  };
})();
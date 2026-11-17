/* ==============================================================
   MODULE: insights-engine.js
   Cálculos de precisão por fase, DNA do jogador, sugestões,
   momento crítico, maior erro, estimativa de rating, etc.
   Depende de: rating-model.js
   ============================================================== */
const InsightsEngine = (() => {

  // ── FIX 1: Usa EXATAMENTE o mesmo algoritmo do card de jogadores (computeStats)
  // Assim precisão global e por fase são sempre coerentes entre si.
  // Precisão de um conjunto de lances de UM jogador. Usa exatamente a mesma
  // conta do cartão do jogador (MoveClassifier.computeStats), para que o
  // painel, o relatório e o cartão nunca mostrem números diferentes.
  // Retorna null quando não há lance fora do livro para avaliar.
  function _computeAccuracyForSlice(movesSlice) {
    const avaliaveis = movesSlice.filter(m =>
      m.classification !== 'book' && m.evalBefore != null && m.evalAfter != null && m.bestEval != null);
    if (!avaliaveis.length) return null;
    return MoveClassifier.computeStats(avaliaveis, avaliaveis[0].color === 'white').accuracy;
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

  // ══════════════════════════════════════════════════════════════
  // Textos e resumos do painel de insights. Tudo aqui é montado com os
  // números desta partida (avaliações, perdas, lances, fases) — nada de
  // frase genérica. Nenhuma função abaixo altera a análise.
  // ══════════════════════════════════════════════════════════════
  const ERROS = ['inaccuracy', 'mistake', 'miss', 'blunder'];
  const NOMES = {
    book: 'Livro', brilliant: 'Brilhante', great: 'Ótimo', excellent: 'Excelente', 'best-move': 'Melhor lance',
    good: 'Boa', inaccuracy: 'Imprecisão', mistake: 'Erro', miss: 'Chance perdida', blunder: 'Gafe'
  };

  function _clamp(v) { return Math.abs(v) >= 29000 ? (v > 0 ? 900 : -900) : Math.max(-900, Math.min(900, v)); }
  /** Quanto o lance ficou abaixo do melhor lance do motor, em centipeões (0 a 900). */
  function moveLoss(m) {
    if (!m || m.bestEval == null || m.evalAfter == null || m.isCheckmate) return 0;
    return Math.max(0, _clamp(m.bestEval) - _clamp(m.evalAfter));
  }
  function moveLabel(m) { return `${Math.floor(m.index / 2) + 1}${m.color === 'white' ? '.' : '...'} ${m.san}`; }
  function _num(cp) { return (cp / 100).toFixed(2).replace('.', ','); }
  /** Percentual em pt-BR (80,9%). */
  function pct(v) { return v == null ? '—' : String(v).replace('.', ',') + '%'; }
  function _plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }
  function _lista(itens) {
    if (itens.length <= 1) return itens.join('');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }

  /** Descreve a avaliação em palavras, do ponto de vista de quem jogou. */
  function describeEval(v) {
    if (v == null) return 'posição incerta';
    if (v >= 29000)  return 'mate a favor';
    if (v <= -29000) return 'mate contra';
    if (v >= 300)  return 'posição ganha';
    if (v >= 120)  return 'vantagem clara';
    if (v >= 40)   return 'leve vantagem';
    if (v > -40)   return 'posição equilibrada';
    if (v > -120)  return 'leve desvantagem';
    if (v > -300)  return 'desvantagem clara';
    return 'posição perdida';
  }
  function _material(v) {
    if (v >= 900) return 'a dama';
    if (v >= 500) return 'uma torre';
    if (v >= 300) return 'uma peça';
    return 'material';
  }

  /** Os erros que mais custaram, em ordem de lance. color = 'white' | 'black' | null (os dois). */
  function keyMoments(moves, color, n = 3) {
    return moves
      .filter(m => (!color || m.color === color) && !m.isBook && ERROS.includes(m.classification))
      .map(m => ({ move: m, loss: moveLoss(m) }))
      .filter(x => x.loss >= 30)
      .sort((a, b) => b.loss - a.loss)
      .slice(0, n)
      .sort((a, b) => a.move.index - b.move.index);
  }

  /** Contagem de lances por grupo, para a barra de distribuição do perfil. */
  function distribution(moves, color) {
    const cm = moves.filter(m => m.color === color && m.classification);
    const c = k => cm.filter(m => m.classification === k).length;
    return {
      total: cm.length,
      top:   c('brilliant') + c('great') + c('best-move') + c('excellent'),
      good:  c('good'),
      book:  c('book'),
      inaccuracy: c('inaccuracy'),
      mistake: c('mistake') + c('miss'),
      blunder: c('blunder'),
    };
  }

  function playerProfile(moves, color) {
    const cm = moves.filter(m => m.color === color && !m.isBook && m.classification);
    const n = k => cm.filter(m => m.classification === k).length;
    const total      = cm.length || 1;
    const blunders   = n('blunder'), mistakes = n('mistake') + n('miss'), inac = n('inaccuracy');
    const brilliants = n('brilliant');
    const top        = n('best-move') + n('excellent') + n('great') + brilliants;
    const errorRate  = (blunders + mistakes) / total;
    const topPct     = Math.round(100 * top / total);
    const perdas     = cm.map(moveLoss);
    const media      = perdas.length ? Math.round(perdas.reduce((a, b) => a + b, 0) / perdas.length) : 0;

    let profile, tags;
    if (brilliants / total > 0.05 && errorRate < 0.15)      { profile = 'Tático e criativo';  tags = ['Sacrifícios corretos', 'Poucos erros']; }
    else if (top / total > 0.5 && errorRate < 0.1)          { profile = 'Sólido e preciso';   tags = ['Alta precisão', 'Poucos erros']; }
    else if (errorRate > 0.4)                               { profile = 'Arriscado';          tags = ['Muitos erros graves', 'Posições instáveis']; }
    else if (errorRate > 0.25)                              { profile = 'Irregular';          tags = ['Erros graves frequentes']; }
    else if (inac / total > 0.35 && errorRate < 0.15)       { profile = 'Cauteloso';          tags = ['Muitas imprecisões', 'Poucos erros graves']; }
    else if (errorRate < 0.1)                               { profile = 'Sólido e preciso';   tags = ['Poucos erros']; }
    else                                                    { profile = 'Equilibrado';        tags = ['Sem padrão dominante']; }

    const desc = `${topPct}% dos lances fora do livro ficaram entre as melhores opções do motor. `
      + `Foram ${_plural(blunders, 'gafe', 'gafes')}, ${_plural(mistakes, 'erro', 'erros')} e ${_plural(inac, 'imprecisão', 'imprecisões')} `
      + `em ${_plural(cm.length, 'lance', 'lances')}, com perda média de ${_num(media)} por lance.`;
    return { profile, tags, desc, emoji: '' };
  }

  // evalAfter está na perspectiva de quem jogou → converte para o lado das brancas
  function _whiteEval(m) { return m.color === 'white' ? m.evalAfter : -m.evalAfter; }

  /** Leitura do gráfico de vantagem em três terços da partida. */
  function chartInsights(moves) {
    const insights = [];
    const valid = moves.filter(m => m.evalAfter != null && !m.isCheckmate);
    if (valid.length < 6) return insights;
    const total = valid.length, t1 = Math.floor(total / 3), t2 = Math.floor(total * 2 / 3);
    const media = (a, b) => {
      const seg = valid.slice(a, b);
      return seg.length ? seg.reduce((s, m) => s + _clamp(_whiteEval(m)), 0) / seg.length : 0;
    };
    const s = [media(0, t1), media(t1, t2), media(t2, total)];
    const nomes = ['primeiro terço', 'segundo terço', 'terço final'];
    const lado = v => (v > 0 ? 'brancas' : 'pretas');

    s.forEach((v, i) => {
      if (Math.abs(v) < 40) insights.push({ text: `No ${nomes[i]}, a partida ficou equilibrada (média de ${_num(Math.round(v))}).`, type: 'info' });
      else insights.push({ text: `No ${nomes[i]}, as ${lado(v)} estiveram melhor (média de ${v > 0 ? '+' : '−'}${_num(Math.abs(Math.round(v)))}).`, type: v > 0 ? 'white' : 'black' });
    });
    for (let i = 1; i < 3; i++) {
      const d = s[i] - s[i - 1];
      if (Math.abs(d) >= 100) {
        const quem = d > 0 ? 'brancas' : 'pretas';
        insights.push({ text: `Do ${nomes[i - 1]} para o ${nomes[i]}, a vantagem se moveu ${_num(Math.abs(Math.round(d)))} a favor das ${quem}.`, type: d > 0 ? 'white' : 'black' });
      }
    }
    // quantas vezes a vantagem trocou de lado de forma relevante
    let trocas = 0, ultimo = 0;
    for (const m of valid) {
      const v = _clamp(_whiteEval(m));
      const sinal = v > 100 ? 1 : v < -100 ? -1 : 0;
      if (sinal && ultimo && sinal !== ultimo) trocas++;
      if (sinal) ultimo = sinal;
    }
    if (trocas >= 2) insights.push({ text: `A vantagem trocou de lado ${trocas} vezes: partida aberta, decidida nos detalhes.`, type: 'info' });
    else if (trocas === 1) insights.push({ text: 'A vantagem trocou de lado uma vez ao longo da partida.', type: 'info' });
    return insights.slice(0, 5);
  }

  /** Padrões desta partida, separados por jogador. */
  function detectPatterns(moves) {
    const out = { white: [], black: [], game: [] };
    for (const color of ['white', 'black']) {
      const p = out[color];
      const cm    = moves.filter(m => m.color === color && !m.isBook && m.classification);
      const total = cm.length || 1;
      const de = k => cm.filter(m => m.classification === k);
      const blunders = de('blunder'), mistakes = de('mistake'), inaccuracies = de('inaccuracy'), misses = de('miss');
      const graves = cm.filter(m => ['blunder', 'mistake'].includes(m.classification));

      if (blunders.length >= 2)
        p.push(`${blunders.length} gafes (${_lista(blunders.slice(0, 4).map(moveLabel))}): material entregue ou mate permitido mais de uma vez.`);
      if (misses.length >= 1)
        p.push(`${_plural(misses.length, 'chance perdida', 'chances perdidas')} (${_lista(misses.slice(0, 3).map(moveLabel))}): havia um ganho claro que não foi jogado.`);
      const deVantagem = graves.filter(m => (m.evalBefore ?? 0) >= 150);
      if (deVantagem.length >= 2)
        p.push(`Em ${deVantagem.length} momentos, um erro grave veio quando a posição já era favorável (${_lista(deVantagem.slice(0, 3).map(moveLabel))}).`);
      if (mistakes.length / total > 0.18)
        p.push(`${mistakes.length} erros em ${cm.length} lances: taxa alta de decisões que custaram mais de 10 pontos de chance de vitória.`);
      if (inaccuracies.length / total > 0.30)
        p.push(`${inaccuracies.length} imprecisões: a posição foi piorando aos poucos, sem um erro único que explique o resultado.`);

      const fase = (a, b) => cm.filter((_, i) => i >= a && i < b);
      const errosEm = lista => lista.filter(m => ['blunder', 'mistake', 'miss'].includes(m.classification)).length;
      const ab = fase(0, 10), mj = fase(10, 30), fi = fase(30, 999);
      if (ab.length >= 5 && ab.filter(m => ERROS.includes(m.classification)).length / ab.length > 0.3)
        p.push('Mais de 30% dos dez primeiros lances fora do livro foram imprecisos ou piores.');
      if (errosEm(mj) >= 3) p.push(`${errosEm(mj)} erros graves no meio-jogo (lances 11 a 30).`);
      if (fi.length >= 5 && errosEm(fi) / fi.length > 0.25) p.push(`${errosEm(fi)} erros graves depois do lance 30: o final custou caro.`);

      // erros concentrados no último terço costumam ser relógio ou cansaço
      const terco = cm.slice(Math.floor(cm.length * 2 / 3));
      if (graves.length >= 3 && terco.filter(m => graves.includes(m)).length / graves.length >= 0.7)
        p.push('A maior parte dos erros graves está no último terço da partida, o que costuma indicar pressão do relógio.');

      const brilhantes = de('brilliant');
      if (brilhantes.length >= 1) p.push(`${_plural(brilhantes.length, 'lance brilhante', 'lances brilhantes')} (${_lista(brilhantes.slice(0, 3).map(moveLabel))}).`);
      const topo = cm.filter(m => ['best-move', 'excellent', 'great', 'brilliant'].includes(m.classification)).length;
      if (topo / total > 0.6 && blunders.length === 0)
        p.push(`${Math.round(100 * topo / total)}% dos lances entre as melhores opções do motor e nenhuma gafe.`);
      if (!p.length) p.push('Nenhum padrão negativo se repetiu nesta partida.');
    }
    const fora = moves.filter(m => !m.isBook).length || 1;
    const gravesTotal = moves.filter(m => ['blunder', 'mistake'].includes(m.classification)).length;
    const livro = moves.filter(m => m.isBook).length;
    if (livro >= 8) out.game.push(`Os ${livro} primeiros meios-lances seguiram a teoria da abertura.`);
    else if (livro <= 2 && moves.length > 15) out.game.push('A partida saiu da teoria logo nos primeiros lances.');
    if (gravesTotal / fora < 0.05 && fora > 20) out.game.push('Poucos erros graves dos dois lados.');
    return out;
  }

  function dna(moves) {
    return { white: playerProfile(moves, 'white'), black: playerProfile(moves, 'black'), patterns: detectPatterns(moves) };
  }

  /** Sugestões de estudo para um jogador, com os lances que as justificam e o guia correspondente. */
  function suggestions(moves, color) {
    const s = [];
    const cm    = moves.filter(m => m.color === color && !m.isBook && m.classification);
    const total = cm.length || 1;
    const de = k => cm.filter(m => m.classification === k);
    const blunders = de('blunder'), misses = de('miss'), inaccuracies = de('inaccuracy');
    const graves = cm.filter(m => ['blunder', 'mistake'].includes(m.classification));
    const phase = calcPhaseAccuracy(moves, color);
    const ref = lista => _lista(lista.slice(0, 3).map(moveLabel));

    const material = blunders.filter(m => (m.immediateCaptureValue ?? 0) >= 300);
    if (material.length)
      s.push({ level: 'high', text: `${_plural(material.length, 'gafe entregou', 'gafes entregaram')} material (${ref(material)}). Antes de soltar a peça, confira xeques, capturas e ameaças do adversário.`,
               href: 'aprender/pecas-indefesas.html', link: 'Peças indefesas e o checklist de 10 segundos' });
    const mates = blunders.filter(m => (m.evalAfter ?? 0) <= -29000);
    if (mates.length)
      s.push({ level: 'high', text: `${_plural(mates.length, 'lance permitiu', 'lances permitiram')} mate forçado (${ref(mates)}). Vale rever os padrões de mate mais comuns.`,
               href: 'aprender/padroes-de-mate.html', link: 'Sete padrões de mate' });
    if (misses.length)
      s.push({ level: 'high', text: `${_plural(misses.length, 'chance perdida', 'chances perdidas')} (${ref(misses)}): havia um ganho claro na posição. Volte a esses lances e tente achá-lo sem olhar a seta.`,
               href: 'aprender/garfo.html', link: 'Garfo e ataques duplos' });
    const errosSimples = de('mistake').filter(m => !(m.evalBefore >= 150));
    if (errosSimples.length)
      s.push({ level: 'high', text: errosSimples.length === 1
        ? `O erro ${ref(errosSimples)} custou caro sem perder material na hora. Volte a esse lance e pergunte o que o adversário ameaçava e qual era o plano do lance sugerido.`
        : `${errosSimples.length} erros (${ref(errosSimples)}) custaram caro sem perder material na hora. Volte a cada um e pergunte o que o adversário ameaçava e qual era o plano do lance sugerido.`,
               href: 'aprender/como-estudar-suas-partidas.html', link: 'Como estudar as próprias partidas' });
    const deVantagem = graves.filter(m => (m.evalBefore ?? 0) >= 150);
    if (deVantagem.length >= 2)
      s.push({ level: 'mid', text: `${deVantagem.length} erros graves vieram com a posição já favorável (${ref(deVantagem)}). Com vantagem, simplifique: troque peças e evite complicações.`,
               href: 'aprender/valor-das-pecas.html#quando-trocar', link: 'Quando trocar e quando evitar' });

    const fases = [['opening', 'abertura', 75, 'aprender/principios-de-abertura.html', 'Princípios de abertura'],
                   ['midgame', 'meio-jogo', 70, 'aprender/cravada-e-espeto.html', 'Cravada e espeto'],
                   ['endgame', 'final', 70, 'aprender/finais-de-rei-e-peao.html', 'Finais de rei e peão']]
      .filter(f => phase[f[0]] != null).sort((a, b) => phase[a[0]] - phase[b[0]]);
    if (fases.length && phase[fases[0][0]] < fases[0][2]) {
      const f = fases[0];
      s.push({ level: 'mid', text: `A fase mais fraca foi ${f[1] === 'abertura' ? 'a abertura' : 'o ' + f[1]}, com ${pct(phase[f[0]])} de precisão.`, href: f[3], link: f[4] });
    }
    if (inaccuracies.length / total > 0.3)
      s.push({ level: 'low', text: `${inaccuracies.length} imprecisões em ${cm.length} lances: a posição piorou aos poucos. Quando não houver tática, escolha o lance pelo plano que a estrutura de peões indica.`,
               href: 'aprender/estrutura-de-peoes.html#plano', link: 'Da estrutura ao plano' });
    const terco = cm.slice(Math.floor(cm.length * 2 / 3));
    if (graves.length >= 3 && terco.filter(m => graves.includes(m)).length / graves.length >= 0.7)
      s.push({ level: 'low', text: 'Os erros graves se concentram no fim da partida. Confira quanto tempo havia no relógio nesses lances.',
               href: 'aprender/gestao-do-tempo.html', link: 'Gestão do relógio' });
    if (!s.length)
      s.push({ level: 'low', text: 'Nenhum erro grave nesta partida. Compare com outras análises para ver se esse nível se repete.',
               href: 'aprender/como-estudar-suas-partidas.html', link: 'Como estudar as próprias partidas' });
    return s.slice(0, 4);
  }

  /** Frases de abertura do resumo: resultado, precisão e o lance que mais pesou. */
  function headline(moves, result) {
    const frases = [];
    const accW = calcAccuracy(moves, 'white'), accB = calcAccuracy(moves, 'black');
    const res = result === '1-0' ? 'As brancas venceram' : result === '0-1' ? 'As pretas venceram' : result === '1/2-1/2' ? 'A partida terminou empatada' : '';
    frases.push(`${res ? res + '. ' : ''}Precisão de ${pct(accW)} para as brancas e ${pct(accB)} para as pretas.`);
    const pior = keyMoments(moves, null, 1)[0];
    if (pior) {
      const m = pior.move;
      frases.push(`O lance que mais pesou foi ${moveLabel(m)} (${NOMES[m.classification].toLowerCase()} das ${m.color === 'white' ? 'brancas' : 'pretas'}), que custou ${_num(pior.loss)} de avaliação.`);
    } else {
      frases.push('Nenhum lance isolado decidiu a partida: não houve erro com perda relevante.');
    }
    return frases;
  }

  /**
   * Comentário de um lance, montado com os números dele.
   * bestSan: melhor lance do motor já em notação legível (opcional).
   */
  function moveInsight(move, bestSan) {
    if (!move) return null;
    const cls  = move.classification;
    const loss = moveLoss(move);
    // "Antes" = avaliação refinada da posição com o melhor lance (bestEval),
    // a mesma base da perda; evalBefore vem só da leitura rápida.
    const base = move.bestEval ?? move.evalBefore;
    const antes = describeEval(base), depois = describeEval(move.evalAfter);
    const outro = bestSan && move.bestMoveUCI && move.bestMoveUCI !== move.playedMoveUCI ? bestSan : null;
    const melhor = outro ? ` O motor preferia ${outro}.` : '';
    const mudou = antes !== depois ? `A posição de quem jogou passou de ${antes} para ${depois}.` : `A posição de quem jogou continua sendo ${depois}.`;
    const mateContra = (move.evalAfter ?? 0) <= -29000;
    const mateEm = v => Math.max(1, 30000 - Math.abs(v));
    const flags = [];
    let comment;

    if (move.isCheckmate) comment = 'Xeque-mate. Não existe lance melhor.';
    else if (cls === 'book') comment = 'Lance de livro: faz parte da teoria desta abertura e não entra no cálculo de precisão.';
    else if (cls === 'brilliant') comment = `Brilhante. Um sacrifício que o motor confirma: mesmo entregando material, a avaliação fica em ${depois}.`;
    else if (cls === 'great') {
      if ((move.evalBefore ?? 0) <= -150) comment = `Ótimo. Recupera uma posição difícil: de ${describeEval(move.evalBefore)} para ${depois}.`;
      else if (Math.abs(move.evalBefore ?? 0) <= 50 && (move.evalAfter ?? 0) >= 150) comment = `Ótimo. Transforma uma posição igual em ${depois}.`;
      else comment = 'Ótimo. Era a única jogada que mantinha a posição: a segunda opção do motor era bem pior.';
    }
    else if (cls === 'best-move') comment = `Melhor lance: coincide com a primeira escolha do motor. ${mudou}`;
    else if (cls === 'excellent') comment = `Excelente. Praticamente equivalente à primeira escolha do motor${outro ? ' (' + outro + ')' : ''}, com diferença de ${_num(loss)}.`;
    else if (cls === 'good') comment = `Boa jogada, com uma opção um pouco melhor disponível (diferença de ${_num(loss)}).${melhor}`;
    else if (cls === 'inaccuracy') comment = `Imprecisão: custou ${_num(loss)} em relação ao melhor lance. ${mudou}${melhor}`;
    else if (cls === 'mistake') comment = `Erro: custou ${_num(loss)} em relação ao melhor lance. ${mudou}${melhor}`;
    else if (cls === 'miss') {
      const tinhaMate = (move.bestEval ?? 0) >= 29000;
      comment = `Chance perdida. ${tinhaMate ? `Havia mate em ${mateEm(move.bestEval)}` : 'Havia uma vantagem decisiva'}${outro ? ' com ' + outro : ''}; depois do lance, ${depois}.`;
    }
    else if (cls === 'blunder') {
      const causa = mateContra ? `O adversário passa a ter mate em ${mateEm(move.evalAfter)}.`
        : (move.immediateCaptureValue ?? 0) >= 300 ? `Na resposta, o adversário ganha ${_material(move.immediateCaptureValue)}.` : '';
      comment = `Gafe: custou ${_num(loss)} em relação ao melhor lance. ${mudou} ${causa}${melhor}`.replace(/\s+/g, ' ').trim();
    }
    else comment = 'Este lance ainda está sendo analisado.';

    if (mateContra) flags.push({ text: 'Permite mate', type: 'danger' });
    else if (cls === 'blunder' && (move.immediateCaptureValue ?? 0) >= 300) flags.push({ text: 'Perde material', type: 'danger' });
    const pv = move.multiPVEvals;
    if (pv && pv.length >= 2 && pv[0] != null && pv[1] != null && Math.abs(pv[0] - pv[1]) > 200 && Math.abs(move.evalBefore ?? 0) < 29000)
      flags.push({ text: 'Só havia uma jogada boa', type: 'info' });
    if (Math.abs(move.evalBefore ?? 0) > 700 && Math.abs(move.evalBefore) < 29000) flags.push({ text: 'Posição já decidida', type: 'info' });
    return { comment, flags, loss };
  }

  return {
    calcAccuracy, calcPhaseAccuracy, findCriticalMoment,
    findBiggestBlunder, estimateRating, playerProfile,
    chartInsights, suggestions, dna, moveInsight, detectPatterns,
    keyMoments, distribution, headline, moveLoss, moveLabel, describeEval, pct, NOMES
  };
})();

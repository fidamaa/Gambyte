/* ==============================================================
   MODULE: pro-tools.js
   Recursos de exportação do Gambyte Pro, construídos em cima do
   resultado que o AnalysisEngine já produz (não refaz nem altera
   nenhuma análise):
     - PGN anotado: avaliação de cada lance no formato [%eval],
       sinais ?! ? ?? ! !! e o melhor lance nos erros. Abre em
       Lichess, ChessBase, Scid e outros programas.
     - Relatório de estudo: resumo em texto da partida, com os
       momentos para revisar e um roteiro de estudo.
   Também expõe bestSan(), usado pelo painel de insights para mostrar
   o melhor lance em notação legível (Nf3) em vez de UCI (g1f3).
   Depende de: pgn-parser.js, move-classifier.js, insights-engine.js,
               auth-system.js, auth-ui.js
   ============================================================== */
const ProTools = (() => {
  let game = null;       // parsedGame da análise atual (headers, moves, fensBefore, movesData)
  let complete = false;  // a análise desta partida já terminou?
  let profMax = 0;       // maior profundidade usada nesta análise

  const NAG = { brilliant: '!!', great: '!', inaccuracy: '?!', mistake: '?', miss: '?', blunder: '??' };
  const ERROS = ['inaccuracy', 'mistake', 'miss', 'blunder'];

  function setGame(parsedGame) { game = parsedGame; complete = false; profMax = 0; }
  function markComplete(profundidade) { complete = true; profMax = profundidade || 0; }

  /** Melhor lance do motor em SAN, a partir da posição anterior ao lance. */
  function bestSan(m) {
    if (!m || !m.bestMoveUCI) return '—';
    try {
      const fen = game && game.fensBefore && game.fensBefore[m.index];
      if (!fen) return m.bestMoveUCI;
      return PGNParser.uciToSan(PGNParser.fenToBoard(fen), m.bestMoveUCI) || m.bestMoveUCI;
    } catch (e) { return m.bestMoveUCI; }
  }

  // Avaliação do ponto de vista das brancas, como o padrão [%eval] exige.
  // (evalAfter é guardado na perspectiva de quem jogou; mate = 30000 − N.)
  function evalTag(m) {
    if (m.evalAfter == null) return '';
    const v = m.color === 'white' ? m.evalAfter : -m.evalAfter;
    if (Math.abs(v) >= 29000) return `[%eval #${v > 0 ? '' : '-'}${Math.max(1, 30000 - Math.abs(v))}]`;
    return `[%eval ${(v / 100).toFixed(2)}]`;
  }

  function clamp(v) { return Math.abs(v) >= 29000 ? (v > 0 ? 900 : -900) : Math.max(-900, Math.min(900, v)); }
  function perda(m) {
    if (m.bestEval == null || m.evalAfter == null) return 0;
    return Math.max(0, clamp(m.bestEval) - clamp(m.evalAfter));
  }

  function numero(i) { return Math.floor(i / 2) + 1; }
  function rotulo(i, san) { return `${numero(i)}${i % 2 === 0 ? '.' : '...'} ${san}`; }

  function buildAnnotatedPGN() {
    const h = Object.assign({}, game.headers || {});
    const md = game.movesData || [];
    const ordem = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    const padrao = { Event: 'Análise Gambyte', Site: 'gambyte.com.br', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), Round: '-', White: 'Brancas', Black: 'Pretas', Result: '*' };
    let out = ordem.map(k => `[${k} "${(h[k] || padrao[k]).replace(/"/g, "'")}"]`).join('\n') + '\n';
    for (const k of Object.keys(h)) if (!ordem.includes(k) && k !== 'Annotator') out += `[${k} "${String(h[k]).replace(/"/g, "'")}"]\n`;
    out += `[Annotator "Gambyte, Stockfish 18"]\n\n`;

    const partes = [];
    let comentarioAntes = false;
    game.moves.forEach((san, i) => {
      const m = md[i] || {};
      const limpo = san.replace(/[!?]+$/, '');
      let prefixo = '';
      if (i % 2 === 0) prefixo = `${numero(i)}. `;
      else if (comentarioAntes) prefixo = `${numero(i)}... `;
      let texto = prefixo + limpo + (NAG[m.classification] || '');
      const coment = [evalTag(m)];
      const nome = MoveClassifier.LABELS[m.classification];
      if (nome && (ERROS.includes(m.classification) || m.classification === 'brilliant' || m.classification === 'great')) {
        let frase = nome + '.';
        if (ERROS.includes(m.classification) && m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI) frase += ` Melhor: ${bestSan(m)}.`;
        coment.push(frase);
      }
      const c = coment.filter(Boolean).join(' ');
      if (c) texto += ` {${c}}`;
      comentarioAntes = !!c;
      partes.push(texto);
    });
    partes.push(h.Result || '*');

    // quebra de linha a cada ~80 colunas, como recomenda o padrão PGN
    let linha = '';
    for (const p of partes) {
      if ((linha + ' ' + p).length > 80 && linha) { out += linha + '\n'; linha = p; }
      else linha = linha ? linha + ' ' + p : p;
    }
    return out + linha + '\n';
  }

  function buildReport() {
    const h = game.headers || {};
    const md = game.movesData || [];
    const branco = h.White || 'Brancas', preto = h.Black || 'Pretas';
    const L = [];
    const linha = '─'.repeat(56);
    L.push('RELATÓRIO DE ESTUDO — GAMBYTE', linha);
    L.push(`${branco} x ${preto}${h.Result ? '  (' + h.Result + ')' : ''}`);
    if (h.Date || h.Event) L.push([h.Event, h.Date].filter(Boolean).join(' · '));
    const eco = (document.getElementById('opening-eco') || {}).textContent || '';
    const abertura = (document.getElementById('opening-name') || {}).textContent || '';
    if (abertura && !/Detectando/.test(abertura)) L.push(`Abertura: ${abertura}${eco && eco !== '—' ? ' (' + eco + ')' : ''}`);
    L.push(`Motor: Stockfish 18${profMax ? ' · profundidade até ' + profMax : ''} · ${game.moves.length} meios-lances`, '');

    L.push('RESUMO POR JOGADOR', linha);
    for (const [cor, nome, isW] of [['white', branco, true], ['black', preto, false]]) {
      const st = MoveClassifier.computeStats(md, isW);
      const fases = InsightsEngine.calcPhaseAccuracy(md, cor);
      const conta = c => md.filter(m => m.color === cor && m.classification === c).length;
      const f = v => (v == null ? '—' : v + '%');
      L.push(`${isW ? 'Brancas' : 'Pretas'}: ${nome}`);
      L.push(`  Precisão ${InsightsEngine.calcAccuracy(md, cor)}%  ·  ACPL ${Math.round(st.acpl)}`);
      L.push(`  Por fase: abertura ${f(fases.opening)} · meio-jogo ${f(fases.midgame)} · final ${f(fases.endgame)}`);
      L.push(`  Imprecisões ${conta('inaccuracy')} · Erros ${conta('mistake')} · Chances perdidas ${conta('miss')} · Gafes ${conta('blunder')}`);
      const destaques = conta('brilliant') + conta('great');
      if (destaques) L.push(`  Lances de destaque (brilhante/ótimo): ${destaques}`);
      L.push('');
    }

    L.push('MOMENTOS PARA REVISAR', linha);
    const piores = md.filter(m => ERROS.includes(m.classification)).map(m => ({ m, p: perda(m) }))
      .sort((a, b) => b.p - a.p).slice(0, 6).sort((a, b) => a.m.index - b.m.index);
    if (!piores.length) L.push('Nenhum erro relevante encontrado nesta partida.');
    piores.forEach(({ m, p }, n) => {
      const quem = m.color === 'white' ? 'Brancas' : 'Pretas';
      L.push(`${n + 1}. ${rotulo(m.index, m.san)}  (${quem}) — ${MoveClassifier.LABELS[m.classification]}, perda de ${(p / 100).toFixed(2)}`);
      if (m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI) L.push(`   Melhor lance: ${bestSan(m)}`);
      L.push('   Por que joguei isso? ______________________________');
    });
    L.push('');

    L.push('SUGESTÕES', linha);
    for (const [cor, nome] of [['white', 'Brancas'], ['black', 'Pretas']]) {
      L.push(nome + ':');
      InsightsEngine.suggestions(md, cor).forEach(s => L.push('  - ' + s.text));
    }
    L.push('');

    L.push('ROTEIRO DE ESTUDO', linha);
    L.push('1. Para cada momento acima, monte a posição e tente achar o melhor lance antes de olhar a resposta.');
    L.push('2. Dê um nome à causa do erro: não vi, calculei errado, não tinha plano, não conhecia a posição, relógio.');
    L.push('3. Escreva uma regra de uma frase que você possa aplicar na próxima partida.');
    L.push('4. Volte a estas posições daqui a uma semana, sem consultar a análise.');
    L.push('', 'Método completo: https://gambyte.com.br/aprender/como-estudar-suas-partidas');
    L.push('Gerado em gambyte.com.br. As avaliações são estimativas do motor e dependem da profundidade usada.');
    return L.join('\n') + '\n';
  }

  function nomeArquivo(sufixo) {
    const h = (game && game.headers) || {};
    const limpa = s => String(s || '').normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    return `${limpa(h.White) || 'brancas'}_x_${limpa(h.Black) || 'pretas'}_${sufixo}`;
  }

  function baixar(texto, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Confere plano e estado da análise antes de exportar; avisa o motivo quando não dá. */
  function podeExportar() {
    if (!AuthSystem.isPremium()) {
      AuthUI.showToast('PGN anotado e relatório de estudo fazem parte do Gambyte Pro.', 'error');
      AuthUI.openPremiumPage();
      return false;
    }
    if (!game || !game.movesData || !game.movesData.length) {
      AuthUI.showToast('Analise uma partida primeiro.', 'error');
      return false;
    }
    if (!complete) {
      AuthUI.showToast('Aguarde a análise terminar para exportar as avaliações finais.', 'error');
      return false;
    }
    return true;
  }

  function init() {
    const menu = document.getElementById('pgn-menu');
    const liga = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => { if (menu) menu.hidden = true; fn(); });
    };
    liga('pgn-menu-annotated', () => { if (podeExportar()) baixar(buildAnnotatedPGN(), nomeArquivo('anotado.pgn')); });
    liga('pgn-menu-report', () => { if (podeExportar()) baixar(buildReport(), nomeArquivo('relatorio.txt')); });
    liga('pgn-menu-report-copy', async () => {
      if (!podeExportar()) return;
      try { await navigator.clipboard.writeText(buildReport()); AuthUI.showToast('Relatório copiado.', 'success'); }
      catch (e) { AuthUI.showToast('Não foi possível copiar. Use a opção de baixar.', 'error'); }
    });
  }

  return { init, setGame, markComplete, bestSan, buildAnnotatedPGN, buildReport, getGame: () => game };
})();

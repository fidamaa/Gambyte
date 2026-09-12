/* ==============================================================
   MODULE: free-play.js
   Allows moving pieces freely, with live engine eval.
   Uses PGNParser.applyMove for move validation.

   Modelo simples de navegação (uma única linha + índice, como o
   histórico de um navegador):
     - "Voltar"/"Avançar" só movem o ponteiro — NUNCA apagam nada.
     - Jogar de novo o MESMO lance que já vinha depois do ponteiro
       simplesmente avança (sem perder nada à frente).
     - Jogar um lance DIFERENTE enquanto o ponteiro está atrás da ponta
       da linha DESCARTA tudo que vinha depois e começa uma linha nova
       a partir daí — essa é a "ramificação": ela só existe a partir do
       momento em que o lance diferente é jogado, e substitui de vez o
       que havia antes (não fica um passado alternativo pra escolher —
       simples assim, de propósito).

   Depende de: pgn-parser.js, board-ui.js, arrow-system.js,
               stockfish-manager.js, engine-suggestion.js,
               evaluation-bar.js, move-classifier.js, analysis-engine.js,
               opening-detector.js
   ============================================================== */
const FreePlay = (() => {
  let active        = false;
  let selectedSq    = null;
  let legalTargets  = [];
  let evalAbort     = null;
  let onBranchCb    = null;   // chamado sempre que a linha muda (lance, navegação, reclassificação)
  let _pgnHeaders   = {};     // from the loaded game
  let _session      = 0;      // incrementado a cada start()/stop() — invalida callbacks assíncronos antigos

  // ── Linha única de lances a partir da posição inicial ────────
  // fens[0] é a posição inicial; fens[i+1] é a posição depois de sans[i].
  let fens       = [];
  let sans       = [];
  let ucis       = [];
  let movesData  = [];   // paralelo a sans — classificação de cada lance
  let idx        = -1;   // ponteiro atual: -1 = posição inicial, k = depois de sans[k]
  let currentFEN = null; // sempre igual a fens[idx+1] — mantido à parte por conveniência

  // Último lance da partida original mantido antes desta linha começar
  // (idx=-1 = nenhum, ou seja, a linha começa do zero).
  let _baseCtx = { idx: -1, moves: [], movesData: [] };

  // ── Público: quantos lances "Brilhante"/livro já apareceram ANTES do
  // índice dado nesta linha — usado pra classificar corretamente mesmo
  // depois de uma ramificação substituir o que vinha antes.
  function _brilliantsBefore(uptoIdx) {
    let count = 0;
    for (let i = 0; i < uptoIdx; i++) if (movesData[i] && movesData[i].classification === 'brilliant') count++;
    return count;
  }
  function _wasOutOfBookBefore(uptoIdx) {
    for (let i = 0; i < uptoIdx; i++) if (movesData[i] && movesData[i].isBook === false) return true;
    return false;
  }

  // ── Public API ─────────────────────────────────────────────
  // baseCtx (opcional): { idx, moves, movesData } — último lance da
  // partida original mantido antes desta linha começar (idx=-1 = nenhum).
  //
  // start() cria uma linha NOVA do zero. Se o jogador só quer sair
  // temporariamente e voltar depois sem perder nada, use pause()/resume()
  // — start() é só para a primeira vez, ou depois de um stop() de verdade
  // (nova partida carregada, "Limpar").
  function start(startFEN, headers, baseCtx, onBranchUpdate) {
    console.log(`[DEBUG] 🎮 FreePlay.start — FEN: ${(startFEN||'').slice(0,40)}…`);
    _session++;
    active     = true;
    const fen  = startFEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    fens = [fen]; sans = []; ucis = []; movesData = []; idx = -1;
    currentFEN  = fen;
    selectedSq = null;
    legalTargets = [];
    _pgnHeaders  = headers || {};
    onBranchCb = onBranchUpdate || null;
    _baseCtx = baseCtx || { idx: -1, moves: [], movesData: [] };

    document.getElementById('board-canvas').classList.add('free-play');
    document.getElementById('free-play-bar').classList.add('visible');
    _updateTurnLabel();
    _requestEval();
    if (onBranchCb) onBranchCb();
    return true;
  }

  // Existe uma linha viva (ativa ou pausada) que pode ser retomada?
  function hasTree() { return fens.length > 0; }

  // Sai da edição SEM apagar nada — o tabuleiro, a lista de lances e o
  // gráfico continuam mostrando exatamente onde o jogador parou. Clicar
  // em "Modo Livre" de novo retoma a mesma linha com resume().
  function pause() {
    console.log(`[DEBUG] 🎮 FreePlay.pause — mantém a linha (${sans.length} lance(s))`);
    active = false;
    if (evalAbort) { evalAbort(); evalAbort = null; }
    selectedSq = null; legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
    document.getElementById('free-play-bar').classList.remove('visible');
  }

  // Retoma uma linha pausada exatamente de onde parou.
  function resume(onBranchUpdate) {
    if (!hasTree()) return false;
    console.log(`[DEBUG] 🎮 FreePlay.resume`);
    active = true;
    onBranchCb = onBranchUpdate || null;
    document.getElementById('board-canvas').classList.add('free-play');
    document.getElementById('free-play-bar').classList.add('visible');
    _updateTurnLabel();
    _requestEval();
    if (onBranchCb) onBranchCb();
    return true;
  }

  // Descarta a linha de verdade — só quando uma partida realmente nova é
  // carregada (Analisar Partida) ou o usuário pede pra "Limpar" tudo.
  function stop() {
    console.log(`[DEBUG] 🎮 FreePlay.stop — descarta a linha`);
    _session++; // invalida qualquer classificação/eval assíncrona pendente desta sessão
    active = false;
    if (evalAbort) { evalAbort(); evalAbort = null; }
    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
    document.getElementById('free-play-bar').classList.remove('visible');
    onBranchCb = null;
    fens = []; sans = []; ucis = []; movesData = []; idx = -1;
  }

  function isActive() { return active; }

  // ── Leitura da linha atual (para a UI renderizar) ───────────
  // path: lances do início até o ponteiro atual (idx). Sem irmãos, sem
  // variantes escondidas — só a linha como ela é agora.
  function getBranchView() {
    const path = [];
    for (let i = 0; i <= idx; i++) {
      path.push({ index: i, san: sans[i], isCurrent: i === idx, moveData: movesData[i] });
    }
    return { baseIdx: _baseCtx.idx, path };
  }

  function canGoBack()    { return idx > -1; }
  function canGoForward() { return idx < sans.length - 1; }

  // Volta ao lance anterior SEM apagar nada — pode avançar de novo depois.
  function goBack() {
    if (!canGoBack()) return;
    idx--;
    currentFEN = fens[idx + 1];
    _afterNavigate(null, null);
  }

  // Avança pelo lance seguinte que já existia nesta linha.
  function goForward() {
    if (!canGoForward()) return;
    idx++;
    currentFEN = fens[idx + 1];
    _afterNavigate(null, null);
  }

  // Pula direto para qualquer ponto já jogado nesta linha (ex.: clique
  // num lance da lista). Não avança além da ponta atual.
  function gotoIndex(target) {
    if (target < -1 || target >= sans.length) return;
    idx = target;
    currentFEN = fens[idx + 1];
    _afterNavigate(null, null);
  }

  function _afterNavigate(fromSq, toSq) {
    selectedSq = null; legalTargets = [];
    _updateTurnLabel();
    _requestEval();
    _redraw(fromSq, toSq);
    if (onBranchCb) onBranchCb();
  }

  // Mantido por compatibilidade com o botão "Voltar" já existente.
  function undoMove() { goBack(); }

  // ── Click handler — called from UIController ───────────────
  function handleClick(sq) {
    if (!active || !sq) return;

    const state = PGNParser.fenToBoard(currentFEN);
    if (!state) return;

    const piece = _pieceAt(state.board, sq);
    const isWhiteTurn = state.turn === 'w';

    if (selectedSq) {
      // Try to make the move
      if (legalTargets.includes(sq)) {
        _makeMove(selectedSq, sq, state);
        return;
      }
      // Clicked on own piece — reselect
      if (piece && ((isWhiteTurn && piece === piece.toUpperCase()) ||
                    (!isWhiteTurn && piece === piece.toLowerCase()))) {
        _select(sq, state, isWhiteTurn);
        return;
      }
      // Clicked elsewhere — deselect
      selectedSq = null; legalTargets = [];
      _redraw(null, null);
    } else {
      // Select if own piece
      if (piece && ((isWhiteTurn && piece === piece.toUpperCase()) ||
                    (!isWhiteTurn && piece === piece.toLowerCase()))) {
        _select(sq, state, isWhiteTurn);
      }
    }
  }

  function _pieceAt(board, sq) {
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1]);
    return board[row][col];
  }

  function _select(sq, state, isWhiteTurn) {
    selectedSq   = sq;
    const rawTargets = _getLegalTargets(sq, state, isWhiteTurn);
    legalTargets = _filterKingTargets(rawTargets, sq, state);
    document.getElementById('board-canvas').classList.add('piece-selected');
    _redraw(null, null);
  }

  function _getLegalTargets(fromSq, state, isWhiteTurn) {
    const piece = _pieceAt(state.board, fromSq);
    if (!piece) return [];
    const pieceLetter = piece.toUpperCase();

    // ── Caso especial: REI ────────────────────────────────────────
    // Calculamos manualmente para ter controle total sobre o roque
    if (pieceLetter === 'K') {
      const targets = [];
      const files = 'abcdefgh';
      const col = fromSq.charCodeAt(0) - 97;
      const row = 8 - parseInt(fromSq[1]);

      // Movimentos normais do rei (1 casa em qualquer direção)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = row + dr, nc = col + dc;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          const toSq = files[nc] + (8 - nr);
          const dest = _pieceAt(state.board, toSq);
          // Não pode ir para casa ocupada por peça própria
          const isOwn = dest && (isWhiteTurn ? dest === dest.toUpperCase() : dest === dest.toLowerCase());
          if (isOwn) continue;
          targets.push(toSq);
        }
      }

      // Roque — apenas mostrar g1/c1 (ou g8/c8), NUNCA h1/a1/h8/a8
      const backRank = isWhiteTurn ? '1' : '8';
      const castling = state.castling || '-';

      // Kingside: e→g (2 casas direita), requer f e g vazios e direito K/k
      const ksRight = isWhiteTurn ? 'K' : 'k';
      if (castling.includes(ksRight)) {
        const f = 'f' + backRank, g = 'g' + backRank;
        if (!_pieceAt(state.board, f) && !_pieceAt(state.board, g)) {
          targets.push(g); // só g1/g8 — o destino do roque
        }
      }

      // Queenside: e→c (2 casas esquerda), requer b, c, d vazios e direito Q/q
      const qsRight = isWhiteTurn ? 'Q' : 'q';
      if (castling.includes(qsRight)) {
        const b = 'b' + backRank, c = 'c' + backRank, d = 'd' + backRank;
        if (!_pieceAt(state.board, b) && !_pieceAt(state.board, c) && !_pieceAt(state.board, d)) {
          targets.push(c); // só c1/c8 — o destino do roque
        }
      }

      return targets;
    }

    // ── Todas as outras peças ─────────────────────────────────────
    const targets = [];
    const files = 'abcdefgh';
    for (let r = 1; r <= 8; r++) {
      for (let f = 0; f < 8; f++) {
        const toSq = files[f] + r;
        if (toSq === fromSq) continue;
        // Pular casas com peça própria
        const dest = _pieceAt(state.board, toSq);
        const isOwn = dest && (isWhiteTurn ? dest === dest.toUpperCase() : dest === dest.toLowerCase());
        if (isOwn) continue;
        const newState = PGNParser.applyMoveUCI(state, fromSq + toSq);
        if (newState) targets.push(toSq);
      }
    }
    return targets;
  }

  // Rei já tratado diretamente acima — este filter é no-op para o rei
  function _filterKingTargets(targets, fromSq, state) {
    return targets; // lógica do rei já foi feita em _getLegalTargets
  }

  function _makeMove(fromSq, toSq, state) {
    const uciMove = fromSq + toSq;
    // Handle promotion (default to queen)
    const piece = _pieceAt(state.board, fromSq);
    const isPromo = (piece === 'P' && toSq[1] === '8') || (piece === 'p' && toSq[1] === '1');
    const uci = isPromo ? uciMove + 'q' : uciMove;

    const newState = PGNParser.applyMoveUCI(state, uci);
    if (!newState) { selectedSq = null; legalTargets = []; _redraw(null, null); return; }

    const newFEN    = PGNParser.boardToFen(newState);
    const san       = PGNParser.uciToSan(state, uci) || uci;
    const fenBefore = currentFEN;
    const isWhite   = state.turn === 'w';
    const nextIdx   = idx + 1;

    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('piece-selected');

    // O mesmo lance que já vinha em seguida nesta linha — só avança,
    // sem descartar nada (não é uma ramificação de verdade).
    if (nextIdx < ucis.length && ucis[nextIdx] === uci) {
      idx = nextIdx;
      currentFEN = fens[idx + 1];
      _updateTurnLabel();
      _requestEval();
      _redraw(fromSq, toSq);
      if (onBranchCb) onBranchCb();
      return;
    }

    // Lance diferente (ou já estava na ponta): descarta tudo que vinha
    // depois do ponteiro e começa uma linha nova a partir daqui — essa é
    // a ramificação, e ela substitui de vez o que havia antes.
    sans.length      = nextIdx;
    ucis.length      = nextIdx;
    movesData.length = nextIdx;
    fens.length      = nextIdx + 1;

    const newMoveData = {
      index: _baseCtx.idx + 1 + nextIdx,
      san, color: isWhite ? 'white' : 'black',
      evalBefore: null, evalAfter: null, bestEval: null, bestMoveUCI: null,
      playedMoveUCI: uci, multiPVEvals: null, mateNs: null,
      classification: null, isBook: false, isCheckmate: san.includes('#')
    };
    sans.push(san);
    ucis.push(uci);
    fens.push(newFEN);
    movesData.push(newMoveData);
    idx = nextIdx;
    currentFEN = newFEN;

    _updateTurnLabel();
    _requestEval();
    _redraw(fromSq, toSq);
    if (onBranchCb) onBranchCb();
    _classifyMove(nextIdx, newMoveData, fenBefore, newFEN, san, uci, isWhite);
  }

  // ── Classificação em tempo real do lance ─────────────────────
  // Duas passadas: rápida (feedback quase instantâneo) e refinada logo
  // depois (pode mudar a classificação, igual à revisão de PGN completa).
  const BRANCH_QUICK_DEPTH   = 8;
  const BRANCH_REFINE_FREE   = 14;
  const BRANCH_REFINE_PRO    = 18;

  async function _classifyMove(i, entry, fenBefore, fenAfter, san, playedMoveUCI, isWhite) {
    const mySession = _session;
    // `entry` é o objeto exato criado em _makeMove — se o índice i tiver
    // sido reaproveitado por uma ramificação nova (o array foi truncado e
    // recriado), movesData[i] já não é mais este objeto, e paramos aqui.
    const stillCurrent = () => mySession === _session && movesData[i] === entry;

    const isCheckmateMove = san.includes('#');
    const inBook = !_wasOutOfBookBefore(i) && OpeningDetector.isBookPosition(fenAfter);

    if (inBook) {
      entry.isBook = true;
      entry.classification = 'book';
      if (stillCurrent() && onBranchCb) onBranchCb();
      return;
    }
    entry.isBook = false;

    const isPro = typeof AuthSystem !== 'undefined' && AuthSystem.isPremium();
    const depths = [BRANCH_QUICK_DEPTH, isPro ? BRANCH_REFINE_PRO : BRANCH_REFINE_FREE];

    for (const depth of depths) {
      if (!stillCurrent()) return;

      const [beforeRes, afterRes] = await Promise.all([
        StockfishManager.analyzePosition(fenBefore, depth, 3),
        StockfishManager.analyzePosition(fenAfter, depth, 3)
      ]);

      if (!stillCurrent()) return;

      const evalBefore = beforeRes.evals[0] ?? 0;
      const evalAfter  = isCheckmateMove ? 29999 : -(afterRes.evals[0] ?? 0);
      const bestEval    = evalBefore;

      const immediateCaptureValue = AnalysisEngine.computeImmediateCaptureValue(fenAfter, afterRes.bestMove);
      const opponentMateN    = afterRes.mateNs ? afterRes.mateNs[0] : null;
      const opponentGetsMate = opponentMateN != null && opponentMateN > 0;
      const mateForMover     = beforeRes.mateNs ? beforeRes.mateNs[0] : null;
      const capturedByMoverValue = playedMoveUCI
        ? AnalysisEngine.pieceValueAtSquare(fenBefore, playedMoveUCI.slice(2, 4))
        : 0;
      const sacrificeValue = immediateCaptureValue - capturedByMoverValue;

      const likelyStalemateOrDraw = (
        evalBefore > 150 && Math.abs(evalAfter) < 30 &&
        !san.includes('+') && !san.includes('#')
      );

      const cls = MoveClassifier.classify({
        san, evalBefore, evalAfter, bestEval,
        bestMoveUCI:   beforeRes.bestMove,
        playedMoveUCI: playedMoveUCI,
        multiPVEvals:  beforeRes.evals,
        isBook: false, isWhite,
        brilliantsUsed: _brilliantsBefore(i),
        moveIndex: i,
        isStalemate: likelyStalemateOrDraw,
        isCheckmate: isCheckmateMove,
        immediateCaptureValue, sacrificeValue,
        mateForMover, opponentGetsMate,
        depth
      });

      entry.evalBefore  = evalBefore;
      entry.evalAfter   = evalAfter;
      entry.bestEval    = bestEval;
      entry.bestMoveUCI = beforeRes.bestMove;
      entry.multiPVEvals = beforeRes.evals;
      entry.mateNs      = beforeRes.mateNs;
      entry.immediateCaptureValue = immediateCaptureValue;
      entry.classification = cls;
      if (stillCurrent() && onBranchCb) onBranchCb();
    }
  }

  // fromSq/toSq (opcionais): quando informados, anima o lance recém-feito
  // com a mesma animação tradicional usada na revisão de PGN.
  function _redraw(fromSq, toSq) {
    const state = PGNParser.fenToBoard(currentFEN);
    if (!state) return;
    const board = __fenToBoard8x8(currentFEN);
    BoardUI.renderWithAnim(board, fromSq || null, toSq || null, selectedSq, legalTargets);
    ArrowSystem.redraw();
  }

  function __fenToBoard8x8(fen) {
    const rows = fen.split(' ')[0].split('/');
    const b = [];
    for (const row of rows) {
      const line = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < parseInt(ch); i++) line.push('');
        else line.push(ch);
      }
      b.push(line);
    }
    return b;
  }

  function _updateTurnLabel() {
    const isWhite = currentFEN.split(' ')[1] === 'w';
    document.getElementById('free-play-turn').textContent = isWhite ? 'Vez das brancas' : 'Vez das pretas';
  }

  // Profundidade de análise em tempo real no Modo Livre: usuários Free ficam
  // limitados ao máximo que dá para processar em tempo real; assinantes Pro
  // recebem uma análise mais profunda (mesma barreira usada na revisão de PGN).
  const FREE_EVAL_DEPTH = 12;
  const PRO_EVAL_DEPTH  = 18;

  let _evalTimer = null;
  function _requestEval() {
    if (_evalTimer) clearTimeout(_evalTimer);
    if (evalAbort) { evalAbort(); evalAbort = null; }
    _evalTimer = setTimeout(async () => {
      let aborted = false;
      evalAbort = () => { aborted = true; };
      try {
        const isPro = typeof AuthSystem !== 'undefined' && AuthSystem.isPremium();
        const depth = isPro ? PRO_EVAL_DEPTH : FREE_EVAL_DEPTH;
        const isWhiteTurn = currentFEN.split(' ')[1] === 'w';

        // Atualização progressiva: assim que o motor encontra QUALQUER
        // melhor lance (mesmo em profundidade baixa), a seta e a barra já
        // refletem isso — não esperamos o "go depth" inteiro terminar.
        const applyEval = (cp, bestMove) => {
          // cp já vem codificado em mate como ±(30000-N) — mesma convenção
          // usada no resultado final (ver stockfish-manager.js).
          const cpFromWhite = isWhiteTurn ? cp : -cp;
          const absCpW = Math.abs(cpFromWhite);
          const isMateW = absCpW >= 29000;
          const mateDepthW = isMateW ? Math.max(1, 30000 - absCpW) : 0;
          EvalBar.update(isMateW ? 0 : cpFromWhite, isMateW, isMateW ? (cpFromWhite > 0 ? mateDepthW : -mateDepthW) : 0);
          const display = isMateW
            ? (cpFromWhite > 0 ? `+M${mateDepthW}` : `-M${mateDepthW}`)
            : (cpFromWhite >= 0 ? '+' : '') + (cpFromWhite / 100).toFixed(2);
          document.getElementById('free-play-eval').textContent = display;
          if (bestMove) EngineSuggestion.updateArrow(bestMove);
        };

        const result = await StockfishManager.analyzePosition(currentFEN, depth, 3, [], (partial) => {
          if (aborted) return;
          applyEval(partial.eval, partial.bestMove);
        });
        if (aborted) return;
        applyEval(result.evals[0] ?? 0, result.bestMove);
      } catch(e) { /* aborted or error */ }
    }, 120);
  }

  // ── module: pgn-exporter.js ────────────────────────────────
  function _buildPGN() {
    const moves = [..._baseCtx.moves, ...sans.slice(0, idx + 1)];
    const date  = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    let pgn = `[Event "Free Play"]\n[Date "${date}"]\n[White "${_pgnHeaders.White || '?'}"]\n[Black "${_pgnHeaders.Black || '?'}"]\n[Result "*"]\n\n`;
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
      pgn += moves[i] + ' ';
    }
    pgn += '*';
    return pgn;
  }

  function exportPGN() {
    _downloadText(_buildPGN(), 'free_play.pgn');
  }

  async function copyPGN() {
    try { await navigator.clipboard.writeText(_buildPGN()); return true; }
    catch (e) { return false; }
  }

  function _downloadText(text, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function _redrawPublic() {
    console.log(`[DEBUG] 🎮 FreePlay._redrawPublic — FEN: ${currentFEN ? currentFEN.slice(0,40) : 'null'}…`);
    _redraw();
  }

  return {
    start, stop, pause, resume, hasTree, isActive,
    handleClick, undoMove, exportPGN, copyPGN,
    currentFEN: () => currentFEN, _redrawPublic,
    getBranchView, gotoIndex, goBack, goForward, canGoBack, canGoForward
  };
})();

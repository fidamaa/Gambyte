/* ==============================================================
   MODULE: free-play.js
   Allows moving pieces freely, with live engine eval.
   Uses PGNParser.applyMove for move validation.
   Depende de: pgn-parser.js, board-ui.js, arrow-system.js,
               stockfish-manager.js, engine-suggestion.js,
               evaluation-bar.js
   ============================================================== */
const FreePlay = (() => {
  let active        = false;
  let gameStates    = [];   // stack of { fen, san, board }
  let currentFEN    = null;
  let selectedSq    = null;
  let legalTargets  = [];
  let evalAbort     = null;
  let onEvalCb      = null;
  let onExitCb      = null;
  let _pgnHeaders   = {};   // from the loaded game

  // ── Public API ─────────────────────────────────────────────
  function start(startFEN, headers, onEval, onExit) {
    console.log(`[DEBUG] 🎮 FreePlay.start — FEN: ${(startFEN||'').slice(0,40)}…`);
    active     = true;
    currentFEN = startFEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    gameStates = [{ fen: currentFEN, san: null }];
    selectedSq = null;
    legalTargets = [];
    _pgnHeaders  = headers || {};
    onEvalCb  = onEval;
    onExitCb  = onExit;

    document.getElementById('board-canvas').classList.add('free-play');
    document.getElementById('free-play-bar').classList.add('visible');
    _updateTurnLabel();
    _requestEval();
    return true;
  }

  function stop() {
    console.log(`[DEBUG] 🎮 FreePlay.stop`);
    active = false;
    if (evalAbort) { evalAbort(); evalAbort = null; }
    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
    document.getElementById('free-play-bar').classList.remove('visible');
    if (onExitCb) onExitCb();
  }

  function isActive() { return active; }
  function currentState() { return gameStates[gameStates.length - 1]; }

  function undoMove() {
    if (gameStates.length <= 1) return;
    gameStates.pop();
    currentFEN = gameStates[gameStates.length - 1].fen;
    selectedSq = null; legalTargets = [];
    _updateTurnLabel();
    _requestEval();
    _redraw();
  }

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
      _redraw();
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
    _redraw();
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
    if (!newState) { selectedSq = null; legalTargets = []; _redraw(); return; }

    const newFEN   = PGNParser.boardToFen(newState);
    const san      = PGNParser.uciToSan(state, uci) || uci;

    currentFEN = newFEN;
    gameStates.push({ fen: newFEN, san });
    selectedSq   = null;
    legalTargets = [];

    document.getElementById('board-canvas').classList.remove('piece-selected');
    _updateTurnLabel();
    _requestEval();
    _redraw();
  }

  function _redraw() {
    const state = PGNParser.fenToBoard(currentFEN);
    if (!state) return;
    const board = __fenToBoard8x8(currentFEN);
    BoardUI.render(board, null, null, selectedSq, legalTargets);
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

  let _evalTimer = null;
  function _requestEval() {
    if (_evalTimer) clearTimeout(_evalTimer);
    if (evalAbort) { evalAbort(); evalAbort = null; }
    _evalTimer = setTimeout(async () => {
      let aborted = false;
      evalAbort = () => { aborted = true; };
      try {
        const result = await StockfishManager.analyzePosition(currentFEN, 12);
        if (aborted) return;
        const cp = result.evals[0] ?? 0;
        // FIX 2: detectar mate com profundidade real
        const abscp = Math.abs(cp);
        const isMate = abscp >= 29000;
        // result is from side-to-move perspective; convert to white's
        const isWhiteTurn = currentFEN.split(' ')[1] === 'w';
        const cpFromWhite = isWhiteTurn ? cp : -cp;
        const absCpW = Math.abs(cpFromWhite);
        const isMateW = absCpW >= 29000;
        const mateDepthW = isMateW ? Math.max(1, 30000 - absCpW) : 0;
        EvalBar.update(isMateW ? 0 : cpFromWhite, isMateW, isMateW ? (cpFromWhite > 0 ? mateDepthW : -mateDepthW) : 0);
        // Display in free-play bar
        const display = isMateW
          ? (cpFromWhite > 0 ? `+M${mateDepthW}` : `-M${mateDepthW}`)
          : (cpFromWhite >= 0 ? '+' : '') + (cpFromWhite / 100).toFixed(2);
        document.getElementById('free-play-eval').textContent = display;
        // Engine arrow
        if (result.bestMove) EngineSuggestion.updateArrow(result.bestMove);
        if (onEvalCb) onEvalCb(result);
      } catch(e) { /* aborted or error */ }
    }, 120);
  }

  // ── module: pgn-exporter.js ────────────────────────────────
  function exportPGN() {
    const moves = gameStates.slice(1).map(s => s.san).filter(Boolean);
    const date  = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    let pgn = `[Event "Free Play"]\n[Date "${date}"]\n[White "${_pgnHeaders.White || '?'}"]\n[Black "${_pgnHeaders.Black || '?'}"]\n[Result "*"]\n\n`;
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
      pgn += moves[i] + ' ';
    }
    pgn += '*';
    _downloadText(pgn, 'free_play.pgn');
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

  return { start, stop, isActive, handleClick, undoMove, exportPGN, currentFEN: () => currentFEN, _redrawPublic };
})();

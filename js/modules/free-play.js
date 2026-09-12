/* ==============================================================
   MODULE: free-play.js
   Allows moving pieces freely, with live engine eval.
   Uses PGNParser.applyMove for move validation.

   O histórico de lances é uma ÁRVORE (não uma pilha linear): voltar um
   lance ("Voltar") só move o ponteiro da posição atual para o pai —
   NUNCA apaga o nó. Jogar um lance diferente a partir de um ponto
   anterior cria um novo FILHO (uma ramificação) irmão do que já existia
   ali, preservando os dois; isso pode se repetir indefinidamente
   (ramificação de ramificação). Cada nó carrega sua própria classificação
   (calculada uma vez, em tempo real, e cacheada — nunca recalculada só
   por navegar de volta a ele).

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
  let onEvalCb      = null;
  let onExitCb      = null;
  let onBranchCb    = null;   // chamado sempre que a árvore muda (lance, navegação, reclassificação)
  let _pgnHeaders   = {};     // from the loaded game

  // ── Árvore de lances do Modo Livre ───────────────────────────
  let root         = null;    // nó raiz: { id, fen, san:null, uci:null, parent:null, children:[], moveData:null }
  let currentNode  = null;    // nó da posição atual (ponteiro de navegação)
  let currentFEN   = null;    // sempre igual a currentNode.fen — mantido à parte só por conveniência
  let _nodeSeq     = 0;
  let _session     = 0;       // incrementado a cada start()/stop() — invalida callbacks assíncronos antigos

  // Último lance da partida original mantido antes da raiz da árvore
  // começar (idx=-1 = nenhum, ou seja, a árvore começa do zero).
  let _baseCtx = { idx: -1, moves: [], movesData: [] };

  function _newNode(fen, san, uci, parent) {
    return { id: ++_nodeSeq, fen, san, uci, parent, children: [], moveData: null, _activeChildId: null };
  }

  function _depthOf(node) {
    let d = 0, n = node;
    while (n.parent) { d++; n = n.parent; }
    return d;
  }

  // ── Público: quantos lances "Brilhante" já apareceram ANTES deste nó,
  // no CAMINHO específico dele (não globalmente — cada ramificação conta
  // os seus próprios lances, não os de outra linha) ────────────────────
  function _brilliantsOnPathTo(node) {
    let count = 0, n = node.parent;
    while (n) { if (n.moveData && n.moveData.classification === 'brilliant') count++; n = n.parent; }
    return count;
  }

  // Idem para "já saiu do livro" — cada ramificação tem seu próprio
  // histórico de livro, baseado só nos ANCESTRAIS dela.
  function _wasOutOfBookBefore(node) {
    let n = node.parent;
    while (n) { if (n.moveData && n.moveData.isBook === false) return true; n = n.parent; }
    return false;
  }

  // ── Public API ─────────────────────────────────────────────
  // baseCtx (opcional): { idx, moves, movesData } — último lance da
  // partida original mantido antes da árvore começar (idx=-1 = nenhum).
  function start(startFEN, headers, onEval, onExit, baseCtx, onBranchUpdate) {
    console.log(`[DEBUG] 🎮 FreePlay.start — FEN: ${(startFEN||'').slice(0,40)}…`);
    _session++;
    active     = true;
    const fen  = startFEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    root       = _newNode(fen, null, null, null);
    currentNode = root;
    currentFEN  = fen;
    selectedSq = null;
    legalTargets = [];
    _pgnHeaders  = headers || {};
    onEvalCb  = onEval;
    onExitCb  = onExit;
    onBranchCb = onBranchUpdate || null;
    _baseCtx = baseCtx || { idx: -1, moves: [], movesData: [] };

    document.getElementById('board-canvas').classList.add('free-play');
    document.getElementById('free-play-bar').classList.add('visible');
    _updateTurnLabel();
    _requestEval();
    if (onBranchCb) onBranchCb();
    return true;
  }

  function stop() {
    console.log(`[DEBUG] 🎮 FreePlay.stop`);
    _session++; // invalida qualquer classificação/eval assíncrona pendente desta sessão
    active = false;
    if (evalAbort) { evalAbort(); evalAbort = null; }
    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
    document.getElementById('free-play-bar').classList.remove('visible');
    const cb = onExitCb;
    onExitCb = null; onEvalCb = null; onBranchCb = null;
    root = null; currentNode = null;
    if (cb) cb();
  }

  function isActive() { return active; }

  // ── Leitura da árvore atual (para a UI renderizar) ──────────
  // path: lances do caminho raiz → posição atual (o que apareceu antes
  // era chamado de "ramificação"; agora é só "o caminho até aqui" — pode
  // ser a linha original, ou uma ramificação, ou ramificação de ramificação).
  // Cada item traz `siblings`: os outros lances possíveis NAQUELE ponto
  // (irmãos no mesmo pai) — usado pra UI oferecer trocar de variante.
  function getBranchView() {
    if (!currentNode) return { baseIdx: _baseCtx.idx, path: [] };
    const chain = [];
    let n = currentNode;
    while (n && n.parent) { chain.unshift(n); n = n.parent; }
    const path = chain.map(node => ({
      id: node.id,
      san: node.san,
      isCurrent: node.id === currentNode.id,
      moveData: node.moveData,
      siblings: node.parent.children.map(s => ({ id: s.id, san: s.san, active: s.id === node.id }))
    }));
    // Filhos da posição ATUAL (pra quem quiser escolher por qual continuar,
    // em vez de só seguir o último visitado via goForward()).
    const children = currentNode.children.map(c => ({ id: c.id, san: c.san }));
    return { baseIdx: _baseCtx.idx, path, children };
  }

  function canGoBack()    { return !!(currentNode && currentNode.parent); }
  function canGoForward() { return !!(currentNode && currentNode.children.length); }

  // Volta ao lance anterior SEM apagar nada — pode avançar de novo depois.
  function goBack() {
    if (!canGoBack()) return;
    currentNode = currentNode.parent;
    currentFEN  = currentNode.fen;
    _afterNavigate(null, null);
  }

  // Avança pelo filho ativo (o último visitado a partir daqui), ou pelo
  // mais recente se nunca visitou nenhum a partir deste ponto.
  function goForward() {
    if (!canGoForward()) return;
    const cid = currentNode._activeChildId;
    const child = (cid && currentNode.children.find(c => c.id === cid)) ||
                  currentNode.children[currentNode.children.length - 1];
    currentNode = child;
    currentFEN  = currentNode.fen;
    _afterNavigate(null, null);
  }

  // Pula direto para qualquer nó da árvore (ex.: clique numa variante).
  // Marca o caminho raiz→nó como "ativo" pra "Avançar" seguir por ele depois.
  function gotoNode(nodeId) {
    if (!root) return;
    const target = _findNode(root, nodeId);
    if (!target) return;
    let n = target;
    while (n.parent) { n.parent._activeChildId = n.id; n = n.parent; }
    currentNode = target;
    currentFEN  = currentNode.fen;
    _afterNavigate(null, null);
  }

  function _findNode(node, id) {
    if (node.id === id) return node;
    for (const c of node.children) { const f = _findNode(c, id); if (f) return f; }
    return null;
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

    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('piece-selected');

    // Já existe esse exato lance a partir daqui (ex.: o jogador voltou e
    // repetiu o mesmo lance) — só navega pra ele, sem duplicar o nó.
    const existing = currentNode.children.find(c => c.uci === uci);
    if (existing) {
      currentNode._activeChildId = existing.id;
      currentNode = existing;
      currentFEN  = existing.fen;
      _updateTurnLabel();
      _requestEval();
      _redraw(fromSq, toSq);
      if (onBranchCb) onBranchCb();
      return;
    }

    // Lance novo a partir daqui — vira um FILHO (ramificação) do nó atual.
    // Se o nó atual já tinha outro(s) filho(s) (a continuação original ou
    // outra variante já explorada), eles são preservados como irmãos.
    const newNode = _newNode(newFEN, san, uci, currentNode);
    newNode.moveData = {
      index: _baseCtx.idx + _depthOf(newNode),
      san, color: isWhite ? 'white' : 'black',
      evalBefore: null, evalAfter: null, bestEval: null, bestMoveUCI: null,
      playedMoveUCI: uci, multiPVEvals: null, mateNs: null,
      classification: null, isBook: false, isCheckmate: san.includes('#')
    };
    currentNode._activeChildId = newNode.id;
    currentNode.children.push(newNode);
    currentNode = newNode;
    currentFEN  = newFEN;

    _updateTurnLabel();
    _requestEval();
    _redraw(fromSq, toSq);
    if (onBranchCb) onBranchCb();
    _classifyNode(newNode, fenBefore, newFEN, san, uci, isWhite);
  }

  // ── Classificação em tempo real do lance ─────────────────────
  // Duas passadas: rápida (feedback quase instantâneo) e refinada logo
  // depois (pode mudar a classificação, igual à revisão de PGN completa).
  const BRANCH_QUICK_DEPTH   = 8;
  const BRANCH_REFINE_FREE   = 14;
  const BRANCH_REFINE_PRO    = 18;

  async function _classifyNode(node, fenBefore, fenAfter, san, playedMoveUCI, isWhite) {
    const mySession = _session;
    const stillCurrent = () => mySession === _session;

    const isCheckmateMove = san.includes('#');
    const inBook = !_wasOutOfBookBefore(node) && OpeningDetector.isBookPosition(fenAfter);

    if (inBook) {
      node.moveData.isBook = true;
      node.moveData.classification = 'book';
      if (stillCurrent() && onBranchCb) onBranchCb();
      return;
    }
    node.moveData.isBook = false;

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
        brilliantsUsed: _brilliantsOnPathTo(node),
        moveIndex: _depthOf(node),
        isStalemate: likelyStalemateOrDraw,
        isCheckmate: isCheckmateMove,
        immediateCaptureValue, sacrificeValue,
        mateForMover, opponentGetsMate,
        depth
      });

      node.moveData.evalBefore  = evalBefore;
      node.moveData.evalAfter   = evalAfter;
      node.moveData.bestEval    = bestEval;
      node.moveData.bestMoveUCI = beforeRes.bestMove;
      node.moveData.multiPVEvals = beforeRes.evals;
      node.moveData.mateNs      = beforeRes.mateNs;
      node.moveData.immediateCaptureValue = immediateCaptureValue;
      node.moveData.classification = cls;
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
        if (onEvalCb) onEvalCb(result);
      } catch(e) { /* aborted or error */ }
    }, 120);
  }

  // ── module: pgn-exporter.js ────────────────────────────────
  function _buildPGN() {
    const chain = [];
    let n = currentNode;
    while (n && n.parent) { chain.unshift(n); n = n.parent; }
    const moves = [..._baseCtx.moves, ...chain.map(n => n.san)];
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
    start, stop, isActive, handleClick, undoMove, exportPGN, copyPGN,
    currentFEN: () => currentFEN, _redrawPublic,
    getBranchView, gotoNode, goBack, goForward, canGoBack, canGoForward
  };
})();

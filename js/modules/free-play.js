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

  // Fim de jogo na posição atual (xeque-mate/afogamento/empate por regra) —
  // null enquanto a partida segue. Ver _computeGameStatus().
  let _gameStatus = null;

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
    selectedSq = null; legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
  }

  // Retoma uma linha pausada exatamente de onde parou.
  function resume(onBranchUpdate) {
    if (!hasTree()) return false;
    console.log(`[DEBUG] 🎮 FreePlay.resume`);
    active = true;
    onBranchCb = onBranchUpdate || null;
    document.getElementById('board-canvas').classList.add('free-play');
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
    selectedSq   = null;
    legalTargets = [];
    document.getElementById('board-canvas').classList.remove('free-play', 'piece-selected');
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
      path.push({ index: i, san: sans[i], uci: ucis[i], isCurrent: i === idx, moveData: movesData[i] });
    }
    return { baseIdx: _baseCtx.idx, path };
  }

  function canGoBack()    { return idx > -1; }
  function canGoForward() { return idx < sans.length - 1; }

  // Volta ao lance anterior SEM apagar nada — pode avançar de novo depois.
  function goBack() {
    if (!canGoBack()) return;
    const desfeito = ucis[idx];
    idx--;
    currentFEN = fens[idx + 1];
    // Anima o lance sendo desfeito: a peça volta e a capturada reaparece.
    _afterNavigate(desfeito ? desfeito.slice(0, 2) : null, desfeito ? desfeito.slice(2, 4) : null, null, null, true);
  }

  // Avança pelo lance seguinte que já existia nesta linha.
  function goForward() {
    if (!canGoForward()) return;
    idx++;
    currentFEN = fens[idx + 1];
    const u = ucis[idx];
    _afterNavigate(u ? u.slice(0, 2) : null, u ? u.slice(2, 4) : null, u, fens[idx]);
  }

  // Pula direto para qualquer ponto já jogado nesta linha (ex.: clique
  // num lance da lista). Não avança além da ponta atual.
  function gotoIndex(target) {
    if (target < -1 || target >= sans.length) return;
    idx = target;
    currentFEN = fens[idx + 1];
    _afterNavigate(null, null);
  }

  function _afterNavigate(fromSq, toSq, played, fenBefore, reverso = false) {
    selectedSq = null; legalTargets = [];
    _updateTurnLabel();
    _requestEval(played, fenBefore);
    _redraw(fromSq, toSq, true, reverso);
    if (onBranchCb) onBranchCb();
  }

  // Mantido por compatibilidade com o botão "Voltar" já existente.
  function undoMove() { goBack(); }

  // ── Interação usada pelo tabuleiro (clique e arrastar) ──────
  function _ehDaVez(piece, turn) {
    return !!piece && (turn === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());
  }
  function isMovable(sq) {
    if (!active || !sq || _gameStatus || !currentFEN) return false;
    const st = PGNParser.fenToBoard(currentFEN);
    return !!st && _ehDaVez(_pieceAt(st.board, sq), st.turn);
  }
  function select(sq) {
    if (!isMovable(sq)) return [];
    const st = PGNParser.fenToBoard(currentFEN);
    _select(sq, st, st.turn === 'w');
    return legalTargets.slice();
  }
  function deselect() {
    if (!selectedSq) return;
    selectedSq = null; legalTargets = [];
    document.getElementById('board-canvas').classList.remove('piece-selected');
    _redraw(null, null, false);
  }
  function getSelection() { return { sq: selectedSq, targets: legalTargets.slice() }; }
  function pieceAt(sq) {
    const st = currentFEN && PGNParser.fenToBoard(currentFEN);
    return st ? _pieceAt(st.board, sq) : null;
  }
  // Tenta o lance from→to. animate=false para peças soltas pelo arraste
  // (a peça já está na casa de destino, não faz sentido animar de novo).
  function tryMove(fromSq, toSq, animate) {
    const destino = resolveTarget(fromSq, toSq);
    if (!destino) return false;
    _makeMove(fromSq, destino, PGNParser.fenToBoard(currentFEN), animate !== false);
    return true;
  }

  // Destino de verdade de um lance pedido no tabuleiro, ou null se não
  // for legal. Roque também vale levando o rei até a própria torre
  // (Kxh1 vira e1→g1; Kxa1 vira e1→c1), como nos grandes sites.
  function resolveTarget(fromSq, toSq) {
    if (!active || _gameStatus || !fromSq || !toSq || !isMovable(fromSq)) return null;
    const st = PGNParser.fenToBoard(currentFEN);
    const alvos = _filterKingTargets(_getLegalTargets(fromSq, st, st.turn === 'w'), fromSq, st);
    if (alvos.includes(toSq)) return toSq;
    const rei = _pieceAt(st.board, fromSq), torre = _pieceAt(st.board, toSq);
    const fila = st.turn === 'w' ? '1' : '8';
    if ((rei === 'K' || rei === 'k') && fromSq === 'e' + fila && torre === (rei === 'K' ? 'R' : 'r') && toSq[1] === fila) {
      const roque = toSq[0] === 'h' ? 'g' + fila : toSq[0] === 'a' ? 'c' + fila : null;
      if (roque && alvos.includes(roque)) return roque;
    }
    return null;
  }

  // ── Click handler — called from UIController ───────────────
  function handleClick(sq) {
    if (!active || !sq) return;
    if (_gameStatus) return; // xeque-mate/empate — a partida já acabou

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
      _redraw(null, null, false);
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
    _redraw(null, null, false);
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

      // Roque — apenas mostrar g1/c1 (ou g8/c8), NUNCA h1/a1/h8/a8.
      // Regras: o rei não pode rocar estando em xeque, nem passar por, nem
      // terminar numa casa atacada (e/f/g ou e/d/c, conforme o lado).
      const backRank = isWhiteTurn ? '1' : '8';
      const castling = state.castling || '-';
      const kingInCheckNow = PGNParser.isInCheck(state.board, isWhiteTurn);

      if (!kingInCheckNow) {
        // Kingside: e→g (2 casas direita), requer f e g vazios e direito K/k
        const ksRight = isWhiteTurn ? 'K' : 'k';
        if (castling.includes(ksRight)) {
          const f = 'f' + backRank, g = 'g' + backRank;
          if (!_pieceAt(state.board, f) && !_pieceAt(state.board, g) &&
              !_squaresAttacked(state.board, [fromSq, f, g], isWhiteTurn)) {
            targets.push(g); // só g1/g8 — o destino do roque
          }
        }

        // Queenside: e→c (2 casas esquerda), requer b, c, d vazios e direito Q/q
        const qsRight = isWhiteTurn ? 'Q' : 'q';
        if (castling.includes(qsRight)) {
          const b = 'b' + backRank, c = 'c' + backRank, d = 'd' + backRank;
          if (!_pieceAt(state.board, b) && !_pieceAt(state.board, c) && !_pieceAt(state.board, d) &&
              !_squaresAttacked(state.board, [fromSq, d, c], isWhiteTurn)) {
            targets.push(c); // só c1/c8 — o destino do roque
          }
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

  // O xadrez exige proteger o próprio rei: nenhuma peça (nem o rei) pode
  // fazer um lance que deixe (ou mantenha) o próprio rei em xeque — isso
  // cobre pinos, "auto-xeque" do próprio rei, capturar o rei adversário
  // (nunca deveria estar disponível) e a obrigação de responder ao xeque.
  function _squaresAttacked(board, squares, isWhiteTurn) {
    return squares.some(sq => PGNParser.isSquareAttacked(board, sq, !isWhiteTurn));
  }

  function _filterKingTargets(targets, fromSq, state) {
    const isWhiteTurn = state.turn === 'w';
    const piece = _pieceAt(state.board, fromSq);
    return targets.filter(toSq => {
      const isPromo = (piece === 'P' && toSq[1] === '8') || (piece === 'p' && toSq[1] === '1');
      const uci = fromSq + toSq + (isPromo ? 'q' : '');
      const newState = PGNParser.applyMoveUCI(state, uci);
      if (!newState) return false;
      return !PGNParser.isInCheck(newState.board, isWhiteTurn);
    });
  }

  function _makeMove(fromSq, toSq, state, animate = true) {
    const uciMove = fromSq + toSq;
    // Handle promotion (default to queen)
    const piece = _pieceAt(state.board, fromSq);
    const isPromo = (piece === 'P' && toSq[1] === '8') || (piece === 'p' && toSq[1] === '1');
    const uci = isPromo ? uciMove + 'q' : uciMove;

    const newState = PGNParser.applyMoveUCI(state, uci);
    if (!newState) { selectedSq = null; legalTargets = []; _redraw(null, null, false); return; }

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
      _requestEval(uci, fenBefore);
      _redraw(fromSq, toSq, animate);
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
    _requestEval(uci, fenBefore);
    _redraw(fromSq, toSq, animate);
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
      const pieceIsHanging = AnalysisEngine.isSquareHanging(fenAfter, playedMoveUCI, afterRes);
      const sacrificeIsRecapturable = AnalysisEngine.isRecapturable(fenAfter, afterRes.bestMove, isWhite);

      // Empate de verdade nesta posição (xeque-mate/afogamento já tratado
      // por isCheckmateMove; aqui pegamos afogamento e as regras de
      // empate automático) — usa a mesma detecção real do Modo Livre,
      // não mais uma heurística por eval.
      const realStatus = _computeGameStatus(fenAfter);
      const isRealDraw = !!realStatus && realStatus.type !== 'checkmate';

      const cls = MoveClassifier.classify({
        san, evalBefore, evalAfter, bestEval,
        bestMoveUCI:   beforeRes.bestMove,
        playedMoveUCI: playedMoveUCI,
        multiPVEvals:  beforeRes.evals,
        isBook: false, isWhite,
        brilliantsUsed: _brilliantsBefore(i),
        moveIndex: i,
        isStalemate: isRealDraw,
        isCheckmate: isCheckmateMove,
        immediateCaptureValue, sacrificeValue,
        pieceIsHanging, sacrificeIsRecapturable,
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

  // fromSq/toSq (opcionais): o lance a animar.
  //   animate=false: a peça já foi solta ali pelo arraste; ainda assim a
  //                  torre do roque desliza e a peça capturada some.
  //   reverso:       o lance está sendo desfeito (botão voltar).
  function _redraw(fromSq, toSq, animate = true, reverso = false) {
    const state = PGNParser.fenToBoard(currentFEN);
    if (!state) return;
    const board = __fenToBoard8x8(currentFEN);
    // Destaque: o último lance da linha (ou o da partida de onde ela começou).
    const u = idx >= 0 ? ucis[idx] : null;
    const de = u ? u.slice(0, 2) : (_baseCtx.lastFrom || null);
    const para = u ? u.slice(2, 4) : (_baseCtx.lastTo || null);
    if (fromSq && toSq) {
      BoardUI.renderWithAnim(board, fromSq, toSq, selectedSq, legalTargets,
        { semMover: !animate, reverso, hlFrom: de, hlTo: para });
    } else {
      BoardUI.render(board, de, para, selectedSq, legalTargets);
    }
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

  // ── Fim de jogo: xeque-mate, afogamento e as três regras de empate
  //    automático (repetição tripla, 50 lances, material insuficiente) ──
  const FILES = 'abcdefgh';

  function _hasAnyLegalMove(state, isWhiteTurn) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        const isOwn = isWhiteTurn ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
        if (!isOwn) continue;
        const fromSq = FILES[c] + (8 - r);
        const raw = _getLegalTargets(fromSq, state, isWhiteTurn);
        if (_filterKingTargets(raw, fromSq, state).length) return true;
      }
    }
    return false;
  }

  // Material insuficiente para dar mate por qualquer sequência de lances:
  // rei-contra-rei, rei+peça-menor-contra-rei, ou rei+bispo-contra-rei+bispo
  // com os dois bispos de casas da mesma cor.
  function _hasInsufficientMaterial(board) {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.toUpperCase() !== 'K') pieces.push({ piece: p, r, c });
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) return /^[bn]$/i.test(pieces[0].piece);
    if (pieces.length === 2 &&
        pieces.every(p => /^b$/i.test(p.piece)) &&
        pieces[0].piece !== pieces[1].piece) {
      const colorOf = p => (p.r + p.c) % 2;
      return colorOf(pieces[0]) === colorOf(pieces[1]);
    }
    return false;
  }

  // Assinatura de posição para repetição tripla: tabuleiro + quem joga +
  // direitos de roque + casa de en passant — ignora os relógios de lance.
  function _posSignature(fen) {
    return fen.split(' ').slice(0, 4).join(' ');
  }

  // Recalcula o status de fim de jogo de uma posição desta linha do Modo
  // Livre (por padrão, currentFEN — a ponta atual). Aceita outro FEN para
  // reclassificar um lance específico de forma correta mesmo que o
  // ponteiro já tenha avançado (ver _classifyMove).
  function _computeGameStatus(fen) {
    const targetFEN = fen || currentFEN;
    const state = PGNParser.fenToBoard(targetFEN);
    if (!state) return null;
    const isWhiteTurn = state.turn === 'w';
    const inCheck = PGNParser.isInCheck(state.board, isWhiteTurn);

    if (!_hasAnyLegalMove(state, isWhiteTurn)) {
      return inCheck
        ? { type: 'checkmate', winner: isWhiteTurn ? 'black' : 'white' }
        : { type: 'stalemate' };
    }
    if (state.half >= 100) return { type: 'fifty-move' };
    if (_hasInsufficientMaterial(state.board)) return { type: 'insufficient-material' };

    const sig = _posSignature(targetFEN);
    let count = 0;
    for (const f of fens) if (_posSignature(f) === sig) count++;
    if (count >= 3) return { type: 'repetition' };

    return null;
  }

  const GAME_STATUS_LABELS = {
    checkmate: w => `Xeque-mate — ${w === 'white' ? 'brancas vencem' : 'pretas vencem'}`,
    stalemate: () => 'Empate — afogamento (sem lances legais)',
    'fifty-move': () => 'Empate — regra dos 50 lances',
    'insufficient-material': () => 'Empate — material insuficiente para mate',
    repetition: () => 'Empate — posição repetida 3 vezes'
  };

  function _updateTurnLabel() {
    _gameStatus = _computeGameStatus();
  }

  // Análise ao vivo da posição atual (ver live-engine.js). played/fenBefore
  // permitem reaproveitar a linha prevista quando o lance era o esperado.
  function _requestEval(played, fenBefore) {
    if (_gameStatus && _gameStatus.type === 'checkmate') {
      LiveEngine.fimDeJogo(currentFEN);
      return;
    }
    if (_gameStatus) {
      LiveEngine.parar(GAME_STATUS_LABELS[_gameStatus.type](_gameStatus.winner));
      EngineSuggestion.updateArrow(null);
      return;
    }
    LiveEngine.analyze(currentFEN, { played, fenBefore });
  }

  // ── module: pgn-exporter.js ────────────────────────────────
  function _buildPGN() {
    const moves = [..._baseCtx.moves, ...sans.slice(0, idx + 1)];
    const date  = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    // Linha que começa numa posição montada (foto, print): PGN com FEN.
    const inicio = fens[0] || PGNParser.INITIAL_FEN;
    const deFEN = !_baseCtx.moves.length && inicio !== PGNParser.INITIAL_FEN;
    // Resultado: mate ou empate na posição exportada; senão, partida em aberto.
    let resultado = '*';
    try {
      const fim = fens[idx + 1] ? _computeGameStatus(fens[idx + 1]) : null;
      if (fim && fim.type === 'checkmate') resultado = fim.winner === 'white' ? '1-0' : '0-1';
      else if (fim) resultado = '1/2-1/2';
    } catch (e) { /* fica em aberto */ }
    let pgn = `[Event "Free Play"]\n[Date "${date}"]\n[White "${_pgnHeaders.White || '?'}"]\n[Black "${_pgnHeaders.Black || '?'}"]\n[Result "${resultado}"]\n`;
    if (deFEN) pgn += `[SetUp "1"]\n[FEN "${inicio}"]\n`;
    pgn += '\n';
    const partes = inicio.split(' ');
    const pretasComecam = deFEN && partes[1] === 'b';
    const n0 = deFEN ? (parseInt(partes[5], 10) || 1) : 1;
    for (let i = 0; i < moves.length; i++) {
      const j = i + (pretasComecam ? 1 : 0);
      const num = n0 + Math.floor(j / 2);
      if (j % 2 === 0) pgn += `${num}. `;
      else if (i === 0) pgn += `${num}... `;
      pgn += moves[i] + ' ';
    }
    pgn += resultado;
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
    _redraw(null, null, false);
  }

  return {
    start, stop, pause, resume, hasTree, isActive,
    isMovable, select, deselect, getSelection, pieceAt, tryMove, resolveTarget, lineLength: () => sans.length,
    handleClick, undoMove, exportPGN, copyPGN,
    currentFEN: () => currentFEN, _redrawPublic,
    getBranchView, gotoIndex, goBack, goForward, canGoBack, canGoForward
  };
})();

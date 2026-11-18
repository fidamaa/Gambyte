/* ==============================================================
   MODULE: ui-controller.js
   Manages DOM updates and user interactions: board, navegação,
   lista de lances, progresso, banner de abertura, etc.
   Depende de: board-ui.js, arrow-system.js, engine-suggestion.js,
               evaluation-bar.js, pgn-parser.js, opening-detector.js,
               move-classifier.js, chart-renderer.js, free-play.js,
               pgn-exporter.js, insights-ui.js (chamado condicionalmente)
   ============================================================== */
const UIController = (() => {

  const els = {
    pgnInput:          document.getElementById('pgn-input'),
    btnAnalyze:        document.getElementById('btn-analyze'),
    btnClear:          document.getElementById('btn-clear'),
    errorMsg:          document.getElementById('error-msg'),
    progressContainer: document.getElementById('progress-container'),
    progressTitle:     document.getElementById('progress-title'),
    progressDepth:     document.getElementById('progress-depth'),
    progressFill:      document.getElementById('progress-fill'),
    progressMoves:     document.getElementById('progress-move-count'),
    progressEta:       document.getElementById('progress-eta'),
    resultsSection:    document.getElementById('results-section'),
    movesList:         document.getElementById('moves-list'),
    chart:             document.getElementById('chart'),
    phaseIndicator:    document.getElementById('phase-indicator'),
    phaseText:         document.getElementById('phase-text'),
    openingBanner:     document.getElementById('opening-banner'),
    openingEco:        document.getElementById('opening-eco'),
    openingName:       document.getElementById('opening-name'),
    openingVariation:  document.getElementById('opening-variation'),
    whiteName:         document.getElementById('white-name'),
    whiteRating:       document.getElementById('white-rating'),
    whiteAcpl:         document.getElementById('white-acpl'),
    whiteAcc:          document.getElementById('white-acc'),
    whiteMistakes:     document.getElementById('white-mistakes'),
    whiteBlunders:     document.getElementById('white-blunders'),
    blackName:         document.getElementById('black-name'),
    blackRating:       document.getElementById('black-rating'),
    blackAcpl:         document.getElementById('black-acpl'),
    blackAcc:          document.getElementById('black-acc'),
    blackMistakes:     document.getElementById('black-mistakes'),
    blackBlunders:     document.getElementById('black-blunders'),
    navStart:          document.getElementById('nav-start'),
    navPrev:           document.getElementById('nav-prev'),
    navNext:           document.getElementById('nav-next'),
    navEnd:            document.getElementById('nav-end'),
    showEngineArrow:   document.getElementById('show-engine-arrow'),
  };

  const cntEls = {
    white: { book:document.getElementById('cnt-w-book'), brilliant:document.getElementById('cnt-w-brilliant'), great:document.getElementById('cnt-w-great'), excellent:document.getElementById('cnt-w-excellent'), 'best-move':document.getElementById('cnt-w-best-move'), good:document.getElementById('cnt-w-good'), inaccuracy:document.getElementById('cnt-w-inaccuracy'), mistake:document.getElementById('cnt-w-mistake'), miss:document.getElementById('cnt-w-miss'), blunder:document.getElementById('cnt-w-blunder') },
    black: { book:document.getElementById('cnt-b-book'), brilliant:document.getElementById('cnt-b-brilliant'), great:document.getElementById('cnt-b-great'), excellent:document.getElementById('cnt-b-excellent'), 'best-move':document.getElementById('cnt-b-best-move'), good:document.getElementById('cnt-b-good'), inaccuracy:document.getElementById('cnt-b-inaccuracy'), mistake:document.getElementById('cnt-b-mistake'), miss:document.getElementById('cnt-b-miss'), blunder:document.getElementById('cnt-b-blunder') }
  };

  // Navigation state
  let parsedGameRef  = null;
  let currentMoveIdx = -1;   // -1 = initial position, 0..n-1 = after move i
  let moveElementsRef = [];
  let analysisStartTime = null;

  // Ramificação do Modo Livre: quando o jogador faz um lance diferente do
  // original, o "resto" da partida vira uma variante ao vivo, classificada
  // conforme o Stockfish analisa — some se ele voltar ao lance base.
  let _branchBaseCtx = null; // { idx, moves, movesData }

  // ── Board size: responsive ──────────────────────────────────
  function getBoardSize() {
    // Tabuleiro como peça central da tela — proporcional à largura mas com
    // teto generoso, não um selo pequeno perdido ao lado dos outros painéis.
    const panel = document.querySelector('.board-panel');
    const width = panel && panel.clientWidth ? panel.clientWidth : Math.min(window.innerWidth - 32, 560);
    const available = Math.max(160, width - 48);
    // No computador, o tabuleiro inteiro precisa caber na tela ao abrir a página.
    const topo = panel ? panel.getBoundingClientRect().top + window.scrollY : 300;
    const alturaUtil = window.innerWidth > 760 ? Math.max(320, window.innerHeight - topo - 28) : 9999;
    return Math.floor(Math.min(560, available, alturaUtil) / 8) * 8;
  }

  function resizeBoard() {
    const board = document.getElementById("board-canvas");
    if (!board) return;
    BoardUI.init(board, getBoardSize());
    ArrowSystem.init(document.getElementById("arrow-canvas"), board, BoardUI.sqSize);
    BoardUI._forceRedraw();
  }

  // ── Init board ─────────────────────────────────────────────
  // O canvas precisa ser (re)criado toda vez que o board aparece (o
  // tamanho pode mudar), mas os event listeners dos controles só podem
  // ser ligados UMA VEZ — senão cada reset (Limpar, nova Análise, entrar
  // no tabuleiro vazio) empilhava um novo handler por cima do anterior.
  let _controlsBound = false;

  function initBoard() {
    const sz = getBoardSize();
    BoardUI.init(document.getElementById('board-canvas'), sz);
    EvalBar.init();
    ArrowSystem.init(
      document.getElementById('arrow-canvas'),
      document.getElementById('board-canvas'),
      BoardUI.sqSize
    );
    if (!_controlsBound) {
      _controlsBound = true;
      _bindBoardControls();
    }
    renderBoardAtMove(-1);
  }

  function _bindBoardControls() {
    // Sync show-engine-arrow toggle
    els.showEngineArrow.addEventListener('change', () => {
      ArrowSystem.setShowEngine(els.showEngineArrow.checked);
    });

    // ── module: board-rotation.js ── flip button
    const btnFlip = document.getElementById('btn-flip');
    if (btnFlip) {
      btnFlip.addEventListener('click', () => {
        const flipped = !BoardUI.isFlipped();
        console.log(`[DEBUG] ⇅ Inverter tabuleiro → flipped=${flipped}`);
        BoardUI.setFlipped(flipped);
        EvalBar.setFlipped(flipped);
        btnFlip.classList.toggle('active', flipped);
        if (FreePlay.isActive()) {
          console.log(`[DEBUG] ⇅ Flip durante Modo Livre — redesenhando FreePlay`);
          // força FreePlay a redesenhar no novo flip
          FreePlay._redrawPublic();
        } else {
          renderBoardAtMove(currentMoveIdx);
        }
        // Pequeno delay para garantir que o canvas foi repintado antes das setas
        setTimeout(() => ArrowSystem.redraw(), 20);
      });
    }

    // ── Tabuleiro sempre interativo: clique e arrastar ─────────
    _bindBoardPointer();

    // ── Export PGN button — abre menu com opções Copiar/Baixar ─
    const btnExport = document.getElementById('btn-export-pgn');
    const pgnMenu    = document.getElementById('pgn-menu');
    const pgnMenuWrap = document.getElementById('pgn-menu-wrap');
    if (btnExport && pgnMenu) {
      btnExport.addEventListener('click', (e) => {
        e.stopPropagation();
        pgnMenu.hidden = !pgnMenu.hidden;
      });
      document.addEventListener('click', (e) => {
        if (!pgnMenu.hidden && pgnMenuWrap && !pgnMenuWrap.contains(e.target)) pgnMenu.hidden = true;
      });
      const btnCopy = document.getElementById('pgn-menu-copy');
      const btnDownload = document.getElementById('pgn-menu-download');
      if (btnCopy) btnCopy.addEventListener('click', async () => {
        pgnMenu.hidden = true;
        const ok = _usarLinhaLivre()
          ? await FreePlay.copyPGN()
          : await PGNExporter.copyGame(parsedGameRef);
        _flashPgnFeedback(btnExport, ok ? 'PGN copiado!' : 'Não foi possível copiar.');
      });
      if (btnDownload) btnDownload.addEventListener('click', () => {
        pgnMenu.hidden = true;
        if (_usarLinhaLivre()) { FreePlay.exportPGN(); return; }
        PGNExporter.exportGame(parsedGameRef);
      });
    }
  }

  function _flashPgnFeedback(btnExport, msg) {
    if (!btnExport) return;
    const label = btnExport.querySelector('span');
    if (!label) return;
    const original = label.textContent;
    label.textContent = msg;
    setTimeout(() => { label.textContent = original; }, 1500);
  }

  // ── Linha livre (variante jogada no tabuleiro) ───────────────
  // O tabuleiro é sempre interativo: na revisão de uma partida, pegar uma
  // peça abre uma linha a partir do lance mostrado; sem partida, a linha
  // começa da posição inicial.
  function _temPartida() { return !!(parsedGameRef && parsedGameRef.moves && parsedGameRef.moves.length); }

  // Exportar a linha livre só quando ela existe de fato (há lances nela,
  // ou não há partida carregada); senão exporta a partida.
  function _usarLinhaLivre() {
    if (!FreePlay.isActive()) return false;
    return FreePlay.lineLength() > 0 || !_temPartida();
  }

  function _enterFreePlay() {
    const startFEN = currentMoveIdx < 0
      ? _fenInicial()
      : (parsedGameRef && parsedGameRef.fensAfter[currentMoveIdx]) || PGNParser.INITIAL_FEN;
    const baseIdx = currentMoveIdx;
    const ms = parsedGameRef && parsedGameRef.moveSquares && baseIdx >= 0 ? parsedGameRef.moveSquares[baseIdx] : null;
    const baseCtx = {
      idx: baseIdx,
      moves: parsedGameRef ? parsedGameRef.moves.slice(0, baseIdx + 1) : [],
      movesData: parsedGameRef && parsedGameRef.movesData ? parsedGameRef.movesData.slice(0, baseIdx + 1) : [],
      lastFrom: ms ? ms.from : null,
      lastTo: ms ? ms.to : null,
    };
    _branchBaseCtx = baseCtx;
    _showClassOverlay(null);
    FreePlay.start(startFEN, parsedGameRef ? parsedGameRef.headers : {}, baseCtx, () => renderBranch());
    FreePlay._redrawPublic();
  }

  // Volta para a partida carregada, descartando a linha livre.
  function _leaveBranch() {
    const base = _branchBaseCtx ? _branchBaseCtx.idx : currentMoveIdx;
    FreePlay.stop();
    _branchBaseCtx = null;
    document.querySelectorAll('.move-pair[data-branch="1"], .move-item[data-branch-in-base="1"]').forEach(el => el.remove());
    els.movesList.querySelectorAll('.move-pair').forEach(p => { p.style.display = ''; });
    moveElementsRef.forEach(el => { if (el) el.style.display = ''; });
    if (parsedGameRef) {
      updateOpeningBanner(parsedGameRef.moves);
      if (parsedGameRef.movesData) { updateChart(parsedGameRef.movesData); updatePlayerStats(parsedGameRef.movesData); }
    }
    return base;
  }

  // FEN mostrado na revisão (sem linha livre)
  // Posição de partida: a inicial do xadrez, ou a montada pela foto/print.
  function _fenInicial() { return (parsedGameRef && parsedGameRef.startFEN) || PGNParser.INITIAL_FEN; }

  function _fenRevisao() {
    if (!parsedGameRef || currentMoveIdx < 0) return _fenInicial();
    return parsedGameRef.fensAfter[currentMoveIdx] || PGNParser.INITIAL_FEN;
  }
  function _movivelNaRevisao(sq) {
    const st = PGNParser.fenToBoard(_fenRevisao());
    if (!st) return false;
    const p = st.board[8 - parseInt(sq[1], 10)][sq.charCodeAt(0) - 97];
    return !!p && (st.turn === 'w' ? p === p.toUpperCase() : p === p.toLowerCase());
  }

  // ── Clique e arrastar (mouse e toque) ─────────────────────────
  function _bindBoardPointer() {
    const cv = document.getElementById('board-canvas');
    const wrap = document.getElementById('board-wrapper');
    if (!cv || !wrap) return;
    let ghost = document.getElementById('drag-ghost');
    if (!ghost) {
      ghost = document.createElement('img');
      ghost.id = 'drag-ghost'; ghost.className = 'drag-ghost'; ghost.alt = ''; ghost.hidden = true;
      wrap.appendChild(ghost);
    }
    let press = null;       // { sq, x, y, id, wasSelected, dragging, touch }
    let ultimoHover = null;
    const sqAt = e => {
      const r = cv.getBoundingClientRect();
      return BoardUI.xyToSq(e.clientX - r.left, e.clientY - r.top);
    };
    const moverFantasma = e => {
      const r = wrap.getBoundingClientRect();
      const sz = BoardUI.sqSize() * (press && press.touch ? 1.35 : 1);
      const sobe = press && press.touch ? sz * 0.45 : 0;   // no toque, a peça fica acima do dedo
      ghost.style.width = ghost.style.height = sz + 'px';
      ghost.style.transform = 'translate(' + (e.clientX - r.left - sz / 2) + 'px,' + (e.clientY - r.top - sz / 2 - sobe) + 'px)';
    };

    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ArrowSystem.clearManual();
      const sq = sqAt(e);
      if (!sq) return;
      e.preventDefault();
      // Na revisão, pegar uma peça de quem joga abre a linha livre aqui.
      if (!FreePlay.isActive()) {
        if (!_movivelNaRevisao(sq)) return;
        _enterFreePlay();
      }
      const sel = FreePlay.getSelection();
      if (sel.sq && FreePlay.resolveTarget(sel.sq, sq)) { // clique no destino (ou na torre, para rocar)
        FreePlay.tryMove(sel.sq, sq, true);
        press = null;
        return;
      }
      if (FreePlay.isMovable(sq)) {
        const wasSelected = sel.sq === sq;
        if (!wasSelected) FreePlay.select(sq);
        press = { sq, x: e.clientX, y: e.clientY, id: e.pointerId, wasSelected, dragging: false, touch: e.pointerType !== 'mouse' };
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
      } else {
        FreePlay.deselect();
        press = null;
      }
    });

    cv.addEventListener('pointermove', e => {
      if (!press || e.pointerId !== press.id) {
        if (e.pointerType !== 'mouse') return;
        const sq = sqAt(e);
        if (sq === ultimoHover) return;
        ultimoHover = sq;
        let cursor = 'default';
        if (sq) {
          if (FreePlay.isActive()) {
            if (FreePlay.isMovable(sq)) cursor = 'grab';
            else if (FreePlay.getSelection().targets.includes(sq)) cursor = 'pointer';
          } else if (_movivelNaRevisao(sq)) cursor = 'grab';
        }
        cv.style.cursor = cursor;
        return;
      }
      if (!press.dragging) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < (press.touch ? 6 : 4)) return;
        press.dragging = true;
        ghost.src = BoardUI.pieceSrc(FreePlay.pieceAt(press.sq));
        ghost.hidden = false;
        cv.style.cursor = 'grabbing';
        BoardUI.setDrag(press.sq);
      }
      moverFantasma(e);
      BoardUI.setHover(sqAt(e));
    });

    const soltar = (e, cancelar) => {
      if (!press || e.pointerId !== press.id) return;
      const p = press;
      press = null;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
      if (p.dragging) {
        ghost.hidden = true;
        BoardUI.setHover(null);
        BoardUI.setDrag(null);
        cv.style.cursor = 'grab';
        const to = cancelar ? null : sqAt(e);
        if (to && to !== p.sq && FreePlay.tryMove(p.sq, to, false)) return;
        FreePlay._redrawPublic();                          // a peça volta para a casa
      } else if (p.wasSelected) {
        FreePlay.deselect();                               // segundo clique na mesma peça
      }
    };
    cv.addEventListener('pointerup', e => soltar(e, false));
    cv.addEventListener('pointercancel', e => soltar(e, true));
  }

  function renderBoardAtMove(idx) {
    if (!parsedGameRef) return;
    const fensAft = parsedGameRef.fensAfter;

    const fen = idx < 0 ? _fenInicial()
              : idx < fensAft.length ? fensAft[idx]
              : fensAft[fensAft.length - 1];

    const board = __fenToBoard8x8(fen);

    let fromSq = null, toSq = null;
    const ms = parsedGameRef.moveSquares || [];
    if (idx >= 0 && ms[idx]) {
      fromSq = ms[idx].from;
      toSq   = ms[idx].to;
    }

    // Um lance para a frente: anima o lance (com captura e roque).
    // Um lance para trás: desfaz o lance seguinte (a peça volta e a
    // capturada reaparece). Saltos maiores: anima só o lance mostrado.
    if (idx === currentMoveIdx - 1 && ms[currentMoveIdx]) {
      const m = ms[currentMoveIdx];
      BoardUI.renderWithAnim(board, m.from, m.to, null, null, { reverso: true, hlFrom: fromSq, hlTo: toSq });
    } else {
      BoardUI.renderWithAnim(board, fromSq, toSq, null, null, idx === currentMoveIdx + 1 ? {} : { prev: null });
    }

    // Engine arrow
    ArrowSystem.clearManual();
    _barraRevisao(fen);
    if (parsedGameRef.movesData) {
      const md = parsedGameRef.movesData[idx];
      if (md && md.bestMoveUCI) {
        EngineSuggestion.updateArrow(md.bestMoveUCI);
      } else {
        EngineSuggestion.updateArrow(null);
      }
      // ── module: evaluation-bar.js ── sync eval bar
      EvalBar.updateFromMoveData(md || null);
    } else if (idx < 0) {
      EvalBar.update(0, false, 0);
    }

    els.navStart.disabled = idx < 0;
    els.navPrev.disabled  = idx < 0;
    els.navEnd.disabled   = idx >= (fensAft.length - 1);
    els.navNext.disabled  = idx >= (fensAft.length - 1);

    for (let i = 0; i < moveElementsRef.length; i++) {
      const el = moveElementsRef[i];
      if (!el) continue;
      if (i === idx) {
        el.classList.add('active');
        // Scroll suave apenas dentro do container .moves-list
        const list = el.closest('.moves-list');
        if (list) {
          const listRect = list.getBoundingClientRect();
          const elRect   = el.getBoundingClientRect();
          // Posição do elemento relativa ao topo do container (considerando scroll atual)
          const elTop = elRect.top - listRect.top + list.scrollTop;
          const elBot = elTop + elRect.height;
          const viewTop = list.scrollTop;
          const viewBot = viewTop + list.clientHeight;
          if (elTop < viewTop) {
            // Item acima da área visível — sobe
            list.scrollTop = elTop - 4;
          } else if (elBot > viewBot) {
            // Item abaixo da área visível — desce só o suficiente
            list.scrollTop = elBot - list.clientHeight + 4;
          }
          // Se já está visível, não faz nada
        }
      } else {
        el.classList.remove('active');
      }
    }

    currentMoveIdx = idx;

    // Atualizar gráfico com cursor no lance atual
    if (parsedGameRef && parsedGameRef.movesData) {
      updateChart(parsedGameRef.movesData, idx);
    }

    // Overlay de classificação do lance
    if (parsedGameRef && parsedGameRef.movesData && idx >= 0) {
      const md  = parsedGameRef.movesData[idx];
      const toSq = parsedGameRef.moveSquares && parsedGameRef.moveSquares[idx]
                   ? parsedGameRef.moveSquares[idx].to
                   : null;
      _showClassOverlay(md ? md.classification : null, toSq);
      // ── INSIGHTS POR LANCE ──
      if (typeof InsightsUI !== 'undefined' && md) InsightsUI.renderMoveInsight(md);
    } else {
      _showClassOverlay(null, null);
    }
  }

  // Barra da análise ao vivo durante a revisão: a linha do motor para a
  // posição mostrada. A seta continua sendo a da análise da partida (o
  // melhor lance no lugar do que foi jogado). Enquanto a partida ainda está
  // sendo analisada, não disputa o motor com ela.
  function _barraRevisao(fen) {
    if (els.progressContainer.classList.contains('visible')) {
      LiveEngine.parar('Análise da partida em andamento…');
      return;
    }
    LiveEngine.analyze(fen, { arrow: false, evalBar: false });
  }

  // ── FEN → 8x8 board ────────────────────────────────────────
  function __fenToBoard8x8(fen) {
    const rows = fen.split(' ')[0].split('/');
    const board = [];
    for (const row of rows) {
      const line = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < parseInt(ch); i++) line.push('');
        else line.push(ch);
      }
      board.push(line);
    }
    return board;
  }

  // ── Navigation ──────────────────────────────────────────────
  // No Modo Livre, as MESMAS setas/teclas navegam a linha do Modo Livre
  // (Voltar/Avançar) em vez da partida carregada — sem botões extras.
  function navigate(delta) {
    if (FreePlay.hasTree()) {
      if (delta < 0) {
        if (FreePlay.canGoBack()) { FreePlay.goBack(); return; }
        if (!_temPartida()) return;
        const base = _leaveBranch();
        renderBoardAtMove(Math.max(-1, base - 1));
        return;
      }
      if (FreePlay.canGoForward()) { FreePlay.goForward(); return; }
      if (_temPartida() && FreePlay.lineLength() === 0) {
        const base = _leaveBranch();
        renderBoardAtMove(Math.min(parsedGameRef.fensAfter.length - 1, base + 1));
      }
      return;
    }
    if (!parsedGameRef) return;
    const max = parsedGameRef.fensAfter.length - 1;
    const newIdx = Math.max(-1, Math.min(max, currentMoveIdx + delta));
    if (newIdx !== currentMoveIdx) renderBoardAtMove(newIdx);
  }

  function navTo(idx) {
    if (!parsedGameRef) return;
    if (FreePlay.hasTree() && _temPartida()) _leaveBranch();
    renderBoardAtMove(idx);
  }

  function navToStart() {
    if (FreePlay.hasTree() && !_temPartida()) { FreePlay.gotoIndex(-1); return; }
    navTo(-1);
  }

  function navToEnd() {
    if (FreePlay.hasTree() && (!_temPartida() || FreePlay.lineLength() > 0)) {
      FreePlay.gotoIndex(FreePlay.lineLength() - 1);
      return;
    }
    if (parsedGameRef) navTo(parsedGameRef.fensAfter.length - 1);
  }

  // ── Opening banner ──────────────────────────────────────────
  function updateOpeningBanner(moves) {
    els.openingBanner.classList.add('visible');
    if (parsedGameRef && parsedGameRef.startFEN) {
      els.openingEco.textContent      = '—';
      els.openingName.textContent     = 'Posição montada';
      els.openingVariation.textContent = 'Lida da imagem. Jogue no tabuleiro ou siga a linha do motor.';
      return;
    }
    const result = OpeningDetector.detect(moves);
    if (!moves.length) {
      els.openingEco.textContent      = '—';
      els.openingName.textContent     = 'Posição inicial';
      els.openingVariation.textContent = 'Jogue no tabuleiro ou traga uma partida logo abaixo.';
    } else if (result) {
      els.openingEco.textContent      = result.eco;
      els.openingName.textContent     = result.name;
      els.openingVariation.textContent = result.variation || '';
    } else {
      els.openingEco.textContent      = '—';
      els.openingName.textContent     = 'Fora de livro';
      els.openingVariation.textContent = '';
    }
  }

  // ── Error / progress / analyze ─────────────────────────────
  function showError(msg) { els.errorMsg.textContent = msg; els.errorMsg.classList.add('visible'); }
  function hideError()    { els.errorMsg.classList.remove('visible'); }

  function setAnalyzing(active) {
    els.btnAnalyze.disabled = active;
    els.btnAnalyze.textContent = active ? 'Analisando…' : 'Analisar Partida';
    if (active) {
      els.phaseIndicator.classList.remove('hidden');
      els.progressContainer.classList.add('visible');
      analysisStartTime = Date.now();
    } else {
      els.phaseIndicator.classList.add('hidden');
    }
  }

  function showResults(parsedGame) {
    // Mostrar uma partida (nova análise, ou o tabuleiro vazio de "Limpar")
    // sempre descarta de vez qualquer árvore do Modo Livre anterior —
    // mas SAIR do Modo Livre sozinho (botão "Sair"/toggle) não passa por
    // aqui, então o que foi feito lá só se perde se o usuário realmente
    // trocar de partida ou limpar.
    if (FreePlay.isActive() || FreePlay.hasTree()) FreePlay.stop();
    _branchBaseCtx = null;

    parsedGameRef = parsedGame;
    currentMoveIdx = -1;

    const headers = parsedGame.headers;
    RatingModel.definirContexto(headers);
    els.resultsSection.classList.add('visible');
    els.whiteName.textContent    = headers.White || 'Brancas';
    els.blackName.textContent    = headers.Black || 'Pretas';
    // Partida nova: zera os números dos jogadores e o gráfico.
    if (!parsedGame.moves.length || !parsedGame.movesData) _resetPlayerStats();
    ChartRenderer.clear(els.chart);

    // Opening detection
    updateOpeningBanner(parsedGame.moves);

    // Init board
    initBoard();
    renderBoardAtMove(-1);
  }

  // ── Tabuleiro vazio (sempre presente) ────────────────────────
  // Monta uma "partida" vazia e entra direto no Modo Livre — usado na
  // carga inicial da página (o tabuleiro já aparece antes de colar
  // qualquer PGN) e sempre que "Limpar" é clicado (reinicia do zero).
  function showEmptyBoard() {
    const emptyGame = {
      headers: { White: 'Brancas', Black: 'Pretas' },
      moves: [], fensBefore: [], fensAfter: [], moveSquares: []
    };
    showResults(emptyGame);
    initMovesList(emptyGame);
    _enterFreePlay();
  }

  // Abre uma posição montada (foto ou print do tabuleiro) para jogar e
  // analisar ao vivo. brancasEmbaixo decide o lado do tabuleiro.
  function showPosition(fen, brancasEmbaixo = true) {
    const game = {
      headers: { White: 'Brancas', Black: 'Pretas', SetUp: '1', FEN: fen },
      moves: [], fensBefore: [], fensAfter: [], moveSquares: [], startFEN: fen,
    };
    const virar = !brancasEmbaixo;
    BoardUI.setFlipped(virar);
    EvalBar.setFlipped(virar);
    document.getElementById('btn-flip')?.classList.toggle('active', virar);
    showResults(game);
    initMovesList(game);
    _enterFreePlay();
  }

  function initMovesList(parsedGame) {
    parsedGameRef = parsedGame;
    const { moves } = parsedGame;
    els.movesList.innerHTML = '';
    moveElementsRef = [];

    for (let i = 0; i < moves.length; i += 2) {
      const pairDiv = document.createElement('div');
      pairDiv.className = 'move-pair';

      const numDiv = document.createElement('div');
      numDiv.className = 'move-number';
      numDiv.textContent = (Math.floor(i / 2) + 1) + '.';
      pairDiv.appendChild(numDiv);

      const wDiv = createMoveEl(i, moves[i]);
      pairDiv.appendChild(wDiv);
      moveElementsRef[i] = wDiv;

      if (i + 1 < moves.length) {
        const bDiv = createMoveEl(i + 1, moves[i + 1]);
        pairDiv.appendChild(bDiv);
        moveElementsRef[i + 1] = bDiv;
      } else {
        pairDiv.appendChild(document.createElement('div'));
      }

      els.movesList.appendChild(pairDiv);
    }
  }

  // Redesenha a cauda da lista de lances com a linha atual do Modo Livre
  // (do início até o ponteiro — pode ser a linha original ou já ter sido
  // substituída por uma ramificação), e atualiza gráfico/abertura/
  // estatísticas com base+linha combinados.
  function renderBranch() {
    if (!_branchBaseCtx) return;
    const { idx: baseIdx } = _branchBaseCtx;
    const { path } = FreePlay.getBranchView();

    document.querySelectorAll('.move-pair[data-branch="1"]').forEach(p => p.remove());
    document.querySelectorAll('.move-item[data-branch-in-base="1"]').forEach(el => el.remove());

    // Peça só selecionada (nenhum lance novo ainda): a lista e o gráfico
    // continuam sendo os da partida.
    if (FreePlay.lineLength() === 0 && _temPartida()) {
      els.movesList.querySelectorAll('.move-pair').forEach(p => { p.style.display = ''; });
      moveElementsRef.forEach(el => { if (el) el.style.display = ''; });
      const fim = parsedGameRef.fensAfter.length - 1;
      els.navStart.disabled = baseIdx < 0;
      els.navPrev.disabled  = baseIdx < 0;
      els.navEnd.disabled   = baseIdx >= fim;
      els.navNext.disabled  = baseIdx >= fim;
      return;
    }

    // Esconde pares INTEIROS além do ponto de ramificação (não só as
    // células — senão sobrava o número "6.", "7."... com a linha vazia).
    // O par que CONTÉM o lance base fica visível; só a célula preta é
    // escondida ali quando o lance base foi das brancas (baseIdx par).
    els.movesList.querySelectorAll('.move-pair').forEach((pairDiv, pairIdx) => {
      const whiteIdx = pairIdx * 2;
      const blackIdx = whiteIdx + 1;
      pairDiv.style.display = (whiteIdx > baseIdx) ? 'none' : '';
      if (moveElementsRef[blackIdx]) {
        moveElementsRef[blackIdx].style.display = (blackIdx > baseIdx) ? 'none' : '';
      }
    });

    let k0 = 0;
    if (baseIdx >= 0 && baseIdx % 2 === 0 && path.length > 0) {
      // Lance base foi das brancas — o 1º lance do caminho (pretas)
      // completa o MESMO par visual, em vez de abrir um novo. O lance
      // preto original fica só escondido (display:none não participa do
      // grid), então a nova célula ocupa a 3ª coluna automaticamente.
      const baseEl = moveElementsRef[baseIdx];
      const basePair = baseEl ? baseEl.parentElement : null;
      if (basePair) {
        const bEl = _createBranchMoveEl(path[0]);
        bEl.dataset.branchInBase = '1';
        basePair.appendChild(bEl);
        k0 = 1;
      }
    }
    // Posição montada (foto/print): a numeração segue o FEN e, se as
    // pretas começam, o primeiro par tem a casa das brancas vazia.
    const fenIni = parsedGameRef && parsedGameRef.startFEN;
    const pretasComecam = !!fenIni && fenIni.split(' ')[1] === 'b';
    const desloc = pretasComecam ? 1 : 0;
    const n0 = fenIni ? (parseInt(fenIni.split(' ')[5], 10) || 1) : 1;
    let pairDiv = null;
    for (let k = k0; k < path.length; k++) {
      const globalIdx = baseIdx + 1 + k + desloc;
      if (globalIdx % 2 === 0 || !pairDiv) {
        pairDiv = document.createElement('div');
        pairDiv.className = 'move-pair';
        pairDiv.dataset.branch = '1';
        const numDiv = document.createElement('div');
        numDiv.className = 'move-number';
        numDiv.textContent = (n0 + Math.floor(globalIdx / 2)) + '.';
        pairDiv.appendChild(numDiv);
        if (globalIdx % 2 === 1) {
          const vazio = document.createElement('div');
          vazio.className = 'move-item move-vazio';
          vazio.textContent = '…';
          pairDiv.appendChild(vazio);
        }
        els.movesList.appendChild(pairDiv);
      }
      pairDiv.appendChild(_createBranchMoveEl(path[k]));
    }
    els.movesList.scrollTop = els.movesList.scrollHeight;

    const branchMovesData   = path.map(p => p.moveData);
    const combinedMoves     = _branchBaseCtx.moves.concat(path.map(p => p.san));
    const combinedMovesData = _branchBaseCtx.movesData.concat(branchMovesData);
    updateOpeningBanner(combinedMoves);
    if (combinedMovesData.some(m => m.evalAfter !== null)) updateChart(combinedMovesData);
    updatePlayerStats(combinedMovesData);

    // As mesmas setas de baixo navegam o Modo Livre — refletem o estado
    // da linha atual (Voltar/Avançar), não mais o da partida carregada.
    const voltaPartida = _temPartida();
    els.navStart.disabled = !FreePlay.canGoBack() && !voltaPartida;
    els.navPrev.disabled  = !FreePlay.canGoBack() && !voltaPartida;
    els.navEnd.disabled   = !FreePlay.canGoForward();
    els.navNext.disabled  = !FreePlay.canGoForward();
  }

  function _createBranchMoveEl(ply) {
    const moveData = ply.moveData;
    const cls = moveData.classification || '';
    const div = document.createElement('div');
    div.className = 'move-item branch' + (cls ? ' ' + cls : '') + (ply.isCurrent ? ' active' : '');
    div.innerHTML = `
      <span class="move-class-icon${cls ? ' ' + cls : ''}">·</span>
      <span class="move-san">${moveData.san}</span>
      <span class="move-eval">${_formatEvalDisplay(moveData.evalAfter)}</span>
      <span class="move-class-badge${cls ? ' ' + cls : ''}" title="${cls ? MoveClassifier.LABELS[cls] : ''}">${cls ? MoveClassifier.LABELS[cls] : ''}</span>
    `;
    div.addEventListener('click', () => FreePlay.gotoIndex(ply.index));
    return div;
  }

  function createMoveEl(idx, san) {
    const div = document.createElement('div');
    div.className = 'move-item';
    div.dataset.index = idx;
    div.innerHTML = `
      <span class="move-class-icon">·</span>
      <span class="move-san">${san}</span>
      <span class="move-eval"></span>
      <span class="move-class-badge"></span>
    `;
    div.addEventListener('click', () => navTo(idx));
    return div;
  }

  // FIX 2: Mostrar profundidade real do mate (M3, M5, etc.)
  // Codificação: ±(30000 - N) onde N é o número de lances até o mate
  function _formatEvalDisplay(v) {
    if (v === null || v === undefined) return '';
    const absV = Math.abs(v);
    if (absV >= 29000) {
      const mateDepth = Math.max(1, 30000 - absV);
      return v > 0 ? `+M${mateDepth}` : `-M${mateDepth}`;
    }
    return (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
  }

  function updateMoveElement(moveData) {
    const el = moveElementsRef[moveData.index];
    if (!el) return;
    const cls = moveData.classification || '';
    el.className = 'move-item' + (cls ? ' ' + cls : '') + (moveData.index === currentMoveIdx ? ' active' : '');
    el.querySelector('.move-class-icon').className = 'move-class-icon' + (cls ? ' ' + cls : '');

    if (moveData.evalAfter !== null) {
      el.querySelector('.move-eval').textContent = _formatEvalDisplay(moveData.evalAfter);
    }
    const badge = el.querySelector('.move-class-badge');
    badge.className = 'move-class-badge' + (cls ? ' ' + cls : '');
    const label = cls ? MoveClassifier.LABELS[cls] : '';
    badge.textContent = label;
    badge.title = label; // rótulo completo no hover, mesmo se truncado (ex.: "Chance Perdida")

    // If this is the currently viewed move, refresh engine arrow
    if (moveData.index === currentMoveIdx && moveData.bestMoveUCI) {
      EngineSuggestion.updateArrow(moveData.bestMoveUCI);
    }
  }

  function updateProgress(data) {
    const { phase, done, total, depth, liveDepth, deep } = data;
    // Fração concluída nesta passada; dentro de um lance da passada
    // profunda, a profundidade ao vivo avança a barra aos poucos.
    // Cada lance tem duas posições (antes e depois); a parcial avança de
    // 0 a 1 ao longo das duas, então a barra nunca recua dentro do lance.
    const partial = liveDepth ? Math.min(0.95, ((data.liveHalf || 0) + Math.min(1, liveDepth / depth)) / 2) : 0;
    let frac = total > 0 ? Math.min(1, (done + partial) / total) : 1;
    // Fase 1 ocupa 0–35% da barra; cada passada da fase 2 ganha uma faixa
    // própria do restante, então a barra nunca volta para trás.
    let pct;
    if (phase === 1) pct = frac * 35;
    else {
      const n = data.passCount || 1, k = data.pass || 0;
      pct = 35 + 65 * (k + frac) / n;
    }
    els.progressFill.style.width = pct.toFixed(1) + '%';
    els.progressTitle.textContent = phase === 1
      ? `Leitura rápida · profundidade ${depth}`
      : deep ? `Análise Profunda · profundidade ${depth}` : `Refinamento · profundidade ${depth}`;
    els.progressDepth.textContent = liveDepth ? `profundidade ${liveDepth} de ${depth}` : `profundidade ${depth}`;
    els.progressMoves.textContent = phase === 1
      ? `${done} de ${total} lances`
      : total === 0 ? 'nada a refinar nesta profundidade' : `${Math.min(done + (liveDepth ? 1 : 0), total)} de ${total} lances revisados`;
    els.phaseText.textContent     = `Fase ${phase}`;
    // Tempo restante desta passada, medido com o ritmo real dela.
    const start = data.passStart || analysisStartTime;
    const feito = done + partial;
    if (start && feito >= 0.25 && total > feito) {
      const elapsed = (Date.now() - start) / 1000;
      const eta     = (total - feito) * (elapsed / feito);
      els.progressEta.textContent = eta < 60
        ? `~${Math.max(1, Math.ceil(eta))}s nesta etapa`
        : `~${Math.ceil(eta / 60)} min nesta etapa`;
    } else if (feito < 0.25 && total > 0) {
      els.progressEta.textContent = deep ? 'cada lance leva alguns segundos' : 'calculando…';
    } else {
      els.progressEta.textContent = '';
    }
  }

  function _resetPlayerStats() {
    for (const id of ['white-rating','white-acpl','white-acc','white-mistakes','white-blunders',
                      'black-rating','black-acpl','black-acc','black-mistakes','black-blunders']) {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    }
    for (const lado of ['white', 'black']) for (const k in cntEls[lado]) cntEls[lado][k].textContent = '0';
  }

  function updatePlayerStats(movesData) {
    // Store reference for board nav
    if (parsedGameRef) parsedGameRef.movesData = movesData;
    // Nada avaliado ainda (tabuleiro vazio, Modo Livre): mostra traços, não 100%.
    if (!movesData.some(m => m && m.evalAfter != null)) { _resetPlayerStats(); return; }

    const wStats = MoveClassifier.computeStats(movesData, true);
    const bStats = MoveClassifier.computeStats(movesData, false);

    // Nível dos dois lados juntos: precisão, equilíbrio da partida,
    // adversário e rating do PGN (ver RatingModel.estimarPartida).
    const niv = RatingModel.estimarPartida(wStats, bStats, parsedGameRef ? parsedGameRef.headers : null);
    const wRatingFinal = niv.white;
    const bRatingFinal = niv.black;

    els.whiteRating.textContent  = wRatingFinal;
    els.whiteAcpl.textContent    = wStats.acpl;
    els.whiteAcc.textContent     = String(wStats.accuracy).replace('.', ',') + '%';
    els.whiteMistakes.textContent = movesData.filter(m => m.color==='white' && m.classification==='mistake').length;
    els.whiteBlunders.textContent = movesData.filter(m => m.color==='white' && m.classification==='blunder').length;

    els.blackRating.textContent  = bRatingFinal;
    els.blackAcpl.textContent    = bStats.acpl;
    els.blackAcc.textContent     = String(bStats.accuracy).replace('.', ',') + '%';
    els.blackMistakes.textContent = movesData.filter(m => m.color==='black' && m.classification==='mistake').length;
    els.blackBlunders.textContent = movesData.filter(m => m.color==='black' && m.classification==='blunder').length;


    const classes = ['book','brilliant','great','excellent','best-move','good','inaccuracy','mistake','miss','blunder'];
    for (const cls of classes) {
      cntEls.white[cls].textContent = movesData.filter(m => m.color==='white' && m.classification===cls).length;
      cntEls.black[cls].textContent = movesData.filter(m => m.color==='black' && m.classification===cls).length;
    }
  }

  // ── Overlay de classificação no tabuleiro ─────────────────────
  function _showClassOverlay(cls, toSq) {
    const overlay = document.getElementById('move-class-overlay');
    if (!overlay) return;

    if (!cls) {
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.style.opacity === '0') overlay.innerHTML = ''; }, 300);
      return;
    }

    const label = MoveClassifier.LABELS[cls] || cls;

    // Posicionar sobre a peça de destino
    if (toSq) {
      const { x, y } = BoardUI.sqToXY(toSq);
      const sq = BoardUI.sqSize();
      overlay.style.left   = (x + sq * 0.55) + 'px';
      overlay.style.top    = (y + sq * 0.15) + 'px';
      overlay.style.right  = 'auto';
      overlay.style.gap    = '8px';
    }

    // Força reanimação recriando o conteúdo
    overlay.innerHTML = '';
    overlay.style.opacity = '0';

    requestAnimationFrame(() => {
      const labelEl = document.createElement('span');
      labelEl.className = `cls-label ${cls}`;
      labelEl.textContent = label;

      overlay.appendChild(labelEl);
      overlay.style.opacity = '1';
    });
  }

  function updateChart(movesData, activeIdx) {
    const valid = movesData.filter(m => m.evalAfter !== null);
    if (valid.length > 0) ChartRenderer.render(els.chart, valid, activeIdx ?? currentMoveIdx);
  }

  // ── Keyboard nav ─────────────────────────────────────────────
  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft')  navigate(-1);
      if (e.key === 'ArrowRight') navigate(+1);
      if (e.key === 'ArrowUp' || e.key === 'Home') navToStart();
      if (e.key === 'ArrowDown' || e.key === 'End') navToEnd();
    });

    els.navStart.addEventListener('click', navToStart);
    els.navPrev.addEventListener('click',  () => navigate(-1));
    els.navNext.addEventListener('click',  () => navigate(+1));
    els.navEnd.addEventListener('click',   navToEnd);
  }

  setupKeyboard();

  return {
    showError, hideError, setAnalyzing, showResults,
    initMovesList, updateMoveElement, updateProgress,
    updatePlayerStats, updateChart, showEmptyBoard, showPosition, resizeBoard,
    // Fim da análise da partida: a barra ao vivo volta a analisar a posição mostrada.
    refreshLive: () => { if (!FreePlay.isActive()) _barraRevisao(_fenRevisao()); }
  };
})();
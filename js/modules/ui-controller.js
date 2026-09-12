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
    accWhiteName:      document.getElementById('acc-white-name'),
    accBlackName:      document.getElementById('acc-black-name'),
    accWhitePct:       document.getElementById('acc-white-pct'),
    accBlackPct:       document.getElementById('acc-black-pct'),
    accWhiteBar:       document.getElementById('acc-white-bar'),
    accBlackBar:       document.getElementById('acc-black-bar'),
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
    const maxW = Math.min(window.innerWidth * 0.38, 560);
    return Math.max(320, Math.floor(maxW / 8) * 8);
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

    // ── Free play button ──────────────────────────────────────
    const btnFP = document.getElementById('btn-free-play');
    if (btnFP) {
      btnFP.addEventListener('click', () => {
        if (FreePlay.isActive()) _exitFreePlay(); else _enterFreePlay();
      });
    }

    // ── Free play back/forward buttons ─────────────────────────
    const btnFPBack = document.getElementById('free-play-back');
    if (btnFPBack) btnFPBack.addEventListener('click', () => FreePlay.undoMove());
    const btnFPFwd = document.getElementById('free-play-forward');
    if (btnFPFwd) btnFPFwd.addEventListener('click', () => FreePlay.goForward());

    // ── Free play exit button ─────────────────────────────────
    const btnFPExit = document.getElementById('free-play-exit');
    if (btnFPExit) btnFPExit.addEventListener('click', () => _exitFreePlay());

    // ── Board click for free play ────────────────────────────
    document.getElementById('board-canvas').addEventListener('click', (e) => {
      if (!FreePlay.isActive()) return;
      const rect = e.target.getBoundingClientRect();
      const sq = BoardUI.xyToSq(e.clientX - rect.left, e.clientY - rect.top);
      FreePlay.handleClick(sq);
    });

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
        const ok = FreePlay.isActive()
          ? await FreePlay.copyPGN()
          : await PGNExporter.copyGame(parsedGameRef);
        _flashPgnFeedback(btnExport, ok ? 'PGN copiado!' : 'Não foi possível copiar.');
      });
      if (btnDownload) btnDownload.addEventListener('click', () => {
        pgnMenu.hidden = true;
        if (FreePlay.isActive()) { FreePlay.exportPGN(); return; }
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

  // ── Entrar/sair do Modo Livre ────────────────────────────────
  // "Sair" NUNCA apaga o que foi feito: só pausa a edição (o tabuleiro, a
  // lista de lances e o gráfico continuam mostrando a árvore como estava).
  // Clicar em "Modo Livre" de novo retoma exatamente do mesmo ponto — só
  // recomeça do zero se a árvore tiver sido descartada de vez (nova
  // análise carregada, ou "Limpar"; ver showResults()).
  function _enterFreePlay() {
    const btnFP = document.getElementById('btn-free-play');
    if (btnFP) btnFP.classList.add('active');
    document.getElementById('btn-free-play-label').textContent = 'Sair do Modo Livre';
    ArrowSystem.clearManual();

    if (FreePlay.hasTree()) {
      console.log('[DEBUG] 🎮 Retomando o Modo Livre — árvore existente preservada');
      FreePlay.resume(() => renderBranch());
      return;
    }

    const startFEN = currentMoveIdx < 0
      ? PGNParser.INITIAL_FEN
      : (parsedGameRef && parsedGameRef.fensAfter[currentMoveIdx]) || PGNParser.INITIAL_FEN;
    console.log(`[DEBUG] 🎮 Entrando no Modo Livre — FEN: ${startFEN.slice(0, 40)}…`);
    EngineSuggestion.updateArrow(null);

    const baseIdx = currentMoveIdx;
    const baseCtx = {
      idx: baseIdx,
      moves: parsedGameRef ? parsedGameRef.moves.slice(0, baseIdx + 1) : [],
      movesData: parsedGameRef && parsedGameRef.movesData ? parsedGameRef.movesData.slice(0, baseIdx + 1) : []
    };
    _branchBaseCtx = baseCtx;

    FreePlay.start(
      startFEN,
      parsedGameRef ? parsedGameRef.headers : {},
      baseCtx,
      () => renderBranch()
    );
    // Renderiza o board inicial do freeplay
    const board = __fenToBoard8x8(startFEN);
    BoardUI.render(board, null, null, null, []);
    _showClassOverlay(null);  // limpa overlay
  }

  function _exitFreePlay() {
    console.log(`[DEBUG] 🎮 Pausando o Modo Livre — nada é apagado`);
    FreePlay.pause();
    const btnFP = document.getElementById('btn-free-play');
    if (btnFP) btnFP.classList.remove('active');
    document.getElementById('btn-free-play-label').textContent = 'Modo Livre';
    // O tabuleiro e a lista de lances continuam mostrando a árvore atual —
    // nenhuma chamada a _clearBranch()/renderBoardAtMove() aqui de propósito.
  }

  function renderBoardAtMove(idx) {
    if (!parsedGameRef) return;
    const fensAft = parsedGameRef.fensAfter;

    const fen = idx < 0 ? PGNParser.INITIAL_FEN
              : idx < fensAft.length ? fensAft[idx]
              : fensAft[fensAft.length - 1];

    const board = __fenToBoard8x8(fen);

    let fromSq = null, toSq = null;
    if (idx >= 0 && parsedGameRef.moveSquares && parsedGameRef.moveSquares[idx]) {
      fromSq = parsedGameRef.moveSquares[idx].from;
      toSq   = parsedGameRef.moveSquares[idx].to;
    }

    BoardUI.renderWithAnim(board, fromSq, toSq);

    // Engine arrow
    ArrowSystem.clearManual();
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
  function navigate(delta) {
    if (!parsedGameRef) return;
    const max = parsedGameRef.fensAfter.length - 1;
    const newIdx = Math.max(-1, Math.min(max, currentMoveIdx + delta));
    if (newIdx !== currentMoveIdx) renderBoardAtMove(newIdx);
  }

  function navTo(idx) {
    if (!parsedGameRef) return;
    renderBoardAtMove(idx);
  }

  // ── Opening banner ──────────────────────────────────────────
  function updateOpeningBanner(moves) {
    const result = OpeningDetector.detect(moves);
    els.openingBanner.classList.add('visible');
    if (result) {
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
    els.resultsSection.classList.add('visible');
    els.whiteName.textContent    = headers.White || 'White';
    els.blackName.textContent    = headers.Black || 'Black';
    els.accWhiteName.textContent = headers.White || 'Brancas';
    els.accBlackName.textContent = headers.Black || 'Pretas';

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
    let pairDiv = null;
    for (let k = k0; k < path.length; k++) {
      const globalIdx = baseIdx + 1 + k;
      if (globalIdx % 2 === 0 || !pairDiv) {
        pairDiv = document.createElement('div');
        pairDiv.className = 'move-pair';
        pairDiv.dataset.branch = '1';
        const numDiv = document.createElement('div');
        numDiv.className = 'move-number';
        numDiv.textContent = (Math.floor(globalIdx / 2) + 1) + '.';
        pairDiv.appendChild(numDiv);
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

    const btnBack = document.getElementById('free-play-back');
    const btnFwd  = document.getElementById('free-play-forward');
    if (btnBack) btnBack.disabled = !FreePlay.canGoBack();
    if (btnFwd)  btnFwd.disabled  = !FreePlay.canGoForward();
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
    const { phase, done, total, depth } = data;
    const pct         = total > 0 ? (done / total) * 100 : 0;
    const adjustedPct = phase === 1 ? pct * 0.6 : 60 + pct * 0.4;
    els.progressFill.style.width = adjustedPct + '%';
    els.progressTitle.textContent = phase === 1
      ? `Fase 1 — Análise rápida (depth ${depth})`
      : `Fase 2 — Refinamento (depth ${depth})`;
    els.progressDepth.textContent = `depth ${depth}`;
    els.progressMoves.textContent = `${done} / ${total} posições`;
    els.phaseText.textContent     = `Fase ${phase}`;
    if (analysisStartTime && done > 0) {
      const elapsed = (Date.now() - analysisStartTime) / 1000;
      const eta     = (total - done) / (done / elapsed);
      els.progressEta.textContent = eta < 60
        ? `~${Math.ceil(eta)}s restantes`
        : `~${Math.ceil(eta / 60)}min restantes`;
    }
  }

  function updatePlayerStats(movesData) {
    // Store reference for board nav
    if (parsedGameRef) parsedGameRef.movesData = movesData;

    const wStats = MoveClassifier.computeStats(movesData, true);
    const bStats = MoveClassifier.computeStats(movesData, false);

    // ── Correlação de nível entre os dois lados ─────────────────────────
    // fromACPL avalia cada jogador isolado. Aqui corrigimos o caso em que
    // um lado forte perde para outro lado forte e acaba com um rating
    // artificialmente baixo (ex.: GM perdendo pra GM caindo a 1600-2150).
    // Só o lado mais fraco pode subir, nunca ultrapassa o mais forte, e só
    // sobe se não houver sinais reais de que jogou mal (ver rating-model.js).
    const wRatingFinal = RatingModel.correlateOpponents(wStats.rating, wStats, bStats.rating);
    const bRatingFinal = RatingModel.correlateOpponents(bStats.rating, bStats, wStats.rating);

    els.whiteRating.textContent  = wRatingFinal;
    els.whiteAcpl.textContent    = wStats.acpl;
    els.whiteAcc.textContent     = wStats.accuracy + '%';
    els.whiteMistakes.textContent = movesData.filter(m => m.color==='white' && m.classification==='mistake').length;
    els.whiteBlunders.textContent = movesData.filter(m => m.color==='white' && m.classification==='blunder').length;

    els.blackRating.textContent  = bRatingFinal;
    els.blackAcpl.textContent    = bStats.acpl;
    els.blackAcc.textContent     = bStats.accuracy + '%';
    els.blackMistakes.textContent = movesData.filter(m => m.color==='black' && m.classification==='mistake').length;
    els.blackBlunders.textContent = movesData.filter(m => m.color==='black' && m.classification==='blunder').length;

    els.accWhitePct.textContent = wStats.accuracy + '%';
    els.accBlackPct.textContent = bStats.accuracy + '%';
    els.accWhiteBar.style.width = wStats.accuracy + '%';
    els.accBlackBar.style.width = bStats.accuracy + '%';

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
    if (valid.length > 0) ChartRenderer.render(els.chart, valid, activeIdx);
  }

  // ── Keyboard nav ─────────────────────────────────────────────
  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft')  navigate(-1);
      if (e.key === 'ArrowRight') navigate(+1);
      if (e.key === 'ArrowUp' || e.key === 'Home') navTo(-1);
      if (e.key === 'ArrowDown' || e.key === 'End') {
        if (parsedGameRef) navTo(parsedGameRef.fensAfter.length - 1);
      }
    });

    els.navStart.addEventListener('click', () => navTo(-1));
    els.navPrev.addEventListener('click',  () => navigate(-1));
    els.navNext.addEventListener('click',  () => navigate(+1));
    els.navEnd.addEventListener('click',   () => {
      if (parsedGameRef) navTo(parsedGameRef.fensAfter.length - 1);
    });
  }

  setupKeyboard();

  return {
    showError, hideError, setAnalyzing, showResults,
    initMovesList, updateMoveElement, updateProgress,
    updatePlayerStats, updateChart, showEmptyBoard
  };
})();
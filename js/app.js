/* ==============================================================
   MODULE: app.js
   App Controller — orquestra a análise, liga os callbacks entre
   AnalysisEngine, UIController e InsightsUI, e inicializa a página.
   Depende de: TODOS os módulos anteriores (ver index.html para a
               ordem correta de carregamento dos <script>).
   ============================================================== */
const App = (() => {
  let stockfishReady = false;
  let analyzing      = false;
  let currentMovesData = [];

  async function initStockfish() {
    try {
      await StockfishManager.init();
      stockfishReady = true;
      console.log('[App] Stockfish pronto');
    } catch (err) {
      console.error('[App] Stockfish falhou:', err);
      UIController.showError(
        'Não foi possível carregar o motor Stockfish. Verifique sua conexão e recarregue a página. ' +
        'Se o problema continuar, avise pela página de Contato.'
      );
    }
  }

  function setupResize() {
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        UIController.resizeBoard();
        if (currentMovesData.length > 0) UIController.updateChart(currentMovesData);
        else ChartRenderer.clear(document.getElementById('chart'));
      }, 200);
    });
  }

  async function runAnalysis() {
    const pgn = document.getElementById('pgn-input').value.trim();
    if (!pgn) { UIController.showError('Cole um PGN válido antes de analisar.'); return; }

    let parsedGame;
    try {
      parsedGame = PGNParser.parsePGN(pgn);
      if (!parsedGame.moves.length) { UIController.showError('Nenhum lance encontrado no PGN.'); return; }
    } catch (err) { UIController.showError('Erro ao parsear PGN: ' + err.message); return; }

    if (!stockfishReady) { UIController.showError('Stockfish ainda não está pronto.'); return; }

    UIController.hideError();

    // Toda transição pra uma nova análise reinicia do zero: aborta
    // qualquer análise anterior ainda rodando (o motor realmente para, não
    // só a UI). UIController.showResults() abaixo descarta a árvore do
    // Modo Livre anterior, se houver uma.
    if (analyzing) { AnalysisEngine.abort(); analyzing = false; UIController.setAnalyzing(false); }

    analyzing = true;
    UIController.setAnalyzing(true);
    UIController.showResults(parsedGame);
    UIController.initMovesList(parsedGame);
    currentMovesData = [];
    // Recursos de exportação do Pro e histórico local usam o resultado pronto.
    ProTools.setGame(parsedGame);
    const deepMode = document.getElementById('pro-deep-toggle')?.checked ?? false;

    AnalysisEngine.setCallbacks({
      onProgress(data) {
        UIController.updateProgress(data);
        if (data.movesData) {
          currentMovesData = data.movesData;
          UIController.updateChart(data.movesData);
          UIController.updatePlayerStats(data.movesData);
        }
        // ── INSIGHTS PROGRESSIVOS (Gambyte Pro) ──────────────────────
        // depthComplete=true garante que dispara exatamente uma vez por depth,
        // independente de quantos lances foram pulados por estabilidade.
        if (data.phase === 2 && data.depthComplete && data.depth >= 14 && data.movesData) {
          const isProMode = document.getElementById('pro-deep-toggle')?.checked ?? false;
          const isPartial = isProMode && data.depth < 20;
          if (parsedGame) parsedGame.movesData = data.movesData;
          InsightsUI.renderGlobalInsights(data.movesData, isPartial);
        }
      },
      onMoveUpdate(moveData, allMoves) {
        currentMovesData = allMoves;
        UIController.updateMoveElement(moveData);
        UIController.updatePlayerStats(allMoves);
        UIController.updateChart(allMoves);
      },
      onComplete(allMoves) {
        currentMovesData = allMoves;
        // Attach movesData to parsedGame so renderBoardAtMove can access per-move data
        if (parsedGame) parsedGame.movesData = allMoves;
        UIController.updatePlayerStats(allMoves);
        UIController.updateChart(allMoves);
        UIController.setAnalyzing(false);
        analyzing = false;
        for (const m of allMoves) UIController.updateMoveElement(m);
        document.getElementById('progress-fill').style.width = '100%';
        document.getElementById('progress-title').textContent = 'Análise concluída';
        document.getElementById('progress-container').classList.remove('visible');
        // ── INSIGHTS FINAIS (sempre atualiza ao completar) ──
        InsightsUI.renderGlobalInsights(allMoves, /*isPartial=*/false);
        ProTools.markComplete(deepMode ? 22 : 16);
        if (deepMode) {
          const revisados = allMoves.filter(m => m._deepRefined && !m.isCheckmate);
          const completos = revisados.filter(m => (m.depthReached || 0) >= 22).length;
          AuthUI.showToast(revisados.length
            ? `Análise Profunda concluída: ${completos} de ${revisados.length} lances revisados chegaram à profundidade 22.`
            : 'Análise Profunda concluída: as avaliações já estavam estáveis antes da profundidade 22.', 'success');
        }
        GameHistory.save(parsedGame, allMoves, pgn);
      }
    });

    try {
      await AnalysisEngine.analyze(parsedGame);
    } catch (err) {
      UIController.showError('Erro durante análise: ' + err.message);
      UIController.setAnalyzing(false);
      analyzing = false;
    }
  }

  // A coluna do meio (classificações + lances) termina exatamente onde
  // termina a coluna do tabuleiro (no fim do gráfico de vantagem); a lista
  // de lances rola por dentro. No celular as colunas empilham e nada muda.
  function setupAlinhamento() {
    const board = document.querySelector('.board-panel');
    const mid = document.querySelector('.middle-panel');
    if (!board || !mid) return;
    const sum = document.querySelector('.summary-panel');
    const alinhar = (el) => {
      if (!el) return;
      const topoB = board.getBoundingClientRect().top;
      const mesmaLinha = window.innerWidth > 760 && Math.abs(el.getBoundingClientRect().top - topoB) < 4;
      el.style.height = mesmaLinha ? board.offsetHeight + 'px' : '';
      el.classList.toggle('alinhado', mesmaLinha);
    };
    // Coluna da direita: se o conteúdo passar da altura, primeiro a lista de
    // partidas encolhe (rola por dentro), depois o painel de resumo.
    const lista = document.getElementById('imp-list');
    const resumo = document.getElementById('insights-section');
    const ajustarDireita = () => {
      if (!sum || !lista || !resumo) return;
      lista.style.maxHeight = ''; resumo.style.maxHeight = '';
      if (!sum.classList.contains('alinhado')) return;
      let excesso = sum.scrollHeight - sum.clientHeight;
      if (excesso <= 0) return;
      if (lista.offsetHeight > 0) {
        const alvo = Math.max(120, lista.offsetHeight - excesso);
        excesso -= lista.offsetHeight - alvo;
        lista.style.maxHeight = alvo + 'px';
      }
      if (excesso > 0 && resumo.offsetHeight > 0) {
        resumo.style.maxHeight = Math.max(240, resumo.offsetHeight - excesso) + 'px';
      }
    };
    let pendente = false;
    const sync = () => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => { pendente = false; alinhar(mid); alinhar(sum); ajustarDireita(); });
    };
    if (window.ResizeObserver) new ResizeObserver(sync).observe(board);
    if (sum && window.MutationObserver) {
      new MutationObserver(sync).observe(sum, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    window.addEventListener('resize', sync);
    sync();
  }

  function init() {
    setupResize();
    setupAlinhamento();
    initStockfish();

    document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
    document.getElementById('pgn-input').addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'Enter') runAnalysis();
    });
    // Colou outra partida no meio de uma análise: o botão volta a valer e
    // troca de partida (a análise atual é interrompida em runAnalysis).
    document.getElementById('pgn-input').addEventListener('input', () => {
      if (!analyzing) return;
      const b = document.getElementById('btn-analyze');
      b.disabled = false;
      b.textContent = 'Analisar esta partida';
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
      document.getElementById('pgn-input').value = '';
      document.getElementById('progress-container').classList.remove('visible');
      UIController.hideError();
      currentMovesData = [];
      // Reinicia do zero: para a análise que estivesse rodando de verdade
      // (não só a UI) e volta pro tabuleiro vazio em branco.
      if (analyzing) { AnalysisEngine.abort(); analyzing = false; UIController.setAnalyzing(false); }
      UIController.showEmptyBoard();
    });

    // O tabuleiro já aparece pronto pra uso antes mesmo de colar um PGN —
    // como se o Modo Livre estivesse sempre ativo por padrão.
    UIController.showEmptyBoard();
  }

  return { init, run: runAnalysis };
})();

document.addEventListener('DOMContentLoaded', () => {
  AuthUI.init();
  App.init();
  InsightsUI.init();
});

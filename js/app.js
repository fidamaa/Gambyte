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
        'Não foi possível carregar Stockfish. Verifique se "stockfish-18-single.js/.wasm" ' +
        'e "stockfish-18-multi.js/.wasm" estão na mesma pasta que este HTML.'
      );
    }
  }

  function setupResize() {
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (currentMovesData.length > 0) UIController.updateChart(currentMovesData);
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

  function init() {
    setupResize();
    initStockfish();

    document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
    document.getElementById('pgn-input').addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'Enter') runAnalysis();
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

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  AuthUI.init();
  App.init();
  InsightsUI.init();
});

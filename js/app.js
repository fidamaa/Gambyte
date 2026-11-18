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

    // Um FEN no lugar do PGN: abre a posição no tabuleiro livre.
    if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/.test(pgn)) {
      const erro = PhotoPosition.abrirFEN(pgn);
      if (erro) UIController.showError(erro);
      else document.getElementById('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    let parsedGame;
    try {
      parsedGame = PGNParser.parsePGN(pgn);
      if (!parsedGame.moves.length) { UIController.showError('Nenhum lance encontrado no PGN.'); return; }
    } catch (err) { UIController.showError('Erro ao parsear PGN: ' + err.message); return; }

    if (!stockfishReady) { UIController.showError('Stockfish ainda não está pronto.'); return; }

    UIController.hideError();
    // No celular a caixa da partida fica no topo: ao analisar, desce até
    // os jogadores e o tabuleiro.
    // (espera a barra de progresso aparecer, senão a rolagem para antes).
    if (window.matchMedia && matchMedia('(max-width:760px)').matches) {
      const jogadores = () => document.querySelector('#results-section .players-row');
      setTimeout(() => jogadores()?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
      // A caixa de cima encolhe um pouco quando a análise começa: confere de novo.
      setTimeout(() => {
        const el = jogadores();
        if (el && Math.abs(el.getBoundingClientRect().top - 8) > 24) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 1400);
    }

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
        UIController.refreshLive();
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
      // Aba da foto aberta: o cartão de destaque do resumo é redundante e,
      // se ainda faltar espaço, a chamada da aba fica mais curta. (Estilo e
      // data-*, que o MutationObserver abaixo não observa.)
      const seFoto = sum.querySelector('.se-foto'), fotoBox = document.getElementById('foto-box');
      if (seFoto) seFoto.style.display = '';
      if (fotoBox) delete fotoBox.dataset.compacta;
      if (!sum.classList.contains('alinhado')) return;
      let excesso = sum.scrollHeight - sum.clientHeight;
      if (excesso <= 0) return;
      if (fotoBox && !fotoBox.hidden) {
        if (seFoto && seFoto.offsetHeight) { excesso -= seFoto.offsetHeight + 12; seFoto.style.display = 'none'; }
        if (excesso > 0) { fotoBox.dataset.compacta = '1'; excesso = sum.scrollHeight - sum.clientHeight; }
        if (excesso <= 0) return;
      }
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

    // Vitrine do Pro (só aparece no celular): some para quem já é Pro.
    const vitrine = document.getElementById('pro-vitrine');
    if (vitrine && typeof AuthSystem !== 'undefined') {
      const ajustar = () => { vitrine.hidden = AuthSystem.isPremium(); };
      ajustar();
      AuthSystem.onChange(ajustar);
    }
  }

  // Abre uma posição montada (foto ou print do tabuleiro): para a análise
  // que estiver rodando e deixa o tabuleiro livre a partir dela.
  function loadPosition(fen, brancasEmbaixo) {
    if (analyzing) { AnalysisEngine.abort(); analyzing = false; UIController.setAnalyzing(false); }
    document.getElementById('progress-container').classList.remove('visible');
    UIController.hideError();
    currentMovesData = [];
    UIController.showPosition(fen, brancasEmbaixo);
  }

  return { init, run: runAnalysis, loadPosition };
})();

document.addEventListener('DOMContentLoaded', () => {
  AuthUI.init();
  App.init();
  InsightsUI.init();
});

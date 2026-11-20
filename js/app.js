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

  // Aviso embaixo do botão Analisar: Lite (rápido, 7 MB) e completo
  // (108 MB, carrega sozinho em segundo plano e entra quando termina).
  function mostrarMotores(info) {
    const box = document.getElementById('motor-status');
    if (!box) return;
    const lite = box.querySelector('[data-motor="lite"]'), full = box.querySelector('[data-motor="full"]');
    const por = (el, estado, txt) => { el.dataset.estado = estado; el.querySelector('.motor-txt').textContent = txt; };
    const k = info && info.kind;
    const juntos = info && info.motores > 1 ? ` (${info.motores} ao mesmo tempo)` : '';
    if (!k) por(lite, 'carregando', 'Carregando o motor rápido (7 MB)…');
    else if (k === 'lite') por(lite, 'ativo', 'Motor rápido pronto: já dá para analisar' + juntos);
    else por(lite, 'pronto', 'Motor rápido carregado');
    if (k === 'full') por(full, 'ativo', 'Motor completo em uso: avaliações ainda melhores' + juntos);
    else if (info && info.esperando) por(full, 'pronto', 'Motor completo pronto: entra na próxima análise');
    else if (info && info.carregandoCompleto) {
      const p = info.progresso;
      por(full, 'carregando', info.doAparelho ? 'Motor completo: abrindo o que já está salvo no aparelho…'
        : p != null && p < 100 ? `Motor completo baixando: ${p}% de 108 MB. Entra sozinho quando terminar`
        : 'Motor completo carregando (108 MB). Entra sozinho quando terminar');
    }
    else if (info && info.lenta) por(full, 'off', 'Internet lenta agora: seguindo só com o motor rápido, sem gastar seus dados');
    else if (info && info.falhou) por(full, 'off', 'Motor completo não carregou. A análise segue com o rápido');
    else por(full, 'off', 'Motor completo: aguardando');
  }
  window.addEventListener('stockfish-motor', e => mostrarMotores(e.detail));

  // ── Motor ainda carregando: espera e começa sozinho ─────────
  // Em vez de "não está pronto", diz quanto falta (estimado pela
  // velocidade da internet da pessoa) e inicia a análise assim que o
  // motor fica pronto — para ninguém achar que o site não funciona.
  let inicioMotor = performance.now();
  let motorFalhou = false;
  let esperaTimer = null;
  // Velocidade real da internet, medida pelos arquivos que a própria
  // página já baixou (bytes por segundo). null = tudo veio do cache.
  function _velocidade() {
    let bytes = 0, tempo = 0;
    for (const e of performance.getEntriesByType('resource')) {
      if (e.transferSize > 30000 && e.duration > 0) { bytes += e.transferSize; tempo += e.duration / 1000; }
    }
    return bytes > 100000 && tempo > 0 ? bytes / tempo : null;
  }
  function _faltaMotor() {
    const passou = (performance.now() - inicioMotor) / 1000;
    const bps = _velocidade();
    // 7,3 MB do motor rápido + ~1 s para ele iniciar.
    const total = bps ? 7300000 / bps + 1 : 2;
    return Math.min(40, Math.ceil(total - passou));
  }
  function aguardarMotor() {
    if (esperaTimer) return;
    const caixa = document.getElementById('error-msg');
    const mostrar = () => {
      const f = _faltaMotor();
      UIController.showError(f > 1
        ? `O motor ainda está carregando. Aguarde cerca de ${f} segundos: a análise começa sozinha.`
        : 'O motor ainda está carregando. Só mais alguns segundos: a análise começa sozinha.');
      caixa && caixa.classList.add('aviso');
    };
    mostrar();
    esperaTimer = setInterval(() => {
      if (motorFalhou) { clearInterval(esperaTimer); esperaTimer = null; caixa && caixa.classList.remove('aviso'); return; }
      if (stockfishReady) {
        clearInterval(esperaTimer); esperaTimer = null;
        caixa && caixa.classList.remove('aviso');
        UIController.hideError();
        runAnalysis();
        return;
      }
      mostrar();
    }, 250);
  }

  async function initStockfish() {
    inicioMotor = performance.now();
    mostrarMotores(null);
    try {
      await StockfishManager.init();
      mostrarMotores(StockfishManager.getEngineInfo());
      stockfishReady = true;
      console.log('[App] Stockfish pronto');
    } catch (err) {
      console.error('[App] Stockfish falhou:', err);
      motorFalhou = true;
      document.getElementById('error-msg')?.classList.remove('aviso');
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

    if (!stockfishReady) { aguardarMotor(); return; }

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
        window.dispatchEvent(new CustomEvent('gambyte:analise-concluida'));
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

    // Celular: a faixa da abertura (e do progresso) fica logo acima do
    // tabuleiro, abaixo dos jogadores. No computador volta para o lugar.
    const faixa = document.querySelector('.game-strip');
    const painel = document.querySelector('.analysis-layout > .board-panel');
    if (faixa && painel && window.matchMedia) {
      const origem = document.createComment('lugar da faixa da partida');
      faixa.parentNode.insertBefore(origem, faixa);
      const mq = matchMedia('(max-width:760px)');
      const posicionar = () => {
        if (mq.matches) painel.parentNode.insertBefore(faixa, painel);
        else origem.parentNode.insertBefore(faixa, origem.nextSibling);
      };
      posicionar();
      mq.addEventListener ? mq.addEventListener('change', posicionar) : mq.addListener(posicionar);
    }

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

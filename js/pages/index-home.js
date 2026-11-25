/* Página inicial: partidas de exemplo (botão e link ?exemplo=id vindo dos
   artigos) e inicialização dos recursos extras. Depende de sample-games.js. */
(function () {
  const campo = document.getElementById('pgn-input');
  const botao = document.getElementById('btn-sample');
  const ids = typeof SAMPLE_GAMES === 'object' ? Object.keys(SAMPLE_GAMES) : [];
  let proximo = 0;

  function carregar(id, avisar) {
    const jogo = SAMPLE_GAMES[id];
    if (!jogo || !campo) return false;
    campo.value = jogo.pgn;
    if (avisar) AuthUI.showToast(`Exemplo carregado: ${jogo.titulo}. Clique em Analisar Partida.`, 'success');
    return true;
  }

  if (botao && ids.length) {
    botao.addEventListener('click', () => {
      carregar(ids[proximo % ids.length], true);
      proximo++;
      campo.focus();
    });
  } else if (botao) {
    botao.hidden = true;
  }

  // Botão da primeira tela: carrega a Partida da Ópera e já analisa,
  // para quem chega ver na hora o que o Gambyte mostra.
  const demo = document.getElementById('btn-demo');
  if (demo && ids.includes('opera')) {
    demo.addEventListener('click', () => {
      if (!carregar('opera', false)) return;
      proximo = ids.indexOf('opera') + 1;
      if (typeof GameImport !== 'undefined') GameImport.mostrarAba('pgn');
      AuthUI.showToast('Analisando a Partida da Ópera (Morphy, 1858). Acompanhe no tabuleiro.', 'success');
      if (typeof App !== 'undefined' && App.run) App.run();
      else document.getElementById('btn-analyze')?.click();
      document.getElementById('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } else if (demo) {
    demo.closest('.demo-cta').hidden = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    ProTools.init();
    GameHistory.init();
    if (typeof GameDNA !== "undefined") GameDNA.init();
    GameImport.init();
    // Partida que veio do "Jogar contra o bot": abre e já analisa.
    const params = new URLSearchParams(location.search);
    if (params.get('analisar') === 'bot') {
      let pgn = null;
      try { pgn = sessionStorage.getItem('gambyte_pgn_analisar'); sessionStorage.removeItem('gambyte_pgn_analisar'); } catch (e) { /* sem armazenamento */ }
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ok */ }
      if (pgn && campo) {
        campo.value = pgn;
        GameImport.mostrarAba('pgn');
        AuthUI.showToast('Analisando a sua partida contra o bot. Acompanhe no tabuleiro.', 'success');
        if (typeof App !== 'undefined' && App.run) App.run();
        else document.getElementById('btn-analyze')?.click();
        document.getElementById('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    const pedido = params.get('exemplo');
    if (pedido && ids.includes(pedido)) {
      proximo = ids.indexOf(pedido) + 1;
      if (carregar(pedido, true)) { GameImport.mostrarAba('pgn'); campo.scrollIntoView({ block: 'center' }); }
    }
    // ?fen=... vindo do botão "Abrir no tabuleiro" dos diagramas do Aprender:
    // a posição abre no tabuleiro livre, como se o FEN tivesse sido colado.
    const fen = new URLSearchParams(location.search).get('fen');
    if (fen && /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}\s+[wb]\b/.test(fen.trim()) && campo && typeof PhotoPosition !== 'undefined') {
      campo.value = fen.trim();
      GameImport.mostrarAba('pgn');
      setTimeout(() => {
        const erro = PhotoPosition.abrirFEN(fen.trim());
        if (erro) { AuthUI.showToast(erro, 'error'); return; }
        AuthUI.showToast('Posição do artigo aberta no tabuleiro. Mexa as peças à vontade.', 'success');
        document.getElementById('board-wrapper')?.scrollIntoView({ block: 'center' });
      }, 0);
    }
  });
})();

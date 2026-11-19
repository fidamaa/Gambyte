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
    GameImport.init();
    const pedido = new URLSearchParams(location.search).get('exemplo');
    if (pedido && ids.includes(pedido)) {
      proximo = ids.indexOf(pedido) + 1;
      if (carregar(pedido, true)) { GameImport.mostrarAba('pgn'); campo.scrollIntoView({ block: 'center' }); }
    }
  });
})();

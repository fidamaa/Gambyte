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

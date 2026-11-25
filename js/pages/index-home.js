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

  // Partidas clássicas (js/data/partidas-classicas.js), em ordem sorteada.
  const classicas = typeof PARTIDAS_CLASSICAS !== 'undefined' ? PARTIDAS_CLASSICAS.slice() : [];
  for (let i = classicas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [classicas[i], classicas[j]] = [classicas[j], classicas[i]];
  }
  let vez = 0;
  const classica = () => classicas[vez % classicas.length];

  if (botao && (classicas.length || ids.length)) {
    botao.addEventListener('click', () => {
      if (classicas.length && campo) {
        const p = classica(); vez++;
        campo.value = p.pgn;
        AuthUI.showToast(`Exemplo carregado: ${p.nome} (${p.quem}). Clique em Analisar Partida.`, 'success');
        mostrarNome(false);
      } else {
        carregar(ids[proximo % ids.length], true);
        proximo++;
      }
      campo.focus();
    });
  } else if (botao) {
    botao.hidden = true;
  }

  // Botão "Ver uma análise de exemplo": o nome embaixo dele vai mudando
  // entre as partidas clássicas; o clique analisa a que está aparecendo.
  const demo = document.getElementById('btn-demo');
  const nomeDemo = demo && demo.querySelector('small');
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mostrarNome(animar) {
    if (!nomeDemo || !classicas.length) return;
    const p = classica();
    const trocar = () => { nomeDemo.textContent = `${p.nome} · ${p.quem}`; };
    if (!animar || calmo || !nomeDemo.animate) { trocar(); return; }
    nomeDemo.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 180, easing: 'ease-in' })
      .finished.then(() => {
        trocar();
        nomeDemo.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
      }).catch(trocar);
  }
  if (demo && classicas.length) {
    mostrarNome(false);
    // Gira a cada poucos segundos (para enquanto o mouse ou o foco está nele).
    let parado = false;
    for (const [ev, v] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]]) demo.addEventListener(ev, () => { parado = v; });
    setInterval(() => {
      if (parado || document.hidden || !demo.offsetParent) return;
      vez++; mostrarNome(true);
    }, 3500);
  }
  if (demo && (classicas.length || ids.includes('opera'))) {
    demo.addEventListener('click', () => {
      let titulo = 'a Partida da Ópera (Morphy, 1858)';
      if (classicas.length && campo) {
        const p = classica();
        campo.value = p.pgn;
        titulo = `${p.nome.replace(/^(A|O) /, m => m.toLowerCase())} (${p.quem})`;
        vez++; mostrarNome(false);
      } else {
        if (!carregar('opera', false)) return;
        proximo = ids.indexOf('opera') + 1;
      }
      if (typeof GameImport !== 'undefined') GameImport.mostrarAba('pgn');
      AuthUI.showToast(`Analisando ${titulo}. Acompanhe no tabuleiro.`, 'success');
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
    // ?abrir=<id>: reabre uma partida do histórico (página Seu DNA)
    const abrir = params.get('abrir');
    if (abrir && campo && typeof PlayerDNA !== 'undefined') {
      const pgnSalvo = PlayerDNA.pgnDe(abrir);
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ok */ }
      if (pgnSalvo) {
        campo.value = pgnSalvo;
        GameImport.mostrarAba('pgn');
        AuthUI.showToast('Reabrindo a partida do seu histórico.', 'success');
        if (typeof App !== 'undefined' && App.run) App.run(); else document.getElementById('btn-analyze')?.click();
        document.getElementById('analise')?.scrollIntoView({ block: 'start' });
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

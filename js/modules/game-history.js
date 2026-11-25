/* ==============================================================
   MODULE: game-history.js
   Histórico das últimas análises, guardado SOMENTE neste navegador
   (localStorage). Nada é enviado ao servidor. Cada entrada guarda o
   PGN e o resumo da análise, para o assinante Pro reabrir uma partida
   antiga e acompanhar a própria evolução.

   O registro é feito para todos (assim o histórico já existe no dia em
   que a pessoa assina); a lista e a reabertura são recursos do Pro.
   Depende de: insights-engine.js, auth-system.js, auth-ui.js
   ============================================================== */
const GameHistory = (() => {
  const KEY = 'gambyte_history_v1';
  const MAX = 30;

  function ler() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function gravar(lista) {
    try { localStorage.setItem(KEY, JSON.stringify(lista.slice(0, MAX))); } catch (e) { /* armazenamento cheio ou bloqueado */ }
  }

  function save(parsedGame, movesData, pgn) {
    if (!parsedGame || !movesData || !movesData.length || !pgn) return;
    const h = parsedGame.headers || {};
    const lances = parsedGame.moves.join(' ');
    const item = {
      id: Date.now(),
      quando: new Date().toISOString(),
      brancas: h.White || 'Brancas',
      pretas: h.Black || 'Pretas',
      resultado: h.Result || '*',
      abertura: ((document.getElementById('opening-name') || {}).textContent || '').replace(/Detectando.*|Fora de livro/, '').trim(),
      accB: InsightsEngine.calcAccuracy(movesData, 'white'),
      accP: InsightsEngine.calcAccuracy(movesData, 'black'),
      gafes: movesData.filter(m => m.classification === 'blunder').length,
      total: parsedGame.moves.length,
      pgn: pgn.slice(0, 20000),
      chave: lances,
    };
    // reanalisar a mesma partida atualiza a entrada em vez de duplicar
    const lista = ler().filter(x => x.chave !== lances);
    lista.unshift(item);
    gravar(lista);
    render();
  }

  function esc(s) { return AuthSystem.escapeHTML(s); }

  // A lista completa (com evolução, comparação e reabertura) fica na página
  // Seu DNA → Histórico; aqui só um atalho, para não repetir a mesma coisa.
  function render() {
    const box = document.getElementById('history-panel');
    if (!box) return;
    let n = 0;
    try { n = (JSON.parse(localStorage.getItem('gambyte_dna_v1') || '[]') || []).length; } catch (e) { n = 0; }
    n = Math.max(n, ler().length);
    if (!n) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<a class="hist-atalho" href="/dna#historico"><span><strong>${n} ${n === 1 ? 'partida analisada' : 'partidas analisadas'} neste aparelho.</strong> Veja a evolução do seu rating estimado, compare períodos e reabra análises.</span><span class="hist-atalho-ir">Histórico</span></a>`;
  }

  // Reabre uma partida do histórico: ela sobe para o topo da lista (sem
  // repetir) e a análise começa na hora, como na busca por usuário.
  function abrir(id) {
    const lista = ler();
    const item = lista.find(x => String(x.id) === String(id));
    const campo = document.getElementById('pgn-input');
    if (!item || !campo) return;
    gravar([item, ...lista.filter(x => x !== item && x.chave !== item.chave)]);
    render();
    campo.value = item.pgn;
    if (typeof GameImport !== 'undefined' && GameImport.mostrarAba) GameImport.mostrarAba('pgn');
    AuthUI.showToast(`Analisando ${item.brancas} x ${item.pretas}.`, 'success');
    // App.run interrompe uma análise em andamento; o botão ficaria desativado.
    if (typeof App !== 'undefined' && App.run) App.run();
    else document.getElementById('btn-analyze')?.click();
    document.getElementById('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function init() {
    const box = document.getElementById('history-panel');
    if (!box) return;
    box.addEventListener('toggle', e => { if (e.target.matches('details.hist')) box.dataset.aberto = e.target.open ? '1' : '0'; }, true);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-hist]');
      if (!b) return;
      if (b.dataset.hist === 'pro') { AuthUI.openPremiumPage(); return; }
      if (b.dataset.hist === 'limpar') {
        if (b.dataset.confirma !== '1') { b.dataset.confirma = '1'; b.textContent = 'Clique de novo para confirmar'; return; }
        try { localStorage.removeItem(KEY); } catch (err) { /* nada a fazer */ }
        render();
        return;
      }
      if (b.dataset.hist === 'abrir') abrir(b.dataset.id);
    });
    AuthSystem.onChange(render);
    render();
  }

  return { init, save };
})();

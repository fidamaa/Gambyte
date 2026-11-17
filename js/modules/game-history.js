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

  function render() {
    const box = document.getElementById('history-panel');
    if (!box) return;
    const lista = ler();
    if (!lista.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;

    if (!AuthSystem.isPremium()) {
      box.innerHTML = `<div class="hist-teaser"><span><strong>${lista.length} ${lista.length === 1 ? 'análise guardada' : 'análises guardadas'} neste aparelho.</strong> A lista, com reabertura das partidas e precisão média, faz parte do Gambyte Pro.</span><button type="button" class="btn-secondary" data-hist="pro">Conhecer o Pro</button></div>`;
      return;
    }

    const media = k => Math.round(lista.reduce((n, x) => n + (x[k] || 0), 0) / lista.length);
    const linhas = lista.map(x => {
      const d = new Date(x.quando);
      const data = isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<li><button type="button" class="hist-item" data-hist="abrir" data-id="${x.id}" title="Carregar esta partida no campo de PGN">
        <span class="hist-data">${data}</span>
        <span class="hist-nomes">${esc(x.brancas)} <i>x</i> ${esc(x.pretas)}<small>${esc(x.abertura || '')}</small></span>
        <span class="hist-acc" title="Precisão das brancas e das pretas">${x.accB}% · ${x.accP}%</span>
        <span class="hist-res">${esc(x.resultado)}</span>
      </button></li>`;
    }).join('');
    box.innerHTML = `<details class="hist"${box.dataset.aberto === '1' ? ' open' : ''}>
      <summary><span class="section-label">Suas análises neste aparelho</span><span class="hist-resumo">${lista.length} ${lista.length === 1 ? 'partida' : 'partidas'} · precisão média ${media('accB')}% (brancas) e ${media('accP')}% (pretas)</span></summary>
      <ul class="hist-lista">${linhas}</ul>
      <div class="hist-rodape"><span>Guardado só neste navegador. Não é enviado ao servidor.</span><button type="button" class="hist-limpar" data-hist="limpar">Apagar histórico</button></div>
    </details>`;
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
      if (b.dataset.hist === 'abrir') {
        const item = ler().find(x => String(x.id) === b.dataset.id);
        const campo = document.getElementById('pgn-input');
        if (!item || !campo) return;
        campo.value = item.pgn;
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        AuthUI.showToast('Partida carregada. Clique em Analisar Partida.', 'success');
      }
    });
    AuthSystem.onChange(render);
    render();
  }

  return { init, save };
})();

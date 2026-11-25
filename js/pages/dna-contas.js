/* Página /dna: contas vinculadas como fonte do DNA geral.
   Com Chess.com e/ou Lichess vinculados na conta, o DNA usa só as
   partidas dessas contas (as novas entram sozinhas, via DNASync). Sem
   conta vinculada, convida a vincular e mostra, por enquanto, as
   partidas analisadas neste aparelho. */
(function () {
  const $ = id => document.getElementById(id);
  const NOME = { chesscom: 'Chess.com', lichess: 'Lichess' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let sincronizou = false, t = 0, vinculado = false;

  function redesenhar() {
    clearTimeout(t);
    t = setTimeout(() => {
      if (window.DNAPagina) DNAPagina.render();
      window.dispatchEvent(new Event('dna:nomes'));
      // DNA ainda vazio com conta vinculada: explica que está montando
      if (vinculado && !PlayerDNA.ler().length) {
        const v = $('dna-vazio');
        v.querySelector('h2').textContent = 'Montando o seu DNA';
        v.querySelector('p').textContent = 'As suas partidas mais recentes estão sendo analisadas pelo motor, uma por uma. O retrato aparece aqui a partir da primeira e fica mais firme a cada partida.';
        const ac = v.querySelector('.dna-vazio-acoes'); if (ac) ac.hidden = true;
      }
    }, 200);
  }

  function fontes(cs) {
    const sites = Object.keys(cs), atual = DNASync.fonte();
    const box = $('dc-fontes');
    const op = (k, rot) => `<button type="button" data-fonte="${k}" aria-pressed="${atual === k || (sites.length === 1 && k === sites[0])}">${rot}</button>`;
    box.innerHTML = (sites.length > 1 ? op('ambos', 'As duas') : '') +
      sites.map(k => op(k, `${NOME[k]} <small>${esc(cs[k])}</small>`)).join('');
  }

  function aplicar() {
    if (!AuthSystem.isReady()) return;
    const cs = DNASync.contas(), tem = Object.keys(cs).length > 0;
    vinculado = tem;
    document.body.classList.toggle('dna-vinculado', tem);
    PlayerDNA.usarContas(tem ? cs : null, DNASync.fonte());
    $('dna-contas').hidden = !tem;
    $('dna-semconta').hidden = tem;
    if (tem) {
      fontes(cs);
      if (!sincronizou) { sincronizou = true; DNASync.sincronizar(); }
    } else {
      const logado = !!AuthSystem.currentSession();
      $('dsc-tit').textContent = logado ? 'Vincule sua conta do Chess.com ou do Lichess' : 'Entre e vincule sua conta do Chess.com ou do Lichess';
      $('dsc-txt').textContent = 'Assim o DNA passa a usar as suas partidas de lá: as mais recentes entram agora e cada partida nova entra sozinha. Por enquanto, o DNA abaixo usa as partidas que você analisou neste aparelho.';
      $('dsc-btn').textContent = logado ? 'Vincular minha conta' : 'Entrar ou criar conta';
    }
    redesenhar();
  }

  $('dc-fontes').addEventListener('click', e => {
    const b = e.target.closest('[data-fonte]');
    if (!b) return;
    DNASync.definirFonte(b.dataset.fonte);
    aplicar();
  });

  // Andamento da sincronização
  DNASync.onChange(st => {
    const box = $('dc-status');
    if (!box) return;
    const fila = DNASync.fila().length, n = PlayerDNA.ler().length;
    let html = '';
    if (st.fase === 'buscando') html = '<span class="cavalo-carregando" aria-hidden="true"><i></i></span>Procurando partidas novas nas suas contas…';
    else if (st.fase === 'preparando') html = '<span class="cavalo-carregando" aria-hidden="true"><i></i></span>Preparando o motor de análise…';
    else if (st.fase === 'analisando') {
      const pct = st.total ? Math.round(100 * st.feitas / st.total) : 0;
      html = `<span class="cavalo-carregando" aria-hidden="true"><i></i></span><span>Analisando suas partidas: <b>${Math.min(st.feitas + 1, st.total)} de ${st.total}</b>. O DNA se atualiza a cada partida; a análise continua enquanto esta página estiver aberta.</span><span class="dc-barra"><i style="width:${pct}%"></i></span>`;
    } else if (st.fase === 'em-dia') html = `<span class="dc-ok" aria-hidden="true"></span>Em dia: ${n} ${n === 1 ? 'partida' : 'partidas'} no seu DNA. As novas entram quando você voltar aqui.`;
    else if (st.fase === 'parado' && fila) html = `${fila} ${fila === 1 ? 'partida espera' : 'partidas esperam'} análise. <button type="button" class="dc-continuar" data-continuar>Continuar</button>`;
    if (st.erro) html += `<span class="dc-erro">${esc(st.erro)}</span>`;
    box.innerHTML = html;
    if (st.nova || st.fase === 'em-dia') redesenhar();
  });
  $('dc-status').addEventListener('click', e => { if (e.target.closest('[data-continuar]')) DNASync.sincronizar(); });

  AuthSystem.onChange(aplicar);
  aplicar();
})();

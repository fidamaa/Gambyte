/* ==============================================================
   MODULE: insights-ui.js
   Painel de insights: Resumo, Lances e Perfil.

   O painel pode mostrar a análise dos dois jogadores ou só de um lado
   (seletor "Mostrar análise de"). Quem está revendo a própria partida
   escolhe o seu lado e vê apenas os seus erros e o que treinar; quem
   estuda uma partida de terceiros deixa em "Os dois".

   Depende de: insights-engine.js, auth-system.js, auth-ui.js,
               pro-tools.js (melhor lance em notação legível)
   ============================================================== */
const InsightsUI = (() => {
  const POV_KEY = 'gambyte_pov';
  let _moves = null;        // movesData da última análise
  let _lastMove = null;     // último lance mostrado na aba Lances
  let _pov = 'both';        // 'both' | 'white' | 'black'

  const $ = id => document.getElementById(id);
  const esc = s => AuthSystem.escapeHTML(s);
  const LADO = { white: 'Brancas', black: 'Pretas' };
  const FASES = [['opening', 'Abertura', 'lances 1 a 10'], ['midgame', 'Meio-jogo', 'lances 11 a 30'], ['endgame', 'Final', 'lance 31 em diante']];
  const cores = () => (_pov === 'both' ? ['white', 'black'] : [_pov]);
  const nome = cor => (($(cor + '-name') || {}).textContent || LADO[cor]).trim();
  const num = cp => (cp / 100).toFixed(2).replace('.', ',');

  // Avaliação no padrão do gráfico: positiva = bom para as brancas.
  function evalBrancas(v, cor) {
    if (v == null) return '—';
    const w = cor === 'white' ? v : -v;
    if (Math.abs(w) >= 29000) return (w > 0 ? '+' : '−') + 'M' + Math.max(1, 30000 - Math.abs(w));
    return (w > 0 ? '+' : w < 0 ? '−' : '') + num(Math.abs(w));
  }
  const chip = cls => `<span class="cls-chip cls-${cls}">${InsightsEngine.NOMES[cls] || '—'}</span>`;
  const melhor = m => (typeof ProTools !== 'undefined' ? ProTools.bestSan(m) : (m.bestMoveUCI || '—'));
  const resultado = () => {
    const g = typeof ProTools !== 'undefined' && ProTools.getGame ? ProTools.getGame() : null;
    return (g && g.headers && g.headers.Result) || '';
  };

  /* ── Estado: lado escolhido, abas e bloqueio do Pro ───────────── */
  function setPov(pov, salvar = true) {
    _pov = ['white', 'black'].includes(pov) ? pov : 'both';
    if (salvar) { try { localStorage.setItem(POV_KEY, _pov); } catch (e) { /* sem armazenamento */ } }
    document.querySelectorAll('[data-pov]').forEach(b => {
      const ativo = b.dataset.pov === _pov;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    for (const cor of ['white', 'black'])
      document.querySelector('.player-card.' + cor)?.classList.toggle('is-you', _pov === cor);
    const hint = $('pov-hint');
    if (hint) hint.textContent = _pov === 'both'
      ? 'Revendo uma partida sua? Escolha o seu lado para ver só os seus erros e o que treinar.'
      : `Mostrando a análise de ${nome(_pov)} (${LADO[_pov].toLowerCase()}).`;
    if (_moves) renderAll();
  }

  function switchTab(tab) {
    document.querySelectorAll('.insights-tab').forEach(t => {
      const ativo = t.dataset.insTab === tab;
      t.classList.toggle('active', ativo);
      t.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    document.querySelectorAll('.insights-tab-content').forEach(t => t.classList.toggle('active', t.id === `insights-tab-${tab}`));
  }

  function updatePremiumGates() {
    const pro = AuthSystem.isPremium();
    ['premium-global-wrap', 'premium-move-wrap', 'premium-dna-wrap'].forEach(id => $(id)?.classList.toggle('locked', !pro));
  }

  /* ── Resumo: parte gratuita ───────────────────────────────────── */
  function renderFree() {
    const box = $('ins-free');
    if (!box) return;
    const acc = { white: InsightsEngine.calcAccuracy(_moves, 'white'), black: InsightsEngine.calcAccuracy(_moves, 'black') };
    const gafes = cor => _moves.filter(m => m.color === cor && m.classification === 'blunder').length;
    const outro = _pov === 'white' ? 'black' : 'white';
    const tiles = _pov === 'both'
      ? [['Precisão das brancas', acc.white + '%', nome('white')], ['Precisão das pretas', acc.black + '%', nome('black')],
         ['Gafes', `${gafes('white')} · ${gafes('black')}`, 'brancas · pretas']]
      : [['Sua precisão', acc[_pov] + '%', LADO[_pov]], ['Precisão do adversário', acc[outro] + '%', LADO[outro]],
         ['Suas gafes', String(gafes(_pov)), `adversário: ${gafes(outro)}`]];
    box.innerHTML = `<p class="ins-lead">${esc(InsightsEngine.headline(_moves, resultado())[0])}</p>
      <div class="ins-stats">${tiles.map(t => `<div class="ins-stat"><span class="ins-stat-label">${t[0]}</span><strong>${t[1]}</strong><span class="ins-stat-sub">${esc(t[2])}</span></div>`).join('')}</div>`;
  }

  /* ── Resumo: parte Pro ────────────────────────────────────────── */
  function blocoMomentos() {
    const lista = InsightsEngine.keyMoments(_moves, _pov === 'both' ? null : _pov, _pov === 'both' ? 4 : 3);
    if (!lista.length) return `<section class="ins-block"><h4>Momentos decisivos</h4><p class="ins-empty">Nenhum erro com perda relevante${_pov === 'both' ? '' : ' do seu lado'} nesta partida.</p></section>`;
    return `<section class="ins-block"><h4>Momentos decisivos</h4><ol class="ins-moments">${lista.map(({ move: m, loss }) => `
      <li><button type="button" class="ins-moment" data-goto="${m.index}" title="Ir para este lance no tabuleiro">
        <span class="ins-moment-top"><strong>${esc(InsightsEngine.moveLabel(m))}</strong>${chip(m.classification)}${_pov === 'both' ? `<span class="ins-who">${LADO[m.color]}</span>` : ''}<span class="ins-loss">−${num(loss)}</span></span>
        <span class="ins-moment-sub">${m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI ? `O motor preferia <b>${esc(melhor(m))}</b>. ` : ''}${esc(InsightsEngine.describeEval(m.evalBefore))} → ${esc(InsightsEngine.describeEval(m.evalAfter))}</span>
      </button></li>`).join('')}</ol><p class="ins-note">Clique em um lance para abri-lo no tabuleiro.</p></section>`;
  }

  function blocoFases() {
    const dados = { white: InsightsEngine.calcPhaseAccuracy(_moves, 'white'), black: InsightsEngine.calcPhaseAccuracy(_moves, 'black') };
    const linhas = FASES.map(([k, rotulo, faixa]) => `<div class="ins-phase">
        <div class="ins-phase-name">${rotulo}<small>${faixa}</small></div>
        <div class="ins-phase-bars">${cores().map(cor => {
          const v = dados[cor][k];
          return `<div class="ins-bar-row"><span class="ins-side ins-side-${cor}" title="${LADO[cor]}"></span><div class="ins-bar"><i class="ins-bar-fill ins-fill-${cor}" style="width:${v == null ? 0 : v}%"></i></div><span class="ins-bar-val">${v == null ? '—' : v + '%'}</span></div>`;
        }).join('')}</div></div>`).join('');
    const fracas = cores().map(cor => {
      const f = FASES.filter(x => dados[cor][x[0]] != null).sort((a, b) => dados[cor][a[0]] - dados[cor][b[0]])[0];
      if (!f) return '';
      return `<li>${_pov === 'both' ? LADO[cor] + ': fase' : 'Fase'} mais fraca foi ${f[1].toLowerCase() === 'abertura' ? 'a abertura' : 'o ' + f[1].toLowerCase()}, com ${dados[cor][f[0]]}%.</li>`;
    }).join('');
    const legenda = _pov === 'both' ? `<div class="ins-legend"><span><i class="ins-side ins-side-white"></i>Brancas</span><span><i class="ins-side ins-side-black"></i>Pretas</span></div>` : '';
    return `<section class="ins-block"><div class="ins-block-head"><h4>Precisão por fase</h4>${legenda}</div>${linhas}${fracas ? `<ul class="ins-bullets">${fracas}</ul>` : ''}<p class="ins-note">Um traço indica que a partida não chegou àquela fase.</p></section>`;
  }

  function blocoTreino() {
    const grupo = cor => `<ul class="ins-sugg">${InsightsEngine.suggestions(_moves, cor).map(s => `<li class="ins-sugg-item ${s.level}"><span>${esc(s.text)}</span>${s.href ? `<a href="${s.href}" target="_blank" rel="noopener">Guia: ${esc(s.link)}</a>` : ''}</li>`).join('')}</ul>`;
    const corpo = _pov === 'both'
      ? ['white', 'black'].map(cor => `<h5 class="ins-subhead"><i class="ins-side ins-side-${cor}"></i>${esc(nome(cor))}</h5>${grupo(cor)}`).join('')
      : grupo(_pov);
    return `<section class="ins-block"><h4>${_pov === 'both' ? 'O que cada lado pode treinar' : 'O que treinar'}</h4>${corpo}</section>`;
  }

  function blocoGrafico() {
    const itens = InsightsEngine.chartInsights(_moves);
    if (!itens.length) return '';
    return `<section class="ins-block"><h4>Leitura do gráfico</h4><ul class="ins-bullets">${itens.map(i => `<li class="t-${i.type}">${esc(i.text)}</li>`).join('')}</ul></section>`;
  }

  function blocoNivel() {
    const r = InsightsEngine.estimateRating(_moves);
    const lados = [['white', r.wRating], ['black', r.bRating]].filter(x => x[1] && (_pov === 'both' || _pov === x[0]));
    return `<section class="ins-block ins-level"><div><h4>Nível estimado ${_pov === 'both' ? 'da partida' : 'do seu jogo'}</h4>
      <strong class="ins-level-value">${_pov === 'both' ? esc(String(r.rating)) : (lados[0] ? lados[0][1] : '—')}</strong>
      <span class="ins-level-range">${_pov === 'both' ? esc(r.range) : 'nesta partida'}</span></div>
      ${_pov === 'both' ? `<div class="ins-level-sides">${lados.map(([cor, v]) => `<span><i class="ins-side ins-side-${cor}"></i>${LADO[cor]} ${v}</span>`).join('')}</div>` : ''}
      <p class="ins-note">Estimativa interna a partir da qualidade dos lances desta partida. Não é o rating de nenhum site.</p></section>`;
  }

  function renderPro() {
    const box = $('ins-pro');
    if (!box) return;
    const segunda = InsightsEngine.headline(_moves, resultado())[1];
    box.innerHTML = `<p class="ins-lead ins-lead-2">${esc(segunda)}</p>${blocoMomentos()}${blocoFases()}${blocoTreino()}${blocoGrafico()}${blocoNivel()}`;
  }

  /* ── Aba Lances ───────────────────────────────────────────────── */
  function renderMove() {
    const box = $('ins-move');
    if (!box) return;
    const m = _lastMove;
    if (!m || !m.classification) {
      box.innerHTML = `<p class="ins-empty">Navegue pela partida com as setas ← → ou clique em um lance da lista. A análise de cada lance aparece aqui.</p>`;
      return;
    }
    const info = InsightsEngine.moveInsight(m, melhor(m));
    const temMelhor = m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI && !m.isCheckmate && m.classification !== 'book';
    const doAdversario = _pov !== 'both' && m.color !== _pov;
    box.innerHTML = `<div class="mi-head"><span class="mi-move">${esc(InsightsEngine.moveLabel(m))}</span>${chip(m.classification)}<span class="ins-who">${doAdversario ? 'Adversário' : LADO[m.color]}</span></div>
      <div class="mi-evals">
        <div class="mi-eval"><span>Avaliação antes</span><strong>${evalBrancas(m.evalBefore, m.color)}</strong></div>
        <div class="mi-eval"><span>Avaliação depois</span><strong>${evalBrancas(m.evalAfter, m.color)}</strong></div>
        <div class="mi-eval"><span>Perda do lance</span><strong class="${info.loss >= 100 ? 'neg' : info.loss < 20 ? 'pos' : ''}">${num(info.loss)}</strong></div>
      </div>
      <p class="mi-comment cls-border-${m.classification}">${esc(info.comment)}</p>
      ${temMelhor ? `<div class="mi-best"><span>Melhor lance do motor</span><strong>${esc(melhor(m))}</strong></div>` : ''}
      ${info.flags.length ? `<div class="mi-flags">${info.flags.map(f => `<span class="mi-flag ${f.type}">${esc(f.text)}</span>`).join('')}</div>` : ''}
      <p class="ins-note">Avaliações no padrão do gráfico: número positivo favorece as brancas. A perda compara o lance jogado com o melhor lance do motor.</p>`;
  }

  /* ── Aba Perfil ───────────────────────────────────────────────── */
  function renderDna() {
    const box = $('ins-dna');
    if (!box) return;
    const dna = InsightsEngine.dna(_moves);
    const GRUPOS = [['top', 'Melhores', 'excellent'], ['good', 'Boas', 'good'], ['book', 'Livro', 'book'], ['inaccuracy', 'Imprecisões', 'inaccuracy'], ['mistake', 'Erros', 'mistake'], ['blunder', 'Gafes', 'blunder']];
    const cartao = cor => {
      const p = dna[cor], d = InsightsEngine.distribution(_moves, cor), total = d.total || 1;
      return `<article class="dna-card">
        <header class="dna-head"><span class="dna-side"><i class="ins-side ins-side-${cor}"></i>${esc(nome(cor))}</span><strong class="dna-profile">${esc(p.profile)}</strong></header>
        <p class="dna-desc">${esc(p.desc)}</p>
        <div class="dna-dist" role="img" aria-label="Distribuição dos lances por classificação">${GRUPOS.filter(g => d[g[0]]).map(g => `<i class="cls-bg-${g[2]}" style="width:${(100 * d[g[0]] / total).toFixed(1)}%"></i>`).join('')}</div>
        <div class="dna-dist-legend">${GRUPOS.filter(g => d[g[0]]).map(g => `<span><i class="cls-bg-${g[2]}"></i>${g[1]} ${d[g[0]]}</span>`).join('')}</div>
        <div class="dna-tags">${p.tags.map(t => `<span class="dna-tag">${esc(t)}</span>`).join('')}</div>
        <h5 class="ins-subhead">Padrões nesta partida</h5>
        <ul class="ins-bullets">${dna.patterns[cor].map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </article>`;
    };
    box.innerHTML = cores().map(cartao).join('')
      + (dna.patterns.game.length ? `<section class="ins-block"><h4>Sobre a partida</h4><ul class="ins-bullets">${dna.patterns.game.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '')
      + `<p class="ins-note">O perfil descreve como cada lado jogou esta partida. Para conhecer o seu estilo, compare várias análises.</p>`;
  }

  function renderAll() {
    renderFree();
    renderPro();
    renderMove();
    renderDna();
    updatePremiumGates();
  }

  /* ── API usada pelo app e pelo tabuleiro ──────────────────────── */
  function renderGlobalInsights(movesData, isPartial = false) {
    _moves = movesData;
    $('insights-section')?.classList.add('visible');
    const banner = $('insights-partial-banner');
    if (banner) banner.hidden = !isPartial;
    setPov(_pov, false);   // atualiza nomes dos jogadores na dica e redesenha tudo
  }

  function renderMoveInsight(moveData) {
    if (!moveData) return;
    _lastMove = moveData;
    renderMove();
  }

  function init() {
    try { _pov = localStorage.getItem(POV_KEY) || 'both'; } catch (e) { _pov = 'both'; }
    const section = $('insights-section');
    if (section) section.addEventListener('click', e => {
      const pov = e.target.closest('[data-pov]');
      if (pov) { setPov(pov.dataset.pov); return; }
      const tab = e.target.closest('[data-ins-tab]');
      if (tab) { switchTab(tab.dataset.insTab); return; }
      if (e.target.closest('[data-ins-pro]')) { AuthUI.openPremiumPage(); return; }
      const ir = e.target.closest('[data-goto]');
      if (ir) {
        document.querySelector(`.move-item[data-index="${ir.dataset.goto}"]`)?.click();
        switchTab('move');
      }
    });
    setPov(_pov, false);
    updatePremiumGates();
  }

  return { init, updatePremiumGates, switchTab, renderGlobalInsights, renderMoveInsight, setPov };
})();

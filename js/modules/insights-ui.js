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
  const FASES = [['opening', 'Abertura', 'até o lance 10'], ['midgame', 'Meio-jogo', 'peças em jogo'], ['endgame', 'Final', '6 peças ou menos']];
  const cores = () => (_pov === 'both' ? ['white', 'black'] : [_pov]);
  const nome = cor => (($(cor + '-name') || {}).textContent || LADO[cor]).trim();
  const num = cp => (cp / 100).toFixed(2).replace('.', ',');
  const pct = v => InsightsEngine.pct(v);

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
    window.dispatchEvent(new CustomEvent('gambyte:pov', { detail: _pov }));
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
  // "Como foi a partida?": uma frase (resultado, precisão e erros graves)
  // e os números principais.
  const GRAVES = ['blunder', 'mistake', 'miss'];
  const faixaPrec = a => a == null ? null : a >= 90 ? 'excelente' : a >= 80 ? 'boa' : a >= 70 ? 'regular' : 'baixa';
  const graves = cor => _moves.filter(m => m.color === cor && GRAVES.includes(m.classification)).length;
  const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  function fraseComoFoi(acc) {
    const r = resultado();
    if (_pov === 'both') {
      const quem = r === '1-0' ? 'Vitória das brancas' : r === '0-1' ? 'Vitória das pretas' : r === '1/2-1/2' ? 'Empate' : 'Partida';
      const gw = graves('white'), gb = graves('black');
      const erros = !gw && !gb ? 'sem erros graves dos dois lados' : `erros graves: ${gw} das brancas e ${gb} das pretas`;
      return `${quem}, com precisão de ${pct(acc.white)} contra ${pct(acc.black)} e ${erros}.`;
    }
    const venceu = (r === '1-0' && _pov === 'white') || (r === '0-1' && _pov === 'black');
    const perdeu = (r === '1-0' && _pov === 'black') || (r === '0-1' && _pov === 'white');
    const res = venceu ? 'Vitória' : perdeu ? 'Derrota' : r === '1/2-1/2' ? 'Empate' : 'Partida';
    const g = graves(_pov);
    return `${res} com precisão ${faixaPrec(acc[_pov]) || '—'} (${pct(acc[_pov])})${g ? ` e ${qtd(g, 'erro grave', 'erros graves')}` : ', sem erros graves'}.`;
  }
  function renderFree() {
    const box = $('ins-free');
    if (!box) return;
    const acc = { white: InsightsEngine.calcAccuracy(_moves, 'white'), black: InsightsEngine.calcAccuracy(_moves, 'black') };
    const gafes = cor => _moves.filter(m => m.color === cor && m.classification === 'blunder').length;
    const outro = _pov === 'white' ? 'black' : 'white';
    const tiles = _pov === 'both'
      ? [['Precisão das brancas', pct(acc.white), nome('white')], ['Precisão das pretas', pct(acc.black), nome('black')],
         ['Gafes', `${gafes('white')} · ${gafes('black')}`, 'brancas · pretas']]
      : [['Sua precisão', pct(acc[_pov]), LADO[_pov]], ['Precisão do adversário', pct(acc[outro]), LADO[outro]],
         ['Suas gafes', String(gafes(_pov)), `adversário: ${gafes(outro)}`]];
    box.innerHTML = `<section class="rs-como"><h4>${_pov === 'both' ? 'Como foi a partida?' : 'Como foi sua partida?'}</h4><p>${esc(fraseComoFoi(acc))}</p></section>
      <div class="ins-stats">${tiles.map(t => `<div class="ins-stat"><span class="ins-stat-label">${t[0]}</span><strong>${t[1]}</strong><span class="ins-stat-sub">${esc(t[2])}</span></div>`).join('')}</div>`;
  }

  /* ── Resumo: parte Pro ────────────────────────────────────────── */
  function blocoMomentos() {
    const lista = InsightsEngine.keyMoments(_moves, _pov === 'both' ? null : _pov, _pov === 'both' ? 4 : 3);
    if (!lista.length) return `<section class="ins-block"><h4>Momentos decisivos</h4><p class="ins-empty">Nenhum erro com perda relevante${_pov === 'both' ? '' : ' do seu lado'} nesta partida.</p></section>`;
    return `<section class="ins-block"><h4>Momentos decisivos</h4><ol class="ins-moments">${lista.map(({ move: m, loss }) => `
      <li><button type="button" class="ins-moment" data-goto="${m.index}" title="Ir para este lance no tabuleiro">
        <span class="ins-moment-top"><strong>${esc(InsightsEngine.moveLabel(m))}</strong>${chip(m.classification)}${_pov === 'both' ? `<span class="ins-who">${LADO[m.color]}</span>` : ''}<span class="ins-loss">−${num(loss)}</span></span>
        <span class="ins-moment-sub">${m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI ? `Melhor lance <b>${esc(melhor(m))}</b> · ` : ''}${LADO[m.color]}: de ${esc(InsightsEngine.describeEval(m.bestEval ?? m.evalBefore))} para ${esc(InsightsEngine.describeEval(m.evalAfter))}</span>
      </button></li>`).join('')}</ol><p class="ins-note">Clique em um lance para abri-lo no tabuleiro.</p></section>`;
  }

  function blocoFases() {
    const dados = { white: InsightsEngine.calcPhaseAccuracy(_moves, 'white'), black: InsightsEngine.calcPhaseAccuracy(_moves, 'black') };
    const linhas = FASES.map(([k, rotulo, faixa]) => `<div class="ins-phase">
        <div class="ins-phase-name">${rotulo}<small>${faixa}</small></div>
        <div class="ins-phase-bars">${cores().map(cor => {
          const v = dados[cor][k];
          const ver = InsightsEngine.phaseVerdict(v);
          return `<div class="ins-bar-row"><span class="ins-side ins-side-${cor}" title="${LADO[cor]}"></span><div class="ins-bar"><i class="ins-bar-fill ins-fill-${cor}" style="width:${v == null ? 0 : v}%"></i></div><span class="ins-bar-val">${pct(v)}</span>${ver ? `<span class="cls-chip cls-${ver.cls} ins-verdict">${ver.label}</span>` : '<span></span>'}</div>`;
        }).join('')}</div></div>`).join('');
    const fracas = cores().map(cor => {
      const f = FASES.filter(x => dados[cor][x[0]] != null).sort((a, b) => dados[cor][a[0]] - dados[cor][b[0]])[0];
      if (!f) return '';
      return `<li>${_pov === 'both' ? LADO[cor] + ': fase' : 'Fase'} mais fraca foi ${f[1].toLowerCase() === 'abertura' ? 'a abertura' : 'o ' + f[1].toLowerCase()}, com ${pct(dados[cor][f[0]])}.</li>`;
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

  // O que deu certo: lance brilhante/ótimo, lances únicos achados, a fase
  // mais precisa, nenhuma gafe. Até `n` itens, do mais marcante para o menos.
  const FASE_NOME = { opening: 'Abertura', midgame: 'Meio-jogo', endgame: 'Final' };
  function bemFeito(cor, n) {
    const itens = [];
    const meus = _moves.filter(m => m.color === cor && m.classification && m.classification !== 'book');
    const esp = meus.filter(m => m.classification === 'brilliant').concat(meus.filter(m => m.classification === 'great'));
    if (esp.length) itens.push({ txt: `${InsightsEngine.moveLabel(esp[0])} foi ${InsightsEngine.NOMES[esp[0].classification].toLowerCase()}${esp.length > 1 ? ` (e mais ${esp.length - 1})` : ''}.`, ir: esp[0].index });
    const dna = typeof GameDNA !== 'undefined' ? GameDNA.calcular(_moves) : null;
    const tat = dna && dna[cor] && dna[cor].facetas.find(f => f.k === 'tatica');
    if (tat && tat.chances >= 2 && tat.achou / tat.chances >= 0.8) itens.push({ txt: `Achou ${tat.achou} de ${tat.chances} lances únicos.` });
    const fases = InsightsEngine.calcPhaseAccuracy(_moves, cor);
    const melhorFase = Object.keys(FASE_NOME).filter(k => fases[k] != null).sort((a, b) => fases[b] - fases[a])[0];
    if (melhorFase && fases[melhorFase] >= 85) itens.push({ txt: `${FASE_NOME[melhorFase]} muito precisa (${pct(fases[melhorFase])}).` });
    if (!meus.some(m => m.classification === 'blunder')) itens.push({ txt: 'Nenhuma gafe na partida.' });
    if (!itens.length && melhorFase) itens.push({ txt: `O melhor trecho foi ${melhorFase === 'opening' ? 'a abertura' : melhorFase === 'midgame' ? 'o meio-jogo' : 'o final'} (${pct(fases[melhorFase])}).` });
    return itens.slice(0, n);
  }
  // Onde perdeu: chances perdidas primeiro, depois os lances que mais custaram.
  function perdeuChance(cor, n) {
    const lista = InsightsEngine.keyMoments(_moves, cor, 4).map(x => x.move);
    lista.sort((a, b) => (b.classification === 'miss') - (a.classification === 'miss'));
    return lista.slice(0, n).map(m => ({
      txt: `${InsightsEngine.moveLabel(m)}: ${InsightsEngine.NOMES[m.classification].toLowerCase()}${m.bestMoveUCI && m.bestMoveUCI !== m.playedMoveUCI ? `, o melhor era ${melhor(m)}` : ''}.`,
      ir: m.index, cls: m.classification }));
  }
  const ICO = {
    bem: '<path d="M20 6 9 17l-5-5"/>',
    perdeu: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5h.01"/>',
    aprender: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'
  };
  const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
  function itemHTML(it, cor) {
    const quem = _pov === 'both' && cor ? `<i class="ins-side ins-side-${cor}" title="${LADO[cor]}"></i>` : '';
    return it.ir != null
      ? `<li>${quem}<button type="button" class="rs-ir" data-goto="${it.ir}" title="Ver no tabuleiro">${esc(it.txt)}</button></li>`
      : `<li>${quem}<span>${esc(it.txt)}</span></li>`;
  }
  function renderPro() {
    const box = $('ins-pro');
    if (!box) return;
    const lados = cores();
    const porLado = _pov === 'both' ? 1 : 2;
    const bem = lados.flatMap(cor => bemFeito(cor, porLado).map(it => itemHTML(it, cor)));
    const perdas = lados.flatMap(cor => perdeuChance(cor, porLado).map(it => itemHTML(it, cor)));
    const licoes = lados.map(cor => ({ cor, s: InsightsEngine.suggestions(_moves, cor)[0] })).filter(x => x.s);
    const voce = _pov === 'both' ? 'cada lado' : 'você';
    box.innerHTML = `<div class="rs">
      <section class="rs-q rs-bem"><h4>${ico('bem')}O que ${voce} fez bem</h4><ul>${bem.join('') || '<li><span>Nada de destaque nesta partida.</span></li>'}</ul></section>
      <section class="rs-q rs-perdeu"><h4>${ico('perdeu')}Onde perdeu oportunidades</h4><ul>${perdas.join('') || '<li><span>Nenhuma oportunidade clara desperdiçada.</span></li>'}</ul></section>
      <section class="rs-q rs-aprender"><h4>${ico('aprender')}O que aprender com esta partida</h4>${licoes.map(({ cor, s: x }) => `<p>${_pov === 'both' ? `<i class="ins-side ins-side-${cor}" title="${LADO[cor]}"></i>` : ''}${esc(x.text)}${x.href ? ` <a href="${x.href}" target="_blank" rel="noopener">Guia: ${esc(x.link)}</a>` : ''}</p>`).join('')}</section>
    </div>
    <details class="rs-detalhes"><summary>Ver a análise detalhada <small>momentos decisivos, fases, gráfico e nível</small></summary>
      ${blocoMomentos()}${blocoFases()}${blocoTreino()}${blocoGrafico()}${blocoNivel()}
    </details>`;
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
        <div class="mi-eval"><span>Avaliação antes</span><strong>${evalBrancas(m.bestEval ?? m.evalBefore, m.color)}</strong></div>
        <div class="mi-eval"><span>Avaliação depois</span><strong>${evalBrancas(m.evalAfter, m.color)}</strong></div>
        <div class="mi-eval"><span>Perda do lance</span><strong class="${info.loss >= 100 ? 'neg' : info.loss < 20 ? 'pos' : ''}">${num(info.loss)}</strong></div>
      </div>
      <p class="mi-comment cls-border-${m.classification}">${esc(info.comment)}</p>
      ${temMelhor ? `<div class="mi-best"><span>Melhor lance do motor</span><strong>${esc(melhor(m))}</strong></div>` : ''}
      ${info.flags.length ? `<div class="mi-flags">${info.flags.map(f => `<span class="mi-flag ${f.type}">${esc(f.text)}</span>`).join('')}</div>` : ''}
      <p class="ins-note">Avaliações no padrão do gráfico: número positivo favorece as brancas. "Antes" é a avaliação da posição com o melhor lance; a perda é a diferença para o lance jogado.</p>`;
  }

  /* ── Padrões desta partida (Pro), dentro do painel "DNA da partida" ── */
  function renderDna() {
    const box = $('ins-dna');
    if (!box) return;
    const dna = InsightsEngine.dna(_moves);
    const bloco = cor => `<section class="ins-block"><h4><i class="ins-side ins-side-${cor}"></i>${esc(nome(cor))}</h4>
        <ul class="ins-bullets">${dna.patterns[cor].map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
    box.innerHTML = cores().map(bloco).join('')
      + (dna.patterns.game.length ? `<section class="ins-block"><h4>Sobre a partida</h4><ul class="ins-bullets">${dna.patterns.game.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '');
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
    // O cadeado dos padrões fica no painel do DNA da partida, fora desta seção.
    document.getElementById('side-dna')?.addEventListener('click', e => { if (e.target.closest('[data-ins-pro]')) AuthUI.openPremiumPage(); });
    setPov(_pov, false);
    updatePremiumGates();
  }

  return { init, updatePremiumGates, switchTab, renderGlobalInsights, renderMoveInsight, setPov };
})();

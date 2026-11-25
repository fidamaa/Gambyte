/* Página /dna, abas "Histórico" e "Aberturas".
   Tudo sai dos mesmos resumos do DNA geral (PlayerDNA, só neste aparelho):
   o histórico alimenta o DNA e nada é guardado duas vezes.
   Depende de: player-dna.js, pgn-parser.js; eco-data.js e
   opening-detector.js são carregados só quando a aba Aberturas abre. */
(function () {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const num = PlayerDNA.num, pct = PlayerDNA.fmtPct;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduzir = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(tag, attrs, pai) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (pai) pai.appendChild(e); return e; }
  const partidas = () => PlayerDNA.partidasDe(PlayerDNA.meusNomes());

  /* ── Abas da página ─────────────────────────────────────────── */
  const abas = Array.from(document.querySelectorAll('[data-hub]'));
  function mostrar(qual, empurrar) {
    if (!['dna', 'historico', 'aberturas'].includes(qual)) qual = 'dna';
    document.body.dataset.hub = qual;
    abas.forEach(b => b.setAttribute('aria-selected', b.dataset.hub === qual ? 'true' : 'false'));
    const vazio = !partidas().length;
    document.querySelectorAll('[data-hub-sec]').forEach(s => { s.hidden = vazio || s.dataset.hubSec !== qual; });
    if (window.DNAPagina) DNAPagina.render();
    if (empurrar) { try { history.replaceState(null, '', qual === 'dna' ? location.pathname : '#' + qual); } catch (e) { /* ok */ } }
    if (vazio) return;
    if (qual === 'historico') renderHistorico();
    if (qual === 'aberturas') abrirExplorador();
  }
  abas.forEach((b, i) => {
    b.addEventListener('click', () => mostrar(b.dataset.hub, true));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); const p = abas[(i + d + abas.length) % abas.length]; p.focus(); mostrar(p.dataset.hub, true);
    });
  });
  window.addEventListener('dna:nomes', () => mostrar(document.body.dataset.hub || 'dna'));

  /* ══ HISTÓRICO ═══════════════════════════════════════════════ */
  let tamComp = 10, compEscolhido = false, filtro = 'todas', aberta = null;

  function renderHistorico() {
    const ps = partidas();
    renderRating(ps);
    renderComparacao(ps);
    renderPadroes(ps);
    renderLista(ps);
  }

  // Rating estimado depois de cada partida, com a faixa de 80%
  function renderRating(ps) {
    const svg = $('h-rating'); svg.innerHTML = '';
    const tip = $('h-rating-tip'); tip.hidden = true;
    const ev = PlayerDNA.evolucaoRating(ps);
    const W = Math.max(300, Math.round(svg.clientWidth || 800)), H = Math.round(svg.clientHeight || 240), pad = { l: 46, r: 12, t: 14, b: 26 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    $('h-rating-sub').textContent = ev.length ? `Agora: ${ev[ev.length - 1].valor} (${ev[ev.length - 1].min}–${ev[ev.length - 1].max})` : '';
    if (ev.length < 2) { const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'ev-rot' }, svg); t.textContent = 'A curva aparece a partir da segunda partida.'; return; }
    let lo = Math.min(...ev.map(e => e.min)), hi = Math.max(...ev.map(e => e.max));
    lo = Math.max(100, Math.floor((lo - 50) / 100) * 100); hi = Math.ceil((hi + 50) / 100) * 100;
    const X = i => pad.l + i / (ev.length - 1) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      el('line', { class: 'ev-grade', x1: pad.l, x2: W - pad.r, y1: y, y2: y }, svg);
      el('text', { class: 'ev-rot', x: pad.l - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = Math.round(v);
    }
    const faixa = ev.map((e, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(e.max).toFixed(1)}`).join('') +
      ev.slice().reverse().map((e, j) => `L${X(ev.length - 1 - j).toFixed(1)},${Y(e.min).toFixed(1)}`).join('') + 'Z';
    el('path', { d: faixa, fill: 'rgba(63,214,154,.12)' }, svg);
    const linha = el('path', { class: 'ev-linha', d: ev.map((e, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(e.valor).toFixed(1)}`).join('') }, svg);
    if (!reduzir && linha.getTotalLength) {
      const c = linha.getTotalLength(); linha.style.strokeDasharray = c; linha.style.strokeDashoffset = c; linha.getBoundingClientRect();
      linha.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.75,.2,1)'; requestAnimationFrame(() => { linha.style.strokeDashoffset = 0; });
    }
    const cursor = el('line', { class: 'ev-cursor', y1: pad.t, y2: H - pad.b, visibility: 'hidden' }, svg);
    const pt = el('circle', { class: 'ev-pt on', r: 5, visibility: 'hidden' }, svg);
    const alvo = el('rect', { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: 'transparent' }, svg);
    const mover = e => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(ev.length - 1, Math.round(((e.clientX - r.left) / r.width * W - pad.l) / (W - pad.l - pad.r) * (ev.length - 1))));
      const p = ps[i], d = new Date(p.quando);
      cursor.setAttribute('x1', X(i)); cursor.setAttribute('x2', X(i)); cursor.setAttribute('visibility', 'visible');
      pt.setAttribute('cx', X(i)); pt.setAttribute('cy', Y(ev[i].valor)); pt.setAttribute('visibility', 'visible');
      tip.innerHTML = `Depois da partida ${i + 1} · ${isNaN(d) ? '' : d.toLocaleDateString('pt-BR')}<br>Rating estimado <b>${ev[i].valor}</b> (${ev[i].min}–${ev[i].max})<br>contra ${esc(p.adv.nome)} · ${p.pontos === 1 ? 'vitória' : p.pontos === 0 ? 'derrota' : p.pontos === .5 ? 'empate' : 'sem resultado'}`;
      tip.style.left = (X(i) / W * r.width) + 'px'; tip.style.top = (Y(ev[i].valor) / H * r.height) + 'px'; tip.hidden = false;
    };
    alvo.addEventListener('pointermove', mover); alvo.addEventListener('pointerdown', mover);
    alvo.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); pt.setAttribute('visibility', 'hidden'); });
  }

  // Últimas N partidas contra as N anteriores
  function renderComparacao(ps) {
    const box = $('h-comp');
    // Sem escolha da pessoa: o maior período que os dados permitem
    if (!compEscolhido) {
      tamComp = ps.length >= 40 ? 20 : ps.length >= 20 ? 10 : 5;
      document.querySelectorAll('[data-comp]').forEach(x => x.setAttribute('aria-pressed', +x.dataset.comp === tamComp ? 'true' : 'false'));
    }
    if (ps.length < tamComp * 2) {
      $('h-comp-sub').textContent = `Precisa de ${tamComp * 2} partidas (há ${ps.length}). Escolha um período menor ou analise mais partidas.`;
      box.innerHTML = '';
      return;
    }
    $('h-comp-sub').textContent = `Suas últimas ${tamComp} partidas contra as ${tamComp} anteriores.`;
    const nomes = PlayerDNA.meusNomes(), todos = PlayerDNA.ler();
    const sub = arr => { const ids = new Set(arr.map(p => p.id)); return PlayerDNA.calcular(nomes, todos.filter(x => ids.has(x.id))); };
    const agora = sub(ps.slice(-tamComp)), antes = sub(ps.slice(-tamComp * 2, -tamComp));
    const linhas = [
      ['Rating estimado', antes.rating.valor, agora.rating.valor, v => String(v), 1, 25],
      ['Precisão', antes.precisao, agora.precisao, v => pct(v), 1, 1],
      ['Pontos', antes.pontos == null ? null : antes.pontos * 100, agora.pontos == null ? null : agora.pontos * 100, v => v == null ? '—' : Math.round(v) + '%', 1, 5],
      ['Gafes / 40 lances', antes.erros.blunder, agora.erros.blunder, v => num(v), -1, .15],
      ['Erros / 40 lances', antes.erros.mistake, agora.erros.mistake, v => num(v), -1, .2],
      ['Lance único achado', antes.tatica.pct == null ? null : antes.tatica.pct * 100, agora.tatica.pct == null ? null : agora.tatica.pct * 100, v => v == null ? '—' : Math.round(v) + '%', 1, 5],
    ];
    box.innerHTML = `<div class="hc-cab"><span></span><span>Antes</span><span>Agora</span></div>` + linhas.map(([n, a, b, f, bom, min]) => {
      const d = a == null || b == null ? null : b - a;
      const cls = d == null || Math.abs(d) < min ? 'igual' : (d * bom > 0 ? 'melhor' : 'pior');
      const seta = cls === 'igual' ? '=' : d > 0 ? '▲' : '▼';
      return `<div class="hc-linha ${cls}"><span>${n}</span><span>${f(a)}</span><span><b>${f(b)}</b><i aria-label="${cls}">${seta}</i></span></div>`;
    }).join('');
  }

  // Padrões que só aparecem somando partidas
  function renderPadroes(ps) {
    const out = [];
    const soma = (lista, f) => lista.reduce((s, p) => s + (f(p) || 0), 0);
    const med = lista => lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : null;
    // por cor
    const w = ps.filter(p => p.cor === 'w' && p.pontos != null), b = ps.filter(p => p.cor === 'b' && p.pontos != null);
    if (w.length >= 3 && b.length >= 3) {
      const pw = med(w.map(p => p.pontos)) * 100, pb = med(b.map(p => p.pontos)) * 100;
      if (Math.abs(pw - pb) >= 15) out.push({ t: pw > pb ? 'bom' : 'atencao', h: `Você rende mais de ${pw > pb ? 'brancas' : 'pretas'}`, d: `${Math.round(Math.max(pw, pb))}% dos pontos, contra ${Math.round(Math.min(pw, pb))}% de ${pw > pb ? 'pretas' : 'brancas'} (${w.length} e ${b.length} partidas).` });
    }
    // fase mais fraca
    const fase = k => { const v = ps.map(p => p.eu.fases && p.eu.fases[k]).filter(x => x != null); return v.length >= 3 ? med(v) : null; };
    const fs = [['abertura', fase('opening')], ['meio-jogo', fase('midgame')], ['final', fase('endgame')]].filter(x => x[1] != null).sort((a, c) => a[1] - c[1]);
    const ART = { abertura: ['A abertura', 'na abertura'], 'meio-jogo': ['O meio-jogo', 'no meio-jogo'], final: ['O final', 'no final'] };
    if (fs.length >= 2 && fs[fs.length - 1][1] - fs[0][1] >= 4) out.push({ t: 'atencao', h: `${ART[fs[0][0]][0]} é a fase mais fraca`, d: `${num(fs[0][1])}% de precisão, contra ${num(fs[fs.length - 1][1])}% ${ART[fs[fs.length - 1][0]][1]}.` });
    // erros graves com vantagem e no fim
    const graves = soma(ps, p => p.eu.pad && p.eu.pad.graves);
    if (graves >= 4) {
      const vant = soma(ps, p => p.eu.pad && p.eu.pad.vant), fim = soma(ps, p => p.eu.pad && p.eu.pad.fim);
      if (vant / graves >= .4) out.push({ t: 'atencao', h: 'Erros graves quando já estava melhor', d: `${Math.round(100 * vant / graves)}% dos seus ${graves} erros graves vieram com a posição a seu favor: hora de conferir as ameaças antes de "fechar" a partida.` });
      if (fim / graves >= .5) out.push({ t: 'atencao', h: 'Os erros se concentram no fim', d: `${Math.round(100 * fim / graves)}% dos erros graves aconteceram no último terço das partidas, o que costuma indicar pressão do relógio.` });
    }
    // aberturas
    const ab = new Map();
    ps.forEach(p => { if (!p.abertura || p.pontos == null) return; const a = ab.get(p.abertura) || { n: 0, s: 0 }; a.n++; a.s += p.pontos; ab.set(p.abertura, a); });
    const abs = Array.from(ab, ([nome, a]) => ({ nome, n: a.n, s: a.s / a.n })).filter(a => a.n >= 3);
    const pior = abs.slice().sort((a, c) => a.s - c.s)[0], melhor = abs.slice().sort((a, c) => c.s - a.s)[0];
    if (pior && pior.s <= .35) out.push({ t: 'atencao', h: `Dificuldade na ${pior.nome}`, d: `${Math.round(pior.s * 100)}% dos pontos em ${pior.n} partidas. Veja onde você sai da teoria na aba Aberturas.` });
    if (melhor && melhor.s >= .7 && melhor !== pior) out.push({ t: 'bom', h: `A ${melhor.nome} funciona para você`, d: `${Math.round(melhor.s * 100)}% dos pontos em ${melhor.n} partidas.` });
    // ritmo
    const rit = new Map();
    ps.forEach(p => { const r = PlayerDNA.ritmoDe(p.ritmo); if (!r || p.eu.acc == null) return; (rit.get(r) || rit.set(r, []).get(r)).push(p.eu.acc); });
    const rs = Array.from(rit, ([r, v]) => ({ r, n: v.length, a: med(v) })).filter(x => x.n >= 3).sort((a, c) => c.a - a.a);
    if (rs.length >= 2 && rs[0].a - rs[rs.length - 1].a >= 4) out.push({ t: 'info', h: `Mais preciso no ${rs[0].r}`, d: `${num(rs[0].a)}% de precisão no ${rs[0].r} e ${num(rs[rs.length - 1].a)}% no ${rs[rs.length - 1].r}.` });
    // saída do livro
    const saidas = ps.filter(p => p.saida).map(p => Math.floor(p.saida.ply / 2) + 1);
    if (saidas.length >= 3) out.push({ t: 'info', h: `Você sai da teoria por volta do lance ${Math.round(med(saidas))}`, d: 'Média das partidas com os lances guardados. Na aba Aberturas dá para ver exatamente onde.' });

    $('h-padroes').innerHTML = out.length
      ? out.map(p => `<li class="hp-${p.t}"><b>${esc(p.h)}</b><span>${esc(p.d)}</span></li>`).join('')
      : '<li class="hp-vazio"><span>Ainda não há padrões claros. Eles aparecem com mais partidas analisadas.</span></li>';
  }

  function ehPro() {
    try {
      const c = JSON.parse(localStorage.getItem('gambyte_perfil') || 'null');
      if (!c || !c.pro) return false;
      for (let i = 0; i < localStorage.length; i++) if (/^sb-.*-auth-token$/.test(localStorage.key(i))) return true;
    } catch (e) { /* ok */ }
    return false;
  }

  function renderLista(ps) {
    const todos = PlayerDNA.calcular(PlayerDNA.meusNomes());
    let lista = ps.slice().reverse();
    if (filtro === 'v') lista = lista.filter(p => p.pontos === 1);
    if (filtro === 'd') lista = lista.filter(p => p.pontos === 0);
    if (filtro === 'w' || filtro === 'b') lista = lista.filter(p => p.cor === filtro);
    const pro = ehPro();
    $('h-lista').innerHTML = lista.length ? lista.map(p => {
      const d = new Date(p.quando);
      const res = p.pontos === 1 ? ['v', 'V'] : p.pontos === 0 ? ['d', 'D'] : p.pontos === .5 ? ['e', 'E'] : ['s', '–'];
      const ab = aberta === p.id;
      const dif = todos.precisao != null && p.eu.acc != null ? p.eu.acc - todos.precisao : null;
      const fase = (k, n) => p.eu.fases && p.eu.fases[k] != null ? `<span>${n} <b>${Math.round(p.eu.fases[k])}%</b></span>` : '';
      return `<li class="hl${ab ? ' aberta' : ''}">
        <button type="button" class="hl-btn" data-partida="${p.id}" aria-expanded="${ab}">
          <span class="hl-data">${isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
          <span class="hl-cor hl-${p.cor}" title="${p.cor === 'w' ? 'Você de brancas' : 'Você de pretas'}"></span>
          <span class="hl-adv">${esc(p.adv.nome)}${p.adv.elo ? ` <small>${p.adv.elo}</small>` : ''}<small class="hl-ab">${esc(p.abertura || '')}</small></span>
          <span class="hl-res hl-res-${res[0]}">${res[1]}</span>
          <span class="hl-num">${pct(p.eu.acc)}</span>
          <span class="hl-num hl-niv">${p.eu.nivel || '—'}</span>
        </button>
        ${ab ? `<div class="hl-det">
          <div class="hl-fases">${fase('opening', 'Abertura')}${fase('midgame', 'Meio-jogo')}${fase('endgame', 'Final')}<span>Gafes <b>${(p.eu.cont && p.eu.cont.blunder) || 0}</b></span><span>Erros <b>${(p.eu.cont && p.eu.cont.mistake) || 0}</b></span></div>
          ${dif != null ? `<p class="hl-comp">Precisão ${dif >= 0 ? `<em class="melhor">${num(dif)} pontos acima</em>` : `<em class="pior">${num(-dif)} pontos abaixo</em>`} da sua média (${pct(todos.precisao)}).</p>` : ''}
          <div class="hl-acoes">${p.temPgn ? (pro ? `<a class="dna-btn" href="/?abrir=${p.id}">Abrir a análise</a>` : `<a class="dna-btn dna-btn-sec" href="/gambyte-premium">Reabrir a análise é do Pro</a>`) : '<span class="dna-sub">Partida antiga: os lances não foram guardados.</span>'}
          ${p.inicio ? `<button type="button" class="dna-btn dna-btn-sec" data-ver-abertura="${p.id}">Ver na aba Aberturas</button>` : ''}</div>
        </div>` : ''}
      </li>`;
    }).join('') : '<li class="hp-vazio"><span>Nenhuma partida com esse filtro.</span></li>';
  }

  $('h-lista').addEventListener('click', e => {
    const v = e.target.closest('[data-ver-abertura]');
    if (v) { const p = partidas().find(x => String(x.id) === v.dataset.verAbertura); if (p) { exCor = p.cor; exSel = p.abertura; exCaminho = (p.inicio || []).slice(0, p.saida ? p.saida.ply + 1 : 8); mostrar('aberturas', true); } return; }
    const b = e.target.closest('[data-partida]');
    if (!b) return;
    aberta = aberta === +b.dataset.partida ? null : +b.dataset.partida;
    renderLista(partidas());
  });
  document.querySelectorAll('[data-comp]').forEach(b => b.addEventListener('click', () => {
    tamComp = +b.dataset.comp; compEscolhido = true;
    document.querySelectorAll('[data-comp]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderComparacao(partidas());
  }));
  document.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderLista(partidas());
  }));

  /* ══ EXPLORADOR DE ABERTURAS ═════════════════════════════════ */
  let exCor = 'w', exSel = null, exCaminho = [], ecoPronto = null;
  const PECA = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  function carregar(src) { return new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = erro; document.head.appendChild(s); }); }
  function garantirEco() {
    if (!ecoPronto) ecoPronto = (typeof ECO_RAW !== 'undefined' ? Promise.resolve() : carregar('js/data/eco-data.js'))
      .then(() => typeof OpeningDetector !== 'undefined' ? null : carregar('js/modules/opening-detector.js'));
    return ecoPronto;
  }

  function estadoDe(sans) {
    let st = PGNParser.fenToBoard(PGNParser.INITIAL_FEN), antes = null;
    for (const s of sans) { const n = PGNParser.applyMove(st, s); if (!n) break; antes = st; st = n; }
    return { st, antes };
  }
  function desenharTabuleiro(sans) {
    const { st, antes } = estadoDe(sans);
    const flip = exCor === 'b';
    let html = '';
    for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
      const r = flip ? 7 - rr : rr, c = flip ? 7 - cc : cc;
      const p = st.board[r][c];
      const mudou = antes && antes.board[r][c] !== p;
      const claro = (r + c) % 2 === 0;
      html += `<span class="ex-c ${claro ? 'cl' : 'cd'}${mudou ? ' ult' : ''}">${p ? `<img src="/pieces/${PECA[p.toLowerCase()]}-${p === p.toUpperCase() ? 'w' : 'b'}.svg" alt="">` : ''}</span>`;
    }
    $('ex-tab').innerHTML = html;
    return st;
  }

  function aberturasDe(ps) {
    const m = new Map();
    ps.filter(p => p.cor === exCor && p.abertura).forEach(p => {
      const a = m.get(p.abertura) || { nome: p.abertura, eco: p.eco, n: 0, pts: 0, nPts: 0, acc: [], comLances: 0 };
      a.n++; if (p.pontos != null) { a.pts += p.pontos; a.nPts++; }
      if (p.eu.fases && p.eu.fases.opening != null) a.acc.push(p.eu.fases.opening);
      if (p.inicio) a.comLances++;
      if (!a.eco && p.eco) a.eco = p.eco;
      m.set(p.abertura, a);
    });
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }

  function linhaPrincipal(nome) {
    if (typeof ECO_RAW === 'undefined') return [];
    const cand = ECO_RAW.filter(e => e[2] === nome);
    if (!cand.length) return [];
    cand.sort((a, b) => (a[3] ? 1 : 0) - (b[3] ? 1 : 0) || a[0].length - b[0].length);
    return cand[0][0].split(' ');
  }

  function abrirExplorador() {
    renderListaAberturas();
    garantirEco().then(renderPalco, renderPalco);
  }

  function renderListaAberturas() {
    const abs = aberturasDe(partidas());
    if (!exSel || !abs.some(a => a.nome === exSel)) { exSel = abs[0] ? abs[0].nome : null; exCaminho = null; }
    const mx = Math.max(1, ...abs.map(a => a.n));
    $('ex-aberturas').innerHTML = abs.length ? abs.map(a => {
      const p = a.nPts ? Math.round(100 * a.pts / a.nPts) : null;
      const acc = a.acc.length ? Math.round(a.acc.reduce((s, x) => s + x, 0) / a.acc.length) : null;
      return `<li><button type="button" class="ex-ab${a.nome === exSel ? ' on' : ''}" data-ab="${esc(a.nome)}">
        <span class="ex-ab-nome">${esc(a.nome)}</span>
        <span class="ex-ab-freq"><i style="width:${(100 * a.n / mx).toFixed(0)}%"></i></span>
        <span class="ex-ab-num">${a.n} ${a.n === 1 ? 'jogo' : 'jogos'} · ${p == null ? '—' : p + '% pts'}${acc == null ? '' : ' · ' + acc + '%'}</span>
      </button></li>`;
    }).join('') : `<li class="dna-sub">Nenhuma partida de ${exCor === 'w' ? 'brancas' : 'pretas'} com a abertura reconhecida.</li>`;
  }

  function renderPalco() {
    const ps = partidas().filter(p => p.cor === exCor && p.abertura === exSel);
    $('ex-nome').textContent = exSel || 'Nenhuma abertura';
    $('ex-eco').textContent = ps[0] && ps[0].eco ? `${ps[0].eco} · ${ps.length} ${ps.length === 1 ? 'partida sua' : 'partidas suas'}` : `${ps.length} ${ps.length === 1 ? 'partida sua' : 'partidas suas'}`;
    const principal = linhaPrincipal(exSel);
    const comLances = ps.filter(p => p.inicio);
    if (exCaminho == null) {
      const ok = principal.length && comLances.some(p => principal.every((m, i) => p.inicio[i] === m));
      exCaminho = ok ? principal.slice() : [];
    }
    const st = desenharTabuleiro(exCaminho);

    // caminho clicável
    $('ex-caminho').innerHTML = exCaminho.length
      ? exCaminho.map((m, i) => `${i % 2 === 0 ? `<span class="ex-n">${i / 2 + 1}.</span>` : ''}<button type="button" data-ir="${i + 1}" class="${i === exCaminho.length - 1 ? 'on' : ''}">${esc(m)}</button>`).join(' ')
      : '<span class="dna-sub">Posição inicial</span>';

    // está no livro?
    let livro = '';
    try {
      if (typeof OpeningDetector !== 'undefined' && exCaminho.length) {
        const dentro = OpeningDetector.isBookPosition(PGNParser.boardToFen(st));
        const nome = OpeningDetector.detect(exCaminho);
        livro = `<span class="ex-selo ${dentro ? 'dentro' : 'fora'}">${dentro ? 'Teoria' : 'Fora da teoria'}</span>${nome ? `<span class="ex-var">${esc(nome.name)}${nome.variation ? ': ' + esc(nome.variation) : ''}</span>` : ''}`;
      }
    } catch (e) { /* sem livro */ }
    if (principal.length) livro += `<p class="ex-princ"><span class="dna-rot">Linha principal</span> ${principal.map((m, i) => `${i % 2 === 0 ? (i / 2 + 1) + '.' : ''}<button type="button" data-linha="${i + 1}">${esc(m)}</button>`).join(' ')}</p>`;
    $('ex-livro').innerHTML = livro;

    // próximos lances das suas partidas a partir daqui
    const prox = new Map();
    comLances.forEach(p => {
      if (!exCaminho.every((m, i) => p.inicio[i] === m)) return;
      const nx = p.inicio[exCaminho.length]; if (!nx) return;
      const a = prox.get(nx) || { san: nx, n: 0, pts: 0, nPts: 0, meu: (exCaminho.length % 2 === 0) === (exCor === 'w') };
      a.n++; if (p.pontos != null) { a.pts += p.pontos; a.nPts++; }
      prox.set(nx, a);
    });
    const lista = Array.from(prox.values()).sort((a, b) => b.n - a.n);
    const mx = Math.max(1, ...lista.map(a => a.n));
    $('ex-prox').innerHTML = lista.length ? lista.map(a => {
      const p = a.nPts ? Math.round(100 * a.pts / a.nPts) : null;
      return `<li><button type="button" data-prox="${esc(a.san)}"><b>${esc(a.san)}</b><span class="ex-quem">${a.meu ? 'você' : 'adversário'}</span>
        <span class="ex-bar"><i style="width:${(100 * a.n / mx).toFixed(0)}%"></i></span><span class="ex-pn">${a.n}× · ${p == null ? '—' : p + '%'}</span></button></li>`;
    }).join('') : `<li class="dna-sub">${comLances.length ? 'Nenhuma das suas partidas seguiu por aqui.' : 'As partidas desta abertura foram analisadas antes de o Gambyte guardar os lances. As próximas análises entram aqui.'}</li>`;

    // onde a partida saiu da teoria
    const saidas = new Map();
    comLances.forEach(p => {
      if (!p.saida) return;
      const k = p.saida.ply + ':' + p.saida.san;
      const a = saidas.get(k) || { ply: p.saida.ply, san: p.saida.san, meu: p.saida.cor === p.cor, n: 0, ex: p };
      a.n++; saidas.set(k, a);
    });
    const ss = Array.from(saidas.values()).sort((a, b) => b.n - a.n).slice(0, 4);
    $('ex-saidas').innerHTML = ss.length ? `<h3 class="dna-rot">Onde saiu da teoria</h3><ul>${ss.map(s => `<li><button type="button" data-saida="${s.ex.id}">
      <b>${Math.floor(s.ply / 2) + 1}${s.ply % 2 === 0 ? '.' : '...'} ${esc(s.san)}</b> <span>${s.meu ? 'você saiu' : 'o adversário saiu'} · ${s.n} ${s.n === 1 ? 'partida' : 'partidas'}</span></button></li>`).join('')}</ul>` : '';
  }

  $('ex-aberturas').addEventListener('click', e => {
    const b = e.target.closest('[data-ab]'); if (!b) return;
    exSel = b.dataset.ab; exCaminho = null; renderListaAberturas(); renderPalco();
  });
  document.querySelectorAll('[data-ex-cor]').forEach(b => b.addEventListener('click', () => {
    exCor = b.dataset.exCor; exSel = null; exCaminho = null;
    document.querySelectorAll('[data-ex-cor]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    abrirExplorador();
  }));
  $('sec-aberturas').addEventListener('click', e => {
    const ir = e.target.closest('[data-ir]'); if (ir) { exCaminho = exCaminho.slice(0, +ir.dataset.ir); renderPalco(); return; }
    const pr = e.target.closest('[data-prox]'); if (pr) { exCaminho = exCaminho.concat(pr.dataset.prox); renderPalco(); return; }
    const li = e.target.closest('[data-linha]'); if (li) { exCaminho = linhaPrincipal(exSel).slice(0, +li.dataset.linha); renderPalco(); return; }
    const sa = e.target.closest('[data-saida]');
    if (sa) { const p = partidas().find(x => String(x.id) === sa.dataset.saida); if (p && p.inicio) { exCaminho = p.inicio.slice(0, p.saida.ply + 1); renderPalco(); } }
  });
  $('ex-voltar').addEventListener('click', () => { if (exCaminho && exCaminho.length) { exCaminho = exCaminho.slice(0, -1); renderPalco(); } });
  $('ex-inicio').addEventListener('click', () => { exCaminho = []; renderPalco(); });

  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (document.body.dataset.hub === 'historico') renderRating(partidas()); }, 200); });

  // Estado pelo endereço (#historico, #aberturas), também ao trocar só o "#"
  const peloEndereco = () => { const h = location.hash.replace('#', ''); mostrar(['historico', 'aberturas'].includes(h) ? h : 'dna', false); };
  window.addEventListener('hashchange', peloEndereco);
  peloEndereco();
})();

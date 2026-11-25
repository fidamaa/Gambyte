/* Página /dna: desenha o DNA geral a partir de PlayerDNA (só este aparelho). */
(function () {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const num = PlayerDNA.num, pct = PlayerDNA.fmtPct;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const milhar = v => String(Math.round(v));   // rating de xadrez se escreve sem ponto
  let recorte = 'todas', serie = 'acc', eixoAtivo = null;
  let _atual = null;

  function el(tag, attrs, pai) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (pai) pai.appendChild(e);
    return e;
  }

  /* ── Quem é você ─────────────────────────────────────────── */
  function renderNomes() {
    const disp = PlayerDNA.nomesDisponiveis();
    const meus = new Set(PlayerDNA.meusNomes().map(n => n.toLowerCase()));
    const box = $('dna-nomes');
    $('dna-quem').hidden = !disp.length;
    box.innerHTML = disp.slice(0, 12).map(d => `<button type="button" data-nome="${esc(d.nome)}" aria-pressed="${meus.has(d.nome.toLowerCase())}">${esc(d.nome)}<small>${d.partidas}</small></button>`).join('');
  }
  $('dna-nomes').addEventListener('click', e => {
    const b = e.target.closest('[data-nome]');
    if (!b) return;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    const nomes = Array.from($('dna-nomes').querySelectorAll('[aria-pressed="true"]')).map(x => x.dataset.nome);
    PlayerDNA.definirMeusNomes(nomes);
    render();
    window.dispatchEvent(new Event('dna:nomes'));
  });

  /* ── Rating ──────────────────────────────────────────────── */
  function renderRating(d) {
    const r = d.rating;
    $('dna-rating-valor').innerHTML = `${milhar(r.valor)}<small>${r.preliminar ? 'preliminar' : ''}</small>`;
    $('dna-rating-faixa').innerHTML = `Faixa provável: <b>${milhar(r.min)} – ${milhar(r.max)}</b> · ${d.n} ${d.n === 1 ? 'partida' : 'partidas'}${r.comResultado ? `, ${r.comResultado} com o resultado contra adversário conhecido` : ''}`;
    $('dna-aviso').textContent = d.n < d.minimo
      ? `Ainda faltam informações: com ${d.n === 1 ? 'uma partida' : d.n + ' partidas'} a estimativa é só um começo. Analise pelo menos ${d.minimo} partidas suas para uma faixa mais confiável.`
      : (r.max - r.min > 500 ? 'A faixa ainda é larga: seus resultados variam bastante. Mais partidas analisadas deixam a estimativa mais firme.' : '');
    // Curva da distribuição com a faixa de 80% destacada
    const svg = $('dna-curva'); svg.innerHTML = '';
    const pts = r.curva.filter(([x]) => x >= r.valor - 900 && x <= r.valor + 900);
    if (!pts.length) return;
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0], ymax = Math.max(...pts.map(p => p[1])) || 1;
    const X = v => (v - x0) / (x1 - x0) * 320, Y = p => 84 - p / ymax * 74;
    const defs = el('defs', {}, svg);
    const g = el('linearGradient', { id: 'cv-g', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#3fd69a', 'stop-opacity': '.45' }, g);
    el('stop', { offset: '1', 'stop-color': '#3fd69a', 'stop-opacity': '0' }, g);
    const linha = pts.map(([x, p], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(p).toFixed(1)}`).join('');
    el('path', { d: linha + `L320,84L0,84Z`, fill: 'rgba(255,255,255,.03)' }, svg);
    const faixa = pts.filter(([x]) => x >= r.min && x <= r.max);
    if (faixa.length) el('path', { d: faixa.map(([x, p], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(p).toFixed(1)}`).join('') + `L${X(faixa[faixa.length - 1][0]).toFixed(1)},84L${X(faixa[0][0]).toFixed(1)},84Z`, fill: 'url(#cv-g)' }, svg);
    el('path', { d: linha, fill: 'none', stroke: '#3fd69a', 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }, svg);
    el('line', { x1: X(r.valor), x2: X(r.valor), y1: 4, y2: 84, stroke: '#e9fff6', 'stroke-width': 1, 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' }, svg);
    el('line', { x1: 0, x2: 320, y1: 84.5, y2: 84.5, stroke: 'rgba(255,255,255,.08)', 'vector-effect': 'non-scaling-stroke' }, svg);
  }

  /* ── Identidade de jogo ──────────────────────────────────────
     O estilo em uma frase, a partir do radar. Só com partidas
     suficientes: com poucas, diz quantas faltam. */
  const MIN_ESTILO = 5;
  const FORTE = { abertura: 'Bem preparado na abertura', meio: 'Forte no meio-jogo', final: 'Seguro nos finais', tatica: 'Jogador tático', consistencia: 'Jogador regular', seguranca: 'Jogador cuidadoso' };
  const FRACO = { abertura: 'que sofre nos primeiros lances', meio: 'que oscila no meio-jogo', final: 'que perde força nos finais', tatica: 'que deixa passar lances táticos', consistencia: 'que varia muito de uma partida para outra', seguranca: 'que ainda entrega material com frequência' };
  function renderIdentidade(d) {
    const box = $('dna-identidade');
    if (!box) return;
    if (d.n < MIN_ESTILO) {
      const f = MIN_ESTILO - d.n;
      box.innerHTML = `<span class="di-rot">Sua identidade de jogo</span><p class="di-falta">O estilo aparece a partir de ${MIN_ESTILO} partidas. ${f === 1 ? 'Falta 1' : 'Faltam ' + f}.</p>`;
      return;
    }
    const ax = d.radar.filter(e => e.v != null).sort((a, b) => b.v - a.v);
    if (ax.length < 2) { box.innerHTML = ''; return; }
    const forte = ax[0], fraco = ax[ax.length - 1];
    const frase = fraco.v <= forte.v - 8 ? `${FORTE[forte.k]}, ${FRACO[fraco.k]}.` : `${FORTE[forte.k]}, sem um ponto fraco claro.`;
    const pts = d.pontos == null ? '' : `<span class="di-chip">Resultados <b>${Math.round(d.pontos * 100)}%</b></span>`;
    box.innerHTML = `<span class="di-rot">Sua identidade de jogo · ${d.n} partidas</span>
      <p class="di-frase">${esc(frase)}</p>
      <div class="di-chips"><span class="di-chip di-forte">Ponto forte <b>${esc(forte.nome)} ${forte.v}</b></span>${fraco.v <= forte.v - 8 ? `<span class="di-chip di-fraco">Dificuldade <b>${esc(fraco.nome)} ${fraco.v}</b></span>` : ''}${pts}</div>`;
  }

  /* ── Radar ───────────────────────────────────────────────── */
  function renderRadar(d, comp) {
    const svg = $('dna-radar'); svg.innerHTML = '';
    const eixos = d.radar, N = eixos.length, cx = 180, cy = 162, R = 112;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;
    const P = (i, v) => [cx + Math.cos(ang(i)) * R * v / 100, cy + Math.sin(ang(i)) * R * v / 100];
    [25, 50, 75, 100].forEach(v => el('polygon', { class: 'rd-anel', points: eixos.map((_, i) => P(i, v).join(',')).join(' ') }, svg));
    eixos.forEach((_, i) => { const [x, y] = P(i, 100); el('line', { class: 'rd-eixo', x1: cx, y1: cy, x2: x, y2: y }, svg); });
    if (comp) el('polygon', { class: 'rd-area rd-comp', points: comp.radar.map((e, i) => P(i, e.v == null ? 0 : e.v).join(',')).join(' ') }, svg);
    const area = el('polygon', { class: 'rd-area', points: eixos.map((_, i) => `${cx},${cy}`).join(' ') }, svg);
    requestAnimationFrame(() => requestAnimationFrame(() => area.setAttribute('points', eixos.map((e, i) => P(i, e.v == null ? 0 : e.v).join(',')).join(' '))));
    eixos.forEach((e, i) => {
      const g = el('g', { class: 'rd-eixo-g' + (eixoAtivo === e.k ? ' on' : ''), tabindex: 0, role: 'button', 'aria-label': `${e.nome}: ${e.v == null ? 'sem dados' : e.v + ' de 100'}` }, svg);
      const [px, py] = P(i, e.v == null ? 0 : e.v);
      const [lx, ly] = P(i, 128);
      el('circle', { class: 'rd-alvo', cx: lx, cy: ly, r: 34 }, g);
      if (e.v != null) el('circle', { class: 'rd-pt', cx: px, cy: py, r: 4 }, g);
      const anc = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
      const t = el('text', { class: 'rd-rot', x: lx, y: ly - 2, 'text-anchor': anc }, g); t.textContent = e.nome;
      const v = el('text', { class: 'rd-val' + (e.v == null ? ' rd-sem' : ''), x: lx, y: ly + 15, 'text-anchor': anc }, g); v.textContent = e.v == null ? 'sem dados' : e.v;
      const mostrar = () => {
        eixoAtivo = e.k;
        svg.querySelectorAll('.rd-eixo-g').forEach(x => x.classList.toggle('on', x === g));
        // Comparação com as partidas anteriores: as 5 mais recentes contra as outras
        let comparar = '';
        if (comp && comp.radar[i] && comp.radar[i].v != null) comparar = `Nas suas partidas todas: ${comp.radar[i].v}.`;
        else if (_atual && _atual.n >= 8) {
          const ids = new Set(_atual.partidas.slice(0, -5).map(p => p.id));
          const antes = PlayerDNA.calcular(PlayerDNA.meusNomes(), PlayerDNA.ler().filter(x => ids.has(x.id)));
          const va = antes.radar[i] && antes.radar[i].v;
          if (va != null && e.v != null) comparar = e.v - va >= 3 ? `Subiu ${e.v - va} pontos com as 5 partidas mais recentes.` : va - e.v >= 3 ? `Caiu ${va - e.v} pontos com as 5 partidas mais recentes.` : 'Estável nas partidas mais recentes.';
        }
        $('dna-radar-info').innerHTML = `<b class="ri-tit">${e.nome}${e.v != null ? ' · ' + e.v : ''}</b>
          <span class="ri-l"><i>O que é</i>${esc(e.o || '')}</span>
          <span class="ri-l"><i>Como foi calculado</i>${esc(e.como || '')}</span>
          <span class="ri-l"><i>Você</i>${esc(e.info)}</span>
          ${comparar ? `<span class="ri-l"><i>Comparação</i>${esc(comparar)}</span>` : ''}`;
        $('dna-radar-info').classList.add('aberta');
      };
      g.addEventListener('mouseenter', mostrar); g.addEventListener('focus', mostrar); g.addEventListener('click', mostrar);
    });
    if (eixoAtivo) { const g = Array.from(svg.querySelectorAll('.rd-eixo-g')).find(x => x.classList.contains('on')); g && g.dispatchEvent(new Event('focus')); }
  }

  /* ── Evolução ────────────────────────────────────────────── */
  function renderEvolucao(d) {
    const svg = $('dna-evo'); svg.innerHTML = '';
    const tip = $('dna-tip'); tip.hidden = true;
    const ev = d.evolucao.filter(p => serie === 'acc' ? p.acc != null : p.nivel > 0);
    const W = Math.max(300, Math.round(svg.clientWidth || 800)), H = Math.round(svg.clientHeight || 240), pad = { l: 44, r: 12, t: 14, b: 26 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (ev.length < 2) {
      const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'ev-rot' }, svg);
      t.textContent = 'A evolução aparece a partir da segunda partida analisada.';
      return;
    }
    const val = p => serie === 'acc' ? p.acc : p.nivel;
    const med = p => serie === 'acc' ? p.accMedia : p.nivelMedia;
    const vs = ev.map(val);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const folga = serie === 'acc' ? 5 : 150;
    lo = Math.max(serie === 'acc' ? 0 : 100, Math.floor((lo - folga) / folga) * folga);
    hi = Math.min(serie === 'acc' ? 100 : 3200, Math.ceil((hi + folga) / folga) * folga);
    const X = i => pad.l + i / (ev.length - 1) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const defs = el('defs', {}, svg);
    const g = el('linearGradient', { id: 'ev-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#3fd69a', 'stop-opacity': '.22' }, g);
    el('stop', { offset: '1', 'stop-color': '#3fd69a', 'stop-opacity': '0' }, g);
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      el('line', { class: 'ev-grade', x1: pad.l, x2: W - pad.r, y1: y, y2: y }, svg);
      const t = el('text', { class: 'ev-rot', x: pad.l - 8, y: y + 4, 'text-anchor': 'end' }, svg);
      t.textContent = serie === 'acc' ? Math.round(v) + '%' : Math.round(v);
    }
    const linha = ev.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(med(p)).toFixed(1)}`).join('');
    el('path', { class: 'ev-area', d: linha + `L${X(ev.length - 1)},${H - pad.b}L${X(0)},${H - pad.b}Z` }, svg);
    const caminho = el('path', { class: 'ev-linha', d: linha }, svg);
    const comp = caminho.getTotalLength ? caminho.getTotalLength() : 0;
    if (comp && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      caminho.style.strokeDasharray = comp; caminho.style.strokeDashoffset = comp;
      caminho.getBoundingClientRect();
      caminho.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.75,.2,1)';
      requestAnimationFrame(() => { caminho.style.strokeDashoffset = 0; });
    }
    const cursor = el('line', { class: 'ev-cursor', x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, visibility: 'hidden' }, svg);
    const pts = ev.map((p, i) => el('circle', { class: 'ev-pt ' + (p.pontos === 1 ? 'v' : p.pontos === 0 ? 'd' : p.pontos === 0.5 ? 'e' : ''), cx: X(i), cy: Y(val(p)), r: ev.length > 60 ? 2.5 : 3.5 }, svg));
    const passo = Math.max(1, Math.ceil(ev.length / 8));
    ev.forEach((p, i) => {
      if (i % passo && i !== ev.length - 1) return;
      const t = el('text', { class: 'ev-rot', x: X(i), y: H - 6, 'text-anchor': 'middle' }, svg);
      t.textContent = String(i + 1);
    });
    // Interação: o ponto mais próximo do mouse/dedo
    const alvo = el('rect', { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: 'transparent' }, svg);
    const mover = e => {
      const r = svg.getBoundingClientRect();
      const xv = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(ev.length - 1, Math.round((xv - pad.l) / (W - pad.l - pad.r) * (ev.length - 1))));
      const p = ev[i];
      pts.forEach((c, k) => c.classList.toggle('on', k === i));
      cursor.setAttribute('x1', X(i)); cursor.setAttribute('x2', X(i)); cursor.setAttribute('visibility', 'visible');
      const data = new Date(p.quando);
      const res = p.pontos === 1 ? 'vitória' : p.pontos === 0 ? 'derrota' : p.pontos === 0.5 ? 'empate' : 'sem resultado';
      tip.innerHTML = `Partida ${i + 1} · ${isNaN(data) ? '' : data.toLocaleDateString('pt-BR')}<br>${esc(p.rotulo)} · ${res}<br>Precisão <b>${pct(p.acc)}</b> · nível <b>${p.nivel ? milhar(p.nivel) : '—'}</b>`;
      tip.style.left = (X(i) / W * r.width) + 'px';
      tip.style.top = (Y(val(p)) / H * r.height) + 'px';
      tip.hidden = false;
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerdown', mover);
    alvo.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); pts.forEach(c => c.classList.remove('on')); });
  }

  /* ── Erros e aberturas ───────────────────────────────────── */
  function renderErros(d) {
    const itens = [['Gafes', d.erros.blunder, 'var(--blunder)'], ['Erros', d.erros.mistake, 'var(--mistake)'], ['Chances perdidas', d.erros.miss, 'var(--miss)'], ['Imprecisões', d.erros.inaccuracy, 'var(--inaccuracy)']];
    const mx = Math.max(4, ...itens.map(i => i[1]));
    $('dna-erros').innerHTML = itens.map(([n, v, c]) => `<div class="db-linha"><span>${n}</span><div class="db-trilho"><div class="db-barra" style="--c:${c}" data-w="${(v / mx * 100).toFixed(1)}"></div></div><span class="db-num">${num(v)}</span></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $('dna-erros').querySelectorAll('.db-barra').forEach(b => { b.style.width = b.dataset.w + '%'; })));
  }
  function renderAberturas(d) {
    const box = $('dna-aberturas');
    if (!d.aberturas.length) { box.innerHTML = '<p class="dna-vazio-txt">As aberturas aparecem quando a partida é reconhecida pelo livro de aberturas.</p>'; return; }
    box.innerHTML = `<div class="da-linha"><span class="da-nome da-cab" style="text-align:left">Abertura</span><span class="da-cab">Jogos</span><span class="da-cab">Pontos</span><span class="da-cab">Prec.</span></div>` +
      d.aberturas.map(a => `<div class="da-linha"><span class="da-nome" title="${esc(a.nome)}">${esc(a.nome)}</span><span>${a.n}</span><span>${a.pontos == null ? '—' : Math.round(a.pontos * 100) + '%'}</span><span>${a.acc == null ? '—' : Math.round(a.acc) + '%'}</span></div>`).join('');
  }

  /* ── Tudo ────────────────────────────────────────────────── */
  function render() {
    renderNomes();
    const nomes = PlayerDNA.meusNomes();
    const todas = PlayerDNA.calcular(nomes);
    const vazio = !todas.n;
    $('dna-vazio').hidden = !vazio;
    $('dna-corpo').hidden = vazio || (document.body.dataset.hub || 'dna') !== 'dna';
    if (vazio) {
      if (PlayerDNA.ler().length) {
        $('dna-vazio').querySelector('h2').textContent = 'Escolha acima quais nomes são seus';
        $('dna-vazio').querySelector('p').textContent = 'Há partidas analisadas neste aparelho, mas nenhuma com os nomes marcados. Toque no seu usuário (e em "Você", para as partidas contra o bot).';
      }
      return;
    }
    let mostrado = todas, comp = null;
    if (recorte === 'ultimas' && todas.n > 10) {
      const ids = new Set(todas.partidas.slice(-10).map(p => p.id));
      mostrado = PlayerDNA.calcular(nomes, PlayerDNA.ler().filter(x => ids.has(x.id)));
      comp = todas;
    }
    _atual = todas;
    renderIdentidade(todas);
    renderRating(todas);
    renderRadar(mostrado, comp);
    $('dna-prec').textContent = pct(todas.precisao);
    $('dna-prec-sub').textContent = todas.n >= 10 ? `Últimas 10: ${pct(todas.precisaoUlt)}` : 'Média das partidas';
    $('dna-res').textContent = todas.pontos == null ? '—' : Math.round(todas.pontos * 100) + '%';
    const pl = (n, um, v) => `${n} ${n === 1 ? um : v}`;
    $('dna-res-sub').textContent = `${pl(todas.vde.v, 'vitória', 'vitórias')}, ${pl(todas.vde.e, 'empate', 'empates')}, ${pl(todas.vde.d, 'derrota', 'derrotas')}`;
    $('dna-n').textContent = String(todas.n);
    $('dna-n-sub').textContent = todas.n < todas.minimo ? `Faltam ${todas.minimo - todas.n} para a faixa confiável` : 'Neste aparelho';
    $('dna-elo').textContent = todas.eloPgn ? milhar(todas.eloPgn.media) : '—';
    $('dna-elo-sub').textContent = todas.eloPgn ? `Média de ${todas.eloPgn.n} PGNs. Só referência: não entra direto no cálculo.` : 'Os PGNs não trazem o seu Elo.';
    renderEvolucao(todas);
    renderErros(todas);
    renderAberturas(todas);
  }

  document.querySelectorAll('[data-recorte]').forEach(b => b.addEventListener('click', () => {
    recorte = b.dataset.recorte;
    document.querySelectorAll('[data-recorte]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    render();
  }));
  document.querySelectorAll('[data-serie]').forEach(b => b.addEventListener('click', () => {
    serie = b.dataset.serie;
    document.querySelectorAll('[data-serie]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderEvolucao(PlayerDNA.calcular(PlayerDNA.meusNomes()));
  }));
  $('dna-apagar').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.confirma !== '1') { b.dataset.confirma = '1'; b.textContent = 'Clique de novo para apagar de vez'; return; }
    PlayerDNA.apagar(); b.dataset.confirma = ''; b.textContent = 'Dados apagados';
    render();
    window.dispatchEvent(new Event('dna:nomes'));
  });
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 200); });
  window.DNAPagina = { render };
  render();
})();

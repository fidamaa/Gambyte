/* ==============================================================
   Página inicial (redesign): abertura, painel em abas, momentos-chave
   e o quadro do lance mostrado.

   Só conversa com o resto do app pelo que já existe (campos #pgn-input
   e #imp-input, App.run, GameImport) e pelos eventos que o
   UIController dispara:
     gambyte:partida      — uma partida (ou o tabuleiro vazio) foi aberta
     gambyte:lances       — os dados dos lances mudaram (análise andando)
     gambyte:lance-atual  — o tabuleiro foi para outro lance
     gambyte:analise-concluida
   ============================================================== */
(function () {
  const $ = id => document.getElementById(id);
  const reduzir = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Abertura: um campo só ────────────────────────────────────
     PGN, FEN ou link do Lichess vão direto para a análise; um nome
     curto é tratado como usuário (Chess.com ou Lichess). */
  const form = $('hero-form'), campo = $('hero-input'), dica = $('hero-dica');
  const RE_FEN = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/;
  const RE_USUARIO = /^@?[A-Za-z0-9_-]{2,30}$/;
  const RE_LICHESS = /lichess\.org\//i;

  function tipo(v) {
    v = v.trim();
    if (!v) return '';
    if (RE_FEN.test(v)) return 'fen';
    if (RE_LICHESS.test(v)) return 'link';
    if (/chess\.com\//i.test(v)) return 'link-chesscom';
    if (RE_USUARIO.test(v)) return 'usuario';
    return 'pgn';
  }
  const DICAS = {
    '': '',
    fen: 'Posição (FEN): abre no tabuleiro para analisar ao vivo.',
    link: 'Link do Lichess: a partida abre e a análise começa.',
    'link-chesscom': 'O Chess.com não libera a busca pelo link: digite o usuário e escolha a partida.',
    usuario: 'Vamos listar as últimas partidas desse usuário.',
    pgn: 'PGN reconhecido: é só clicar em Analisar.',
  };

  function crescer() {
    if (!campo) return;
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 168) + 'px';
    const t = tipo(campo.value);
    campo.classList.toggle('pgn', t === 'pgn' || t === 'fen');
    if (dica) dica.textContent = t === 'usuario' ? `Vamos listar as últimas partidas de ${campo.value.trim().replace(/^@/, '')} no ${siteNome()}.` : (DICAS[t] || '');
  }

  // Site do usuário: espelha os botões da busca (que guardam a escolha).
  function siteAtual() {
    const b = document.querySelector('[data-imp-site].active, [data-imp-site][aria-pressed="true"]');
    if (b) return b.dataset.impSite;
    try { return JSON.parse(localStorage.getItem('gambyte_import_v1') || '{}').site || 'chesscom'; } catch (e) { return 'chesscom'; }
  }
  const siteNome = () => (document.querySelector('[data-hero-site][aria-pressed="true"]')?.dataset.heroSite === 'lichess' ? 'Lichess' : 'Chess.com');
  function exemplo() {
    if (!campo) return;
    const curto = innerWidth < 520;
    campo.placeholder = curto ? `Usuário do ${siteNome()} ou PGN` : `Seu usuário do ${siteNome()}, ou cole o PGN da partida`;
  }
  function marcarSite(s) {
    document.querySelectorAll('[data-hero-site]').forEach(b => b.setAttribute('aria-pressed', b.dataset.heroSite === s ? 'true' : 'false'));
    exemplo();
  }
  document.querySelectorAll('[data-hero-site]').forEach(b => b.addEventListener('click', () => {
    marcarSite(b.dataset.heroSite);
    document.querySelector(`#import-box [data-imp-site="${b.dataset.heroSite}"]`)?.click();
    campo?.focus();   // escolheu o site: é para digitar o usuário
    crescer();
  }));

  function irParaAnalise() {
    const alvo = $('analise');
    if (alvo) alvo.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' });
  }

  function enviar(e) {
    if (e) e.preventDefault();
    const v = (campo.value || '').trim();
    const t = tipo(v);
    if (t) botaoCarregando();
    if (!t) { campo.focus(); campo.closest('.hero-form')?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 }); return; }
    if (t === 'usuario' || t === 'link' || t === 'link-chesscom') {
      const imp = $('imp-input');
      if (!imp) return;
      mostrarAbaLateral('trazer');
      if (typeof GameImport !== 'undefined') GameImport.mostrarAba('importar', true);
      document.querySelector(`#import-box [data-imp-site="${document.querySelector('[data-hero-site][aria-pressed="true"]')?.dataset.heroSite || 'chesscom'}"]`)?.click();
      imp.value = v.replace(/^@/, '');
      $('imp-btn')?.click();
      irParaAnalise();
      return;
    }
    // PGN ou FEN: o mesmo caminho do campo de colar
    const pgn = $('pgn-input');
    if (!pgn) return;
    pgn.value = v;
    if (typeof GameImport !== 'undefined') GameImport.mostrarAba('pgn');
    if (typeof App !== 'undefined' && App.run) App.run(); else $('btn-analyze')?.click();
    irParaAnalise();
  }

  if (form && campo) {
    campo.addEventListener('input', crescer);
    campo.addEventListener('keydown', e => {
      // Enter envia; Shift+Enter quebra a linha (PGN colado à mão)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
    });
    form.addEventListener('submit', enviar);
    // Texto de exemplo conforme o site escolhido (mais curto no celular)
    exemplo(); addEventListener('resize', exemplo);
    marcarSite(siteAtual());
    crescer();
  }
  // Os botões de site da busca também atualizam os da abertura
  document.addEventListener('click', e => {
    const b = e.target.closest('#import-box [data-imp-site]');
    if (b) marcarSite(b.dataset.impSite);
  });

  /* ── Carregando: cavalo que vira de um lado para o outro ───────
     Sobre o tabuleiro, do começo da análise até chegarem as primeiras
     avaliações; no botão da primeira dobra, logo depois do clique. */
  let cobertura = null;
  function cobrirTabuleiro(sim, texto) {
    const wrap = $('board-wrapper');
    if (!wrap) return;
    if (!cobertura) {
      cobertura = document.createElement('div');
      cobertura.className = 'board-carregando';
      cobertura.setAttribute('role', 'status');
      cobertura.innerHTML = '<span class="carregador" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><i></i></span><span class="bc-txt"></span>';
      wrap.appendChild(cobertura);
    }
    cobertura.querySelector('.bc-txt').textContent = texto || 'Preparando a análise…';
    cobertura.hidden = !sim;
  }
  const btnHero = $('hero-btn');
  function botaoCarregando() {
    if (!btnHero) return;
    btnHero.classList.add('carregando');
    setTimeout(() => btnHero.classList.remove('carregando'), 1600);
  }

  /* ── Painel lateral em abas ──────────────────────────────────── */
  const KEY_ABA = 'gambyte_painel_v1';
  const abas = Array.from(document.querySelectorAll('[data-side]'));
  function mostrarAbaLateral(qual, lembrar) {
    abas.forEach(b => {
      const on = b.dataset.side === qual;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) b.classList.remove('novo');
    });
    document.querySelectorAll('[data-side-pane]').forEach(p => {
      const on = p.dataset.sidePane === qual;
      if (on && p.hidden) { p.hidden = false; if (!reduzir) { p.classList.remove('entrando'); void p.offsetWidth; p.classList.add('entrando'); } }
      else if (!on) p.hidden = true;
    });
    if (lembrar) { try { localStorage.setItem(KEY_ABA, qual); } catch (e) { /* sem armazenamento */ } }
    window.dispatchEvent(new Event('resize'));   // a coluna recalcula a altura
  }
  abas.forEach((b, i) => {
    b.addEventListener('click', () => mostrarAbaLateral(b.dataset.side, true));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const prox = abas[(i + d + abas.length) % abas.length];
      prox.focus(); mostrarAbaLateral(prox.dataset.side, true);
    });
  });
  // Links "tirar uma foto" e "trazer" levam para a aba certa
  document.addEventListener('click', e => {
    if (e.target.closest('[data-ir-foto], [data-ir-trazer], a[href="#trazer"]')) mostrarAbaLateral('trazer');
  }, true);

  /* ── Partida aberta / análise ─────────────────────────────────── */
  let temPartida = false;
  window.addEventListener('gambyte:partida', e => {
    const p = e.detail && e.detail.parsed;
    temPartida = !!(p && p.moves && p.moves.length);
    document.body.classList.toggle('em-analise', temPartida);
    cobrirTabuleiro(temPartida);
    if (temPartida) mostrarAbaLateral(location.hash === '#dna-da-partida' ? 'dna' : 'lances');
    $('side-tab-resumo')?.classList.remove('novo');
    renderMomentos([], -1);
    renderInfo(null, -1);
  });
  window.addEventListener('gambyte:lances', e => {
    const md = (e.detail || {}).movesData || [];
    if (cobertura && !cobertura.hidden && md.some(m => m && m.evalAfter != null)) cobrirTabuleiro(false);
  });
  window.addEventListener('gambyte:analise-concluida', () => {
    cobrirTabuleiro(false);
    const r = $('side-tab-resumo');
    if (r && r.getAttribute('aria-selected') !== 'true') r.classList.add('novo');
  });

  /* ── Veredito: a conclusão da partida em poucas linhas ──────────
     Quem jogou melhor, onde a partida virou e o melhor momento; o
     resto (fases, treino, leitura do gráfico) fica na aba Resumo. */
  let lancesAtuais = null, parsedAtual = null;
  window.addEventListener('gambyte:lances', e => { const d = e.detail || {}; lancesAtuais = d.movesData; parsedAtual = d.parsed; });
  function lanceBtn(m) { return `<button type="button" class="vd-lance" data-ir-lance="${m.index}">${esc(rotulo(m))}</button>`; }
  function renderVeredito() {
    const box = $('veredito');
    if (!box) return;
    const moves = lancesAtuais, p = parsedAtual;
    if (!temPartida || !moves || !moves.some(m => m && m.classification) || typeof InsightsEngine === 'undefined') { box.hidden = true; return; }
    const h = (p && p.headers) || {};
    const nome = c => (c === 'white' ? h.White : h.Black) || (c === 'white' ? 'Brancas' : 'Pretas');
    const aW = InsightsEngine.calcAccuracy(moves, 'white'), aB = InsightsEngine.calcAccuracy(moves, 'black');
    const pc = v => v == null ? '—' : String(v).replace('.', ',') + '%';
    const r = h.Result;
    const titulo = r === '1-0' ? `Vitória de ${nome('white')}` : r === '0-1' ? `Vitória de ${nome('black')}` : r === '1/2-1/2' ? 'Empate' : 'Partida analisada';
    const melhorLado = aW != null && aB != null && Math.abs(aW - aB) >= 1 ? (aW > aB ? 'white' : 'black') : null;
    let linha1 = melhorLado
      ? `${esc(nome(melhorLado))} jogou melhor: ${pc(melhorLado === 'white' ? aW : aB)} de precisão, contra ${pc(melhorLado === 'white' ? aB : aW)}.`
      : `Os dois lados jogaram parecido: ${pc(aW)} e ${pc(aB)} de precisão.`;
    let linha2 = '';
    // O lance que mais pesou: entre gafes, erros e chances perdidas primeiro;
    // só sem nenhum deles vale a maior imprecisão.
    const graves = moves.filter(m => m && ['blunder', 'mistake', 'miss'].includes(m.classification));
    const perda = m => InsightsEngine.moveLoss(m);
    const pior = (graves.length ? graves : moves.filter(m => m && m.classification === 'inaccuracy')).sort((a, b) => perda(b) - perda(a))[0];
    if (pior) {
      const m = pior;
      linha2 = `O lance que mais pesou foi ${lanceBtn(m)}: ${esc((InsightsEngine.NOMES[m.classification] || '').toLowerCase())} de ${esc(nome(m.color))}.`;
    } else linha2 = 'Nenhum lance isolado decidiu: não houve erro com perda relevante.';
    const bom = moves.find(m => m && (m.classification === 'brilliant' || m.classification === 'great'));
    const linha3 = bom ? `Melhor momento: ${lanceBtn(bom)}, ${esc((InsightsEngine.NOMES[bom.classification] || '').toLowerCase())} de ${esc(nome(bom.color))}.` : '';
    box.innerHTML = `<div class="vd-texto"><strong class="vd-tit">${esc(titulo)}</strong><p>${linha1} ${linha2}${linha3 ? ' ' + linha3 : ''}</p></div>
      <button type="button" class="vd-mais" data-vd-resumo>Ver o resumo completo</button>`;
    box.hidden = false;
  }
  $('veredito')?.addEventListener('click', e => {
    const l = e.target.closest('[data-ir-lance]');
    if (l) { document.querySelector(`.move-item[data-index="${l.dataset.irLance}"]`)?.click(); $('board-wrapper')?.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'center' }); return; }
    if (e.target.closest('[data-vd-resumo]')) { mostrarAbaLateral('resumo', true); $('side-panel')?.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' }); }
  });
  window.addEventListener('gambyte:analise-concluida', () => setTimeout(renderVeredito, 60));
  window.addEventListener('gambyte:partida', () => { const v = $('veredito'); if (v) { v.hidden = true; v.innerHTML = ''; } });

  /* ── Etapas da análise: rápida → 12 → 16 (→ 22 no Pro) ─────────── */
  function etapasDe() {
    const pro = $('pro-deep-toggle')?.checked;
    return pro ? [[8, 'Rápida'], [14, '14'], [18, '18'], [22, '22']] : [[8, 'Rápida'], [12, '12'], [16, '16']];
  }
  window.addEventListener('gambyte:progresso', e => {
    const d = e.detail || {}, cont = $('progress-container');
    if (!cont) return;
    let box = cont.querySelector('.etapas');
    if (!box) {
      box = document.createElement('div');
      box.className = 'etapas';
      box.setAttribute('aria-label', 'Etapas da análise');
      cont.querySelector('.progress-header')?.after(box);
    }
    const lista = etapasDe();
    const atual = d.phase === 1 ? 0 : Math.max(0, lista.findIndex(x => x[0] >= d.depth));
    box.innerHTML = lista.map((x, i) => `<span class="etapa${i < atual ? ' feita' : i === atual ? ' agora' : ''}">${x[1]}</span>`).join('<i aria-hidden="true"></i>');
  });

  /* ── Momentos-chave ──────────────────────────────────────────── */
  const COR = { blunder: 'var(--blunder)', mistake: 'var(--mistake)', miss: 'var(--miss)', inaccuracy: 'var(--inaccuracy)', brilliant: 'var(--brilliant)', great: 'var(--great)' };
  const NOME = { blunder: 'Gafe', mistake: 'Erro', miss: 'Chance perdida', inaccuracy: 'Imprecisão', brilliant: 'Brilhante', great: 'Ótimo' };
  let ultimos = [];
  function rotulo(m) { return `${Math.floor(m.index / 2) + 1}${m.color === 'white' ? '.' : '...'} ${m.san || ''}`; }

  function renderMomentos(movesData, idx) {
    const box = $('momentos');
    if (!box) return;
    ultimos = movesData || [];
    if (!temPartida || !ultimos.some(m => m && m.classification)) { box.hidden = true; box.innerHTML = ''; return; }
    const graves = ultimos.filter(m => m && ['blunder', 'mistake', 'miss'].includes(m.classification));
    const bons = ultimos.filter(m => m && ['brilliant', 'great'].includes(m.classification));
    let lista = graves.concat(bons);
    if (lista.length < 3) lista = lista.concat(ultimos.filter(m => m && m.classification === 'inaccuracy').slice(0, 4));
    lista.sort((a, b) => a.index - b.index);
    const nErros = graves.length;
    box.hidden = false;
    box.innerHTML = `<div class="momentos-tit"><b>Momentos-chave</b><span>${nErros ? `${nErros} ${nErros === 1 ? 'lance decidiu' : 'lances pesaram'}` : 'sem erros graves'}</span></div>` +
      (lista.length
        ? `<div class="momentos-lista" role="list">${lista.map(m => `<button type="button" role="listitem" class="momento${m.index === idx ? ' ativo' : ''}" data-ir-lance="${m.index}" style="--c:${COR[m.classification]}" title="${NOME[m.classification]}: ${rotulo(m)}"><i></i>${rotulo(m)}<small>${NOME[m.classification]}</small></button>`).join('')}</div>`
        : '<p class="momentos-vazio">Nenhum lance grave até aqui.</p>');
  }
  $('momentos')?.addEventListener('click', e => {
    const b = e.target.closest('[data-ir-lance]');
    if (!b) return;
    document.querySelector(`.move-item[data-index="${b.dataset.irLance}"]`)?.click();
  });
  window.addEventListener('gambyte:lances', e => {
    const d = e.detail || {};
    renderMomentos(d.movesData, d.idx);
  });

  /* ── Quadro do lance mostrado ────────────────────────────────── */
  const CLS_COR = { book: 'var(--book)', brilliant: 'var(--brilliant)', great: 'var(--great)', excellent: 'var(--excellent)', 'best-move': 'var(--best-move)', good: 'var(--good)', inaccuracy: 'var(--inaccuracy)', mistake: 'var(--mistake)', miss: 'var(--miss)', blunder: 'var(--blunder)' };
  function fmtEval(v) {
    if (v == null) return '';
    if (Math.abs(v) >= 29000) return (v > 0 ? '+' : '−') + 'M' + Math.max(1, 30000 - Math.abs(v));
    return (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) / 100).toFixed(2).replace('.', ',');
  }
  function san(fen, uci) {
    try { return PGNParser.uciToSan(PGNParser.fenToBoard(fen), uci); } catch (e) { return uci; }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderInfo(parsed, idx) {
    const box = $('lance-info');
    if (!box) return;
    const md = parsed && parsed.movesData && parsed.movesData[idx];
    if (!parsed || idx < 0 || !md || !parsed.moves || !parsed.moves.length) { box.innerHTML = ''; return; }
    const cls = md.classification;
    const label = cls && typeof MoveClassifier !== 'undefined' ? (MoveClassifier.LABELS[cls] || cls) : '';
    const brancas = md.color === 'white';
    const evBrancas = md.evalAfter == null ? null : (brancas ? md.evalAfter : -md.evalAfter);
    const fenAntes = (parsed.fensBefore && parsed.fensBefore[idx]) || (idx === 0 ? (parsed.startFEN || PGNParser.INITIAL_FEN) : parsed.fensAfter[idx - 1]);
    let html = '';
    if (label) html += `<span class="li-pill" style="color:${CLS_COR[cls] || 'var(--text2)'}">${esc(label)}</span>`;
    html += `<span class="li-san">${esc(rotulo({ index: idx, color: md.color, san: parsed.moves[idx] }))}</span>`;
    if (evBrancas != null) html += `<span class="li-eval" title="Avaliação depois do lance (do ponto de vista das brancas)">${fmtEval(evBrancas)}</span>`;
    const jogou = (md.playedMoveUCI || '').slice(0, 4);
    if (md.bestMoveUCI && fenAntes && md.bestMoveUCI.slice(0, 4) !== jogou && cls !== 'book') {
      html += `<span class="li-melhor">Melhor: <b>${esc(san(fenAntes, md.bestMoveUCI))}</b></span>`;
    }
    const alts = (md.altUCI || []).slice(1, 3).filter(a => a && a.uci && a.uci.slice(0, 4) !== jogou);
    const mostrarAlts = $('show-alt-arrows')?.checked;
    if (mostrarAlts && alts.length && fenAntes && cls !== 'book') {
      html += `<span class="li-alt">Também: ${alts.map(a => `<b>${esc(san(fenAntes, a.uci))}</b>`).join(', ')}</span>`;
    }
    box.innerHTML = html;
  }
  let ultimoParsed = null, ultimoIdx = -1;
  window.addEventListener('gambyte:lance-atual', e => {
    const d = e.detail || {};
    ultimoParsed = d.parsed; ultimoIdx = d.idx;
    renderInfo(d.parsed, d.idx);
    document.querySelectorAll('.momento').forEach(b => b.classList.toggle('ativo', +b.dataset.irLance === d.idx));
  });
  window.addEventListener('gambyte:lances', () => { if (ultimoParsed) renderInfo(ultimoParsed, ultimoIdx); });

  /* ── Chave "Alternativas" ────────────────────────────────────── */
  const chaveAlt = $('show-alt-arrows');
  if (chaveAlt) {
    try { chaveAlt.checked = localStorage.getItem('gambyte_alternativas') === '1'; } catch (e) { /* ok */ }
    const aplicar = () => {
      if (typeof ArrowSystem !== 'undefined' && ArrowSystem.setShowAlts) ArrowSystem.setShowAlts(chaveAlt.checked);
      renderInfo(ultimoParsed, ultimoIdx);
    };
    chaveAlt.addEventListener('change', () => {
      try { localStorage.setItem('gambyte_alternativas', chaveAlt.checked ? '1' : '0'); } catch (e) { /* ok */ }
      aplicar();
    });
    aplicar();
  }

  /* ── Seções de baixo entram ao aparecer na tela ──────────────── */
  if ('IntersectionObserver' in window && !reduzir) {
    document.documentElement.classList.add('revelar');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visto'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.info-home').forEach(s => io.observe(s));
  }

  /* ── Estado inicial ──────────────────────────────────────────── */
  let inicial = 'trazer';
  try { const a = localStorage.getItem(KEY_ABA); if (a === 'trazer') inicial = a; } catch (e) { /* ok */ }
  mostrarAbaLateral(inicial);
})();

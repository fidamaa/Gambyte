/* Aprender xadrez: o que deixa os guias com cara de app.
   - Índice: progresso de leitura (guardado só neste aparelho), "continuar
     de onde parou" e quantos guias de cada tema já foram lidos.
   - Artigo: barra de leitura no topo, sumário flutuante, diagramas que
     passam os lances com ◀ ▶, teste rápido e "marcar como lido".
   Todo o texto já está no HTML; isto só acrescenta os controles. */
(function () {
  const CHAVE = 'gambyte_aprender';
  function ler() {
    try { const d = JSON.parse(localStorage.getItem(CHAVE) || '{}'); return d && typeof d === 'object' ? d : {}; }
    catch (e) { return {}; }
  }
  const estado = ler();
  if (!estado.lidos || typeof estado.lidos !== 'object') estado.lidos = {};
  if (!estado.testes || typeof estado.testes !== 'object') estado.testes = {};
  function gravar() { try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* sem armazenamento */ } }

  const IC = {
    lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    inicio: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    ant: '<path d="m15 18-6-6 6-6"/>',
    prox: '<path d="m9 18 6-6-6-6"/>',
    fim: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    refazer: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const suave = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  function aviso(msg) {
    document.querySelectorAll('.app-aviso.ap-av').forEach(a => a.remove());
    const t = document.createElement('div');
    t.className = 'app-aviso ap-av';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ══ Índice ══════════════════════════════════════════════════════ */
  function indice() {
    const cartoes = [...document.querySelectorAll('.ap-hub .ap-sec .ap-card[data-slug]')];
    const slugs = [...new Set(cartoes.map(c => c.dataset.slug))];
    const lido = s => !!estado.lidos[s];
    cartoes.forEach(c => c.classList.toggle('lido', lido(c.dataset.slug)));
    // temas
    document.querySelectorAll('.ap-tema[data-cat]').forEach(t => {
      const doTema = [...new Set(cartoes.filter(c => c.closest(`.ap-sec[data-cat="${t.dataset.cat}"]`)).map(c => c.dataset.slug))];
      const n = doTema.filter(lido).length, tot = doTema.length;
      const rot = t.querySelector('.ap-tema-n');
      if (n) rot.textContent = n === tot ? `${tot} de ${tot} lidos` : `${n} de ${tot} lidos`;
      t.querySelector('.ap-tema-barra span').style.width = tot ? `${(n / tot) * 100}%` : '0';
      t.classList.toggle('completo', tot > 0 && n === tot);
    });
    // progresso geral
    const caixa = document.querySelector('.ap-prog');
    if (!caixa) return;
    const total = slugs.length, feitos = slugs.filter(lido).length, pct = total ? Math.round((feitos / total) * 100) : 0;
    caixa.querySelector('.ap-prog-arco').setAttribute('stroke-dasharray', `${pct} 100`);
    caixa.querySelector('.ap-prog-pct').textContent = pct + '%';
    const txt = caixa.querySelector('.ap-prog-txt'), btn = caixa.querySelector('.ap-prog-btn');
    const titulo = s => { const c = cartoes.find(x => x.dataset.slug === s); return c ? c.querySelector('strong').textContent : ''; };
    if (feitos) txt.textContent = feitos === total ? `Você leu os ${total} guias. Que tal refazer um teste rápido?` : `${feitos} de ${total} guias lidos. Continue de onde parou.`;
    let alvo = null, rotulo = '';
    if (estado.ultimo && slugs.includes(estado.ultimo) && !lido(estado.ultimo)) { alvo = estado.ultimo; rotulo = 'Continuar: '; }
    else if (feitos) { alvo = slugs.find(s => !lido(s)); rotulo = 'Próximo: '; }
    if (alvo) { btn.href = '/aprender/' + alvo; btn.textContent = rotulo + titulo(alvo); }
    else if (feitos === total && total) { btn.href = '/aprender/glossario'; btn.textContent = 'Revisar com o glossário'; }
  }

  /* ══ Artigo ══════════════════════════════════════════════════════ */
  function artigo() {
    const slug = document.body.dataset.slug;
    const corpo = document.querySelector('.ap-corpo');
    if (!slug || !corpo) return;
    estado.ultimo = slug;
    gravar();

    /* Barra de leitura no topo */
    const barra = document.createElement('div');
    barra.className = 'ap-barra';
    barra.setAttribute('aria-hidden', 'true');
    barra.innerHTML = '<span></span>';
    document.body.appendChild(barra);
    const fio = barra.firstChild;
    const progresso = () => {
      const r = corpo.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      return Math.min(1, Math.max(0, total > 0 ? (-r.top + innerHeight * 0.4) / total : 1));
    };

    /* Marcar como lido */
    const btnLido = document.querySelector('[data-lido]');
    let desmarcou = false;
    function pintarLido() {
      if (!btnLido) return;
      const sim = !!estado.lidos[slug];
      btnLido.hidden = false;
      btnLido.classList.toggle('on', sim);
      btnLido.setAttribute('aria-pressed', String(sim));
      btnLido.querySelector('span').textContent = sim ? 'Lido' : 'Marcar como lido';
    }
    function marcar(sim, avisar) {
      if (sim) estado.lidos[slug] = Date.now(); else delete estado.lidos[slug];
      gravar();
      pintarLido();
      if (avisar) aviso(sim ? 'Guia marcado como lido.' : 'Marcação de lido removida.');
    }
    pintarLido();
    btnLido?.addEventListener('click', () => { const sim = !estado.lidos[slug]; if (!sim) desmarcou = true; marcar(sim, true); });
    const fim = document.querySelector('.ap-fim');
    if (fim && 'IntersectionObserver' in window) {
      const obs = new IntersectionObserver(es => {
        if (es.some(e => e.isIntersecting) && !estado.lidos[slug] && !desmarcou) { marcar(true, true); obs.disconnect(); }
      });
      obs.observe(fim);
    }

    sumario(progresso);
    addEventListener('scroll', () => { fio.style.transform = `scaleX(${progresso()})`; }, { passive: true });
    fio.style.transform = `scaleX(${progresso()})`;

    document.querySelectorAll('.tab-fig[data-passos]').forEach(diagramaVivo);
    teste(slug, () => { if (!estado.lidos[slug] && !desmarcou) marcar(true, false); });
  }

  /* Sumário flutuante: botão que abre a lista de seções */
  function sumario(progresso) {
    const toc = document.querySelector('.ap-toc');
    const titulos = [...document.querySelectorAll('.ap-corpo h2[id]')];
    if (!toc || titulos.length < 3) return;
    const extras = [...document.querySelectorAll('#teste-t')];
    const itens = [...titulos, ...extras];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ap-sum-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = `${svg('lista')}<span>Sumário</span><small class="ap-sum-n"></small>`;
    const fundo = document.createElement('div');
    fundo.className = 'ap-folha-fundo';
    const folha = document.createElement('div');
    folha.className = 'ap-folha';
    folha.id = 'ap-folha';
    folha.setAttribute('role', 'dialog');
    folha.setAttribute('aria-modal', 'true');
    folha.setAttribute('aria-labelledby', 'ap-folha-t');
    folha.innerHTML = `<div class="ap-folha-alca" aria-hidden="true"></div><div class="ap-folha-topo"><div><strong id="ap-folha-t">Neste artigo</strong><small class="ap-folha-pct"></small></div><button type="button" class="ap-folha-x" aria-label="Fechar o sumário">${svg('fechar')}</button></div>`
      + `<ol class="ap-folha-lista">${itens.map((h, n) => `<li><a href="#${h.id}"><span class="ap-folha-num">${h.id === 'teste-t' ? svg('check') : n + 1}</span><span>${h.textContent}</span></a></li>`).join('')}</ol>`;
    btn.setAttribute('aria-controls', folha.id);
    document.body.append(btn, fundo, folha);
    const links = [...folha.querySelectorAll('a')];

    const atual = () => { let k = -1; for (let n = 0; n < itens.length; n++) if (itens[n].getBoundingClientRect().top < innerHeight * 0.35) k = n; return k; };
    function pintar() {
      const k = atual();
      links.forEach((a, n) => { a.classList.toggle('atual', n === k); if (n === k) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      btn.querySelector('.ap-sum-n').textContent = k >= 0 && k < titulos.length ? `${k + 1}/${titulos.length}` : '';
      folha.querySelector('.ap-folha-pct').textContent = `${Math.round(progresso() * 100)}% lido`;
      const visivel = toc.getBoundingClientRect().bottom < 0;
      btn.classList.toggle('vis', visivel);
    }
    const raiz = document.documentElement;
    function abrir() {
      pintar();
      raiz.classList.add('ap-folha-aberta');
      btn.setAttribute('aria-expanded', 'true');
      const a = folha.querySelector('a.atual') || links[0];
      a.scrollIntoView({ block: 'nearest' });
      folha.querySelector('.ap-folha-x').focus({ preventScroll: true });
    }
    function fechar(volta) {
      if (!raiz.classList.contains('ap-folha-aberta')) return;
      raiz.classList.remove('ap-folha-aberta');
      btn.setAttribute('aria-expanded', 'false');
      if (volta) btn.focus({ preventScroll: true });
    }
    btn.addEventListener('click', abrir);
    fundo.addEventListener('click', () => fechar(true));
    folha.querySelector('.ap-folha-x').addEventListener('click', () => fechar(true));
    folha.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      fechar(false);
      const alvo = document.getElementById(a.getAttribute('href').slice(1));
      if (alvo) { alvo.scrollIntoView({ behavior: suave(), block: 'start' }); history.replaceState(null, '', a.getAttribute('href')); }
    });
    document.addEventListener('keydown', e => {
      if (!raiz.classList.contains('ap-folha-aberta')) return;
      if (e.key === 'Escape') { e.preventDefault(); fechar(true); }
      if (e.key === 'Tab') {
        const f = [...folha.querySelectorAll('a,button')], i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    // arrastar a folha para baixo fecha (celular)
    let y0 = null;
    folha.addEventListener('touchstart', e => { y0 = folha.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    folha.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 80) fechar(true); y0 = null; }, { passive: true });
    let pedido = 0;
    addEventListener('scroll', () => { if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; pintar(); }); }, { passive: true });
    pintar();
  }

  /* Diagrama que passa os lances: ◀ ▶, toque no tabuleiro, teclas ← → */
  const NOMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  function tabuleiroDe(fen) {
    const casas = [];
    for (const fil of fen.split(' ')[0].split('/')) for (const ch of fil) {
      if (/\d/.test(ch)) for (let k = 0; k < +ch; k++) casas.push('');
      else casas.push(ch);
    }
    return casas;
  }
  function diagramaVivo(fig) {
    let dados;
    try { dados = JSON.parse(fig.dataset.passos); } catch (e) { return; }
    const fens = dados.f, lances = dados.l, ini = dados.i, ult = fens.length - 1;
    if (!Array.isArray(fens) || fens.length < 2) return;
    const tab = fig.querySelector('.tab'), cel = [...tab.children];
    const marcasOriginais = cel.map(c => c.classList.contains('m'));
    const abrir = fig.querySelector('.tab-abrir');
    const vez = fig.querySelector('.tab-vez');
    const ctrl = document.createElement('div');
    ctrl.className = 'tab-ctrl';
    ctrl.innerHTML = `<button type="button" data-ir="inicio" aria-label="Voltar ao início">${svg('inicio')}</button>`
      + `<button type="button" data-ir="ant" aria-label="Lance anterior">${svg('ant')}</button>`
      + `<span class="tab-lance" aria-live="polite"></span>`
      + `<button type="button" data-ir="prox" aria-label="Próximo lance">${svg('prox')}</button>`
      + `<button type="button" data-ir="fim" aria-label="Ir ao último lance">${svg('fim')}</button>`;
    fig.querySelector('.tab-acoes').prepend(ctrl);
    fig.classList.add('vivo');
    tab.setAttribute('title', 'Toque para ver o próximo lance');
    const rot = ctrl.querySelector('.tab-lance');
    let i = ini;

    function mostrar(n) {
      i = Math.max(0, Math.min(ult, n));
      const agora = tabuleiroDe(fens[i]), antes = i > 0 ? tabuleiroDe(fens[i - 1]) : null;
      cel.forEach((c, k) => {
        const p = agora[k];
        let img = c.querySelector('img');
        if (p) {
          const src = `/pieces/${NOMES[p.toLowerCase()]}-${p === p.toUpperCase() ? 'w' : 'b'}.svg`;
          if (!img) { img = document.createElement('img'); img.alt = ''; img.width = 60; img.height = 60; img.decoding = 'async'; c.appendChild(img); }
          if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        } else if (img) img.remove();
        c.classList.toggle('m', i === ini && marcasOriginais[k]);
        c.classList.toggle('u', !!antes && antes[k] !== p);
      });
      const brancas = fens[i].split(' ')[1] === 'w';
      if (vez) { vez.classList.toggle('vb', brancas); vez.classList.toggle('vp', !brancas); vez.textContent = brancas ? 'Jogam as brancas' : 'Jogam as pretas'; }
      rot.innerHTML = i === 0 ? `<b>Posição inicial</b><small>toque ▶ para jogar</small>` : `<b>${lances[i]}</b><small>lance ${i} de ${ult}</small>`;
      ctrl.querySelector('[data-ir="inicio"]').disabled = ctrl.querySelector('[data-ir="ant"]').disabled = i === 0;
      ctrl.querySelector('[data-ir="prox"]').disabled = ctrl.querySelector('[data-ir="fim"]').disabled = i === ult;
      if (abrir) abrir.href = '/?fen=' + encodeURIComponent(fens[i]);
    }
    ctrl.addEventListener('click', e => {
      const b = e.target.closest('[data-ir]');
      if (!b) return;
      const ir = b.dataset.ir;
      mostrar(ir === 'inicio' ? 0 : ir === 'fim' ? ult : ir === 'ant' ? i - 1 : i + 1);
      if (b.disabled) ctrl.querySelector(ir === 'inicio' || ir === 'ant' ? '[data-ir="prox"]' : '[data-ir="ant"]').focus();
    });
    ctrl.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(i - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(i + 1); }
    });
    tab.addEventListener('click', () => mostrar(i === ult ? 0 : i + 1));
    mostrar(ini);
  }

  /* Teste rápido */
  function teste(slug, aoTerminar) {
    const caixa = document.querySelector('.ap-teste');
    if (!caixa) return;
    const qs = [...caixa.querySelectorAll('.ap-q')];
    const placar = caixa.querySelector('.ap-teste-placar');
    function conferir() {
      const feitas = qs.filter(q => q.classList.contains('respondida'));
      if (feitas.length < qs.length) { placar.textContent = ''; return; }
      const certas = qs.filter(q => q.classList.contains('acertou')).length;
      estado.testes[slug] = `${certas}/${qs.length}`;
      gravar();
      const frase = certas === qs.length ? 'Gabaritou! Você pegou as ideias principais do guia.'
        : certas === 0 ? 'Vale reler as partes que ficaram em dúvida e tentar de novo.'
        : 'Bom começo. Releia o trecho das que errou e tente de novo.';
      placar.innerHTML = `<span class="ap-placar-n">${certas}/${qs.length}</span><span>${frase}</span><button type="button" class="ap-refazer">${svg('refazer')}Refazer</button>`;
      placar.classList.toggle('gabarito', certas === qs.length);
      aoTerminar();
    }
    caixa.addEventListener('click', e => {
      if (e.target.closest('.ap-refazer')) {
        qs.forEach(q => {
          q.classList.remove('respondida', 'acertou');
          q.querySelectorAll('.ap-q-op').forEach(b => { b.disabled = false; b.classList.remove('certa', 'errada', 'escolhida'); b.removeAttribute('aria-pressed'); });
          q.querySelector('.ap-q-exp').hidden = true;
        });
        placar.innerHTML = '';
        placar.classList.remove('gabarito');
        qs[0].scrollIntoView({ behavior: suave(), block: 'center' });
        return;
      }
      const op = e.target.closest('.ap-q-op');
      if (!op) return;
      const q = op.closest('.ap-q');
      if (q.classList.contains('respondida')) return;
      const certa = +q.dataset.certa, escolha = +op.dataset.i;
      q.classList.add('respondida');
      if (escolha === certa) q.classList.add('acertou');
      q.querySelectorAll('.ap-q-op').forEach(b => {
        const n = +b.dataset.i;
        b.disabled = true;
        if (n === certa) b.classList.add('certa');
        if (n === escolha) { b.classList.add('escolhida'); b.setAttribute('aria-pressed', 'true'); if (n !== certa) b.classList.add('errada'); }
      });
      const exp = q.querySelector('.ap-q-exp');
      exp.hidden = false;
      exp.setAttribute('data-rotulo', escolha === certa ? 'Certo!' : 'Não é essa.');
      conferir();
    });
  }

  function iniciar() {
    if (document.querySelector('.ap-hub')) indice();
    if (document.body.classList.contains('ap-art')) artigo();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
  // voltar pelo histórico (bfcache) mostra o progresso atualizado
  addEventListener('pageshow', e => {
    if (!e.persisted || !document.querySelector('.ap-hub')) return;
    Object.assign(estado, ler());
    if (!estado.lidos) estado.lidos = {};
    indice();
  });
})();

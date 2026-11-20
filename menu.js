/* Barra de cima, em todas as páginas.
   - Computador: "Como usar", "Sobre" e "Contato" ficam no menu "Mais".
   - Celular: o ☰ abre uma gaveta lateral com todas as páginas, o Pro e a
     conta; as páginas principais ficam em abas fixas embaixo.
   - A barra (e as abas) somem ao rolar para baixo e voltam ao rolar para cima. */
(function () {
  const IC = {
    analisar: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
    aprender: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    'como-usar': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    guia: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    sobre: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    contato: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    seta: '<path d="m6 9 6 6 6-6"/>',
    conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const PAGINAS = [
    { id: 'analisar', href: '/', nome: 'Analisar partida', aba: 'Analisar' },
    { id: 'aprender', href: '/aprender/', nome: 'Aprender xadrez', aba: 'Aprender' },
    { id: 'como-usar', href: '/como-usar', nome: 'Como usar', aba: 'Como usar', mais: true },
    { id: 'guia', href: '/guia', nome: 'Guia de análise', aba: 'Guia' },
    { id: 'sobre', href: '/sobre', nome: 'Sobre', mais: true },
    { id: 'contato', href: '/contato', nome: 'Contato', mais: true },
  ];
  // Página de um endereço: "/", "aprender/x", "como-usar.html" → id da lista.
  function idDe(caminho) {
    const p = caminho.replace(/^\/+/, '').replace(/\.html$/, '').replace(/\/+$/, '');
    if (p === '' || p === 'index') return 'analisar';
    if (p === 'aprender' || p.startsWith('aprender/')) return 'aprender';
    if (p === 'gambyte-premium') return 'pro';
    return PAGINAS.some(x => x.id === p) ? p : null;
  }
  const atual = idDe(location.pathname);
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lerConta() {
    let sessao = null, cache = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) { sessao = JSON.parse(localStorage.getItem(k)); break; }
      }
      cache = JSON.parse(localStorage.getItem('gambyte_perfil') || 'null');
    } catch (e) { /* sem armazenamento */ }
    const user = sessao && (sessao.user || (sessao.currentSession && sessao.currentSession.user));
    let nome = user ? ((cache && cache.nome) || (user.user_metadata && user.user_metadata.name) || (user.email || '').split('@')[0] || 'Minha conta') : null;
    let pro = !!(user && cache && cache.pro);
    // No analisador e na página do Pro o AuthSystem sabe mais (e na hora).
    try {
      if (window.AuthSystem && AuthSystem.currentSession) {
        const s = AuthSystem.currentSession();
        if (s) { nome = s.name || (s.email || '').split('@')[0] || nome || 'Minha conta'; pro = !!s.premium; }
      }
    } catch (e) { /* segue com o que tem */ }
    return { logado: !!nome, nome, pro };
  }

  // Clicar na página em que já está só volta ao topo (no analisador,
  // recarregar apagaria a análise aberta).
  function noTopoSeForAqui(e) {
    const a = e.target.closest('a[href]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.hash || idDe(u.pathname) !== atual || !atual) return;
    if (u.pathname.replace(/\.html$/, '').replace(/\/$/, '') !== location.pathname.replace(/\.html$/, '').replace(/\/$/, '')) return;
    e.preventDefault();
    fecharGaveta();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /* ── Computador: menu "Mais" ── */
  function montarMais(links) {
    const vaoProMais = [...links.querySelectorAll(':scope > a')].filter(a => {
      const p = PAGINAS.find(x => x.id === idDe(new URL(a.href, location.href).pathname));
      return p && p.mais;
    });
    if (!vaoProMais.length) return;
    const caixa = document.createElement('div');
    caixa.className = 'nav-mais';
    caixa.innerHTML = `<button type="button" class="nav-mais-btn" aria-expanded="false" aria-haspopup="true">Mais${svg('seta')}</button><div class="nav-mais-lista"></div>`;
    const lista = caixa.lastChild, btn = caixa.firstChild;
    lista.id = 'nav-mais-lista';
    btn.setAttribute('aria-controls', lista.id);
    vaoProMais[0].before(caixa);
    for (const a of vaoProMais) {
      const id = idDe(new URL(a.href, location.href).pathname);
      a.insertAdjacentHTML('afterbegin', svg(id));
      lista.appendChild(a);
      if (a.getAttribute('aria-current') === 'page') caixa.classList.add('tem-atual');
    }
    const abrir = sim => { caixa.classList.toggle('aberta', sim); btn.setAttribute('aria-expanded', String(sim)); };
    btn.addEventListener('click', e => { e.stopPropagation(); abrir(!caixa.classList.contains('aberta')); });
    document.addEventListener('click', e => { if (!caixa.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && caixa.classList.contains('aberta')) { abrir(false); btn.focus(); } });
    lista.addEventListener('click', () => abrir(false));
  }

  /* ── Celular: gaveta lateral ── */
  let gaveta, botaoMenu;
  function fecharGaveta() {
    if (!document.documentElement.classList.contains('gaveta-aberta')) return;
    document.documentElement.classList.remove('gaveta-aberta');
    if (botaoMenu) { botaoMenu.setAttribute('aria-expanded', 'false'); botaoMenu.focus({ preventScroll: true }); }
  }
  function preencherGaveta() {
    const c = lerConta();
    const links = PAGINAS.map(p => `<a href="${p.href}"${p.id === atual ? ' aria-current="page"' : ''}>${svg(p.id)}${p.nome}</a>`).join('');
    const pro = c.pro ? '' :
      `<div class="nav-gaveta-pro"><strong>Gambyte Pro</strong><p>Análise profunda, foto do tabuleiro e nenhum anúncio.</p><a class="nav-pro" href="/gambyte-premium">Conhecer o Pro</a></div>`;
    const conta = c.logado
      ? `<a class="nav-gaveta-conta" href="/gambyte-login.html"><span class="perfil-ini">${esc(c.nome.charAt(0).toUpperCase())}</span><span>${esc(c.nome)}<small>${c.pro ? 'Gambyte Pro ativo' : 'Minha conta'}</small></span></a>`
      : `<a class="nav-gaveta-conta" href="/gambyte-login.html"><span class="perfil-ini nav-ini-vazio">${svg('conta')}</span><span>Entrar<small>ou criar uma conta grátis</small></span></a>`;
    gaveta.querySelector('.nav-gaveta-links').innerHTML = links;
    gaveta.querySelector('.nav-gaveta-fim').innerHTML = pro + conta;
  }
  function montarGaveta(nav) {
    const fundo = document.createElement('div');
    fundo.className = 'nav-gaveta-fundo';
    gaveta = document.createElement('div');
    gaveta.className = 'nav-gaveta';
    gaveta.id = 'nav-gaveta';
    gaveta.setAttribute('role', 'dialog');
    gaveta.setAttribute('aria-modal', 'true');
    gaveta.setAttribute('aria-label', 'Menu do Gambyte');
    gaveta.innerHTML = `<div class="nav-gaveta-topo"><a class="info-brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Gambyte</span></a><button type="button" class="nav-gaveta-fechar" aria-label="Fechar o menu">${svg('fechar')}</button></div><nav class="nav-gaveta-links" aria-label="Páginas"></nav><div class="nav-gaveta-fim"></div>`;
    document.body.append(fundo, gaveta);

    botaoMenu = document.createElement('button');
    botaoMenu.type = 'button';
    botaoMenu.className = 'info-menu-btn';
    botaoMenu.setAttribute('aria-controls', gaveta.id);
    botaoMenu.setAttribute('aria-expanded', 'false');
    botaoMenu.setAttribute('aria-label', 'Abrir o menu');
    botaoMenu.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(botaoMenu);

    botaoMenu.addEventListener('click', () => {
      preencherGaveta();
      document.documentElement.classList.add('gaveta-aberta');
      botaoMenu.setAttribute('aria-expanded', 'true');
      gaveta.querySelector('.nav-gaveta-fechar').focus({ preventScroll: true });
    });
    fundo.addEventListener('click', fecharGaveta);
    gaveta.querySelector('.nav-gaveta-fechar').addEventListener('click', fecharGaveta);
    gaveta.addEventListener('click', e => { noTopoSeForAqui(e); });
    document.addEventListener('keydown', e => {
      if (!document.documentElement.classList.contains('gaveta-aberta')) return;
      if (e.key === 'Escape') { e.preventDefault(); fecharGaveta(); return; }
      if (e.key === 'Tab') { // foco preso na gaveta
        const f = [...gaveta.querySelectorAll('a,button')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    matchMedia('(min-width: 901px)').addEventListener('change', m => { if (m.matches) fecharGaveta(); });
    // Arrastar a gaveta para a direita fecha.
    let x0 = null;
    gaveta.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    gaveta.addEventListener('touchend', e => { if (x0 != null && e.changedTouches[0].clientX - x0 > 70) fecharGaveta(); x0 = null; }, { passive: true });
  }

  /* ── Celular: abas embaixo ── */
  function montarAbas() {
    const abas = document.createElement('nav');
    abas.className = 'nav-abas';
    abas.setAttribute('aria-label', 'Páginas principais');
    abas.innerHTML = PAGINAS.filter(p => p.aba)
      .map(p => `<a href="${p.href}"${p.id === atual ? ' aria-current="page"' : ''}>${svg(p.id)}<span>${p.aba}</span></a>`).join('');
    abas.addEventListener('click', noTopoSeForAqui);
    document.body.appendChild(abas);
    document.body.classList.add('tem-abas');
  }

  /* ── Some ao rolar para baixo, volta ao rolar para cima ── */
  function rolagem(nav) {
    const raiz = document.documentElement;
    let ultimo = scrollY;
    const aberto = () => raiz.classList.contains('gaveta-aberta') || nav.querySelector('.nav-mais.aberta') || nav.matches(':focus-within');
    addEventListener('scroll', () => {
      const y = scrollY, d = y - ultimo;
      if (y < 90 || aberto()) raiz.classList.remove('nav-recolhida');
      else if (d > 8) raiz.classList.add('nav-recolhida');
      else if (d < -8) raiz.classList.remove('nav-recolhida');
      if (Math.abs(d) > 8 || y < 90) ultimo = y;
    }, { passive: true });
  }

  function montar() {
    const nav = document.querySelector('body > .info-nav');
    const links = nav && nav.querySelector('.info-links');
    if (!nav || !links || nav.dataset.montada) return;
    nav.dataset.montada = '1';
    // Páginas de artigo: "Aprender" fica marcado como atual.
    if (!links.querySelector('[aria-current]') && atual) {
      for (const a of links.querySelectorAll(':scope > a')) if (idDe(new URL(a.href, location.href).pathname) === atual) { a.setAttribute('aria-current', 'page'); break; }
    }
    links.addEventListener('click', noTopoSeForAqui);
    montarMais(links);
    montarGaveta(nav);
    montarAbas();
    rolagem(nav);
  }

  // Perfil no canto do cabeçalho: quem está logado vê o próprio perfil (e,
  // se não for Pro, o botão do Pro ao lado); quem não está vê "Entrar" e o
  // Pro. Páginas que montam o próprio canto (analisador e página do Pro)
  // não usam isto.
  function perfil() {
    const lado = document.querySelector('body > .info-nav > .info-nav-side');
    if (!lado || lado.id) return;
    const c = lerConta();
    const pro = `<a class="nav-pro" href="/gambyte-premium"><span class="so-pc">Gambyte&nbsp;</span>Pro</a>`;
    if (!c.logado) {
      lado.innerHTML = `<a class="nav-entrar" href="/gambyte-login.html">Entrar</a>` + pro;
      return;
    }
    lado.innerHTML = (c.pro ? '' : pro) +
      `<a class="perfil-chip" href="/gambyte-login.html" title="Minha conta">` +
      `<span class="perfil-ini">${esc(c.nome.charAt(0).toUpperCase())}</span>` +
      `<span class="perfil-nome">${esc(c.nome)}</span>` +
      (c.pro ? '<span class="perfil-pro">PRO</span>' : '') + '</a>';
  }

  function iniciar() { montar(); perfil(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

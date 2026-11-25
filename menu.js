/* Barra de cima, em todas as páginas.
   - Computador: "Como usar", "Sobre" e "Contato" ficam no menu "Mais".
   - Celular: o ☰ abre uma gaveta lateral com todas as páginas, o Pro e a
     conta; as páginas principais ficam em abas fixas embaixo.
   - A barra (e as abas) somem ao rolar para baixo e voltam ao rolar para cima. */
(function () {
  const IC = {
    analisar: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
    jogar: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4"/><path d="M15 11h.01M18 13h.01"/>',
    aprender: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    'como-usar': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    guia: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    sobre: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    dna: '<path d="M12 2.5 21 9l-3.4 10.5H6.4L3 9z"/><path d="M12 8.2 15.6 10.8 14.2 15H9.8L8.4 10.8z"/>',
    contato: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    seta: '<path d="m6 9 6 6 6-6"/>',
    conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    baixar: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    compartilhar: '<path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    somar: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    pontos: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  const PAGINAS = [
    { id: 'analisar', href: '/', nome: 'Analisar partida', aba: 'Analisar' },
    { id: 'jogar', href: '/jogar', nome: 'Jogar contra o bot', aba: 'Jogar' },
    { id: 'dna', href: '/dna', nome: 'Seu DNA no xadrez', aba: 'DNA' },
    { id: 'aprender', href: '/aprender/', nome: 'Aprender xadrez', aba: 'Aprender' },
    { id: 'como-usar', href: '/como-usar', nome: 'Como usar', mais: true },
    { id: 'guia', href: '/guia', nome: 'Guia de análise', aba: 'Guia', mais: true },
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
    lista.insertAdjacentHTML('beforeend', `<button type="button" class="nav-mais-app" data-instalar>${svg('baixar')}Baixar o app</button>`);
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
    const app = `<button type="button" class="nav-gaveta-app" data-instalar>${svg('baixar')}<span>Baixar o app<small>Ícone na tela e abre em tela cheia</small></span></button>`;
    gaveta.querySelector('.nav-gaveta-fim').innerHTML = app + pro + conta;
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

  /* ── Baixar o app (o site instalado como app) ── */
  let pedidoInstalar = null;
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; agendarFaixa(); });
  addEventListener('appinstalled', () => {
    pedidoInstalar = null;
    document.documentElement.classList.add('app-instalado');
    fecharComoInstalar();
    fecharFaixa();
    avisoApp('Pronto! O Gambyte está na sua tela inicial.');
  });

  function aparelho() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return 'ios';
    if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : 'android';
    if (/Firefox\//.test(ua)) return 'firefox-pc';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari-pc';
    return 'chrome-pc';
  }

  function passos() {
    const i = n => `<span class="app-ic">${svg(n)}</span>`;
    switch (aparelho()) {
      case 'ios': return ['Abra o gambyte.com.br no <strong>Safari</strong>.', `Toque em <strong>Compartilhar</strong> ${i('compartilhar')} na barra de baixo.`, `Escolha <strong>Adicionar à Tela de Início</strong> ${i('somar')} e toque em <strong>Adicionar</strong>.`];
      case 'android': return [`Toque no menu ${i('pontos')} do navegador, no canto de cima.`, 'Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).', 'Confirme. O ícone do Gambyte aparece junto com seus apps.'];
      case 'samsung': return ['Toque no menu <strong>☰</strong> do navegador, embaixo.', 'Escolha <strong>Adicionar página a</strong> e depois <strong>Tela inicial</strong>.', 'Confirme. O ícone do Gambyte aparece junto com seus apps.'];
      case 'edge': return [`Clique no menu ${i('pontos')} do Edge.`, 'Vá em <strong>Aplicativos</strong> e em <strong>Instalar este site como aplicativo</strong>.', 'Confirme. O Gambyte abre numa janela própria.'];
      case 'firefox-pc': return ['O Firefox no computador não instala sites como app.', 'Abra o <strong>gambyte.com.br</strong> no Chrome ou no Edge.', 'Lá, clique em <strong>Baixar o app</strong> de novo.'];
      case 'safari-pc': return ['No Safari do Mac, abra o menu <strong>Arquivo</strong>.', 'Escolha <strong>Adicionar ao Dock</strong>.', 'Confirme. O Gambyte abre numa janela própria.'];
      default: return [`Clique no ícone de instalar ${i('baixar')} no fim da barra de endereço, ou no menu ${i('pontos')} do navegador.`, 'Escolha <strong>Instalar Gambyte</strong> (ou <strong>Transmitir, salvar e compartilhar → Instalar</strong>).', 'Confirme. O Gambyte abre numa janela própria.'];
    }
  }

  let modalApp = null;
  function fecharComoInstalar() {
    if (!modalApp) return;
    modalApp.remove();
    modalApp = null;
    document.documentElement.classList.remove('app-modal-aberto');
  }
  function mostrarComoInstalar() {
    fecharComoInstalar();
    modalApp = document.createElement('div');
    modalApp.className = 'app-modal-fundo';
    modalApp.innerHTML = `<div class="app-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-t">
      <button type="button" class="app-modal-x" aria-label="Fechar">${svg('fechar')}</button>
      <img src="/icone-192.png" alt="" width="64" height="64" class="app-modal-icone">
      <h2 id="app-modal-t">Baixar o app do Gambyte</h2>
      <p class="app-modal-sub">Grátis, sem loja e sem ocupar espaço: o Gambyte ganha um ícone na tela e abre em tela cheia, como qualquer app.</p>
      <ol class="app-passos">${passos().map(p => `<li>${p}</li>`).join('')}</ol>
      <button type="button" class="nav-pro app-modal-ok">Entendi</button>
    </div>`;
    document.body.appendChild(modalApp);
    document.documentElement.classList.add('app-modal-aberto');
    const fechar = () => fecharComoInstalar();
    modalApp.addEventListener('click', e => { if (e.target === modalApp || e.target.closest('.app-modal-x,.app-modal-ok')) fechar(); });
    modalApp.querySelector('.app-modal-ok').focus({ preventScroll: true });
  }

  function avisoApp(msg) {
    const t = document.createElement('div');
    t.className = 'app-aviso';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  /* Faixa "Instalar": no celular (quando dá para instalar) e no fim de uma
     análise. Fechou no X, some por uns dias (lembrado no aparelho). */
  const DIA = 864e5;
  const lembrar = (k, v) => { try { if (v === undefined) return +localStorage.getItem(k) || 0; localStorage.setItem(k, String(v)); } catch (e) { return 0; } };
  let faixa = null, faixaAgendada = false;
  function fecharFaixa(chave) {
    if (!faixa) return;
    if (chave) lembrar(chave, Date.now());
    faixa.remove();
    faixa = null;
    document.body.classList.remove('com-faixa-app');
  }
  function mostrarFaixa(titulo, texto, chave) {
    if (instalado() || faixa || document.querySelector('.app-modal')) return;
    // Celular: texto curto para caber em duas linhas.
    if (matchMedia('(max-width: 520px)').matches) { titulo = titulo.curto || titulo; texto = 'Grátis, em tela cheia.'; }
    faixa = document.createElement('div');
    faixa.className = 'app-faixa';
    faixa.setAttribute('role', 'complementary');
    faixa.setAttribute('aria-label', 'Baixar o app do Gambyte');
    faixa.innerHTML = `<img src="/icone-192.png" alt="" width="44" height="44"><div class="app-faixa-texto"><strong>${titulo}</strong><span>${texto}</span></div><button type="button" class="app-faixa-btn" data-instalar>Instalar</button><button type="button" class="app-faixa-x" aria-label="Agora não">${svg('fechar')}</button>`;
    faixa.querySelector('.app-faixa-x').addEventListener('click', () => fecharFaixa(chave));
    faixa.querySelector('.app-faixa-btn').addEventListener('click', () => { lembrar(chave, Date.now()); setTimeout(() => fecharFaixa(), 0); });
    document.body.appendChild(faixa);
    document.body.classList.add('com-faixa-app');
  }
  // Celular: uma vez por visita, alguns segundos depois de abrir, e só onde
  // a instalação funciona (navegador liberou ou é iPhone/iPad).
  function agendarFaixa() {
    if (faixaAgendada || instalado() || !matchMedia('(max-width: 900px)').matches) return;
    if (!pedidoInstalar && aparelho() !== 'ios') return;
    if (Date.now() - lembrar('gambyte_app_faixa') < 14 * DIA) return;
    faixaAgendada = true;
    setTimeout(() => mostrarFaixa(Object.assign(new String('Gambyte no seu celular'), { curto: 'Baixe o app' }), 'Grátis, ícone na tela e abre em tela cheia.', 'gambyte_app_faixa'), 4000);
  }
  // Fim de uma análise: o momento em que o app faz mais sentido.
  addEventListener('gambyte:analise-concluida', () => {
    if (instalado() || aparelho() === 'firefox-pc') return;
    if (Date.now() - lembrar('gambyte_app_fim') < 7 * DIA) return;
    setTimeout(() => mostrarFaixa(Object.assign(new String('Analise as próximas pelo app'), { curto: 'Analise pelo app' }), 'Instale grátis: abre direto no tabuleiro, em tela cheia.', 'gambyte_app_fim'), 1500);
  });

  async function instalar() {
    fecharGaveta();
    if (instalado()) { avisoApp('Você já está usando o app do Gambyte.'); return; }
    if (pedidoInstalar) {
      const p = pedidoInstalar;
      pedidoInstalar = null;
      try { await p.prompt(); await p.userChoice; } catch (e) { mostrarComoInstalar(); }
      return;
    }
    mostrarComoInstalar();
  }

  function montarInstalar() {
    if (instalado()) document.documentElement.classList.add('app-instalado');
    // Rodapé: mais um lugar para achar o app.
    const rodape = document.querySelector('.info-footer nav');
    if (rodape && !rodape.querySelector('[data-instalar]')) rodape.insertAdjacentHTML('beforeend', '<button type="button" class="rodape-app" data-instalar>Baixar o app</button>');
    // PC: botão de baixar ao lado do Pro, na barra de cima.
    const nav = document.querySelector('body > .info-nav'), lado = nav && nav.querySelector('.info-nav-side');
    if (lado && !nav.querySelector('.nav-app-btn')) lado.insertAdjacentHTML('beforebegin', `<button type="button" class="nav-app-btn" data-instalar title="Baixar o app do Gambyte">${svg('baixar')}<span>Baixar app</span></button>`);
    agendarFaixa();
    document.addEventListener('click', e => { if (e.target.closest('[data-instalar]')) { e.preventDefault(); instalar(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalApp) fecharComoInstalar(); });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
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
    // Nomes curtos no PC quando falta espaço (o resto some abaixo de 1280 px):
    // "Analisar partida" → "Analisar", "Aprender xadrez" → "Aprender"...
    const CURTO = { analisar: ['Analisar', ' partida'], aprender: ['Aprender', ' xadrez'], guia: ['Guia', ' de análise'] };
    for (const a of links.querySelectorAll(':scope > a')) {
      const c = CURTO[idDe(new URL(a.href, location.href).pathname)];
      if (c && a.textContent.trim() === c[0] + c[1]) a.innerHTML = `${c[0]}<span class="nav-longo">${c[1]}</span>`;
    }
    // "Jogar contra o bot" logo depois de "Analisar partida", em todas as páginas.
    if (!links.querySelector('a[href="/jogar"],a[href="jogar"],a[href="../jogar"]')) {
      const primeiro = links.querySelector(':scope > a');
      const a = document.createElement('a');
      a.href = '/jogar'; a.innerHTML = 'Jogar<span class="nav-longo"> contra o bot</span>';
      if (atual === 'jogar') a.setAttribute('aria-current', 'page');
      if (primeiro) primeiro.after(a); else links.prepend(a);
    }
    // "Seu DNA" (retrato de todas as partidas analisadas) depois de "Jogar".
    if (!links.querySelector('a[href="/dna"],a[href="dna"],a[href="../dna"]')) {
      const jogar = links.querySelector('a[href="/jogar"],a[href="jogar"],a[href="../jogar"]');
      const a = document.createElement('a');
      a.href = '/dna'; a.innerHTML = 'Seu DNA';
      if (atual === 'dna') a.setAttribute('aria-current', 'page');
      if (jogar) jogar.after(a); else links.append(a);
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

  function iniciar() { montar(); perfil(); montarInstalar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

/* Menu retrátil do cabeçalho no celular: um botão ☰ ao lado do logo abre
   e fecha a lista de páginas. No computador o botão fica escondido (CSS). */
(function () {
  function montar() {
    const nav = document.querySelector('body > .info-nav');
    const links = nav && nav.querySelector('.info-links');
    if (!nav || !links || nav.querySelector('.info-menu-btn')) return;
    if (!links.id) links.id = 'info-links';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'info-menu-btn';
    b.setAttribute('aria-controls', links.id);
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'Abrir o menu');
    b.innerHTML = '<span></span><span></span><span></span>';
    nav.insertBefore(b, nav.firstChild);
    const abrir = sim => {
      nav.classList.toggle('menu-aberto', sim);
      b.setAttribute('aria-expanded', String(sim));
      b.setAttribute('aria-label', sim ? 'Fechar o menu' : 'Abrir o menu');
    };
    b.addEventListener('click', e => { e.stopPropagation(); abrir(!nav.classList.contains('menu-aberto')); });
    links.addEventListener('click', e => { if (e.target.closest('a')) abrir(false); });
    document.addEventListener('click', e => { if (nav.classList.contains('menu-aberto') && !nav.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('menu-aberto')) { abrir(false); b.focus(); } });
  }
  // Perfil no canto do cabeçalho, em todas as páginas: quem está logado vê
  // o próprio perfil (e, se não for Pro, o botão do Pro ao lado); quem não
  // está vê "Entrar" e "Gambyte Pro". Páginas que montam o próprio canto
  // (analisador e página do Pro) não usam isto.
  function perfil() {
    const lado = document.querySelector('body > .info-nav > .info-nav-side');
    if (!lado || lado.id) return;
    const raiz = location.pathname.indexOf('/aprender/') >= 0 ? '/' : '';
    let sessao = null, cache = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) { sessao = JSON.parse(localStorage.getItem(k)); break; }
      }
      cache = JSON.parse(localStorage.getItem('gambyte_perfil') || 'null');
    } catch (e) { /* sem armazenamento */ }
    const user = sessao && (sessao.user || (sessao.currentSession && sessao.currentSession.user));
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pro = `<a class="nav-pro" href="${raiz}gambyte-premium.html"><span class="so-pc">Gambyte&nbsp;</span>Pro</a>`;
    if (!user) {
      lado.innerHTML = `<a class="nav-entrar" href="${raiz}gambyte-login.html">Entrar</a>` + pro;
      return;
    }
    const nome = (cache && cache.nome) || (user.user_metadata && user.user_metadata.name) || (user.email || '').split('@')[0] || 'Minha conta';
    const ehPro = !!(cache && cache.pro);
    lado.innerHTML = (ehPro ? '' : pro) +
      `<a class="perfil-chip" href="${raiz}gambyte-login.html" title="Minha conta">` +
      `<span class="perfil-ini">${esc(nome.charAt(0).toUpperCase())}</span>` +
      `<span class="perfil-nome">${esc(nome)}</span>` +
      (ehPro ? '<span class="perfil-pro">PRO</span>' : '') + '</a>';
  }

  function iniciar() { montar(); perfil(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

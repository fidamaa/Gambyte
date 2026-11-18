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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();

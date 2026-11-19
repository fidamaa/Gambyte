/* Anúncios (Google AdSense).
   Roda antes do script do AdSense: para quem é Pro (o Pro promete "sem
   anúncios"), pausa os pedidos de anúncio, inclusive os automáticos.
   O estado do Pro vem do último login guardado neste aparelho; quando a
   conta carrega, auth-ui.js também esconde os espaços de anúncio. */
(function () {
  let pro = false;
  try { pro = !!(JSON.parse(localStorage.getItem('gambyte_perfil') || 'null') || {}).pro; } catch (e) { /* sem armazenamento */ }
  if (pro) (window.adsbygoogle = window.adsbygoogle || []).pauseAdRequests = 1;

  // Pede o anúncio de um espaço só quando ele já tem largura. Pedir durante
  // a montagem da página dá "No slot size for availableWidth=0" e o espaço
  // fica vazio para sempre.
  window.gambyteAnuncio = function (ins) {
    if (!ins || ins.dataset.pedido) return;
    const pedir = () => {
      if (ins.dataset.pedido || ins.offsetWidth === 0) return false;
      ins.dataset.pedido = '1';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* bloqueador de anúncio */ }
      return true;
    };
    if (pedir()) return;
    const tentar = () => { if (pedir() && obs) obs.disconnect(); };
    const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(tentar) : null;
    if (obs) obs.observe(ins);
    window.addEventListener('load', tentar, { once: true });
  };
})();

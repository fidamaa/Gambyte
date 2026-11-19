/* Anúncios (Google AdSense).
   Roda antes do script do AdSense: para quem é Pro (o Pro promete "sem
   anúncios"), pausa os pedidos de anúncio, inclusive os automáticos.
   O estado do Pro vem do último login guardado neste aparelho; quando a
   conta carrega, auth-ui.js também esconde os espaços de anúncio. */
(function () {
  let pro = false;
  try { pro = !!(JSON.parse(localStorage.getItem('gambyte_perfil') || 'null') || {}).pro; } catch (e) { /* sem armazenamento */ }
  if (pro) (window.adsbygoogle = window.adsbygoogle || []).pauseAdRequests = 1;
})();

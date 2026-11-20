/* Service worker do app do Gambyte.
   Rede primeiro: com internet, tudo vem do servidor como sempre (cada
   publicação chega na hora). Cada arquivo do próprio site que chega bem fica
   guardado; sem internet, o app abre com o que já foi visto e o motor, que
   roda no aparelho, continua analisando.
   Não mexe no cache do motor completo (gambyte-motor-*), que é do site. */
const CACHE = 'gambyte-site-v1';
const BASICO = ['/', '/menu.js', '/manifest.webmanifest', '/icone-192.png', '/logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICO)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n.startsWith('gambyte-site-') && n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/_prints/')) return;
  e.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp.ok && resp.type === 'basic') {
        const copia = resp.clone();
        // Páginas ficam guardadas sem o "?..." do endereço (uma cópia por página).
        const chave = req.mode === 'navigate' ? url.origin + url.pathname : req;
        caches.open(CACHE).then(c => c.put(chave, copia)).catch(() => {});
      }
      return resp;
    } catch (erro) {
      const salvo = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (salvo) return salvo;
      if (req.mode === 'navigate') {
        const inicio = await caches.match('/');
        if (inicio) return inicio;
      }
      throw erro;
    }
  })());
});

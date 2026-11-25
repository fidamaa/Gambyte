/* Abertura da página inicial (vinheta de marca, ~2,6 s).
   Tela verde → o cavalo entra numa curva em laço, com um rastro atrás →
   pousa com mola (amassa, estica, balança) → desliza e o nome "Gambyte"
   surge letra a letra → o cavalo salta para cima e puxa a cortina verde
   junto, revelando o site.

   Carregado no <head> (síncrono e pequeno) para decidir ANTES da primeira
   pintura se a vinheta roda: só na primeira visita da sessão, nunca para
   quem pede menos movimento e nunca quando a página abre para uma tarefa
   (?analisar, ?exemplo, ?fen, ?importar). Clique, toque ou tecla pulam.
   ?abertura=teste roda sempre (para conferir). */
(function () {
  var raiz = document.documentElement;
  var teste = /[?&]abertura=teste/.test(location.search);
  var rodar = true;
  try {
    if (sessionStorage.getItem('gambyte_abertura')) rodar = false;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) rodar = false;
    if (/[?&](analisar|exemplo|fen|importar)=/.test(location.search)) rodar = false;
    if (!Element.prototype.animate) rodar = false;
  } catch (e) { rodar = false; }
  if (teste && Element.prototype.animate) rodar = true;
  raiz.classList.add(rodar ? 'abertura-rodando' : 'sem-abertura');
  if (!rodar) return;
  try { sessionStorage.setItem('gambyte_abertura', '1'); } catch (e) { /* ok */ }

  var acabou = false, el = null;
  function liberarSite() { raiz.classList.remove('abertura-rodando'); raiz.classList.add('sem-abertura'); }
  function fim() {
    if (acabou) return;
    acabou = true;
    liberarSite();
    if (el) el.remove();
    removeEventListener('keydown', fim);
  }
  addEventListener('keydown', fim);
  if (!teste) setTimeout(fim, 4000);   // garantia: nunca prende o site

  // Mola (passa um pouco do ponto e assenta). linear() onde houver; senão, um "back".
  var MOLA = 'cubic-bezier(.34,1.56,.64,1)';
  try {
    if (CSS.supports('animation-timing-function', 'linear(0, 1)'))
      MOLA = 'linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1)';
  } catch (e) { /* fica o back */ }

  function rodarVinheta() {
    var cav = el.querySelector('.ab-heroi'), corpo = cav.querySelector('i');
    var rastro = Array.prototype.slice.call(el.querySelectorAll('.ab-fant'));
    var letras = Array.prototype.slice.call(el.querySelectorAll('.ab-nome span'));
    var T0 = 100, ENTRA = 860, TN = T0 + 900, TS = TN + 820;
    var caminho = [{ offsetDistance: '0%' }, { offsetDistance: '100%' }];
    var curva = 'cubic-bezier(.3,0,.15,1)';

    // 1. Entrada em laço (posição) + giro e tamanho (corpo)
    cav.animate(caminho, { duration: ENTRA, delay: T0, easing: curva, fill: 'both' });
    corpo.animate([
      { rotate: '-40deg', scale: '.55' },
      { rotate: '18deg', scale: '1.08', offset: .42 },
      { rotate: '-8deg', scale: '1', offset: .78 },
      { rotate: '0deg', scale: '1' }
    ], { duration: ENTRA, delay: T0, easing: 'ease-out', fill: 'both' });

    // Rastro: cópias que seguem o mesmo laço, um pouco atrasadas
    rastro.forEach(function (f, i) {
      var d = T0 + (i + 1) * 24, op = .26 - i * .032;
      f.animate(caminho, { duration: ENTRA, delay: d, easing: curva, fill: 'both' });
      f.animate([{ opacity: 0 }, { opacity: op, offset: .08 }, { opacity: op, offset: .7 }, { opacity: 0 }],
        { duration: ENTRA, delay: d, fill: 'both' });
    });

    // 2. Pouso: amassa, estica, balança
    corpo.animate([
      { scale: '1 1', rotate: '0deg' },
      { scale: '1.16 .82', rotate: '0deg', offset: .18 },
      { scale: '.93 1.09', rotate: '-5deg', offset: .42 },
      { scale: '1.03 .97', rotate: '3deg', offset: .66 },
      { scale: '1 1', rotate: '-1deg', offset: .84 },
      { scale: '1 1', rotate: '0deg' }
    ], { duration: 560, delay: T0 + ENTRA - 60, easing: 'ease-out' });

    // 3. Abre espaço e o nome surge letra a letra
    [cav].concat(rastro).forEach(function (x) {
      x.animate([{ translate: '0 0' }, { translate: '-122px 0' }], { duration: 700, delay: TN, easing: MOLA, fill: 'both' });
    });
    letras.forEach(function (l, i) {
      l.animate([
        { opacity: 0, translate: '0 30px', filter: 'blur(8px)' },
        { opacity: 1, translate: '0 0', filter: 'blur(0)' }
      ], { duration: 700, delay: TN + 90 + i * 48, easing: MOLA, fill: 'both' });
    });

    // 4. Salto para cima puxando a cortina
    corpo.animate([
      { rotate: '0deg', scale: '1 1' },
      { rotate: '-9deg', scale: '1.1 .86', offset: .22 },
      { rotate: '6deg', scale: '.86 1.28' }
    ], { duration: 560, delay: TS, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    cav.animate([
      { translate: '-122px 0' },
      { translate: '-122px 14px', offset: .2 },
      { translate: '-122px -115vh' }
    ], { duration: 640, delay: TS, easing: 'cubic-bezier(.55,0,.7,.25)', fill: 'forwards' });
    rastro.forEach(function (f, i) {
      var d = TS + (i + 1) * 22, op = .24 - i * .03;
      f.animate([
        { translate: '-122px 0', opacity: 0 },
        { translate: '-122px 14px', opacity: op, offset: .2 },
        { translate: '-122px -115vh', opacity: op }
      ], { duration: 640, delay: d, easing: 'cubic-bezier(.55,0,.7,.25)', fill: 'forwards' });
    });
    letras.forEach(function (l, i) {
      l.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 -34px' }],
        { duration: 360, delay: TS + 80 + i * 26, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    });
    var cortina = el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-118%)' }],
      { duration: 720, delay: TS + 170, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
    // O conteúdo começa a entrar enquanto a cortina sobe
    if (!teste) {
      setTimeout(liberarSite, TS + 260);
      cortina.finished.then(fim, fim);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    el = document.getElementById('abertura');
    if (!el) { fim(); return; }
    el.addEventListener('pointerdown', fim);
    try { rodarVinheta(); } catch (e) { fim(); }
    // teste: congela no início; window.abertura(t) mostra o quadro de t ms
    if (teste) {
      var todas = el.getAnimations({ subtree: true });
      todas.forEach(function (a) { a.pause(); a.currentTime = 0; });
      window.abertura = function (t) { todas.forEach(function (a) { a.currentTime = t; }); return todas.length; };
    }
  });
})();

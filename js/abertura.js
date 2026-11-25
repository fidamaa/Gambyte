/* Abertura da página inicial (vinheta de marca, ~3 s).
   O tabuleiro da logo surge; em cada coluna do "gráfico" da logo uma
   torre sobe de baixo até o topo da barra, preenchendo o caminho, e o
   quadrado do topo acende verde-claro. Com a logo pronta, o nome aparece;
   depois a logo cresce até o lugar do tabuleiro da página, vira um
   tabuleiro 8x8 e o tabuleiro de verdade assume no mesmo lugar.

   Carregado no <head> (síncrono e pequeno) para decidir ANTES da primeira
   pintura se a vinheta roda: só na primeira visita da sessão, nunca para
   quem pede menos movimento e nunca quando a página abre para uma tarefa
   (?analisar, ?exemplo, ?fen, ?importar, ?abrir). Clique, toque ou tecla
   pulam. ?abertura=teste congela no início e window.abertura(ms) mostra
   um quadro. */
(function () {
  var raiz = document.documentElement;
  var teste = /[?&]abertura=teste/.test(location.search);
  // ?vinheta: roda de novo mesmo já tendo visto nesta sessão (para conferir)
  var forcar = /[?&]vinheta(=|&|$)/.test(location.search);
  var rodar = true;
  try {
    if (sessionStorage.getItem('gambyte_abertura')) rodar = false;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) rodar = false;
    if (/[?&](analisar|exemplo|fen|importar|abrir)=/.test(location.search)) rodar = false;
    if (!Element.prototype.animate) rodar = false;
  } catch (e) { rodar = false; }
  if ((teste || forcar) && Element.prototype.animate) rodar = true;
  // Duas classes separadas: "abertura-rodando" mantém a vinheta na tela;
  // "abertura-segura" só segura a entrada do conteúdo até a hora certa.
  raiz.classList.add(rodar ? 'abertura-rodando' : 'sem-abertura');
  if (rodar) raiz.classList.add('abertura-segura');
  if (!rodar) return;
  try { sessionStorage.setItem('gambyte_abertura', '1'); } catch (e) { /* ok */ }

  var acabou = false, el = null;
  function liberarSite() { raiz.classList.remove('abertura-segura'); }
  function fim() {
    if (acabou) return;
    acabou = true;
    liberarSite();
    raiz.classList.remove('abertura-rodando');
    raiz.classList.add('sem-abertura');
    if (el) el.remove();
    removeEventListener('keydown', fim);
  }
  addEventListener('keydown', fim);
  if (!teste) setTimeout(fim, 5000);   // garantia: nunca prende o site

  // Mola (passa um pouco do ponto e assenta). linear() onde houver; senão, um "back".
  var MOLA = 'cubic-bezier(.34,1.56,.64,1)';
  try {
    if (CSS.supports('animation-timing-function', 'linear(0, 1)'))
      MOLA = 'linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1)';
  } catch (e) { /* fica o back */ }

  function rodarVinheta() {
    var tile = document.getElementById('ab-tile');
    var nome = document.getElementById('ab-nome');
    var fundo = el.querySelector('.ab-fundo');
    var letras = Array.prototype.slice.call(nome.querySelectorAll('span'));
    var todas = [];
    function anima(alvo, quadros, op) { var a = alvo.animate(quadros, op); todas.push(a); return a; }

    // Posição das casas na logo (viewBox 64: casas de 9 a partir de 9,5)
    var pos = function (n) { return ((9.5 + 9 * n) / 64 * 100).toFixed(3) + '%'; };
    var posB = function (n) { return ((10.3 + 9 * n) / 64 * 100).toFixed(3) + '%'; };
    function novo(cls, c, r, interno) {
      var d = document.createElement('i');
      d.className = cls;
      d.style.left = (interno ? posB : pos)(c);
      d.style.top = (interno ? posB : pos)(r);
      tile.appendChild(d);
      return d;
    }

    // A vinheta termina no topo da página, onde está a logo da barra
    try { history.scrollRestoration = 'manual'; } catch (e) { /* ok */ }
    window.scrollTo(0, 0);
    // O tile começa centralizado; o nome entra depois ao lado dele
    var gap = parseFloat(getComputedStyle(el.querySelector('.ab-palco')).columnGap) || 30;
    var desloca = (nome.offsetWidth + gap) / 2;          // o tile começa centralizado
    tile.style.translate = desloca + 'px 0';

    var T0 = 80;
    // 1. O tile da logo aparece
    anima(tile, [{ opacity: 0, scale: '.8', rotate: '-6deg' }, { opacity: 1, scale: '1', rotate: '0deg' }],
      { duration: 640, delay: T0, easing: MOLA, fill: 'both' });

    // 2. O tabuleiro surge, em diagonal
    var escuras = [[0, 0], [2, 0], [4, 0], [1, 1], [3, 1], [0, 2], [2, 2], [4, 2], [1, 3], [3, 3], [0, 4], [2, 4], [4, 4]];
    escuras.sort(function (a, b) { return (a[0] - a[1]) - (b[0] - b[1]); });
    escuras.forEach(function (q, i) {
      anima(novo('ab-c', q[0], q[1]), [{ opacity: 0, scale: '.3' }, { opacity: 1, scale: '1' }],
        { duration: 320, delay: T0 + 180 + i * 26, easing: MOLA, fill: 'both' });
    });

    // 3. O gráfico cresce: em cada coluna uma torre sobe de baixo até o
    //    topo da barra, preenchendo o caminho; ao chegar ela se dissolve e o
    //    quadrado do topo acende verde-claro. Colunas da esquerda para a
    //    direita, como um gráfico crescendo; a maior termina no canto.
    var SOBE = [.22, .9, .3, 1.1];   // acelera, desacelera e passa um pouquinho do ponto
    var sobeCss = 'cubic-bezier(' + SOBE.join(',') + ')';
    // Momento (0..1) em que a curva atinge a fração f do caminho: o rastro
    // acende exatamente quando a torre passa pela casa.
    function quandoChega(f) {
      var x1 = SOBE[0], y1 = SOBE[1], x2 = SOBE[2], y2 = SOBE[3];
      for (var i = 1; i <= 400; i++) {
        var u = i / 400, m = 1 - u;
        var y = 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u;
        if (y >= f) return 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u;
      }
      return 1;
    }
    var colunas = [
      { c: 0, topo: 4 }, { c: 1, topo: 3 }, { c: 2, topo: 4 }, { c: 3, topo: 2 }, { c: 4, topo: 0 },
    ];
    var fimLances = 0;
    colunas.forEach(function (col, i) {
      var altura = 4 - col.topo + 1;               // casas da barra (1 a 5)
      var t = T0 + 520 + i * 125;                  // início desta coluna
      var dur = 300 + 135 * altura;                // barras maiores levam mais tempo
      var sobe = -(altura - 1) * 100 - 60;         // sai de um pouco abaixo da casa de baixo
      var p = novo('ab-p', col.c, 4);
      p.style.setProperty('--peca', 'url(/pieces/rook-w.svg)');
      // entra por baixo, já subindo
      anima(p, [{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: 1 }], { duration: dur, delay: t, fill: 'both' });
      anima(p, [{ translate: '0 60%' }, { translate: '0 ' + (sobe + 60) + '%' }], { duration: dur, delay: t, easing: sobeCss, fill: 'both' });
      // inclina um pouco na arrancada e endireita no fim
      anima(p, [{ rotate: '0deg' }, { rotate: (i % 2 ? '4deg' : '-4deg'), offset: .3 }, { rotate: '0deg' }], { duration: dur, delay: t, easing: 'ease-out', fill: 'both' });
      // rastro: cada casa da barra acende quando a torre passa por ela
      for (var r = 4; r > col.topo; r--) {
        var frac = (4 - r + .6) / (altura - 1 + .6);  // fração do caminho até o centro da casa
        var bar = novo('ab-b esc', col.c, r, true);
        anima(bar, [{ transform: 'scaleY(0)', filter: 'brightness(1.8)' }, { transform: 'scaleY(1)', filter: 'brightness(1)' }],
          { duration: 260, delay: t + dur * quandoChega(Math.min(1, frac)), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
      }
      // chegada: a torre se dissolve para cima e o topo acende
      var chega = t + dur * quandoChega(.96);
      anima(p, [{ opacity: 1, scale: '1', filter: 'blur(0)' }, { opacity: 0, scale: '.7', filter: 'blur(3px)' }],
        { duration: 300, delay: chega + 30, easing: 'ease-in', fill: 'forwards' });
      anima(novo('ab-b cla', col.c, col.topo, true), [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 520, delay: chega, easing: MOLA, fill: 'both' });
      anima(novo('ab-luz', col.c, col.topo), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.5)', offset: .3 }, { opacity: 0, transform: 'scale(2.3)' }],
        { duration: 640, delay: chega - 20, easing: 'ease-out', fill: 'both' });
      fimLances = Math.max(fimLances, chega + 260);
    });

    // 4. Logo pronta: o tile abre espaço e o nome aparece
    var TN = fimLances + 60;
    anima(tile, [{ translate: desloca + 'px 0' }, { translate: '0 0' }], { duration: 720, delay: TN, easing: MOLA, fill: 'both' });
    letras.forEach(function (l, i) {
      anima(l, [{ opacity: 0, translate: (-desloca / 2) + 'px 0', filter: 'blur(8px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }],
        { duration: 680, delay: TN + 120 + i * 45, easing: MOLA, fill: 'both' });
    });

    // 5. A logo vira o tabuleiro da página: cresce até o lugar dele, as
    //    casas 5x5 dão lugar às 8x8 em onda, o fundo verde some e o
    //    tabuleiro de verdade (com as peças) assume no mesmo lugar.
    //    A posição do tabuleiro só é medida agora: no começo da vinheta ele
    //    ainda não estava montado.
    var TS = TN + 640, DUR = 900;
    var saidaFeita = false, saidaAnims = [];
    function saida() {
      if (saidaFeita) return saidaAnims;
      saidaFeita = true;
      var lista = [];
      function an(alvo, q, op) { var a = alvo.animate(q, op); lista.push(a); return a; }
      var alvo = document.getElementById('board-canvas');
      var rA = alvo && alvo.getBoundingClientRect();
      var rT = tile.getBoundingClientRect();
      // o nome sai primeiro
      letras.forEach(function (l, i) {
        an(l, [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(6px)', translate: '0 -14px' }],
          { duration: 300, delay: i * 22, easing: 'ease-in', fill: 'forwards' });
      });
      if (!rA || rA.width < 50 || rA.bottom < 0 || rA.top > innerHeight) {
        // sem tabuleiro visível: só some
        an(el.querySelector('.ab-palco'), [{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        an(fundo, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 150, fill: 'forwards' });
        saidaAnims = lista; return lista;
      }
      var esc = rA.width / rT.width;
      var dx = (rA.left + rA.width / 2) - (rT.left + rT.width / 2);
      var dy = (rA.top + rA.height / 2) - (rT.top + rT.height / 2);
      var curva = 'cubic-bezier(.65,0,.2,1)';
      // as 64 casas do tabuleiro, nas cores do tabuleiro do site
      var tab = document.createElement('div');
      tab.className = 'ab-tab8';
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var q = document.createElement('i');
        q.className = (r + c) % 2 === 0 ? 'cl' : 'cd';
        tab.appendChild(q);
        an(q, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 380, delay: 160 + (r + c) * 26, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
      }
      tile.appendChild(tab);
      // a logo se desfaz enquanto as casas novas aparecem
      Array.prototype.forEach.call(tile.querySelectorAll('.ab-c, .ab-b'), function (casa) {
        an(casa, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: 120, fill: 'forwards' });
      });
      // o tile cresce até o tabuleiro e perde os cantos e a borda da logo
      an(tile, [
        { transform: 'translate(0,0) scale(1)', borderRadius: '21.9%', boxShadow: getComputedStyle(tile).boxShadow },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + esc + ')', borderRadius: (6 / esc) + 'px', boxShadow: '0 0 0 0 rgba(0,0,0,0)' }
      ], { duration: DUR, easing: curva, fill: 'forwards' });
      // o verde vai embora quando o tabuleiro pousa
      an(fundo, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: DUR - 260, easing: 'ease-out', fill: 'forwards' });
      // e o tabuleiro de verdade (com as peças) assume
      an(tile, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: DUR + 60, easing: 'ease-out', fill: 'forwards', composite: 'replace' });
      saidaAnims = lista;
      return lista;
    }

    if (teste) {
      todas.forEach(function (a) { a.pause(); a.currentTime = 0; });
      window.abertura = function (t) {
        todas.forEach(function (a) { a.currentTime = t; });
        if (t >= TS) {
          var s = saida();
          s.forEach(function (a) { a.pause(); a.currentTime = t - TS; });
        }
        return todas.length;
      };
      return;
    }
    setTimeout(function () { saida(); }, TS);
    setTimeout(liberarSite, TS + 200);
    setTimeout(fim, TS + DUR + 420);
  }

  document.addEventListener('DOMContentLoaded', function () {
    el = document.getElementById('abertura');
    if (!el) { fim(); return; }
    el.addEventListener('pointerdown', fim);
    try { rodarVinheta(); } catch (e) { fim(); }
  });
})();

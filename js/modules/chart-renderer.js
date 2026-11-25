/* ==============================================================
   MODULE: chart-renderer.js
   Gráfico de vantagem no estilo dos grandes sites de xadrez:
   a área clara (brancas) sobe a partir da base e a escura (pretas)
   desce a partir do topo; a fronteira entre as duas é a avaliação.

   Escala: a avaliação vira chance esperada de vitória (a mesma curva
   que o classificador usa), então +1 e +2 ficam bem separados e uma
   vantagem de +8 não "achata" o resto do gráfico.

   Interação: passar o mouse mostra lance e avaliação; clicar leva o
   tabuleiro para aquele lance.
   ============================================================== */
const ChartRenderer = (() => {

  const CLS_COLOR = {
    book: '#8890a8', brilliant: '#5bc9b8', great: '#9b7de0', excellent: '#5bc97a',
    'best-move': '#59b8e0', good: '#c9c45b', inaccuracy: '#e09b5b',
    mistake: '#e05c5c', miss: '#e0785b', blunder: '#c93030',
  };
  // Só os momentos que importam ganham marcador (o resto vira ruído visual).
  const MARCAR = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

  const C = {
    escuro:  '#141c1f',   // lado das pretas
    claro:   '#e3e9e5',   // lado das brancas
    meio:    'rgba(140,160,152,.45)',
    linha:   '#3fd69a',
    rotulo:  '#7a8a86',
  };

  let _lastW = 0, _lastH = 0;
  let _estado = null;   // dados do último desenho, usados pela interação
  let _hover = -1;
  const _ligados = new WeakSet();

  function chance(cp) {
    // cp do ponto de vista das brancas → 0..1 (mesma curva do classificador)
    if (cp >= 29000) return 1;
    if (cp <= -29000) return 0;
    return 1 / (1 + Math.exp(-0.00368208 * cp));
  }
  function fmt(v) {
    if (Math.abs(v) >= 29000) return (v > 0 ? '+' : '−') + 'M' + Math.max(1, 30000 - Math.abs(v));
    return (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) / 100).toFixed(2).replace('.', ',');
  }

  function ligar(canvas) {
    if (_ligados.has(canvas)) return;
    _ligados.add(canvas);
    canvas.style.cursor = 'pointer';
    const indice = ev => {
      if (!_estado) return -1;
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const { pad, pw, n } = _estado;
      if (n < 1) return -1;
      const i = Math.round(((x - pad.l) / pw) * Math.max(1, n - 1));
      return Math.max(0, Math.min(n - 1, i));
    };
    canvas.addEventListener('mousemove', ev => {
      const i = indice(ev);
      if (i === _hover || !_estado) return;
      _hover = i;
      const m = _estado.moves[i];
      // A etiqueta é desenhada no próprio gráfico; o rótulo serve aos leitores de tela.
      canvas.setAttribute('aria-label', m ? `Lance ${Math.floor(m.index / 2) + 1}${m.color === 'white' ? '' : ' das pretas'}: ${m.san || ''}, avaliação ${fmt(_estado.evals[i])}. Clique para ir ao lance.` : 'Gráfico de vantagem');
      desenhar(canvas);
    });
    canvas.addEventListener('mouseleave', () => { _hover = -1; if (_estado) desenhar(canvas); });
    canvas.addEventListener('click', ev => {
      const i = indice(ev);
      const m = _estado && _estado.moves[i];
      if (!m) return;
      const alvo = document.querySelector(`.move-item[data-index="${m.index}"]`);
      if (alvo) alvo.click();
    });
  }

  function render(canvas, movesData, activeIdx) {
    const moves = movesData.filter(m => m && m.evalAfter !== null && m.evalAfter !== undefined);
    if (!moves.length) return;
    const evals = moves.map(m => (m.color === 'white' ? m.evalAfter : -m.evalAfter));
    _estado = { moves, evals, activeIdx, pad: null, pw: 0, n: moves.length };
    ligar(canvas);
    desenhar(canvas);
  }

  function desenhar(canvas) {
    const { moves, evals, activeIdx } = _estado;
    const W = canvas.clientWidth || _lastW || 400;
    const H = canvas.clientHeight || _lastH || 150;
    const dpr = window.devicePixelRatio || 1;
    if (W !== _lastW || H !== _lastH || canvas.width !== Math.round(W * dpr)) {
      _lastW = W; _lastH = H;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 0, r: 0, t: 0, b: 18 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const n = evals.length;
    _estado.pad = pad; _estado.pw = pw;
    const x = i => pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = v => pad.t + ph * (1 - chance(v));
    const midY = pad.t + ph / 2;

    // Fundo (lado das pretas) com cantos arredondados
    const raio = 8;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(pad.l, pad.t, pw, ph, raio) : ctx.rect(pad.l, pad.t, pw, ph);
    ctx.clip();
    ctx.fillStyle = C.escuro;
    ctx.fillRect(pad.l, pad.t, pw, ph);

    // Área das brancas: da base até a curva (começa da posição inicial, 0,00)
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ph);
    ctx.lineTo(pad.l, midY);
    for (let i = 0; i < n; i++) ctx.lineTo(x(i), y(evals[i]));
    ctx.lineTo(pad.l + pw, pad.t + ph);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
    grad.addColorStop(0, '#f1f5f2'); grad.addColorStop(1, '#c9d4ce');
    ctx.fillStyle = grad;
    ctx.fill();

    // Fronteira (a avaliação) em esmeralda, fina
    ctx.beginPath();
    ctx.moveTo(pad.l, midY);
    for (let i = 0; i < n; i++) ctx.lineTo(x(i), y(evals[i]));
    ctx.strokeStyle = 'rgba(20,163,114,.95)';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Linha de igualdade
    ctx.strokeStyle = C.meio;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, midY); ctx.lineTo(pad.l + pw, midY); ctx.stroke();
    ctx.setLineDash([]);

    // Lance sob o mouse: guia vertical suave
    if (_hover >= 0 && _hover < n) {
      ctx.fillStyle = 'rgba(63,214,154,.18)';
      ctx.fillRect(x(_hover) - 1, pad.t, 2, ph);
    }

    // Lance ativo: guia vertical dourada
    let ai = -1;
    if (activeIdx !== undefined && activeIdx >= 0) ai = moves.findIndex(m => (m.index ?? m.moveIndex) === activeIdx);
    if (ai >= 0) {
      ctx.fillStyle = 'rgba(63,214,154,.55)';
      ctx.fillRect(x(ai) - 1, pad.t, 2, ph);
    }

    // Marcadores dos momentos importantes
    const r = n > 80 ? 3 : n > 40 ? 3.5 : 4;
    for (let i = 0; i < n; i++) {
      const cls = moves[i].classification;
      if (!MARCAR.has(cls) && i !== ai) continue;
      const cor = CLS_COLOR[cls] || C.linha;
      ctx.beginPath();
      ctx.arc(x(i), y(evals[i]), i === ai ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = cor;
      ctx.fill();
      ctx.lineWidth = i === ai ? 2.5 : 1.5;
      ctx.strokeStyle = i === ai ? '#ffffff' : 'rgba(20,22,30,.85)';
      ctx.stroke();
    }
    ctx.restore();

    // Etiqueta do lance sob o mouse: número, lance e avaliação
    if (_hover >= 0 && _hover < n && moves[_hover]) {
      const m = moves[_hover];
      const txt = `${Math.floor((m.index ?? m.moveIndex) / 2) + 1}${m.color === 'white' ? '.' : '...'} ${m.san || ''}  ${fmt(evals[_hover])}`;
      ctx.font = '600 11.5px "JetBrains Mono", monospace';
      const tw = ctx.measureText(txt).width + 16, th = 22;
      let tx = x(_hover) - tw / 2; tx = Math.max(2, Math.min(W - tw - 2, tx));
      const py = y(evals[_hover]);
      const ty = py - th - 10 < 2 ? py + 10 : py - th - 10;
      ctx.fillStyle = 'rgba(8,12,14,.92)';
      ctx.strokeStyle = 'rgba(63,214,154,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(tx, ty, tw, th, 6) : ctx.rect(tx, ty, tw, th);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9efed';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, tx + 8, ty + th / 2 + .5);
      ctx.textBaseline = 'alphabetic';
    }

    // Números dos lances
    ctx.fillStyle = C.rotulo;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'alphabetic';
    const passo = n > 120 ? 20 : n > 60 ? 10 : n > 24 ? 6 : 2;
    for (let i = 0; i < n; i += passo) {
      const num = Math.floor((moves[i].index ?? moves[i].moveIndex) / 2) + 1;
      ctx.textAlign = i === 0 ? 'left' : 'center';
      ctx.fillText(String(num), x(i), H - 4);
    }
  }

  // Sem partida analisada: posição igual (metade clara, metade escura) e um aviso.
  function clear(canvas) {
    if (!canvas) return;
    _estado = null; _hover = -1;
    const W = canvas.clientWidth || _lastW || 400;
    const H = canvas.clientHeight || _lastH || 150;
    const dpr = window.devicePixelRatio || 1;
    _lastW = W; _lastH = H;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.title = '';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ph = H - 18, mid = ph / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, W, ph, 8) : ctx.rect(0, 0, W, ph);
    ctx.clip();
    ctx.fillStyle = C.escuro; ctx.fillRect(0, 0, W, ph);
    ctx.fillStyle = 'rgba(233,231,225,.16)'; ctx.fillRect(0, mid, W, ph - mid);
    ctx.strokeStyle = C.meio; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = C.rotulo;
    ctx.font = '12px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(W < 380 ? 'A vantagem aparece aqui na análise.' : 'A vantagem de cada lado aparece aqui durante a análise.', W / 2, mid - 10);
  }

  return { render, clear };
})();

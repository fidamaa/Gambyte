/* ==============================================================
   MODULE: chart-renderer.js
   Renders the advantage chart on a canvas element
   ============================================================== */
const ChartRenderer = (() => {

  let _lastW = 0;  // cache to avoid unnecessary canvas resize (causes layout reflow)

  function render(canvas, movesData, activeIdx) {
    const W = canvas.offsetWidth || _lastW || 400;
    const H = 130;
    const dpr = devicePixelRatio || 1;
    // Only resize the canvas element when dimensions actually changed
    if (W !== _lastW || canvas.width !== Math.round(W * dpr)) {
      _lastW = W;
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // reset + scale

    const validMoves = movesData.filter(m => m.evalAfter !== null);
    if (validMoves.length === 0) return;

    // Build eval series from white's perspective
    // evalAfter já está na perspectiva do jogador que moveu (negado no AnalysisEngine)
    // Branco move → evalAfter = perspectiva das brancas → usa direto
    // Preto move  → evalAfter = perspectiva das pretas → negamos para converter para brancas
    const evals = validMoves.map(m => {
      const isWhiteMoved = m.color === 'white';
      return isWhiteMoved ? m.evalAfter : -m.evalAfter;
    });

    const maxEval = 600;
    const pad = { l: 8, r: 8, t: 10, b: 22 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const midY = pad.t + ph / 2;

    function evalToY(e) {
      const clamped = Math.max(-maxEval, Math.min(maxEval, e));
      return pad.t + (ph / 2) * (1 - clamped / maxEval);
    }
    function idxToX(i) {
      return pad.l + (i / Math.max(1, evals.length - 1)) * pw;
    }

    // Background
    ctx.fillStyle = '#13161e';
    ctx.fillRect(0, 0, W, H);

    // Gradient fill — brancas (acima da linha): branco suave
    // Pretas (abaixo da linha): azul/roxo escuro
    const whiteGrad = ctx.createLinearGradient(0, pad.t, 0, midY);
    whiteGrad.addColorStop(0,   'rgba(240,217,181,0.55)');
    whiteGrad.addColorStop(1,   'rgba(240,217,181,0.05)');

    const blackGrad = ctx.createLinearGradient(0, midY, 0, pad.t + ph);
    blackGrad.addColorStop(0,   'rgba(70,70,130,0.10)');
    blackGrad.addColorStop(1,   'rgba(70,70,130,0.55)');

    // White advantage area (above midline)
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, pw, midY - pad.t);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(idxToX(0), midY);
    for (let i = 0; i < evals.length; i++) ctx.lineTo(idxToX(i), evalToY(evals[i]));
    ctx.lineTo(idxToX(evals.length - 1), midY);
    ctx.closePath();
    ctx.fillStyle = whiteGrad;
    ctx.fill();
    ctx.restore();

    // Black advantage area (below midline)
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, midY, pw, ph / 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(idxToX(0), midY);
    for (let i = 0; i < evals.length; i++) ctx.lineTo(idxToX(i), evalToY(evals[i]));
    ctx.lineTo(idxToX(evals.length - 1), midY);
    ctx.closePath();
    ctx.fillStyle = blackGrad;
    ctx.fill();
    ctx.restore();

    // Mid line
    ctx.strokeStyle = '#2e3448';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, midY);
    ctx.lineTo(W - pad.r, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Linha de eval
    ctx.beginPath();
    ctx.moveTo(idxToX(0), evalToY(evals[0]));
    for (let i = 1; i < evals.length; i++) ctx.lineTo(idxToX(i), evalToY(evals[i]));
    ctx.strokeStyle = '#e8c97a';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Indicador de lado — pequenos triângulos nas laterais
    ctx.fillStyle = 'rgba(240,217,181,0.5)';
    ctx.beginPath(); ctx.moveTo(pad.l-6, pad.t+2); ctx.lineTo(pad.l-1, midY-2); ctx.lineTo(pad.l-1, pad.t+2); ctx.fill();
    ctx.fillStyle = 'rgba(80,80,160,0.5)';
    ctx.beginPath(); ctx.moveTo(pad.l-6, pad.t+ph-2); ctx.lineTo(pad.l-1, midY+2); ctx.lineTo(pad.l-1, pad.t+ph-2); ctx.fill();

    // ── Bolinhas coloridas por classificação ─────────────────────
    const CLS_DOT_COLOR = {
      'book':       '#8890a8',
      'brilliant':  '#5bc9b8',
      'excellent':  '#5bc97a',
      'best-move':  '#59b8e0',
      'very-good':  '#8fc95b',
      'good':       '#c9c45b',
      'inaccuracy': '#e09b5b',
      'mistake':    '#e05c5c',
      'blunder':    '#c93030',
    };

    // Determina o tamanho das bolinhas: menor em partidas longas
    const dotR = evals.length > 60 ? 2 : evals.length > 30 ? 2.5 : 3;

    for (let i = 0; i < evals.length; i++) {
      const m   = validMoves[i];
      const cls = m.classification || '';
      const col = CLS_DOT_COLOR[cls];
      if (!col) continue;  // sem classificação ainda (análise em andamento)

      const cx = idxToX(i);
      const cy = evalToY(evals[i]);

      // Círculo preenchido com cor da classificação
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      // Borda branca fina para destacar do fundo
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // ── Cursor do lance ativo ─────────────────────────────────────
    // Encontra o índice dentro de validMoves que corresponde a activeIdx
    if (activeIdx !== undefined && activeIdx >= 0) {
      const vmIdx = validMoves.findIndex(m => (m.index !== undefined ? m.index : m.moveIndex) === activeIdx);
      if (vmIdx >= 0) {
        const cx = idxToX(vmIdx);
        const cy = evalToY(evals[vmIdx]);
        const cr = dotR + 3;  // círculo externo maior que as bolinhas

        // Anel externo branco semi-transparente
        ctx.beginPath();
        ctx.arc(cx, cy, cr + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Anel colorido da classificação (ou branco se sem class)
        const m   = validMoves[vmIdx];
        const cls = m.classification || '';
        const CLS_CURSOR = {
          'book':'#8890a8','brilliant':'#5bc9b8','excellent':'#5bc97a',
          'best-move':'#59b8e0','very-good':'#8fc95b','good':'#c9c45b',
          'inaccuracy':'#e09b5b','mistake':'#e05c5c','blunder':'#c93030',
        };
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.strokeStyle = CLS_CURSOR[cls] || '#e8c97a';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Ponto central sólido
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fillStyle = CLS_CURSOR[cls] || '#e8c97a';
        ctx.fill();
      }
    }

    // Labels de número de lance (a cada 10)
    ctx.fillStyle = '#555d78';
    ctx.font = `9px JetBrains Mono, monospace`;
    ctx.textAlign = 'center';
    for (let i = 0; i < evals.length; i += 10) {
      const moveNum = Math.floor(validMoves[i].moveIndex / 2) + 1;
      ctx.fillText(moveNum, idxToX(i), H - 5);
    }
  }

  return { render };
})();

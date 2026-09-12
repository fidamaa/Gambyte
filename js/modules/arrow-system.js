/* ==============================================================
   MODULE: arrow-system.js
   Handles manual arrows (right-click drag) and engine arrows.
   Depende de: board-ui.js
   ============================================================== */
const ArrowSystem = (() => {
  let canvas  = null;
  let ctx     = null;
  let sqSizeFn = null;

  // Manual arrows: array of { from, to, color }
  let manualArrows = [];
  // Engine arrow: { from, to } | null
  let engineArrow  = null;
  let showEngine   = true;

  // Drag state
  let dragging  = false;
  let dragFrom  = null;

  function init(arrowCanvas, boardCanvas, sqSizeGetter) {
    canvas    = arrowCanvas;
    sqSizeFn  = sqSizeGetter;
    ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // Right-click drag on board canvas
    boardCanvas.addEventListener('contextmenu', e => e.preventDefault());

    boardCanvas.addEventListener('mousedown', e => {
      if (e.button !== 2) return;
      e.preventDefault();
      const rect = boardCanvas.getBoundingClientRect();
      const sq = BoardUI.xyToSq(e.clientX - rect.left, e.clientY - rect.top);
      if (sq) { dragging = true; dragFrom = sq; }
    });

    boardCanvas.addEventListener('mouseup', e => {
      if (e.button !== 2) return;
      e.preventDefault();
      if (!dragging) return;
      const rect = boardCanvas.getBoundingClientRect();
      const sq = BoardUI.xyToSq(e.clientX - rect.left, e.clientY - rect.top);
      dragging = false;

      if (!sq || sq === dragFrom) {
        // Simple right-click: remove last arrow or clear all on double
        if (manualArrows.length > 0) manualArrows.pop();
      } else {
        // Drag: add arrow
        const existing = manualArrows.findIndex(a => a.from === dragFrom && a.to === sq);
        if (existing >= 0) {
          manualArrows.splice(existing, 1); // toggle off
        } else {
          manualArrows.push({ from: dragFrom, to: sq, color: 'rgba(255,80,80,0.82)' });
        }
      }
      dragFrom = null;
      redraw();
    });

    // Double right-click: clear all
    boardCanvas.addEventListener('dblclick', e => {
      if (e.button !== 2) return;
      manualArrows = [];
      redraw();
    });
  }

  let _redrawPending = false;

  function setEngineArrow(from, to) {
    engineArrow = (from && to) ? { from, to } : null;
    _scheduleRedraw();
  }

  function setShowEngine(val) {
    showEngine = val;
    _scheduleRedraw();
  }

  function clearManual() {
    manualArrows = [];
    _scheduleRedraw();
  }

  function _scheduleRedraw() {
    if (_redrawPending) return;
    _redrawPending = true;
    requestAnimationFrame(() => {
      _redrawPending = false;
      redraw();
    });
  }

  function redraw() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.width  / dpr;
    const h   = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    if (showEngine && engineArrow) {
      drawArrow(engineArrow.from, engineArrow.to, 'rgba(50,200,100,0.88)', true);
    }
    for (const a of manualArrows) {
      drawArrow(a.from, a.to, a.color, false);
    }
  }

  function sqCenter(sq) {
    // Delegate to BoardUI so flip is respected automatically
    const { x, y } = BoardUI.sqToXY(sq);
    const sz = sqSizeFn();
    return { x: x + sz / 2, y: y + sz / 2 };
  }

  // Retorna os "cotovelos" (waypoints) do trajeto entre duas casas.
  // Lances de cavalo (2+1) são desenhados em L, como no chess.com,
  // em vez de uma diagonal genérica.
  function _pathPoints(from, to) {
    const p1 = sqCenter(from);
    const p2 = sqCenter(to);
    const fileOf = sq => sq.charCodeAt(0) - 97;
    const rankOf = sq => parseInt(sq[1], 10);
    const df = Math.abs(fileOf(to) - fileOf(from));
    const dr = Math.abs(rankOf(to) - rankOf(from));
    const isKnightMove = (df === 1 && dr === 2) || (df === 2 && dr === 1);

    if (!isKnightMove) return [p1, p2];

    // Cotovelo: primeiro percorre o eixo maior (2 casas), depois vira 90°.
    const longAxisIsFile = df === 2;
    const bend = longAxisIsFile
      ? { x: p2.x, y: p1.y }
      : { x: p1.x, y: p2.y };
    return [p1, bend, p2];
  }

  function drawArrow(from, to, color, isEngine) {
    const sz     = sqSizeFn();
    const points = _pathPoints(from, to);

    const headLen  = sz * 0.34;
    const headW    = sz * 0.30;      // largura da base do "bloco" da ponta
    const bodyW    = sz * 0.22;      // haste mais grossa/quadrada, estilo chess.com
    const startPad = sz * 0.20;
    const endPad   = sz * 0.16;

    // Recuar o início do trajeto a partir da casa de origem
    const first = points[0], second = points[1];
    const fdx = second.x - first.x, fdy = second.y - first.y;
    const flen = Math.hypot(fdx, fdy) || 1;
    const sx = first.x + (fdx / flen) * startPad;
    const sy = first.y + (fdy / flen) * startPad;

    // Recuar o fim do trajeto na direção do último segmento
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const ldx = last.x - prev.x, ldy = last.y - prev.y;
    const llen = Math.hypot(ldx, ldy) || 1;
    const ux = ldx / llen, uy = ldy / llen;
    const ex = last.x - ux * endPad;
    const ey = last.y - uy * endPad;

    // Ponto onde a haste termina e a ponta (bloco) começa
    const headBaseX = ex - ux * headLen;
    const headBaseY = ey - uy * headLen;
    const perpX = -uy, perpY = ux;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = bodyW;
    ctx.lineJoin    = 'miter';
    ctx.lineCap     = 'butt';
    if (isEngine) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 6;
    }

    // Haste: do início até a base da ponta, passando pelos cotovelos
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i < points.length - 1; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineTo(headBaseX, headBaseY);
    ctx.stroke();

    // Ponta em bloco/trapézio (mais "quadrada", sem curvas), como no chess.com
    ctx.beginPath();
    ctx.moveTo(headBaseX + perpX * headW / 2, headBaseY + perpY * headW / 2);
    ctx.lineTo(headBaseX - perpX * headW / 2, headBaseY - perpY * headW / 2);
    ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  return { init, setEngineArrow, setShowEngine, clearManual, redraw };
})();

/* ==============================================================
   MODULE: arrow-system.js
   Setas e marcações no tabuleiro, no estilo dos grandes sites:

   - Botão direito arrastando: desenha uma seta (aparece enquanto você
     arrasta). Arrastar de novo a mesma seta apaga.
   - Botão direito sem arrastar: marca a casa. De novo, desmarca.
   - Shift, Ctrl ou Alt mudam a cor (verde, vermelho, azul).
   - Qualquer clique esquerdo no tabuleiro, ou um lance, apaga tudo.
   - A seta do motor fica em verde, por baixo das setas do jogador.

   Cada seta é desenhada opaca numa camada à parte e depois aplicada
   com transparência: a haste e a ponta não se sobrepõem em tons
   diferentes, e o cavalo ganha uma seta em L limpa.
   Depende de: board-ui.js
   ============================================================== */
const ArrowSystem = (() => {
  let canvas  = null;
  let ctx     = null;
  let sqSizeFn = null;
  let layer = null, lctx = null;   // camada opaca de cada seta

  const CORES = {
    padrao:   'rgb(255,170,0)',
    verde:    'rgb(159,207,63)',
    vermelho: 'rgb(248,85,63)',
    azul:     'rgb(72,193,249)',
    motor:    'rgb(63,214,154)',
    alternativa: 'rgb(120,170,235)',
  };
  const MARCAS = {
    padrao:   'rgba(235,97,80,0.80)',
    verde:    'rgba(172,206,89,0.80)',
    vermelho: 'rgba(248,85,63,0.80)',
    azul:     'rgba(82,176,220,0.80)',
  };

  let manualArrows = [];   // { from, to, cor }
  let marks = [];          // { sq, cor }
  let engineArrow  = null; // { from, to }
  let altArrows    = [];   // [{ from, to }] 2ª e 3ª linhas do motor
  let showAlts     = false;
  let showEngine   = true;
  let preview = null;      // seta sendo arrastada agora
  let dragFrom = null, dragCor = 'padrao';
  const boundBoards = new WeakSet();

  function corDoEvento(e) {
    if (e.shiftKey) return 'verde';
    if (e.ctrlKey || e.metaKey) return 'vermelho';
    if (e.altKey) return 'azul';
    return 'padrao';
  }

  function init(arrowCanvas, boardCanvas, sqSizeGetter) {
    canvas    = arrowCanvas;
    sqSizeFn  = sqSizeGetter;
    ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer = document.createElement('canvas');
    layer.width = canvas.width; layer.height = canvas.height;
    lctx = layer.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (boundBoards.has(boardCanvas)) return;
    boundBoards.add(boardCanvas);

    const sqDe = e => {
      const r = boardCanvas.getBoundingClientRect();
      return BoardUI.xyToSq(e.clientX - r.left, e.clientY - r.top);
    };
    boardCanvas.addEventListener('contextmenu', e => e.preventDefault());

    boardCanvas.addEventListener('mousedown', e => {
      if (e.button !== 2) return;
      e.preventDefault();
      dragFrom = sqDe(e);
      dragCor = corDoEvento(e);
      preview = null;
    });
    window.addEventListener('mousemove', e => {
      if (!dragFrom) return;
      const sq = sqDe(e);
      const novo = sq && sq !== dragFrom ? { from: dragFrom, to: sq, cor: dragCor } : null;
      if ((novo && preview && novo.to === preview.to) || (!novo && !preview)) return;
      preview = novo;
      _scheduleRedraw();
    });
    window.addEventListener('mouseup', e => {
      if (e.button !== 2 || !dragFrom) return;
      const de = dragFrom, sq = sqDe(e);
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) dragCor = corDoEvento(e);
      dragFrom = null; preview = null;
      if (!sq) { _scheduleRedraw(); return; }
      if (sq === de) {
        const i = marks.findIndex(m => m.sq === sq);
        if (i >= 0 && marks[i].cor === dragCor) marks.splice(i, 1);
        else { if (i >= 0) marks.splice(i, 1); marks.push({ sq, cor: dragCor }); }
        BoardUI._forceRedraw();
      } else {
        const i = manualArrows.findIndex(a => a.from === de && a.to === sq);
        if (i >= 0 && manualArrows[i].cor === dragCor) manualArrows.splice(i, 1);
        else { if (i >= 0) manualArrows.splice(i, 1); manualArrows.push({ from: de, to: sq, cor: dragCor }); }
      }
      _scheduleRedraw();
    });
  }

  let _redrawPending = false;

  function setEngineArrow(from, to) {
    engineArrow = (from && to) ? { from, to } : null;
    _scheduleRedraw();
  }

  function setAltArrows(lista) {
    altArrows = (lista || []).filter(a => a && a.from && a.to);
    _scheduleRedraw();
  }
  function setShowAlts(val) { showAlts = !!val; _scheduleRedraw(); }

  function setShowEngine(val) {
    showEngine = val;
    _scheduleRedraw();
  }

  // Apaga setas e marcações do jogador (clique no tabuleiro, lance novo).
  function clearManual() {
    if (!manualArrows.length && !marks.length && !preview) return;
    manualArrows = [];
    preview = null;
    if (marks.length) { marks = []; if (BoardUI._forceRedraw) BoardUI._forceRedraw(); }
    _scheduleRedraw();
  }

  // Casas marcadas: desenhadas pelo BoardUI por baixo das peças.
  function getMarks() { return marks.map(m => ({ sq: m.sq, color: MARCAS[m.cor] || MARCAS.padrao })); }

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
    if (layer && (layer.width !== canvas.width || layer.height !== canvas.height)) {
      layer.width = canvas.width; layer.height = canvas.height;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (showEngine && showAlts) {
      altArrows.forEach((a, k) => {
        if (engineArrow && a.from === engineArrow.from && a.to === engineArrow.to) return;
        drawArrow(a.from, a.to, CORES.alternativa, k === 0 ? 0.62 : 0.42, 0.72);
      });
    }
    if (showEngine && engineArrow) drawArrow(engineArrow.from, engineArrow.to, CORES.motor, 0.86);
    for (const a of manualArrows) drawArrow(a.from, a.to, CORES[a.cor] || CORES.padrao, 0.82);
    if (preview) drawArrow(preview.from, preview.to, CORES[preview.cor] || CORES.padrao, 0.82);
  }

  function sqCenter(sq) {
    const { x, y } = BoardUI.sqToXY(sq);
    const sz = sqSizeFn();
    return { x: x + sz / 2, y: y + sz / 2 };
  }

  // Trajeto entre duas casas; lances de cavalo viram um L.
  function _pathPoints(from, to) {
    const p1 = sqCenter(from);
    const p2 = sqCenter(to);
    const df = Math.abs(to.charCodeAt(0) - from.charCodeAt(0));
    const dr = Math.abs(parseInt(to[1], 10) - parseInt(from[1], 10));
    const cavalo = (df === 1 && dr === 2) || (df === 2 && dr === 1);
    if (!cavalo) return [p1, p2];
    const bend = df === 2 ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
    return [p1, bend, p2];
  }

  function drawArrow(from, to, color, alpha, escala = 1) {
    if (!lctx) return;
    const sz = sqSizeFn() * escala;
    const pts = _pathPoints(from, to);

    const bodyW   = sz * 0.24;
    const headW   = sz * 0.56;
    const headLen = sz * 0.44;
    const startPad = sz * 0.28;   // sai um pouco do centro da casa de origem
    const tipBack  = sz * 0.10;   // a ponta para pouco antes do centro do destino

    const a = pts[0], b = pts[1];
    const fl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const sx = a.x + (b.x - a.x) / fl * startPad;
    const sy = a.y + (b.y - a.y) / fl * startPad;

    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const ll = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
    const ux = (last.x - prev.x) / ll, uy = (last.y - prev.y) / ll;
    const tx = last.x - ux * tipBack, ty = last.y - uy * tipBack;
    const bx = tx - ux * headLen, by = ty - uy * headLen;
    const px = -uy, py = ux;

    const dpr = window.devicePixelRatio || 1;
    lctx.save();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.restore();

    lctx.save();
    lctx.fillStyle = color;
    lctx.strokeStyle = color;
    lctx.lineWidth = bodyW;
    lctx.lineJoin = 'miter';
    lctx.lineCap = 'butt';
    // Haste (passa pelo cotovelo no L do cavalo)
    lctx.beginPath();
    lctx.moveTo(sx, sy);
    for (let i = 1; i < pts.length - 1; i++) lctx.lineTo(pts[i].x, pts[i].y);
    lctx.lineTo(bx + ux, by + uy);   // 1px de sobra para emendar na ponta
    lctx.stroke();
    // Ponta triangular larga
    lctx.beginPath();
    lctx.moveTo(bx + px * headW / 2, by + py * headW / 2);
    lctx.lineTo(tx, ty);
    lctx.lineTo(bx - px * headW / 2, by - py * headW / 2);
    lctx.closePath();
    lctx.fill();
    lctx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return { init, setEngineArrow, setShowEngine, setAltArrows, setShowAlts, clearManual, redraw, getMarks };
})();

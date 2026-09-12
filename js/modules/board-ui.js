/* ==============================================================
   MODULE: board-ui.js
   Renders chess board on canvas, handles piece display.
   ============================================================== */
const BoardUI = (() => {
  /* ── module: ui-theme.js + board-rotation.js ──────────────────
     SVG pieces (Cburnett set — clean lines similar to Chess.com)
     Flip support: flipped=false → white at bottom; true → black at bottom
  ─────────────────────────────────────────────────────────────── */

  // ── Peças via imagens da pasta ./pieces/ ──────────────────────
  // Formato: ./pieces/{nome}-{cor}.svg  ex: bishop-b.svg, knight-w.svg
  // Mapa: letra FEN → nome do arquivo
  const PIECE_NAME = {
    K:'king', Q:'queen', R:'rook', B:'bishop', N:'knight', P:'pawn',
    k:'king', q:'queen', r:'rook', b:'bishop', n:'knight', p:'pawn',
  };
  const PIECE_COLOR = { K:'w',Q:'w',R:'w',B:'w',N:'w',P:'w', k:'b',q:'b',r:'b',b:'b',n:'b',p:'b' };

  // Cache de imagens — carrega uma vez, reutiliza sempre
  const _pieceImgCache = {};

  function _getPieceImg(piece) {
    if (_pieceImgCache[piece]) return _pieceImgCache[piece];
    const name  = PIECE_NAME[piece];
    const color = PIECE_COLOR[piece];
    const img   = new Image();
    img.src = `pieces/${name}-${color}.svg`;
    img.onload = () => {
      // Força redesenho do tabuleiro quando a imagem carrega
      if (typeof BoardUI !== 'undefined' && BoardUI._forceRedraw) BoardUI._forceRedraw();
    };
    _pieceImgCache[piece] = img;
    return img;
  }

  // Pré-carrega todas as 12 peças ao iniciar
  function _preloadPieces() {
    'KQRBNPkqrbnp'.split('').forEach(p => _getPieceImg(p));
  }

  // Não há mais funções de draw canvas — peças são imagens PNG
  // O drawPieces usa _getPieceImg diretamente

  // ── Theme / colors ─────────────────────────────────────────────
  const THEME = {
    light:    '#f0d9b5',
    dark:     '#b58863',
    hlFrom:   'rgba(20,170,90,0.45)',
    hlTo:     'rgba(20,170,90,0.55)',
    hlSelect: 'rgba(80,130,250,0.45)',
    dot:      'rgba(0,0,0,0.18)',   // legal move dot
  };

  let canvas   = null;
  let ctx      = null;
  let size     = 400;
  let sqSize   = 50;
  let flipped  = false;   // module: board-rotation.js

  // Selection state (used by FreePlay)
  let selectedSq   = null;
  let legalDots    = [];   // array of sq strings to show as dots


  function init(canvasEl, boardSize) {
    canvas = canvasEl;
    size   = boardSize;
    sqSize = size / 8;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const arrowCanvas = document.getElementById('arrow-canvas');
    arrowCanvas.width  = size * dpr;
    arrowCanvas.height = size * dpr;
    arrowCanvas.style.width  = size + 'px';
    arrowCanvas.style.height = size + 'px';

    _preloadPieces(); // pré-carrega os 12 PNGs
    updateCoords();
  }

  // ── module: board-rotation.js ─────────────────────────────────
  function setFlipped(val) {
    flipped = val;
    updateCoords();
  }
  function isFlipped() { return flipped; }

  function updateCoords() {
    const ranks = document.getElementById('board-ranks');
    const files = document.getElementById('board-files');
    if (!ranks || !files) return;
    const rankLabels = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
    const fileLabels = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    ranks.style.height = size + 'px';
    files.style.width  = size + 'px';
    ranks.innerHTML = rankLabels.map(r => `<span>${r}</span>`).join('');
    files.innerHTML = fileLabels.map(f => `<span>${f}</span>`).join('');
  }

  // ── Coordinate mapping (respects flip) ─────────────────────────
  function sqToCanvas(sq) {
    const col = sq.charCodeAt(0) - 97;   // a=0..h=7
    const row = 8 - parseInt(sq[1]);     // rank 8→row0, rank 1→row7
    const c = flipped ? (7 - col) : col;
    const r = flipped ? (7 - row) : row;
    return { x: c * sqSize, y: r * sqSize };
  }

  function canvasToSq(x, y) {
    const c = Math.floor(x / sqSize);
    const r = Math.floor(y / sqSize);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    const col = flipped ? (7 - c) : c;
    const row = flipped ? (7 - r) : r;
    return String.fromCharCode(97 + col) + (8 - row);
  }

  // Public aliases used by ArrowSystem
  function xyToSq(x, y)  { return canvasToSq(x, y); }
  function sqToXY(sq)     { return sqToCanvas(sq); }

  function setSelection(sq, dots) {
    selectedSq = sq;
    legalDots  = dots || [];
  }

  // ── Drawing ────────────────────────────────────────────────────
  function drawSquares(highlights) {
    // Draw board with slight rounded corners via clip
    ctx.save();
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0); ctx.arcTo(size, 0, size, r, r);
    ctx.lineTo(size, size - r); ctx.arcTo(size, size, size - r, size, r);
    ctx.lineTo(r, size); ctx.arcTo(0, size, 0, size - r, r);
    ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
    ctx.clip();

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        // Convert canvas grid back to board col/row
        const boardCol = flipped ? (7 - col) : col;
        const boardRow = flipped ? (7 - row) : row;
        const isLight  = (boardRow + boardCol) % 2 === 0;
        ctx.fillStyle  = isLight ? THEME.light : THEME.dark;
        ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
      }
    }
    ctx.restore();

    // Highlights
    if (highlights) {
      for (const { sq, color } of highlights) {
        const { x, y } = sqToCanvas(sq);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, sqSize, sqSize);
      }
    }

    // Legal move dots
    if (legalDots.length) {
      ctx.fillStyle = THEME.dot;
      for (const sq of legalDots) {
        const { x, y } = sqToCanvas(sq);
        ctx.beginPath();
        ctx.arc(x + sqSize / 2, y + sqSize / 2, sqSize * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPieces(board) {
    if (!board) return;
    for (let boardRow = 0; boardRow < 8; boardRow++) {
      for (let boardCol = 0; boardCol < 8; boardCol++) {
        const piece = board[boardRow][boardCol];
        if (!piece) continue;
        const sq = String.fromCharCode(97 + boardCol) + (8 - boardRow);
        const { x, y } = sqToCanvas(sq);
        const img = _getPieceImg(piece);
        if (!img) continue;
        const pad = sqSize * 0.04; // pequena margem interna
        ctx.save();
        ctx.shadowColor   = 'rgba(0,0,0,0.30)';
        ctx.shadowBlur    = sqSize * 0.08;
        ctx.shadowOffsetX = sqSize * 0.02;
        ctx.shadowOffsetY = sqSize * 0.04;
        ctx.drawImage(img, x + pad, y + pad, sqSize - pad*2, sqSize - pad*2);
        ctx.restore();
      }
    }
  }

  // ── Animação de movimento ─────────────────────────────────────
  // Guarda o estado da animação em curso
  let _anim = null;  // { fromX, fromY, toX, toY, piece, board, startTime, duration, fromSq, toSq }

  function _animatePiece(board, fromSq, toSq, duration = 180) {
    if (_anim && _anim.raf) cancelAnimationFrame(_anim.raf);
    if (!fromSq || !toSq) { _anim = null; return; }
    const { x: fx, y: fy } = sqToCanvas(fromSq);
    const { x: tx, y: ty } = sqToCanvas(toSq);
    const tc = toSq.charCodeAt(0) - 97;
    const tr = 8 - parseInt(toSq[1]);
    const piece = board[tr][tc];
    // Detectar se é movimento de cavalo (N/n): padrão L 2+1 casas
    const fc = fromSq.charCodeAt(0) - 97;
    const fr = 8 - parseInt(fromSq[1]);
    const dc = Math.abs(tc - fc), dr = Math.abs(tr - fr);
    const isKnight = (dc === 2 && dr === 1) || (dc === 1 && dr === 2);
    _anim = { fromX: fx, fromY: fy, toX: tx, toY: ty, piece, board, fromSq, toSq,
              startTime: performance.now(), duration,
              isKnight, raf: null };
    _runAnim();
  }

  function _runAnim() {
    if (!_anim) return;
    const now  = performance.now();
    const prog = Math.min(1, (now - _anim.startTime) / _anim.duration);
    const t    = 1 - Math.pow(1 - prog, 3);  // ease-out cubic

    let ax, ay;
    if (_anim.isKnight) {
      // Arco parabólico para o cavalo
      const mx = (_anim.fromX + _anim.toX) / 2;
      const arcH = sqSize * 1.1;
      const cpx = mx;
      const cpy = Math.min(_anim.fromY, _anim.toY) - arcH;
      ax = (1-t)*(1-t)*_anim.fromX + 2*(1-t)*t*cpx + t*t*_anim.toX;
      ay = (1-t)*(1-t)*_anim.fromY + 2*(1-t)*t*cpy + t*t*_anim.toY;
    } else {
      ax = _anim.fromX + (_anim.toX - _anim.fromX) * t;
      ay = _anim.fromY + (_anim.toY - _anim.fromY) * t;
    }

    // Fundo + highlights
    const hl = [
      { sq: _anim.fromSq, color: THEME.hlFrom },
      { sq: _anim.toSq,   color: THEME.hlTo   },
    ];
    drawSquares(hl);
    // Todas as peças exceto a que está sendo animada
    drawPiecesExcept(_anim.board, _anim.toSq);
    // Peça animada no topo
    const img = _getPieceImg(_anim.piece);
    if (img && img.complete && img.naturalWidth > 0) {
      const pad = sqSize * 0.04;
      ctx.save();
      ctx.shadowColor   = 'rgba(0,0,0,0.40)';
      ctx.shadowBlur    = sqSize * 0.14;
      ctx.shadowOffsetX = sqSize * 0.03;
      ctx.shadowOffsetY = sqSize * 0.06;
      ctx.drawImage(img, ax + pad, ay + pad, sqSize - pad*2, sqSize - pad*2);
      ctx.restore();
    }
    // Setas por cima
    ArrowSystem.redraw();

    if (prog < 1) {
      _anim.raf = requestAnimationFrame(_runAnim);
    } else {
      _anim = null;
      // Render final limpo
      drawSquares(hl);
      drawPieces(_lastBoard);
      ArrowSystem.redraw();
    }
  }

  function _drawBoardStatic(board, fromSq, toSq) {
    const hl = [];
    if (fromSq) hl.push({ sq: fromSq, color: THEME.hlFrom });
    if (toSq)   hl.push({ sq: toSq,   color: THEME.hlTo });
    drawSquares(hl);
    drawPiecesExcept(board, toSq);
  }

  function drawPiecesExcept(board, exceptSq) {
    if (!board) return;
    for (let boardRow = 0; boardRow < 8; boardRow++) {
      for (let boardCol = 0; boardCol < 8; boardCol++) {
        const piece = board[boardRow][boardCol];
        if (!piece) continue;
        const sq = String.fromCharCode(97 + boardCol) + (8 - boardRow);
        if (sq === exceptSq) continue;  // skip peça animada
        const { x, y } = sqToCanvas(sq);
        const img = _getPieceImg(piece);
        if (!img) continue;
        const pad = sqSize * 0.04;
        ctx.save();
        ctx.shadowColor   = 'rgba(0,0,0,0.30)';
        ctx.shadowBlur    = sqSize * 0.08;
        ctx.shadowOffsetX = sqSize * 0.02;
        ctx.shadowOffsetY = sqSize * 0.04;
        ctx.drawImage(img, x + pad, y + pad, sqSize - pad*2, sqSize - pad*2);
        ctx.restore();
      }
    }
  }

  let _lastBoard = null, _lastFrom = null, _lastTo = null;

  // render() — redesenho estático, SEM animação.
  // A animação é disparada explicitamente por renderWithAnim().
  function render(board, fromSq, toSq, selSq, dots) {
    if (!canvas || !ctx) return;
    if (_anim) { cancelAnimationFrame(_anim.raf); _anim = null; }
    _lastBoard = board; _lastFrom = fromSq; _lastTo = toSq;
    selectedSq = selSq || null;
    legalDots  = dots  || [];
    const highlights = [];
    if (fromSq)     highlights.push({ sq: fromSq,    color: THEME.hlFrom });
    if (toSq)       highlights.push({ sq: toSq,      color: THEME.hlTo });
    if (selectedSq) highlights.push({ sq: selectedSq, color: THEME.hlSelect });
    drawSquares(highlights);
    drawPieces(board);
  }

  // renderWithAnim() — igual a render(), mas dispara a animação de movimento.
  // Chamado apenas por renderBoardAtMove (navegação de lances).
  function renderWithAnim(board, fromSq, toSq) {
    if (!canvas || !ctx) return;
    _lastBoard = board; _lastFrom = fromSq; _lastTo = toSq;
    selectedSq = null;
    legalDots  = [];
    if (fromSq && toSq && board) {
      _animatePiece(board, fromSq, toSq, 180);
    } else {
      if (_anim) { cancelAnimationFrame(_anim.raf); _anim = null; }
      const highlights = [];
      if (toSq) highlights.push({ sq: toSq, color: THEME.hlTo });
      drawSquares(highlights);
      drawPieces(board);
    }
  }

  // _forceRedraw: chamado pelo onload das imagens.
  // Se animação em curso, não interfere. Caso contrário, redesenha estaticamente.
  function _forceRedraw() {
    if (!ctx || !canvas) return;
    if (_anim) return;  // animação em curso — não interfere
    const hl = [];
    if (_lastFrom) hl.push({ sq: _lastFrom, color: THEME.hlFrom });
    if (_lastTo)   hl.push({ sq: _lastTo,   color: THEME.hlTo });
    if (selectedSq) hl.push({ sq: selectedSq, color: THEME.hlSelect });
    drawSquares(hl);
    drawPieces(_lastBoard);
    ArrowSystem.redraw();
  }

  return { init, render, renderWithAnim, sqToXY, xyToSq, sqSize: () => sqSize,
           setFlipped, isFlipped, canvasToSq, _forceRedraw };
})();

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
    // Casas em pedra clara e verde-acinzentado: combinam com o acento
    // esmeralda sem disputar com as setas e as etiquetas dos lances.
    light:    '#e4e9e3',
    dark:     '#6f8c80',
    hlFrom:   'rgba(236,214,92,0.45)',
    hlTo:     'rgba(236,214,92,0.58)',
    hlSelect: 'rgba(20,110,50,0.50)',
    dot:      'rgba(0,0,0,0.18)',   // legal move dot (casa vazia)
    capture:  'rgba(220,55,55,0.55)', // casa de captura — destaque vermelho, não mais ponto
    premove:  'rgba(200,60,60,0.55)', // pré-lance (Jogar contra o bot)
  };

  let canvas   = null;
  let ctx      = null;
  let size     = 400;
  let sqSize   = 50;
  let flipped  = false;   // module: board-rotation.js

  // Selection state (used by FreePlay)
  let selectedSq   = null;
  let legalDots    = [];   // array of sq strings to show as dots

  // Arraste: a peça sai da casa de origem (vira um "fantasma" que segue o
  // ponteiro, ver ui-controller) e a casa sob o ponteiro ganha contorno.
  let _dragSq  = null;
  let _hoverSq = null;
  // Pré-lance marcado (casas de origem e destino), por cima dos destaques.
  let _preSqs = [];


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

    for (const sq of _preSqs) {
      const { x, y } = sqToCanvas(sq);
      ctx.fillStyle = THEME.premove;
      ctx.fillRect(x, y, sqSize, sqSize);
    }

    // Casas marcadas com o botão direito (por baixo das peças)
    if (typeof ArrowSystem !== 'undefined' && ArrowSystem.getMarks) {
      for (const { sq, color } of ArrowSystem.getMarks()) {
        const { x, y } = sqToCanvas(sq);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, sqSize, sqSize);
      }
    }

    // Casa sob a peça arrastada: contorno claro, como nos grandes sites
    if (_hoverSq) {
      const { x, y } = sqToCanvas(_hoverSq);
      const w = Math.max(2, sqSize * 0.06);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = w;
      ctx.strokeRect(x + w / 2, y + w / 2, sqSize - w, sqSize - w);
      ctx.restore();
    }

    // Casas de movimento legal: captura = casa inteira em vermelho
    // (bem visível), movimento simples = ponto tradicional.
    if (legalDots.length) {
      for (const sq of legalDots) {
        const { x, y } = sqToCanvas(sq);
        if (_boardPieceAt(_lastBoard, sq)) {
          ctx.fillStyle = THEME.capture;
          ctx.fillRect(x, y, sqSize, sqSize);
        } else {
          ctx.fillStyle = THEME.dot;
          ctx.beginPath();
          ctx.arc(x + sqSize / 2, y + sqSize / 2, sqSize * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function _boardPieceAt(board, sq) {
    if (!board) return null;
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1], 10);
    return (board[row] && board[row][col]) || null;
  }

  function drawPieces(board) {
    if (!board) return;
    for (let boardRow = 0; boardRow < 8; boardRow++) {
      for (let boardCol = 0; boardCol < 8; boardCol++) {
        const piece = board[boardRow][boardCol];
        if (!piece) continue;
        const sq = String.fromCharCode(97 + boardCol) + (8 - boardRow);
        if (sq === _dragSq) continue;   // está "na mão" do jogador
        const { x, y } = sqToCanvas(sq);
        const img = _getPieceImg(piece);
        // Sem isso, um SVG ainda não decodificado pode desenhar em branco
        // no primeiro frame (a peça "pisca"/some até o onload disparar).
        if (!img || !img.complete || img.naturalWidth === 0) continue;
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
  // Uma animação mostra a posição final com algumas peças "em trânsito":
  //   moves: peças deslizando em linha reta (todas, cavalo incluído,
  //          como nos grandes sites); no roque, rei e torre juntos.
  //   fades: peça capturada sumindo quando o atacante chega (ou
  //          reaparecendo, quando o lance é desfeito).
  let _anim = null;  // { moves, fades, board, exceptSqs, hl, startTime, duration, raf }
  const ANIM_MS = 200;

  const _corDe = p => (p === p.toUpperCase() ? 'w' : 'b');

  // Detecta roque a partir do movimento do rei (2 casas na horizontal, na
  // fileira de origem) e devolve o par from/to correspondente da torre.
  function _castlingRookSquares(fromSq, toSq) {
    const fc = fromSq.charCodeAt(0) - 97, fr = fromSq[1];
    const tc = toSq.charCodeAt(0) - 97;
    if (Math.abs(tc - fc) !== 2 || fromSq[1] !== toSq[1]) return null;
    const kingSide = tc > fc;
    return { rookFrom: (kingSide ? 'h' : 'a') + fr, rookTo: (kingSide ? 'f' : 'd') + fr };
  }

  // Monta a animação do lance from→to.
  //   board:    posição que fica na tela no fim;
  //   prev:     posição que estava antes (para achar a peça capturada);
  //   reverso:  o lance está sendo desfeito (a peça volta de "to" para "from");
  //   semMover: a peça já foi solta ali pelo arraste — só anima a torre do
  //             roque e a captura.
  function _montarAnim(board, prev, fromSq, toSq, reverso, semMover) {
    const at = (b, sq) => _boardPieceAt(b, sq);
    const moves = [], fades = [];
    if (!reverso) {
      const piece = at(board, toSq);
      if (!piece) return null;
      if (!semMover) moves.push({ piece, de: fromSq, para: toSq });
      // Só confia na posição anterior se ela for mesmo a de antes do lance.
      const antes = prev && at(prev, fromSq);
      if (antes && _corDe(antes) === _corDe(piece) && !at(board, fromSq)) {
        const alvo = at(prev, toSq);
        if (alvo && _corDe(alvo) !== _corDe(piece)) fades.push({ piece: alvo, sq: toSq, sai: true });
        else if (!alvo && antes.toUpperCase() === 'P' && fromSq[0] !== toSq[0]) {
          const ep = toSq[0] + fromSq[1];
          const pe = at(prev, ep);
          if (pe && !at(board, ep)) fades.push({ piece: pe, sq: ep, sai: true });
        }
      }
      if (piece.toUpperCase() === 'K') {
        const r = _castlingRookSquares(fromSq, toSq);
        if (r && at(board, r.rookTo)) moves.push({ piece: at(board, r.rookTo), de: r.rookFrom, para: r.rookTo });
      }
    } else {
      const piece = at(board, fromSq);
      if (!piece) return null;
      moves.push({ piece, de: toSq, para: fromSq });
      const volta = at(board, toSq);
      if (volta && _corDe(volta) !== _corDe(piece)) fades.push({ piece: volta, sq: toSq, sai: false });
      else if (!volta && piece.toUpperCase() === 'P' && fromSq[0] !== toSq[0]) {
        const ep = toSq[0] + fromSq[1];
        const pe = at(board, ep);
        if (pe && _corDe(pe) !== _corDe(piece)) fades.push({ piece: pe, sq: ep, sai: false });
      }
      if (piece.toUpperCase() === 'K') {
        const r = _castlingRookSquares(fromSq, toSq);
        if (r && at(board, r.rookFrom)) moves.push({ piece: at(board, r.rookFrom), de: r.rookTo, para: r.rookFrom });
      }
    }
    const exceptSqs = moves.map(m => m.para).concat(fades.filter(f => !f.sai).map(f => f.sq));
    return { moves, fades, exceptSqs };
  }

  function _desenharPeca(piece, x, y, alpha, escala, sombraForte) {
    const img = _getPieceImg(piece);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const pad = sqSize * 0.04;
    const tam = (sqSize - pad * 2) * escala;
    const off = (sqSize - tam) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor   = sombraForte ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.30)';
    ctx.shadowBlur    = sqSize * (sombraForte ? 0.14 : 0.08);
    ctx.shadowOffsetX = sqSize * (sombraForte ? 0.03 : 0.02);
    ctx.shadowOffsetY = sqSize * (sombraForte ? 0.06 : 0.04);
    ctx.drawImage(img, x + off, y + off, tam, tam);
    ctx.restore();
  }

  function _animatePiece(board, fromSq, toSq, opts = {}) {
    if (_anim && _anim.raf) cancelAnimationFrame(_anim.raf);
    _anim = null;
    if (!fromSq || !toSq) return false;
    const plano = _montarAnim(board, opts.prev || null, fromSq, toSq, !!opts.reverso, !!opts.semMover);
    if (!plano || (!plano.moves.length && !plano.fades.length)) return false;
    const hl = [];
    if (opts.hlFrom) hl.push({ sq: opts.hlFrom, color: THEME.hlFrom });
    if (opts.hlTo)   hl.push({ sq: opts.hlTo,   color: THEME.hlTo });
    if (selectedSq)  hl.push({ sq: selectedSq,  color: THEME.hlSelect });
    _anim = { ...plano, board, hl, startTime: performance.now(), duration: opts.duration || ANIM_MS, raf: null };
    _runAnim();
    return true;
  }

  function _runAnim() {
    if (!_anim) return;
    const prog = Math.min(1, (performance.now() - _anim.startTime) / _anim.duration);
    const t    = 1 - Math.pow(1 - prog, 3);  // ease-out cúbico: sai rápido, pousa macio

    drawSquares(_anim.hl);
    drawPiecesExcept(_anim.board, _anim.exceptSqs);

    // Capturada: some quando o atacante está chegando (encolhe um pouco);
    // ao desfazer o lance, reaparece do mesmo jeito.
    for (const f of _anim.fades) {
      const { x, y } = sqToCanvas(f.sq);
      const k = f.sai ? Math.max(0, Math.min(1, (prog - 0.45) / 0.55)) : Math.min(1, prog / 0.7);
      const alpha = f.sai ? 1 - k : k;
      const escala = f.sai ? 1 - 0.18 * k : 0.82 + 0.18 * k;
      _desenharPeca(f.piece, x, y, alpha, escala, false);
    }
    for (const m of _anim.moves) {
      const a = sqToCanvas(m.de), b = sqToCanvas(m.para);
      _desenharPeca(m.piece, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1, 1, true);
    }
    ArrowSystem.redraw();

    if (prog < 1) {
      _anim.raf = requestAnimationFrame(_runAnim);
    } else {
      const hl = _anim.hl;
      _anim = null;
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
    drawPiecesExcept(board, [toSq]);
  }

  function drawPiecesExcept(board, exceptSqs) {
    if (!board) return;
    const skip = Array.isArray(exceptSqs) ? exceptSqs : [exceptSqs];
    for (let boardRow = 0; boardRow < 8; boardRow++) {
      for (let boardCol = 0; boardCol < 8; boardCol++) {
        const piece = board[boardRow][boardCol];
        if (!piece) continue;
        const sq = String.fromCharCode(97 + boardCol) + (8 - boardRow);
        if (skip.includes(sq)) continue;  // skip peça(s) animada(s)
        const { x, y } = sqToCanvas(sq);
        const img = _getPieceImg(piece);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
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
  // Usado por renderBoardAtMove (navegação de lances) e por FreePlay
  // (lances livres também recebem a animação tradicional).
  // opts: { prev, reverso, semMover, hlFrom, hlTo } (ver _montarAnim).
  // Sem prev, usa a posição que estava na tela (o caso normal: um lance
  // depois do outro).
  function renderWithAnim(board, fromSq, toSq, selSq, dots, opts = {}) {
    if (!canvas || !ctx) return;
    const prev = 'prev' in opts ? opts.prev : _lastBoard;
    const hlFrom = 'hlFrom' in opts ? opts.hlFrom : fromSq;
    const hlTo = 'hlTo' in opts ? opts.hlTo : toSq;
    _lastBoard = board; _lastFrom = hlFrom; _lastTo = hlTo;
    selectedSq = selSq || null;
    legalDots  = dots  || [];
    if (board && _animatePiece(board, fromSq, toSq, { ...opts, prev, hlFrom, hlTo })) return;
    const highlights = [];
    if (hlFrom)     highlights.push({ sq: hlFrom,     color: THEME.hlFrom });
    if (hlTo)       highlights.push({ sq: hlTo,       color: THEME.hlTo });
    if (selectedSq) highlights.push({ sq: selectedSq, color: THEME.hlSelect });
    drawSquares(highlights);
    drawPieces(board);
    ArrowSystem.redraw();
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

  function setPremove(sqs) { _preSqs = sqs || []; }
  function setDrag(sq)  { _dragSq = sq || null; _forceRedraw(); }
  function setHover(sq) { if (sq === _hoverSq) return; _hoverSq = sq || null; _forceRedraw(); }
  function pieceSrc(piece) { return piece ? `pieces/${PIECE_NAME[piece]}-${PIECE_COLOR[piece]}.svg` : ''; }

  return { init, render, renderWithAnim, sqToXY, xyToSq, sqSize: () => sqSize,
           setFlipped, isFlipped, canvasToSq, _forceRedraw, setDrag, setHover, setPremove, pieceSrc };
})();

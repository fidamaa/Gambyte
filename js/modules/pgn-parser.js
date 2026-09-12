/* ==============================================================
   MODULE: pgn-parser.js
   Minimal FEN generator using pure JS chess logic. Implements a
   lightweight chess engine to generate FENs and parse PGN.
   ============================================================== */
const PGNParser = (() => {

  // Piece codes: uppercase = white, lowercase = black
  const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function fenToBoard(fen) {
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    const board = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < parseInt(ch); i++) row.push('');
        } else {
          row.push(ch);
        }
      }
      board.push(row);
    }
    return {
      board,
      turn: parts[1],
      castling: parts[2],
      ep: parts[3],
      half: parseInt(parts[4]),
      full: parseInt(parts[5])
    };
  }

  function boardToFen(state) {
    let fenParts = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p === '') { empty++; }
        else { if (empty) { row += empty; empty = 0; } row += p; }
      }
      if (empty) row += empty;
      fenParts.push(row);
    }
    return [
      fenParts.join('/'),
      state.turn,
      state.castling || '-',
      state.ep || '-',
      state.half,
      state.full
    ].join(' ');
  }

  // Col/row helpers
  const colOf = sq => sq.charCodeAt(0) - 97;
  const rowOf = sq => 8 - parseInt(sq[1]);
  const sqOf  = (r, c) => String.fromCharCode(97 + c) + (8 - r);

  function pieceAt(board, sq) {
    return board[rowOf(sq)][colOf(sq)];
  }

  function setPiece(board, sq, piece) {
    board[rowOf(sq)][colOf(sq)] = piece;
  }

  function cloneBoard(board) {
    return board.map(r => [...r]);
  }

  /**
   * Apply a SAN move to a state and return new state.
   * Returns null if move cannot be parsed.
   */
  function applyMove(state, san) {
    const newState = {
      board: cloneBoard(state.board),
      turn: state.turn,
      castling: state.castling,
      ep: state.ep,
      half: state.half,
      full: state.full
    };

    const isWhite = state.turn === 'w';
    const myColor = isWhite ? (p => p === p.toUpperCase() && p !== '') : (p => p === p.toLowerCase() && p !== '');

    // Strip check/mate indicators
    const cleanSan = san.replace(/[+#!?]/g, '').trim();

    // Castling
    if (cleanSan === 'O-O' || cleanSan === '0-0') {
      const row = isWhite ? 7 : 0;
      setPiece(newState.board, sqOf(row, 4), '');
      setPiece(newState.board, sqOf(row, 7), '');
      setPiece(newState.board, sqOf(row, 6), isWhite ? 'K' : 'k');
      setPiece(newState.board, sqOf(row, 5), isWhite ? 'R' : 'r');
      newState.castling = newState.castling
        .replace(isWhite ? 'K' : 'k', '').replace(isWhite ? 'Q' : 'q', '') || '-';
      newState.ep = '-';
      newState.half++;
      if (!isWhite) newState.full++;
      newState.turn = isWhite ? 'b' : 'w';
      return newState;
    }

    if (cleanSan === 'O-O-O' || cleanSan === '0-0-0') {
      const row = isWhite ? 7 : 0;
      setPiece(newState.board, sqOf(row, 4), '');
      setPiece(newState.board, sqOf(row, 0), '');
      setPiece(newState.board, sqOf(row, 2), isWhite ? 'K' : 'k');
      setPiece(newState.board, sqOf(row, 3), isWhite ? 'R' : 'r');
      newState.castling = newState.castling
        .replace(isWhite ? 'K' : 'k', '').replace(isWhite ? 'Q' : 'q', '') || '-';
      newState.ep = '-';
      newState.half++;
      if (!isWhite) newState.full++;
      newState.turn = isWhite ? 'b' : 'w';
      return newState;
    }

    // Normal moves — parse SAN
    // Formats: e4, Nf3, exd5, Nxf3, Bxe5, Qd1e2, R1e2, Nb1c3, e8=Q, exd8=Q
    const promoMatch = cleanSan.match(/=([QRBN])$/);
    const promo = promoMatch ? promoMatch[1] : null;
    const sanBase = promo ? cleanSan.slice(0, -2) : cleanSan;

    // Extract destination square (last 2 chars that look like a square)
    const destMatch = sanBase.match(/([a-h][1-8])$/);
    if (!destMatch) return null;
    const dest = destMatch[1];
    let rest = sanBase.slice(0, -2);

    // Piece type
    let pieceType;
    let pieceCh;
    if (/^[NBRQK]/.test(rest)) {
      pieceType = rest[0];
      pieceCh = isWhite ? pieceType : pieceType.toLowerCase();
      rest = rest.slice(1);
    } else {
      pieceType = 'P';
      pieceCh = isWhite ? 'P' : 'p';
    }

    // Capture indicator
    const isCapture = rest.includes('x');
    rest = rest.replace('x', '');

    // Disambiguation
    let disambigFile = null, disambigRank = null;
    for (const ch of rest) {
      if (/[a-h]/.test(ch)) disambigFile = ch;
      if (/[1-8]/.test(ch)) disambigRank = ch;
    }

    // Find source square
    const destR = rowOf(dest), destC = colOf(dest);
    let sourceSquare = null;

    const candidateSources = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (newState.board[r][c] === pieceCh) {
          candidateSources.push(sqOf(r, c));
        }
      }
    }

    for (const src of candidateSources) {
      if (disambigFile && src[0] !== disambigFile) continue;
      if (disambigRank && src[1] !== disambigRank) continue;
      if (canPieceReach(newState.board, src, dest, pieceType, isWhite, state.ep)) {
        sourceSquare = src;
        break;
      }
    }

    if (!sourceSquare) return null;

    // Handle en passant capture
    if (pieceType === 'P' && dest === state.ep && state.ep !== '-') {
      const capturedPawnRow = isWhite ? destR + 1 : destR - 1;
      setPiece(newState.board, sqOf(capturedPawnRow, destC), '');
    }

    // Move piece
    const movingPiece = pieceAt(newState.board, sourceSquare);
    setPiece(newState.board, sourceSquare, '');
    setPiece(newState.board, dest, promo ? (isWhite ? promo : promo.toLowerCase()) : movingPiece);

    // Update en passant
    newState.ep = '-';
    if (pieceType === 'P' && Math.abs(rowOf(sourceSquare) - destR) === 2) {
      const epRow = isWhite ? destR + 1 : destR - 1;
      newState.ep = sqOf(epRow, destC);
    }

    // Update castling rights
    if (pieceType === 'K') {
      newState.castling = newState.castling
        .replace(isWhite ? 'K' : 'k', '').replace(isWhite ? 'Q' : 'q', '') || '-';
    }
    if (pieceType === 'R') {
      if (sourceSquare === 'a1') newState.castling = newState.castling.replace('Q', '') || '-';
      if (sourceSquare === 'h1') newState.castling = newState.castling.replace('K', '') || '-';
      if (sourceSquare === 'a8') newState.castling = newState.castling.replace('q', '') || '-';
      if (sourceSquare === 'h8') newState.castling = newState.castling.replace('k', '') || '-';
    }

    // Half-move clock
    if (pieceType === 'P' || isCapture) newState.half = 0;
    else newState.half++;

    if (!isWhite) newState.full++;
    newState.turn = isWhite ? 'b' : 'w';

    return newState;
  }

  function canPieceReach(board, src, dest, type, isWhite, ep) {
    const sr = rowOf(src), sc = colOf(src);
    const dr = rowOf(dest), dc = colOf(dest);
    const dr_ = dr - sr, dc_ = dc - sc;

    const targetPiece = board[dr][dc];
    const isOccupiedByOwn = targetPiece !== '' &&
      (isWhite ? targetPiece === targetPiece.toUpperCase() : targetPiece === targetPiece.toLowerCase());
    if (isOccupiedByOwn) return false;

    switch (type) {
      case 'P': {
        const dir = isWhite ? -1 : 1;
        if (dc === sc) {
          // Forward
          if (dr_ === dir && targetPiece === '') return true;
          if (dr_ === 2 * dir && sc === sc && targetPiece === '' &&
              board[sr + dir][sc] === '' && (isWhite ? sr === 6 : sr === 1)) return true;
        } else if (Math.abs(dc_) === 1 && dr_ === dir) {
          // Diagonal capture
          if (targetPiece !== '' && !isOccupiedByOwn) return true;
          if (dest === ep && ep !== '-') return true;
        }
        return false;
      }
      case 'N':
        return (Math.abs(dr_) === 2 && Math.abs(dc_) === 1) || (Math.abs(dr_) === 1 && Math.abs(dc_) === 2);
      case 'B':
        if (Math.abs(dr_) !== Math.abs(dc_) || dr_ === 0) return false;
        return isPathClear(board, sr, sc, dr, dc, Math.sign(dr_), Math.sign(dc_));
      case 'R':
        if (dr_ !== 0 && dc_ !== 0) return false;
        return isPathClear(board, sr, sc, dr, dc, Math.sign(dr_), Math.sign(dc_));
      case 'Q':
        if (dr_ !== 0 && dc_ !== 0 && Math.abs(dr_) !== Math.abs(dc_)) return false;
        return isPathClear(board, sr, sc, dr, dc, Math.sign(dr_), Math.sign(dc_));
      case 'K':
        return Math.abs(dr_) <= 1 && Math.abs(dc_) <= 1 && (dr_ !== 0 || dc_ !== 0);
      default:
        return false;
    }
  }

  function isPathClear(board, sr, sc, dr, dc, rd, cd) {
    let r = sr + rd, c = sc + cd;
    while (r !== dr || c !== dc) {
      if (board[r][c] !== '') return false;
      r += rd; c += cd;
    }
    return true;
  }

  /**
   * Parse PGN headers and move list
   */
  function parsePGN(pgn) {
    const headers = {};
    const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
    let m;
    while ((m = headerRegex.exec(pgn)) !== null) {
      headers[m[1]] = m[2];
    }

    // Step 1: remove every [...] header line (line by line, safe for all JS engines)
    let movesText = pgn.split('\n')
      .filter(line => !line.trimStart().startsWith('['))
      .join('\n');

    // Step 2: remove inline comments, variations, NAGs, move numbers, results
    movesText = movesText.replace(/\{[^}]*\}/g, '');      // {comments}
    movesText = movesText.replace(/\([^)]*\)/g, '');      // (variations)
    movesText = movesText.replace(/\$\d+/g, '');          // $NAG
    movesText = movesText.replace(/\d+\.\.\./g, ' ');     // 1...
    movesText = movesText.replace(/\d+\./g, ' ');         // 1.
    movesText = movesText.replace(/1-0|0-1|1\/2-1\/2|\*/g, ''); // results
    movesText = movesText.trim();

    // Step 3: keep only valid SAN tokens — rejects URLs, words, stray garbage
    const sanList = movesText
      .split(/\s+/)
      .filter(s => /^([NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h][1-8]?x?[a-h][1-8]|[a-h][1-8]|O-O-O|O-O|0-0-0|0-0)[+#=a-hNBRQ1-8?!]*$/.test(s));

    // Generate FENs
    let state = fenToBoard(INITIAL_FEN);
    const positions = [];
    const fensBefore = [];

    positions.push(boardToFen(state)); // initial

    for (let i = 0; i < sanList.length; i++) {
      fensBefore.push(boardToFen(state));
      const nextState = applyMove(state, sanList[i]);
      if (!nextState) {
        console.warn(`Could not apply move: ${sanList[i]} at position ${i}`);
        break;
      }
      state = nextState;
      positions.push(boardToFen(state));
    }

    // Build move squares for board highlighting
    const moveSquares = [];
    for (let idx = 0; idx < fensBefore.length; idx++) {
      moveSquares.push(_detectMoveSquares(fensBefore[idx], positions[idx + 1]));
    }

    return {
      headers,
      moves: sanList.slice(0, fensBefore.length),
      fensBefore,
      fensAfter: positions.slice(1, fensBefore.length + 1),
      moveSquares
    };
  }

  // Detect squares that changed between two FENs (for move highlighting)
  function _detectMoveSquares(fenBefore, fenAfter) {
    if (!fenBefore || !fenAfter) return { from: null, to: null };
    const b1 = fenBefore.split(' ')[0].split('/');
    const b2 = fenAfter.split(' ')[0].split('/');
    const removed = [], added = [];
    for (let r = 0; r < 8; r++) {
      const row1 = [], row2 = [];
      for (const ch of b1[r]) { if (/\d/.test(ch)) for (let i=0;i<parseInt(ch);i++) row1.push(''); else row1.push(ch); }
      for (const ch of b2[r]) { if (/\d/.test(ch)) for (let i=0;i<parseInt(ch);i++) row2.push(''); else row2.push(ch); }
      for (let col = 0; col < 8; col++) {
        const sq = String.fromCharCode(97+col)+(8-r);
        const p1 = row1[col], p2 = row2[col];
        if (p1 && !p2)              removed.push({ sq, piece: p1 });
        if (!p1 && p2)              added.push({ sq, piece: p2 });
        if (p1 && p2 && p1 !== p2) { removed.push({ sq, piece: p1 }); added.push({ sq, piece: p2 }); }
      }
    }
    // For castling: multiple pieces move. Prefer the King (K/k) as the "from"
    const isKingPiece = p => p === 'K' || p === 'k';
    const fromEntry = removed.find(e => isKingPiece(e.piece)) || removed[0];
    const toEntry   = added.find(e => isKingPiece(e.piece))   || added[0];
    return { from: fromEntry?.sq || null, to: toEntry?.sq || null };
  }

  // applyMoveUCI: apply a move given as UCI string (e2e4, e7e8q) to a board state.
  // Moves the piece directly from→to without going through SAN disambiguation,
  // so it always moves exactly the piece on 'from' — never ambiguous.
  function applyMoveUCI(state, uci) {
    const from  = uci.slice(0, 2);
    const to    = uci.slice(2, 4);
    const promo = uci[4] ? uci[4].toUpperCase() : null;

    const piece = pieceAt(state.board, from);
    if (!piece) return null;

    const isWhite     = state.turn === 'w';
    const isWhitePiece = piece === piece.toUpperCase();
    // Must be the side to move
    if (isWhite !== isWhitePiece) return null;

    const pieceLetter = piece.toUpperCase();
    const destPiece   = pieceAt(state.board, to);
    const isCapture   = !!destPiece || (pieceLetter === 'P' && from[0] !== to[0]);

    const newState = {
      board:    cloneBoard(state.board),
      turn:     state.turn,
      castling: state.castling,
      ep:       state.ep,
      half:     state.half,
      full:     state.full
    };

    // ── Castling ──────────────────────────────────────────────────
    if (pieceLetter === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      const row    = isWhite ? 7 : 0;
      const isKS   = to[0] === 'g';   // kingside

      // Check castling rights
      const rightNeeded = isWhite ? (isKS ? 'K' : 'Q') : (isKS ? 'k' : 'q');
      if (!state.castling.includes(rightNeeded)) return null;

      // Check path is clear between king and rook
      const rookFromCol = isKS ? 7 : 0;
      const minCol = Math.min(4, rookFromCol) + 1;
      const maxCol = Math.max(4, rookFromCol);
      for (let c = minCol; c < maxCol; c++) {
        if (newState.board[row][c] !== '') return null;
      }

      const rookFrom = isKS ? sqOf(row, 7) : sqOf(row, 0);
      const rookTo   = isKS ? sqOf(row, 5) : sqOf(row, 3);
      setPiece(newState.board, from, '');
      setPiece(newState.board, to, piece);
      setPiece(newState.board, rookFrom, '');
      setPiece(newState.board, rookTo, isWhite ? 'R' : 'r');
      newState.castling = newState.castling
        .replace(isWhite ? 'K' : 'k', '').replace(isWhite ? 'Q' : 'q', '') || '-';
      newState.ep = '-';
      newState.half++;
      if (!isWhite) newState.full++;
      newState.turn = isWhite ? 'b' : 'w';
      return newState;
    }

    // ── Validate move legality using canPieceReach ─────────────────
    // This prevents pawns/pieces from moving to illegal squares
    const epForCheck = state.ep || '-';
    if (!canPieceReach(newState.board, from, to, pieceLetter, isWhite, epForCheck)) {
      // Special case: allow en-passant captures that canPieceReach handles via ep param
      // If it already returned false, the move is truly illegal
      return null;
    }

    // ── En passant ─────────────────────────────────────────────────
    if (pieceLetter === 'P' && to === state.ep && state.ep !== '-') {
      const capturedRow = isWhite ? rowOf(to) + 1 : rowOf(to) - 1;
      setPiece(newState.board, sqOf(capturedRow, colOf(to)), '');
    }

    // ── Move piece ─────────────────────────────────────────────────
    const promotedPiece = promo
      ? (isWhite ? promo : promo.toLowerCase())
      : piece;
    setPiece(newState.board, from, '');
    setPiece(newState.board, to, promotedPiece);

    // ── Update EP square ───────────────────────────────────────────
    newState.ep = '-';
    if (pieceLetter === 'P' && Math.abs(rowOf(from) - rowOf(to)) === 2) {
      const epRow = isWhite ? rowOf(to) + 1 : rowOf(to) - 1;
      newState.ep = sqOf(epRow, colOf(to));
    }

    // ── Update castling rights ─────────────────────────────────────
    if (pieceLetter === 'K') {
      newState.castling = newState.castling
        .replace(isWhite ? 'K' : 'k', '').replace(isWhite ? 'Q' : 'q', '') || '-';
    }
    if (pieceLetter === 'R') {
      if (from === 'a1') newState.castling = newState.castling.replace('Q', '') || '-';
      if (from === 'h1') newState.castling = newState.castling.replace('K', '') || '-';
      if (from === 'a8') newState.castling = newState.castling.replace('q', '') || '-';
      if (from === 'h8') newState.castling = newState.castling.replace('k', '') || '-';
    }

    // ── Clocks ─────────────────────────────────────────────────────
    if (pieceLetter === 'P' || isCapture) newState.half = 0;
    else newState.half++;
    if (!isWhite) newState.full++;
    newState.turn = isWhite ? 'b' : 'w';

    return newState;
  }

  // uciToSan: convert UCI move to SAN notation (best effort)
  function uciToSan(state, uci) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4];
    const piece = pieceAt(state.board, from);
    if (!piece) return uci;
    const pieceLetter = piece.toUpperCase();
    const destPiece   = pieceAt(state.board, to);
    const isCapture   = !!destPiece || (pieceLetter === 'P' && from[0] !== to[0]);

    if (pieceLetter === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      return to[0] === 'g' ? 'O-O' : 'O-O-O';
    }
    if (pieceLetter === 'P') {
      let s = (isCapture ? from[0] + 'x' : '') + to;
      if (promo) s += '=' + promo.toUpperCase();
      return s;
    }
    return pieceLetter + (isCapture ? 'x' : '') + to;
  }

  return { parsePGN, INITIAL_FEN, fenToBoard, boardToFen, applyMoveUCI, uciToSan };
})();

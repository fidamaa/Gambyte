/* ==============================================================
   MODULE: opening-detector.js
   Builds a Trie from ECO data for O(k) prefix lookup (usado só para
   NOMEAR a abertura no banner — combinação exata de sequência de lances).

   Para decidir SE um lance é "livro" (isBookPosition), usa um segundo
   índice: um Set de POSIÇÕES (FEN normalizado), pré-calculado replicando
   cada linha do ECO_RAW via PGNParser.applyMove. Isso é tolerante a
   TRANSPOSIÇÕES — ex.: 1.d4 Nf6 2.Nf3 d5 chega na mesma posição que
   1.d4 d5 2.Nf3 Nf6, e a Trie (que só compara a sequência exata de
   lances) erraria isso; o Set de posições acerta.

   Depende de: js/data/eco-data.js (variável global ECO_RAW), pgn-parser.js
   ============================================================== */
const OpeningDetector = (() => {
  // Each trie node: { children: Map<san, node>, data: {eco,name,var}|null }
  let root = null;
  let bookPositions = null; // Set<string> de posições normalizadas (board+turn+castling)

  function _normKey(fen) {
    const parts = fen.split(' ');
    return parts[0] + ' ' + parts[1] + ' ' + parts[2]; // board+turn+castling, ignora ep/halfmove/fullmove
  }

  function _buildBookPositions() {
    const set = new Set();
    set.add(_normKey(PGNParser.INITIAL_FEN));
    for (const [movesStr] of ECO_RAW) {
      const sanList = movesStr.split(' ');
      let state = PGNParser.fenToBoard(PGNParser.INITIAL_FEN);
      for (const san of sanList) {
        const next = PGNParser.applyMove(state, san);
        if (!next) break; // linha de dados inconsistente — para aqui, não quebra o resto
        state = next;
        set.add(_normKey(PGNParser.boardToFen(state)));
      }
    }
    return set;
  }

  function build() {
    root = { children: new Map(), data: null };
    for (const [movesStr, eco, name, variation] of ECO_RAW) {
      const moves = movesStr.split(' ');
      let node = root;
      for (const m of moves) {
        if (!node.children.has(m)) {
          node.children.set(m, { children: new Map(), data: null });
        }
        node = node.children.get(m);
      }
      // Store data at leaf (longest sequence wins by sort order)
      node.data = { eco, name, variation };
    }
    bookPositions = _buildBookPositions();
    console.log(
      `[OpeningDetector] Trie construída com ${ECO_RAW.length} aberturas` +
      ` (${bookPositions.size} posições únicas no índice de transposição)`
    );
  }

  /**
   * Verifica se uma posição (FEN) é conhecida em qualquer linha do banco
   * de aberturas, em qualquer ordem de lances que chegue nela.
   */
  function isBookPosition(fen) {
    if (!bookPositions) build();
    return bookPositions.has(_normKey(fen));
  }

  /**
   * Detect opening from a list of SAN moves.
   * Returns the best (longest) match found.
   * @param {string[]} moves
   * @returns {{ eco, name, variation } | null}
   */
  function detect(moves) {
    if (!root) build();
    let node = root;
    let lastMatch = null;

    for (const m of moves) {
      // Strip annotations for lookup
      const clean = m.replace(/[+#!?]/g, '');
      if (!node.children.has(clean)) break;
      node = node.children.get(clean);
      if (node.data) lastMatch = node.data;
    }

    return lastMatch;
  }

  // Build immediately in background
  setTimeout(() => { if (!root) build(); }, 100);

  function getRootNode() { if (!root) build(); return root; }
  return { detect, build, getRootNode, isBookPosition };
})();

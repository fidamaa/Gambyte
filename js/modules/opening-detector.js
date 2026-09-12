/* ==============================================================
   MODULE: opening-detector.js
   Builds a Trie from ECO data for O(k) prefix lookup.
   Depende de: js/data/eco-data.js (variável global ECO_RAW)
   ============================================================== */
const OpeningDetector = (() => {
  // Each trie node: { children: Map<san, node>, data: {eco,name,var}|null }
  let root = null;

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
    console.log('[OpeningDetector] Trie construída com', ECO_RAW.length, 'aberturas');
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
  return { detect, build, getRootNode };
})();

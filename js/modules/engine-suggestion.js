/* ==============================================================
   MODULE: engine-suggestion.js
   Converts Stockfish bestmove UCI to board squares.
   Depende de: arrow-system.js
   ============================================================== */
const EngineSuggestion = (() => {
  /**
   * Given a UCI move string like "e2e4" or "e7e8q",
   * return { from: "e2", to: "e4" }
   */
  function parseUCI(uci) {
    if (!uci || uci.length < 4) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  }

  function updateArrow(bestMoveUCI) {
    const parsed = parseUCI(bestMoveUCI);
    if (parsed) {
      // Stockfish may return castling as e1h1/e1a1 (Fischer notation).
      // Normalize to king destination squares g1/c1/g8/c8 for display.
      let { from, to } = parsed;
      if ((from === 'e1' && to === 'h1') || (from === 'e8' && to === 'h8')) to = to[1] === '1' ? 'g1' : 'g8';
      if ((from === 'e1' && to === 'a1') || (from === 'e8' && to === 'a8')) to = to[1] === '1' ? 'c1' : 'c8';
      ArrowSystem.setEngineArrow(from, to);
    } else {
      ArrowSystem.setEngineArrow(null, null);
    }
  }

  return { updateArrow, parseUCI };
})();

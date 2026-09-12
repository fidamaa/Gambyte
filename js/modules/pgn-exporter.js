/* ==============================================================
   MODULE: pgn-exporter.js  (for the main analyzed game)
   ============================================================== */
const PGNExporter = (() => {
  function buildPGN(parsedGame) {
    if (!parsedGame) return '';
    const h = parsedGame.headers || {};
    const date = h.Date || new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    let pgn = '';
    pgn += `[Event "${h.Event || 'Analysis'}"]\n`;
    pgn += `[Date "${date}"]\n`;
    pgn += `[White "${h.White || '?'}"]\n`;
    pgn += `[Black "${h.Black || '?'}"]\n`;
    pgn += `[Result "${h.Result || '*'}"]\n\n`;

    const moves = parsedGame.moves || [];
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i / 2) + 1}. `;
      pgn += moves[i] + ' ';
    }
    pgn += (h.Result || '*');
    return pgn;
  }

  function _download(pgn, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pgn], { type: 'text/plain' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportGame(parsedGame) {
    if (!parsedGame) return;
    const h = parsedGame.headers || {};
    const pgn = buildPGN(parsedGame);
    _download(pgn, `${(h.White || 'game').replace(/\s/g,'_')}_vs_${(h.Black || 'game').replace(/\s/g,'_')}.pgn`);
  }

  async function copyGame(parsedGame) {
    if (!parsedGame) return false;
    try { await navigator.clipboard.writeText(buildPGN(parsedGame)); return true; }
    catch (e) { return false; }
  }

  return { exportGame, copyGame, buildPGN };
})();

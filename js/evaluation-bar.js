/* ==============================================================
   MODULE: evaluation-bar.js
   Dynamic vertical evaluation bar beside the board
   ============================================================== */
const EvalBar = (() => {
  let _whiteEl = null;
  let _topLabel = null;
  let _botLabel = null;
  let _flipped  = false;

  function init() {
    _whiteEl  = document.getElementById('eval-bar-white');
    _topLabel = document.getElementById('eval-bar-top-label');
    _botLabel = document.getElementById('eval-bar-bot-label');
  }

  function setFlipped(v) { _flipped = v; update(_lastCp, _lastIsMate, _lastMateN); }

  let _lastCp = 0, _lastIsMate = false, _lastMateN = 0;

  /**
   * Update the bar.
   * @param {number} cpFromWhite  centipawns from White's perspective (+= white better)
   * @param {boolean} isMate
   * @param {number}  mateN       positive = white mates in N, negative = black mates in N
   */
  function update(cpFromWhite, isMate, mateN) {
    _lastCp = cpFromWhite; _lastIsMate = isMate; _lastMateN = mateN;
    if (!_whiteEl) return;

    let pct;      // percentage of bar that is WHITE
    let labelTop, labelBot, labelClass;

    if (isMate) {
      pct = mateN > 0 ? 97 : 3;
      const absN = Math.abs(mateN);
      if (mateN > 0) {
        labelTop = ''; labelBot = `M${absN}`; labelClass = 'positive';
      } else {
        labelTop = `-M${absN}`; labelBot = ''; labelClass = 'negative';
      }
    } else {
      // Sigmoid-like mapping: ±600cp → ±95%
      const clamped = Math.max(-600, Math.min(600, cpFromWhite));
      pct = 50 + (clamped / 600) * 45;
      const abs = Math.abs(cpFromWhite / 100).toFixed(1);
      if (cpFromWhite > 15) {
        labelTop = ''; labelBot = `+${abs}`; labelClass = 'positive';
      } else if (cpFromWhite < -15) {
        labelTop = `-${abs}`; labelBot = ''; labelClass = 'negative';
      } else {
        labelTop = ''; labelBot = '0.0'; labelClass = '';
      }
    }

    // If board is flipped, swap top/bottom labels
    if (_flipped) {
      [labelTop, labelBot] = [labelBot, labelTop];
    }

    _whiteEl.style.height = pct + '%';
    _topLabel.textContent = labelTop;
    _botLabel.textContent = labelBot;
    _topLabel.className   = 'eval-bar-label ' + (_flipped ? labelClass : (labelClass === 'positive' ? 'negative' : labelClass === 'negative' ? 'positive' : ''));
    _botLabel.className   = 'eval-bar-label ' + labelClass;
  }

  function updateFromMoveData(moveData) {
    if (!moveData) { update(0, false, 0); return; }
    const isWhiteMoved = moveData.color === 'white';
    // evalAfter já está na perspectiva do jogador que moveu.
    // Branco moveu → evalAfter = perspectiva das brancas → usa direto
    // Preto moveu  → evalAfter = perspectiva das pretas → nega para converter para brancas
    const cpFromWhite  = isWhiteMoved ? moveData.evalAfter : -moveData.evalAfter;

    // FIX 2: detectar mate e extrair a profundidade real
    // Valores codificados: ±(30000 - N) onde N é o número de lances
    const absVal = Math.abs(cpFromWhite);
    const isMate = absVal >= 29000;  // qualquer valor acima de 29000 é mate

    if (isMate) {
      // Recuperar mateN: 30000 - absVal = N lances até o mate
      const mateDepth = Math.max(1, 30000 - absVal);
      // Sinal: positivo = brancas dão mate, negativo = pretas dão mate
      const mateN = cpFromWhite > 0 ? mateDepth : -mateDepth;
      update(0, true, mateN);
    } else {
      update(cpFromWhite, false, 0);
    }
  }

  return { init, update, updateFromMoveData, setFlipped };
})();

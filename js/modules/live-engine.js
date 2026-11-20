/* ==============================================================
   MODULE: live-engine.js
   Análise ao vivo da posição do tabuleiro, no estilo dos grandes sites:

   - Resposta imediata: se a posição já foi vista, o resultado guardado
     aparece na hora; se o lance jogado é o que o motor previa, a linha
     anterior é reaproveitada (o próximo lance dela vira a nova seta)
     antes mesmo de a busca nova começar.
   - Aprofundamento contínuo: a busca entrega a linha inteira a cada
     profundidade nova, e a seta, a barra e a linha prevista acompanham.
   - Prioridade: a busca ao vivo fura a fila do motor (ver
     StockfishManager.analyzeLive), então nunca espera a classificação
     dos lances ou a análise da partida terminarem.

   Depende de: stockfish-manager.js, pgn-parser.js, evaluation-bar.js,
               engine-suggestion.js, auth-system.js (opcional)
   ============================================================== */
const LiveEngine = (() => {
  const DEPTH_FREE = 18;
  const DEPTH_PRO  = 22;
  const MAX_PLIES  = 10;      // lances mostrados na linha prevista
  const cache = new Map();    // fen → { cp, pv, depth }  (cp do ponto de vista de quem joga)
  const CACHE_MAX = 400;
  const DESVANTAGEM_CLARA = 150; // centipeões: abaixo de −1,50 repetir para empatar é aceitável

  // Posição inicial já calculada (Stockfish 18, motor recém-aberto), para o
  // site abrir com a avaliação e a seta na hora, sem esperar o motor. Uma
  // por plano, porque o melhor lance muda com a profundidade: até a 21 o
  // motor prefere 1. e4; da 22 em diante, 1. d4.
  const INICIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const INICIAL_PRONTA = {
    [DEPTH_FREE]: { cp: 49, depth: DEPTH_FREE, pv: 'e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4 g7g6 b1c3 g8f6 g1f3'.split(' ') },
    [DEPTH_PRO]:  { cp: 27, depth: DEPTH_PRO,  pv: 'd2d4 g8f6 c2c4 e7e6 g1f3 d7d5 g2g3 d5c4 d1a4 b8c6 a2a3 f8e7 f1g2'.split(' ') },
  };

  let token = 0;
  let timer = null;
  let modo = { arrow: true, evalBar: true };

  const $ = id => document.getElementById(id);

  function alvo() {
    const pro = typeof AuthSystem !== 'undefined' && AuthSystem.isPremium && AuthSystem.isPremium();
    return pro ? DEPTH_PRO : DEPTH_FREE;
  }

  function guardar(fen, r) {
    const old = cache.get(fen);
    if (old && old.depth > r.depth) return;
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(fen, r);
  }

  // Linha prevista em notação de partida: "12. Nf3 Nc6 13. Bb5 a6 …"
  function linhaSAN(fen, pv) {
    if (!pv || !pv.length) return '';
    let st = PGNParser.fenToBoard(fen);
    if (!st) return '';
    const partes = fen.split(' ');
    let n = parseInt(partes[5], 10) || 1;
    let brancas = partes[1] === 'w';
    const out = [];
    for (const u of pv.slice(0, MAX_PLIES)) {
      let san = null, prox = null;
      try { san = PGNParser.uciToSan(st, u); prox = PGNParser.applyMoveUCI(st, u); } catch (e) { /* lance inválido */ }
      if (!san || !prox) break;
      if (brancas) out.push(`${n}. ${san}`);
      else out.push(out.length ? san : `${n}… ${san}`);
      if (!brancas) n++;
      brancas = !brancas;
      st = prox;
    }
    return out.join(' ');
  }

  function fmt(cpW) {
    const abs = Math.abs(cpW);
    if (abs >= 29000) {
      const n = Math.max(1, 30000 - abs);
      return (cpW > 0 ? '+M' : '−M') + n;
    }
    return (cpW > 0 ? '+' : cpW < 0 ? '−' : '') + (abs / 100).toFixed(2).replace('.', ',');
  }

  function mostrar(fen, r, previa) {
    const evalEl = $('free-play-eval'), linhaEl = $('live-line'), profEl = $('live-depth');
    if (!r) {
      if (linhaEl) linhaEl.textContent = 'Calculando…';
      if (profEl) profEl.textContent = '';
      if (modo.arrow) EngineSuggestion.updateArrow(null);
      return;
    }
    const brancasJogam = fen.split(' ')[1] === 'w';
    const cpW = brancasJogam ? r.cp : -r.cp;
    const mate = Math.abs(cpW) >= 29000;
    if (evalEl) {
      evalEl.textContent = fmt(cpW);
      evalEl.classList.toggle('neg', cpW < 0);
    }
    if (linhaEl) linhaEl.textContent = linhaSAN(fen, r.pv) || '—';
    if (profEl) profEl.textContent = previa ? 'prévia' : `prof. ${r.depth}`;
    if (modo.evalBar) {
      const n = mate ? Math.max(1, 30000 - Math.abs(cpW)) : 0;
      EvalBar.update(mate ? 0 : cpW, mate, mate ? (cpW > 0 ? n : -n) : 0);
    }
    if (modo.arrow) EngineSuggestion.updateArrow(r.pv && r.pv[0] ? r.pv[0] : null);
  }

  /**
   * Analisa a posição mostrada no tabuleiro.
   * opts.played / opts.fenBefore: o lance que levou até aqui (para
   *   reaproveitar a linha prevista na posição anterior).
   * opts.arrow / opts.evalBar: se esta análise controla a seta e a barra
   *   (na revisão da partida, a seta continua sendo a da análise completa).
   */
  function analyze(fen, opts = {}) {
    aviso(null);
    const tok = ++token;
    modo = { arrow: opts.arrow !== false, evalBar: opts.evalBar !== false };
    if (timer) clearTimeout(timer);

    // Repetição (Modo Livre): o motor recebe a linha jogada até aqui, para
    // enxergar as posições repetidas. Se algum lance repetiria a posição
    // (ver FreePlay), a busca fica só com os outros lances — a não ser que
    // eles deixem quem joga em desvantagem clara; aí repetir (empatar) vale.
    const hist = opts.historico || null;
    const evitar = (opts.evitar && opts.evitar.length && opts.alternativas && opts.alternativas.length) ? opts.evitar : null;
    const chave = evitar ? `${fen}|sem:${[...evitar].sort().join(',')}` : fen;

    // 1) Resposta imediata
    let r = cache.get(chave) || null, previa = false;
    if (fen === INICIAL && (!r || r.depth < alvo())) r = INICIAL_PRONTA[alvo()] || r;
    if (!r && opts.played && opts.fenBefore) {
      const ant = cache.get(opts.fenBefore);
      if (ant && ant.pv && ant.pv[0] === opts.played && ant.pv.length > 1 && !(evitar && evitar.includes(ant.pv[1]))) {
        r = { cp: -ant.cp, pv: ant.pv.slice(1), depth: Math.max(1, ant.depth - 1) };
        previa = true;
      }
    }
    mostrar(fen, r, previa);

    // 2) Busca ao vivo (pequena espera para juntar cliques rápidos)
    const profundidade = alvo();
    if (r && !previa && r.depth >= profundidade) return;
    const buscar = (k, extra) => StockfishManager.analyzeLive(hist ? hist.inicio : fen, profundidade, u => {
      if (tok !== token || !u || !u.pv || !u.pv.length) return;
      const res = { cp: u.eval, pv: u.pv, depth: u.depth };
      guardar(k, res);
      mostrar(fen, res, false);
    }, { movesUCI: hist ? hist.lances : [], ...extra });
    timer = setTimeout(() => {
      if (tok !== token) return;
      if (!evitar) { buscar(chave); return; }
      buscar(chave, { searchMoves: opts.alternativas }).then(fim => {
        if (tok !== token || !fim || fim.cancelled) return;
        const cp = fim.evals && fim.evals[0];
        // Sem repetir, quem joga fica claramente pior: mostra o melhor de verdade.
        if (cp != null && cp <= -DESVANTAGEM_CLARA) { cache.delete(chave); buscar(fen); }
      });
    }, 30);
  }

  // Aviso de xeque-mate no centro do tabuleiro (some na próxima posição).
  function aviso(vencedor) {
    const ref = $('move-class-overlay');
    const pai = ref && ref.parentElement;
    let el = $('board-mate');
    if (!vencedor) { if (el) el.hidden = true; return; }
    if (!pai) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'board-mate';
      el.setAttribute('role', 'status');
      pai.appendChild(el);
    }
    el.innerHTML = `<strong>Xeque-mate!</strong><span>${vencedor === 'white' ? 'Brancas vencem' : 'Pretas vencem'} · ${vencedor === 'white' ? '1-0' : '0-1'}</span>`;
    el.hidden = false;
  }

  // Xeque-mate na posição mostrada: quem está para jogar levou mate. Para a
  // busca, mostra o aviso e põe a barra inteira para quem venceu.
  function fimDeJogo(fen) {
    const vencedor = fen.split(' ')[1] === 'w' ? 'black' : 'white';
    parar(`Xeque-mate — ${vencedor === 'white' ? 'brancas vencem' : 'pretas vencem'}`);
    const evalEl = $('free-play-eval');
    if (evalEl) {
      evalEl.textContent = vencedor === 'white' ? '1-0' : '0-1';
      evalEl.classList.toggle('neg', vencedor === 'black');
    }
    EngineSuggestion.updateArrow(null);
    EvalBar.fim(vencedor);
    aviso(vencedor);
  }

  // Fim de jogo ou nada para analisar: limpa a linha e mostra o motivo.
  function parar(texto) {
    aviso(null);
    token++;
    if (timer) clearTimeout(timer);
    const linhaEl = $('live-line'), profEl = $('live-depth'), evalEl = $('free-play-eval');
    if (linhaEl) linhaEl.textContent = texto || '';
    if (profEl) profEl.textContent = '';
    if (evalEl && texto) evalEl.textContent = '—';
  }

  return { analyze, parar, fimDeJogo, linhaSAN };
})();

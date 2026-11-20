/* ==============================================================
   MODULE: bot-engine.js
   O lance do bot no "Jogar contra o bot", em cada nível.

   - 1500 em diante: o próprio Stockfish com a força limitada
     (UCI_LimitStrength + UCI_Elo), ligada só na busca do bot (ver
     StockfishManager: a busca seguinte sem elo volta à força total).
     2500+ é o motor sem limite, com pouco tempo por lance.
   - Abaixo de 1350 (o UCI_Elo do Stockfish não desce tanto): uma busca
     rasa com 5 linhas (MultiPV 5) e um sorteio do tipo de lance pelo
     nível — melhor, bom, imprecisão, erro ou gafe —, escolhendo entre as
     linhas a que tem a perda daquele tamanho. O erro e a gafe, quando
     nenhuma das 5 linhas é ruim o bastante, saem de uma segunda busca,
     bem rasa, que avalia todos os outros lances. Nunca um lance ilegal: tudo sai da lista de lances legais.
   - Repetição: o bot não volta a uma posição repetida (empate) quando
     não está claramente pior, igual à sugestão do Modo Livre.

   As chances de cada nível foram ajustadas jogando bot contra bot e
   medindo com a própria análise do Gambyte (precisão e nível estimado).
   (bancada local, fora do site: _prints/calibrar-bot.html).

   Depende de: stockfish-manager.js, pgn-parser.js, free-play.js (regras)
   ============================================================== */
const BotEngine = (() => {
  const NIVEIS = [400, 800, 1200, 1500, 1800, 2200, 2500];
  const DESVANTAGEM_CLARA = 150; // centipeões: abaixo disso, repetir para empatar vale

  // Perda de cada tipo de lance, em pontos de chance de vitória (0–100, a
  // mesma escala da precisão): perder 300 centipeões numa posição igual é
  // uma gafe; com +10 no tabuleiro, quase não muda nada.
  const FAIXAS = {
    melhor:     [0, 2],
    bom:        [2, 6],
    imprecisao: [6, 12],
    erro:       [12, 22],
    gafe:       [22, Infinity]
  };
  const TIPOS = Object.keys(FAIXAS);
  const chance = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

  const PERFIS = {
    400:  { depth: 6,  multiPV: 5, chance: { melhor: .18, bom: .20, imprecisao: .18, erro: .20, gafe: .24 } },
    800:  { depth: 8,  multiPV: 5, chance: { melhor: .26, bom: .22, imprecisao: .20, erro: .18, gafe: .14 } },
    1200: { depth: 10, multiPV: 5, chance: { melhor: .36, bom: .25, imprecisao: .18, erro: .13, gafe: .08 } },
    1500: { elo: 1400, depth: 12, movetime: 700 },
    1800: { elo: 1800, depth: 14, movetime: 900 },
    2200: { elo: 2500, depth: 16, movetime: 1100 },
    2500: { depth: 12, movetime: 800 }
  };

  // Diagnóstico (calibração): troca o perfil de um nível.
  function ajustar(nivel, perfil) { PERFIS[nivel] = { ...PERFIS[nivel], ...perfil }; }
  function perfil(nivel) { return PERFIS[nivel] || PERFIS[1200]; }

  const sortear = lista => lista[Math.floor(Math.random() * lista.length)];

  // Posições da partida, lances legais e os que repetiriam posição.
  function contexto(inicio, lances) {
    const R = FreePlay.regras;
    const fens = [inicio];
    let st = PGNParser.fenToBoard(inicio);
    for (const u of lances) { st = PGNParser.applyMoveUCI(st, u); fens.push(PGNParser.boardToFen(st)); }
    const fen = fens[fens.length - 1];
    const vistas = new Map();
    for (const f of fens) { const s = R.assinatura(f); vistas.set(s, (vistas.get(s) || 0) + 1); }
    const aqui = vistas.get(R.assinatura(fen)) || 0;
    const legais = R.lancesLegais(fen);
    const evitar = legais.filter(u => {
      let n = 0;
      try { n = vistas.get(R.assinatura(PGNParser.boardToFen(PGNParser.applyMoveUCI(st, u)))) || 0; } catch (e) { /* lance inválido */ }
      return n >= 2 || (aqui >= 2 && n >= 1);
    });
    return { fen, fens, legais, evitar, alternativas: legais.filter(u => !evitar.includes(u)) };
  }

  // Linhas de uma busca: [{ uci, cp }] com cp do ponto de vista de quem joga.
  function linhas(res, legais) {
    const out = [];
    if (!res || !res.pvLines) return out;
    for (let k = 0; k < res.pvLines.length; k++) {
      const pv = res.pvLines[k], cp = res.evals[k];
      if (!pv || cp == null) continue;
      const uci = pv.split(' ')[0];
      if (legais.includes(uci) && !out.some(l => l.uci === uci)) out.push({ uci, cp });
    }
    return out;
  }

  function sortearTipo(chance) {
    let r = Math.random(), acc = 0;
    for (const t of TIPOS) { acc += chance[t] || 0; if (r < acc) return t; }
    return 'melhor';
  }

  // Níveis abaixo de 1350: sorteia o tipo de lance e escolhe a linha.
  async function _comErros(p, inicio, lances, permitidos) {
    const res = await StockfishManager.analyzePosition(inicio, p.depth, p.multiPV, lances, null,
      { movetime: 1500, searchMoves: permitidos.length ? permitidos : null });
    const cands = linhas(res, permitidos);
    if (!cands.length) return { uci: res && permitidos.includes(res.bestMove) ? res.bestMove : sortear(permitidos), melhor: null };
    const melhor = cands[0].cp, wMelhor = chance(melhor);
    const perda = c => { c.perda = Math.max(0, wMelhor - chance(c.cp)); return c; };
    cands.forEach(perda);
    const tipo = sortearTipo(p.chance);
    const [lo, hi] = FAIXAS[tipo];
    const naFaixa = l => l.filter(c => c.perda >= lo && c.perda < hi);
    let escolha = null;
    // "Melhor" é o melhor lance do motor mesmo: com vantagem enorme todo lance
    // perde ~0 de chance de vitória, e sortear entre eles deixava o bot
    // passeando sem dar mate.
    if (tipo === 'melhor') escolha = cands[0];
    else if (naFaixa(cands).length) escolha = sortear(naFaixa(cands));
    else if (tipo === 'gafe' || tipo === 'erro') {
      // Nenhuma das linhas é ruim o bastante: avalia todos os outros lances
      // (busca rasa, uma linha por lance) e escolhe um da faixa sorteada.
      const outros = permitidos.filter(u => !cands.some(c => c.uci === u));
      if (outros.length) {
        const res2 = await StockfishManager.analyzePosition(inicio, p.depthErro || 4, Math.min(60, outros.length), lances, null,
          { movetime: 1500, searchMoves: outros });
        const todos = linhas(res2, outros).map(perda).concat(cands);
        const bons = naFaixa(todos);
        if (bons.length) escolha = sortear(bons);
        else {
          // A faixa não existe aqui: a gafe fica com o pior lance; o erro,
          // com o pior abaixo da faixa da gafe.
          const teto = tipo === 'gafe' ? Infinity : FAIXAS.gafe[0];
          const abaixo = todos.filter(c => c.perda < teto);
          if (abaixo.length) escolha = abaixo.reduce((a, b) => (b.perda > a.perda ? b : a));
        }
      }
    }
    if (!escolha) {
      // A faixa sorteada não existe nesta posição: fica com a linha mais
      // próxima dela por baixo (a pior das que perdem menos que o limite).
      const abaixo = cands.filter(c => c.perda < hi);
      escolha = abaixo.reduce((a, b) => (b.perda > a.perda ? b : a), abaixo[0] || cands[0]);
    }
    return { uci: escolha.uci, melhor, tipo, perda: escolha.perda };
  }

  // 1500 em diante: o Stockfish com a força limitada (ou total, no 2500+).
  async function _limitado(p, inicio, lances, permitidos) {
    const res = await StockfishManager.analyzePosition(inicio, p.depth, 1, lances, null,
      { movetime: p.movetime, elo: p.elo || 0, searchMoves: permitidos.length ? permitidos : null });
    const uci = res && permitidos.includes(res.bestMove) ? res.bestMove : null;
    return { uci: uci || sortear(permitidos), melhor: res && res.evals ? res.evals[0] : null };
  }

  /**
   * Lance do bot na posição depois de `lances` (UCI) a partir de `inicio`.
   * Resolve com { uci, melhor (avaliação do bot, cp do lado dele), tipo }.
   */
  async function escolher({ inicio, lances, nivel }) {
    const p = perfil(nivel);
    const ctx = contexto(inicio, lances);
    if (!ctx.legais.length) return null;
    if (ctx.legais.length === 1) return { uci: ctx.legais[0], melhor: null, tipo: 'unico' };
    const buscar = permitidos => (p.multiPV ? _comErros : _limitado)(p, inicio, lances, permitidos);
    if (ctx.evitar.length && ctx.alternativas.length) {
      const r = await buscar(ctx.alternativas);
      // Sem repetir, o bot ficaria claramente pior: aí repetir (empatar) vale.
      if (r && r.melhor != null && r.melhor < -DESVANTAGEM_CLARA) return buscar(ctx.legais);
      return r;
    }
    return buscar(ctx.legais);
  }

  // Avaliação da posição para o lado `cor` ('w' ou 'b'), força total.
  async function avaliar({ inicio, lances, cor }) {
    const res = await StockfishManager.analyzePosition(inicio, 12, 1, lances, null, { movetime: 900 });
    const cp = res && res.evals ? res.evals[0] : null;
    if (cp == null) return null;
    const vez = contexto(inicio, lances).fen.split(' ')[1];
    return vez === cor ? cp : -cp;
  }

  return { NIVEIS, escolher, avaliar, contexto, ajustar, perfil };
})();

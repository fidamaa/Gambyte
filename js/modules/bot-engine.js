/* ==============================================================
   MODULE: bot-engine.js
   O lance do bot no "Jogar contra o bot", em cada nível.

   - 1500 em diante: o próprio Stockfish com a força limitada
     (UCI_LimitStrength + UCI_Elo), ligada só na busca do bot (ver
     StockfishManager: a busca seguinte sem elo volta à força total).
     2500+ é o motor sem limite, com pouco tempo por lance.
   - Abaixo de 1350 (o UCI_Elo do Stockfish não desce tanto): como um bot
     dos grandes sites, a maioria dos lances é boa e, de vez em quando,
     vem um erro: a cada lance, um sorteio pelo nível decide o tipo —
     melhor, bom, imprecisão, erro ou gafe. Um 800, por exemplo, comete
     várias imprecisões, alguns erros e duas ou três gafes numa partida,
     mas não toda hora. O tamanho do erro é medido em material
     (centipeões), então o bot também entrega peça quando está ganhando,
     como gente desse nível. Nos primeiros lances ele não erra feio (a
     abertura sai natural). As 5 linhas de uma busca rasa (MultiPV 5) dão
     os lances bons; o erro e a gafe, quando nenhuma delas perde o
     bastante, saem de uma segunda busca, bem rasa, que avalia todos os
     outros lances. Nunca um lance ilegal: tudo sai da lista de legais.
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

  // Perda de cada tipo de lance, em centipeões (avaliação limitada a ±20
  // peões, para um mate não valer infinito): imprecisão é uma posição pior,
  // erro é perder um peão ou mais, gafe é entregar uma peça ou mais.
  const FAIXAS = {
    melhor:     [0, 15],
    bom:        [15, 50],
    imprecisao: [50, 120],
    erro:       [120, 300],
    gafe:       [300, Infinity]
  };
  const TIPOS = Object.keys(FAIXAS);
  const limitar = cp => Math.max(-2000, Math.min(2000, cp));

  // chance: probabilidade de cada tipo de lance; abertura: quantos lances do
  // bot, no começo, sem erro nem gafe.
  const PERFIS = {
    400:  { depth: 4,  multiPV: 5, abertura: 2, chance: { melhor: .26, bom: .18, imprecisao: .16, erro: .18, gafe: .22 } },
    800:  { depth: 5,  multiPV: 5, abertura: 4, chance: { melhor: .38, bom: .24, imprecisao: .14, erro: .13, gafe: .11 } },
    1200: { depth: 7,  multiPV: 5, abertura: 5, chance: { melhor: .48, bom: .26, imprecisao: .12, erro: .09, gafe: .05 } },
    1500: { elo: 1400, depth: 12, movetime: 700 },
    1800: { elo: 1800, depth: 14, movetime: 900 },
    2200: { elo: 2650, depth: 16, movetime: 1100 },
    2500: { depth: 16, movetime: 1000 }
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

  // relaxa > 1: chances de imprecisão, erro e gafe multiplicadas (o resto
  // sai do "melhor").
  function sortearTipo(chance, relaxa = 1) {
    const c = { ...chance };
    if (relaxa !== 1) {
      let extra = 0;
      for (const t of ['imprecisao', 'erro', 'gafe']) { const n = (c[t] || 0) * relaxa; extra += n - (c[t] || 0); c[t] = n; }
      c.melhor = Math.max(0, (c.melhor || 0) - extra);
    }
    let r = Math.random(), acc = 0;
    for (const t of TIPOS) { acc += c[t] || 0; if (r < acc) return t; }
    return 'melhor';
  }
  // Ganhando com folga, gente desse nível relaxa e devolve material: o jogo
  // vira, como nas partidas de verdade.
  const RELAXA_GANHANDO = 1.7, GANHANDO = 300;

  // Níveis abaixo de 1350: sorteia o tipo de lance e escolhe a linha.
  async function _comErros(p, inicio, lances, permitidos) {
    const res = await StockfishManager.analyzePosition(inicio, p.depth, p.multiPV, lances, null,
      { movetime: 1500, searchMoves: permitidos.length ? permitidos : null });
    const cands = linhas(res, permitidos);
    if (!cands.length) return { uci: res && permitidos.includes(res.bestMove) ? res.bestMove : sortear(permitidos), melhor: null };
    const melhor = cands[0].cp;
    const perda = c => { c.perda = Math.max(0, limitar(melhor) - limitar(c.cp)); return c; };
    cands.forEach(perda);
    let tipo = sortearTipo(p.chance, melhor >= GANHANDO ? RELAXA_GANHANDO : 1);
    // Abertura: nada de erro nem gafe nos primeiros lances do bot.
    if (Math.floor(lances.length / 2) < (p.abertura || 0) && (tipo === 'erro' || tipo === 'gafe')) tipo = 'bom';
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

/* ==============================================================
   MODULE: RatingModel
   Nível estimado de cada jogador numa partida.

   PIPELINE:
     MoveClassifier.computeStats() → precisão (escala dos grandes sites)
     RatingModel.fromAccuracy(precisão, lances, gafes, erros) → nível
     RatingModel.correlateOpponents() → ajuste quando os dois são fortes
   ============================================================== */
const RatingModel = (() => {

  // ──────────────────────────────────────────────────────────
  // fromAccuracy — NÍVEL DA PARTIDA A PARTIR DA PRECISÃO
  //
  // A precisão (já na escala dos grandes sites) é o que mais diz sobre o
  // nível de uma partida. Pontos da curva:
  //   50% → 550    70% → 1000   80% → 1350   85% → 1600   90% → 1850
  //   91% → 1900   93% → 2075   95% → 2300   96% → 2400   97% → 2500
  //   98% → 2600   99% → 2750
  // Ajustes:
  //   • Partida curta: poucos lances dizem menos, então o resultado fica
  //     um pouco mais perto de 1500 (com 12 lances fora do livro, 15% mais
  //     perto; a partir de 18 lances, sem ajuste).
  //   • Gafes e erros: cada gafe tira 90 pontos e cada erro 30, além do
  //     que já custaram na precisão (no máximo 3 gafes e 5 erros contam).
  // ──────────────────────────────────────────────────────────
  const CURVA = [
    [0, 300], [40, 400], [50, 550], [60, 775], [70, 1000], [75, 1175], [80, 1350],
    [85, 1600], [88, 1750], [90, 1850], [91, 1900], [93, 2075], [95, 2300], [96, 2400],
    [97, 2500], [98, 2600], [99, 2750], [100, 2900]
  ];
  function _curva(acc) {
    for (let i = 1; i < CURVA.length; i++) {
      const [a1, r1] = CURVA[i - 1], [a2, r2] = CURVA[i];
      if (acc <= a2) return r1 + (r2 - r1) * (acc - a1) / (a2 - a1);
    }
    return CURVA[CURVA.length - 1][1];
  }

  function _bruto(accuracy, nMoves, blunders, mistakes) {
    let r = _curva(Math.max(0, Math.min(100, accuracy)));
    r -= 90 * Math.min(blunders || 0, 3) + 30 * Math.min(mistakes || 0, 5);
    // Partida curta e fraca: poucos lances dizem pouco, puxa para 1500.
    if (r < 1500) {
      const peso = Math.min(1, 0.55 + (nMoves || 0) / 40);
      r = r * peso + 1500 * (1 - peso);
    }
    return r;
  }
  const _arred = r => Math.max(400, Math.min(3200, Math.round(r / 25) * 25));

  // Nível de um lado olhando só para ele (sem adversário nem contexto).
  function fromAccuracy(accuracy, nMoves, blunders, mistakes) {
    if (accuracy == null || !nMoves) return 1500;
    return _arred(_bruto(accuracy, nMoves, blunders, mistakes));
  }

  // ══════════════════════════════════════════════════════════════
  // estimarPartida — NÍVEL DOS DOIS LADOS, COM CONTEXTO
  //
  // Ajustado em 2026-11-18 contra o rating real de 30 partidas do
  // Chess.com (5 por faixa: ~400, 1000, 1500, 2000, 2400–2500 e GMs) e
  // mais 43 partidas da conta do dono do site.
  //   1. Precisão (curva acima) — sozinha separa mal os níveis: um 400
  //      faz 93% contra quem entrega peças, e um GM faz 88% numa partida
  //      dura contra outro GM.
  //   2. EQUILÍBRIO: por quantos meios-lances a partida ficou sem ninguém
  //      com +3 de vantagem. É o sinal que mais separa os níveis — entre
  //      fortes a partida segue parelha por muito tempo; entre fracos
  //      alguém entrega material cedo. Também cobre o tamanho da partida:
  //      acertar tudo em 8 lances diz pouco; segurar 70 lances diz muito.
  //   3. Adversário: o nível de cada um é puxado para o do outro, somado
  //      à diferença de precisão (jogou melhor que um 2000 → acima dele).
  //   4. Rating conhecido (WhiteElo/BlackElo do PGN, ex.: partidas
  //      importadas do Chess.com/Lichess): metade do resultado.
  //   Quem jogou pior nunca fica acima de quem jogou melhor.
  //   Piso: o nível nunca fica mais de 100 abaixo da curva da precisão
  //   (pedido do dono: 95% x 74% numa partida curta ≈ 1875 x 1150).
  //   Resultado no teste: sem rating no PGN, 35 de 60 a até 500 pontos do
  //   rating real (antes 29); com rating no PGN, 51 de 60.
  //   O ritmo (bullet/blitz) foi testado e não ajudou — fica de fora.
  //
  // lado = { accuracy, lances, equilibrio } (de computeStats);
  // ctx  = cabeçalhos do PGN (opcional).
  // ══════════════════════════════════════════════════════════════
  const NIV_A = -1890, NIV_PREC = 0.347, NIV_EQ = 819, NIV_PISO = 100;
  const NIV_ADV = 0.2, NIV_DIF = 20, NIV_ELO = 0.5;

  function _base(lado) {
    const c = _curva(Math.max(0, Math.min(100, lado.accuracy)));
    const r = NIV_A + NIV_PREC * c + NIV_EQ * Math.log(1 + (lado.equilibrio || 0));
    return Math.max(r, c - NIV_PISO);
  }

  function _um(eu, adv, eloConhecido) {
    const anc = _base(adv) + Math.max(-400, Math.min(400, NIV_DIF * (eu.accuracy - adv.accuracy)));
    let r = _base(eu) * (1 - NIV_ADV) + anc * NIV_ADV;
    if (eloConhecido > 0) r = r * (1 - NIV_ELO) + eloConhecido * NIV_ELO;
    return r;
  }

  function estimarPartida(w, b, ctx) {
    if (!w || !b || w.accuracy == null || b.accuracy == null || !(w.lances > 0) || !(b.lances > 0)) {
      return { white: w ? w.rating : null, black: b ? b.rating : null };
    }
    const elo = k => parseInt((ctx && ctx[k]) || '', 10) || 0;
    let rw = _um(w, b, elo('WhiteElo'));
    let rb = _um(b, w, elo('BlackElo'));
    if (w.accuracy > b.accuracy + 0.5 && rb > rw - 25) rb = rw - 25;
    if (b.accuracy > w.accuracy + 0.5 && rw > rb - 25) rw = rb - 25;
    return { white: _arred(rw), black: _arred(rb) };
  }

  // Contexto da partida aberta (cabeçalhos do PGN), para quem não tem.
  let _ctxAtual = null;
  function definirContexto(headers) { _ctxAtual = headers || null; }
  function contextoAtual() { return _ctxAtual; }

  // ══════════════════════════════════════════════════════════════
  // correlateOpponents — CONTEXTO DE CONFRONTO
  //
  // Problema que resolve: fromAccuracy avalia cada jogador isoladamente,
  // olhando só pra qualidade dos próprios lances. Isso funciona bem
  // quando os dois jogadores têm nível parecido, mas falha quando um
  // grande mestre enfrenta outro grande mestre: o VENCEDOR já recebe
  // o rating que merece (isso já está ótimo, não mexemos nisso), mas
  // o PERDEDOR pode ser jogado lá pra baixo (ex.: 1600, 2150) só
  // porque, em termos absolutos, seus lances "perderam" mais
  // centipawns contra uma defesa/ataque de outro GM — o que não
  // significa que ele jogue nesse nível.
  //
  // Regra geral pedida:
  //   • Contra oponente fraco/mediano → não faz sentido puxar nada,
  //     a avaliação isolada já é confiável (não mexe).
  //   • "Player normal" perdendo pra um GM → a faixa dele continua
  //     em torno do próprio rating (não infla só por causa do
  //     adversário ser forte).
  //   • Nível alto perdendo pra nível alto → o rating do perdedor
  //     sobe em direção ao nível da partida, MAS só se o desempenho
  //     dele não mostrar sinais reais de jogo ruim (poucos erros
  //     graves, precisão ainda alta). Se ele realmente jogou mal
  //     (tipo um 2000 jogando igual um 1000, por desatenção), o
  //     rating cai mesmo — isso é natural e deve ser preservado.
  //
  // selfStats = { accuracy, blunders, mistakes } do PRÓPRIO jogador
  // (os mesmos valores já calculados por computeStats/fromAccuracy).
  // Nunca altera o lado com rating mais alto — o vencedor/melhor
  // desempenho sempre fica com o valor que já calculou sozinho.
  // ══════════════════════════════════════════════════════════════
  function correlateOpponents(selfRating, selfStats, opponentRating) {
    if (selfRating == null || opponentRating == null) return selfRating;
    // Só o lado mais fraco na comparação pode ser puxado para cima.
    if (selfRating >= opponentRating) return selfRating;

    const gap = opponentRating - selfRating;

    // Oponente precisa ser efetivamente forte (nível Mestre+) para
    // "carregar" o nível da partida. Contra oponentes medianos, a
    // avaliação isolada de fromAccuracy já é confiável — não mexe.
    if (opponentRating < 2200) return selfRating;

    // Gap pequeno = já estão em faixas parecidas, não precisa ajustar.
    if (gap < 250) return selfRating;

    const acc       = selfStats?.accuracy  ?? 100;
    const blunders  = selfStats?.blunders  ?? 0;
    const mistakes  = selfStats?.mistakes  ?? 0;

    // Só puxa pra cima quem REALMENTE sustentou um nível de jogo alto
    // naquela partida (mesmo perdendo): precisão sólida, zero blunders e
    // no máximo um erro leve. Isso é o que separa "GM teve um jogo duro
    // contra outro GM" de "player normal perdeu pro GM jogando do jeito
    // dele" — o segundo caso não bate nesse padrão e fica com sua própria
    // faixa de rating, como pedido. Se o desempenho realmente despencou
    // (poucos acertos, blunders, vários erros), a queda é natural e não
    // deve ser corrigida — fica como está.
    const sustentouNivelAlto = acc >= 72 && blunders === 0 && mistakes <= 2;
    if (!sustentouNivelAlto) return selfRating;

    // ── Magnitude do "puxão" ──────────────────────────────────
    // Cresce com a força do oponente (mais forte = "carrega" mais
    // o nível da partida) e com o próprio desempenho (precisão alta
    // e zero blunders puxam mais forte que uma vitória "suja").
    const forcaOponente = Math.max(0, Math.min(1, (opponentRating - 2200) / 500)); // 0 em 2200 → 1 em 2700+
    const qualidadeProp = Math.max(0, Math.min(1, (acc - 72) / 23));               // 0 em 72% → 1 em 95%+

    const puxaoBase = Math.min(gap * 0.6, 550);
    const puxao = puxaoBase * (0.4 + 0.4 * forcaOponente + 0.2 * qualidadeProp);

    // Nunca ultrapassa (nem encosta) no rating do oponente — o
    // vencedor/melhor desempenho sempre fica no topo.
    const ratingAjustado = Math.min(selfRating + puxao, opponentRating - 50);
    return Math.round(ratingAjustado / 25) * 25;
  }

  // ── Texto de faixa ──────────────────────────────────────────
  function toRange(rating) {
    if (rating >= 2700) return { label: String(rating), range: 'Nível Super-GM',            emoji: '👑' };
    if (rating >= 2500) return { label: String(rating), range: 'Nível Grande Mestre',        emoji: '🏆' };
    if (rating >= 2300) return { label: String(rating), range: 'Nível Mestre Internacional', emoji: '⭐' };
    if (rating >= 2000) return { label: String(rating), range: 'Nível Mestre',               emoji: '🎓' };
    if (rating >= 1800) return { label: String(rating), range: 'Avançado',                   emoji: '🔥' };
    if (rating >= 1500) return { label: String(rating), range: 'Intermediário+',             emoji: '📈' };
    if (rating >= 1200) return { label: String(rating), range: 'Intermediário',              emoji: '📊' };
    if (rating >= 1000) return { label: String(rating), range: 'Iniciante+',                 emoji: '🌱' };
    return               { label: String(rating), range: 'Iniciante',                        emoji: '♟' };
  }

  return { fromAccuracy, estimarPartida, definirContexto, contextoAtual, toRange, correlateOpponents };
})();
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
  //   50% → 550    70% → 1000   80% → 1350   85% → 1550   90% → 1800
  //   95% → 2000   96% → 2075   97% → 2200   98% → 2450   99% → 2700
  // Ajustes:
  //   • Partida curta: poucos lances dizem menos, então o resultado fica
  //     um pouco mais perto de 1500 (com 12 lances fora do livro, 15% mais
  //     perto; a partir de 18 lances, sem ajuste).
  //   • Gafes e erros: cada gafe tira 90 pontos e cada erro 30, além do
  //     que já custaram na precisão (no máximo 3 gafes e 5 erros contam).
  // ──────────────────────────────────────────────────────────
  const CURVA = [
    [0, 300], [40, 400], [50, 550], [60, 775], [70, 1000], [75, 1175], [80, 1350],
    [85, 1550], [88, 1700], [90, 1800], [93, 1925], [95, 2000], [96, 2075], [97, 2200],
    [98, 2450], [99, 2700], [100, 2850]
  ];
  function _curva(acc) {
    for (let i = 1; i < CURVA.length; i++) {
      const [a1, r1] = CURVA[i - 1], [a2, r2] = CURVA[i];
      if (acc <= a2) return r1 + (r2 - r1) * (acc - a1) / (a2 - a1);
    }
    return CURVA[CURVA.length - 1][1];
  }

  function fromAccuracy(accuracy, nMoves, blunders, mistakes) {
    if (accuracy == null || !nMoves) return 1500;
    let r = _curva(Math.max(0, Math.min(100, accuracy)));
    const peso = Math.min(1, 0.55 + nMoves / 40);
    r = r * peso + 1500 * (1 - peso);
    r -= 90 * Math.min(blunders || 0, 3) + 30 * Math.min(mistakes || 0, 5);
    return Math.max(400, Math.min(3000, Math.round(r / 25) * 25));
  }

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
    if (rating >= 2500) return { label: String(rating), range: 'Nível Grão-Mestre',          emoji: '🏆' };
    if (rating >= 2300) return { label: String(rating), range: 'Nível Mestre Internacional', emoji: '⭐' };
    if (rating >= 2000) return { label: String(rating), range: 'Nível Mestre',               emoji: '🎓' };
    if (rating >= 1800) return { label: String(rating), range: 'Avançado',                   emoji: '🔥' };
    if (rating >= 1500) return { label: String(rating), range: 'Intermediário+',             emoji: '📈' };
    if (rating >= 1200) return { label: String(rating), range: 'Intermediário',              emoji: '📊' };
    if (rating >= 1000) return { label: String(rating), range: 'Iniciante+',                 emoji: '🌱' };
    return               { label: String(rating), range: 'Iniciante',                        emoji: '♟' };
  }

  return { fromAccuracy, toRange, correlateOpponents };
})();
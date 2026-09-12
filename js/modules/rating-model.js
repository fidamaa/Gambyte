/* ==============================================================
   MODULE: RatingModel — CPL Contextual v4
   ─────────────────────────────────────────────────────────────
   PERSPECTIVA DOS CAMPOS (armazenados pelo AnalysisEngine):
     evalBefore / bestEval  → perspectiva do jogador que move
     evalAfter              → negado ao armazenar → perspectiva do jogador
     multiPVEvals           → perspectiva do jogador (de beforeResult)
     Mates: M1=29999, -M1=-29999

   PIPELINE:
     computeStats() → acpl canônico (exibido na UI) + accuracy + rawCpls
     RatingModel.fromACPL(acpl, rawCpls, n, accuracy) → rating final
       piecewise interpolado + ajuste precisão + ajuste consistência (CV)
   ============================================================== */
const RatingModel = (() => {

  // ──────────────────────────────────────────────────────────
  // Normaliza um valor de eval: clamp de mates e extremos
  // ──────────────────────────────────────────────────────────
  function _norm(v) {
    if (v == null) return null;
    if (Math.abs(v) >= 29000) return v > 0 ? 900 : -900;
    return Math.max(-900, Math.min(900, v));
  }

  // ──────────────────────────────────────────────────────────
  // Complexidade da posição [0..1]
  // Gap pequeno top1↔top2 = muitas opções boas = difícil
  // ──────────────────────────────────────────────────────────
  function _complexidade(multiPVEvals) {
    if (!multiPVEvals || multiPVEvals.length < 2) return 0;
    const t1 = _norm(multiPVEvals[0]);
    const t2 = _norm(multiPVEvals[1]);
    if (t1 == null || t2 == null) return 0;
    const gap = Math.abs(t1 - t2);
    return Math.max(0, 1 - gap / 200);
  }

  // ──────────────────────────────────────────────────────────
  // Volatilidade local [0..1]
  // ──────────────────────────────────────────────────────────
  function _volatilidade(moves, idx) {
    const janela = moves.slice(Math.max(0, idx - 6), idx);
    const vals   = janela
      .map(m => Math.abs(_norm(m.evalBefore) ?? 0))
      .filter(v => v < 900);
    if (vals.length < 2) return 0;
    const media = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std   = Math.sqrt(vals.reduce((s, v) => s + (v - media) ** 2, 0) / vals.length);
    return Math.min(std / (media + 1), 1.0);
  }

  // ──────────────────────────────────────────────────────────
  // fromACPL — CONVERSÃO FINAL
  //
  // Curva: rating_base = a - b × ln(acpl+1)²
  // Calibrada exatamente em dois pontos âncora:
  //   ACPL 10 → 3000   (nível GM+)
  //   ACPL 80 → 700    (iniciante)
  // Comportamento verificado:
  //   ACPL  0 → ~3975  ACPL 20 → ~2400  ACPL 30 → ~1975
  //   ACPL 50 → ~1350  ACPL 70 → ~890   ACPL 90 → ~525
  //   ACPL 100+ → 400 (floor)
  //
  // Fórmula final:
  //   rating = base(acpl) + ajuste_precisao + ajuste_consistencia + performance_boost
  // ──────────────────────────────────────────────────────────
  function fromACPL(acplUI, rawCpls, n, accuracy, blunders, mistakes) {
    if (n === 0 || acplUI == null) return 1500;

    // ── 1. Parâmetros calibrados (derivados analiticamente) ───
    const K_EXP = 2;
    const B     = 2300 / (Math.log(81) ** K_EXP - Math.log(11) ** K_EXP);
    const A     = 3000 + B * Math.log(11) ** K_EXP;

    function baseCurve(acpl) {
      return Math.max(400, A - B * Math.log(acpl + 1) ** K_EXP);
    }

    // ── 2. Robustez: partidas curtas puxam para médio ─────────
    let acpl = acplUI;
    if (n < 8) {
      const fator = n / 8;
      acpl = acpl * fator + 55 * (1 - fator);
    }

    const base = baseCurve(acpl);

    // ── 3. Ajuste de precisão — leve, não dominante ───────────
    let ajustePrecisao = 0;
    if (accuracy != null) {
      if      (accuracy > 90) ajustePrecisao =  120;
      else if (accuracy > 85) ajustePrecisao =   60;
      else if (accuracy > 75) ajustePrecisao =    0;
      else if (accuracy > 70) ajustePrecisao =  -50;
      else if (accuracy > 60) ajustePrecisao = -100;
      else                    ajustePrecisao = -150;
    }

    // ── 3b. Amortecimento na faixa iniciante/intermediária (ACPL ≥ 40) ──
    // Nessa faixa o ajuste de precisão (±150) e o consistencyBoost (±150)
    // vinham somando/subtraindo demais em cima do mesmo jogo, fazendo o
    // mesmo nível real (ex.: ~800-1000 de rating "verdadeiro") sair ora
    // muito abaixo (600→450), ora muito acima (1250→1400) do esperado.
    // Reduzimos a amplitude desses dois ajustes nessa faixa para apertar
    // o desvio, sem tocar na faixa de elite (ACPL < 40), que já funciona bem.
    const FATOR_AMORTECIMENTO_FAIXA_BAIXA = 0.6;
    if (acplUI >= 40) {
      ajustePrecisao = Math.round(ajustePrecisao * FATOR_AMORTECIMENTO_FAIXA_BAIXA);
    }

    // ── 4. Ajuste de consistência (CV) — limitado a ±100 ──────
    // NÃO ALTERAR esta lógica
    let ajusteConsistencia = 0;
    if (rawCpls && rawCpls.length >= 5) {
      const media = rawCpls.reduce((a, b) => a + b, 0) / rawCpls.length;
      const std   = Math.sqrt(rawCpls.reduce((s, v) => s + (v - media) ** 2, 0) / rawCpls.length);
      const cv    = std / (media + 1);
      ajusteConsistencia = -Math.round(Math.min(cv, 1.0) * 100);
    }

    // ── 5. Performance boost — partidas de alto nível (ACPL < 40) ────────
    // Mutuamente exclusivo com consistencyBoost: só um dos dois é aplicado.
    let performanceBoost = 0;
    if (acplUI < 40) {
      // Por nível de ACPL
      if      (acplUI < 10) performanceBoost += 500;
      else if (acplUI < 15) performanceBoost += 400;
      else if (acplUI < 20) performanceBoost += 300;
      else if (acplUI < 25) performanceBoost += 200;
      else if (acplUI < 30) performanceBoost += 100;
      // Por precisão
      if (accuracy != null) {
        if      (accuracy > 92) performanceBoost += 200;
        else if (accuracy > 88) performanceBoost += 150;
        else if (accuracy > 85) performanceBoost += 100;
      }
      // Por ausência de erros graves
      const bd = blunders ?? 99;
      const mk = mistakes ?? 99;
      if      (bd === 0 && mk === 0) performanceBoost += 250;
      else if (bd === 0 && mk === 1) performanceBoost += 150;
      else if (bd === 0)             performanceBoost +=  50;

      performanceBoost = Math.min(performanceBoost, 1200);
    }

     // ── 6. Consistency boost — jogadores intermediários (ACPL 40–65) ──────
    // Ativa APENAS se fora do range elite (ACPL ≥ 40).
    // Máximo +150 — bônus moderado para não inflar jogadores de nível médio.
    let consistencyBoost = 0;
    if (acplUI >= 40 && acplUI < 65) {
      const bd2 = blunders ?? 99;
      const mk2 = mistakes ?? 99;
      const acc2 = accuracy ?? 0;

      // Cancelamento total: acc < 70 ou blunders > 1
      if (acc2 >= 70 && bd2 <= 1) {
        if      (bd2 === 0 && mk2 === 0) consistencyBoost = 150;
        else if (bd2 === 0 && mk2 <= 2)  consistencyBoost = 100;
        else if (bd2 === 0)              consistencyBoost =  50;
        else if (bd2 === 1 && mk2 <= 1)  consistencyBoost =  25;

        // Reduz pela metade se precisão apenas razoável (70–74%)
        if (acc2 < 75) consistencyBoost = Math.round(consistencyBoost * 0.5);
      }

      // Mesmo amortecimento da faixa baixa/intermediária (ver item 3b) —
      // este boost já nasce restrito a ACPL 40–65, então recebe o mesmo fator.
      consistencyBoost = Math.round(consistencyBoost * FATOR_AMORTECIMENTO_FAIXA_BAIXA);
    }

    // ── 7. Rating final ────────────────────────────────────────
    const ratingRaw = base + ajustePrecisao + ajusteConsistencia + performanceBoost + consistencyBoost;
    const rating    = Math.max(400, Math.min(3200, Math.round(ratingRaw / 25) * 25));

    console.log(
      `[RatingModel] acpl=${acplUI.toFixed(1)}cp` +
      ` base=${Math.round(base)}` +
      ` acc_adj=${ajustePrecisao}` +
      ` cv_adj=${ajusteConsistencia}` +
      ` perf=${performanceBoost}` +
      ` cons=${consistencyBoost}` +
      ` → rating=${rating}`
    );
    return rating;
  }

  // ──────────────────────────────────────────────────────────
  // fromMoves — usado apenas pelo InsightsEngine.estimateRating
  // Calcula seu próprio ACPL contextual (com complexidade/volatilidade)
  // independente do ACPL da UI (que não tem complexidade).
  // ──────────────────────────────────────────────────────────
  const ALPHA       = 0.55;
  const DECIDED_EVAL  = 500;
  const ONLY_MOVE_GAP = 450;
  const MAX_LOSS_CP   = 300;

  function _cpl(m) {
    if (m.isCheckmate) return 0;
    const best   = _norm(m.bestEval);
    const played = _norm(m.evalAfter);
    if (best == null || played == null) return null;
    return Math.max(0, Math.min(MAX_LOSS_CP, best - played));
  }

  function fromMoves(moves) {
    if (!moves || moves.length === 0) return 1500;

    const cpls    = [];
    const pesos   = [];
    const rawCpls = [];

    for (let idx = 0; idx < moves.length; idx++) {
      const m   = moves[idx];
      const cpl = _cpl(m);
      if (cpl == null) continue;
      rawCpls.push(cpl);

      const evalNorm  = Math.abs(_norm(m.evalBefore) ?? 0);
      const isMatePos = evalNorm >= 900;
      const isDecided = evalNorm >= DECIDED_EVAL && !isMatePos;
      const pesoBase  = isMatePos ? 0.05 : isDecided ? 0.25 : 1.0;

      const t1 = _norm(m.multiPVEvals?.[0]);
      const t2 = _norm(m.multiPVEvals?.[1]);
      const isOnlyMove = t1 != null && t2 != null && Math.abs(t1 - t2) >= ONLY_MOVE_GAP;
      if (isOnlyMove) {
        cpls.push(Math.min(cpl, 10) * pesoBase * 0.1);
        pesos.push(pesoBase * 0.1);
        continue;
      }

      const comp = _complexidade(m.multiPVEvals);
      const vol  = _volatilidade(moves, idx);
      const ctx  = Math.max(comp, vol * 0.6);
      const peso = pesoBase / (1 + ALPHA * ctx);

      cpls.push(cpl * peso);
      pesos.push(peso);
    }

    const pesoTotal = pesos.reduce((a, b) => a + b, 0);
    if (pesoTotal < 0.5) return fromACPL(60, rawCpls, rawCpls.length);

    const acplCtx = cpls.reduce((a, b) => a + b, 0) / pesoTotal;
    return fromACPL(acplCtx, rawCpls, rawCpls.length);
  }

  // ══════════════════════════════════════════════════════════════
  // correlateOpponents — CONTEXTO DE CONFRONTO
  //
  // Problema que resolve: fromACPL avalia cada jogador isoladamente,
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
  // (os mesmos valores já calculados por computeStats/fromACPL).
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
    // avaliação isolada de fromACPL já é confiável — não mexe.
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

  return { fromACPL, fromMoves, toRange, correlateOpponents, _norm };
})();
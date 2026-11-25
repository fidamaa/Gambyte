/* ==============================================================
   MODULE: player-dna.js
   DNA GERAL do jogador: o retrato de várias partidas analisadas.

   É um sistema à parte do "Perfil" de uma partida (InsightsEngine.dna):
   aqui nada é sobre um jogo só. Cada análise concluída deixa um resumo
   compacto (sem o PGN) guardado SOMENTE neste aparelho; a página /dna
   junta os resumos do jogador escolhido.

   O rating estimado NÃO é uma conversão de precisão em Elo. É a média
   de uma distribuição (bayesiana, numa grade de 100 a 3200) que junta:
     • o nível de cada partida pelo modelo calibrado do Gambyte
       (RatingModel.estimarPartida: precisão, equilíbrio da partida e
       adversário), calculado SEM o Elo do próprio jogador, com incerteza
       maior em partidas curtas;
     • o resultado contra o Elo do adversário, quando o PGN traz esse
       número (a mesma curva logística do Elo);
     • uma crença inicial larga (1500 ± 700), que pesa pouco depois de
       algumas partidas.
   A faixa mostrada é o intervalo de 80% dessa distribuição: ela encolhe
   com mais partidas e alarga quando o jogador é irregular.
   Depende de: move-classifier.js, insights-engine.js, rating-model.js
   (só para registrar; o cálculo usa apenas os resumos).
   ============================================================== */
const PlayerDNA = (() => {
  const KEY = 'gambyte_dna_v1';
  const KEY_EU = 'gambyte_dna_eu_v1';
  const MAX = 300;
  const MIN_PARTIDAS = 3;     // abaixo disso o rating é só preliminar

  // Contas vinculadas (Chess.com/Lichess da conta do Gambyte). Quando
  // existem, o DNA geral é das partidas dessas contas, e não de qualquer
  // partida analisada neste aparelho.
  let _contas = null, _fonte = 'ambos';
  function usarContas(contas, fonte) {
    const c = {};
    if (contas && contas.chesscom) c.chesscom = contas.chesscom;
    if (contas && contas.lichess) c.lichess = contas.lichess;
    _contas = Object.keys(c).length ? c : null;
    _fonte = fonte === 'chesscom' || fonte === 'lichess' ? fonte : 'ambos';
  }
  const fonteDe = x => x.fonte || (/lichess/i.test(x.site || '') ? 'lichess' : /chess\.com/i.test(x.site || '') ? 'chesscom' : 'manual');
  function sitesAtivos() {
    if (!_contas) return null;
    return Object.keys(_contas).filter(k => _fonte === 'ambos' || _fonte === k);
  }

  function lerTudo() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  // O que entra no DNA: com contas vinculadas, só as partidas delas.
  function ler() {
    const v = lerTudo(), sites = sitesAtivos();
    return sites ? v.filter(x => sites.includes(fonteDe(x))) : v;
  }
  function gravar(lista) {
    try { localStorage.setItem(KEY, JSON.stringify(lista.slice(0, MAX))); } catch (e) { /* cheio ou bloqueado */ }
  }
  function apagar() { try { localStorage.removeItem(KEY); } catch (e) { /* ok */ } }

  /* ── Registro de uma partida analisada ─────────────────────── */
  const CLS = ['brilliant', 'great', 'best-move', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  const _cp = v => Math.abs(v) >= 29000 ? (v > 0 ? 1500 : -1500) : Math.max(-1500, Math.min(1500, v));

  function _lado(movesData, cor, stats, nivel, elo, nome) {
    const meus = movesData.filter(m => m && m.color === cor);
    const cont = {};
    CLS.forEach(c => { cont[c] = 0; });
    meus.forEach(m => { if (cont[m.classification] != null) cont[m.classification]++; });
    // Momentos táticos: o melhor lance era bem melhor que o segundo (um
    // "lance único") e a posição ainda não estava perdida. Achou = jogou o
    // lance do motor.
    let chances = 0, achou = 0;
    meus.forEach(m => {
      const ev = m.multiPVEvals;
      if (!ev || ev.length < 2 || ev[0] == null || ev[1] == null || m.classification === 'book') return;
      const gap = _cp(ev[0]) - _cp(ev[1]);
      if (gap < 150 || _cp(ev[0]) < -300) return;
      chances++;
      if (m.bestMoveUCI && m.playedMoveUCI && m.bestMoveUCI.slice(0, 4) === m.playedMoveUCI.slice(0, 4)) achou++;
    });
    // Padrões que só fazem sentido somados entre partidas
    const graves = meus.filter(m => ['blunder', 'mistake'].includes(m.classification));
    const ultimoTerco = meus.slice(Math.floor(meus.length * 2 / 3));
    const pad = {
      vant: graves.filter(m => (m.evalBefore ?? 0) >= 150).length,      // erro grave estando melhor
      fim: graves.filter(m => ultimoTerco.includes(m)).length,           // no último terço (relógio)
      graves: graves.length,
    };
    let fases = { opening: null, midgame: null, endgame: null };
    try { fases = InsightsEngine.calcPhaseAccuracy(movesData, cor); } catch (e) { /* sem fases */ }
    return {
      nome: nome || '', elo: elo || 0,
      acc: stats.accuracy, acpl: stats.acpl, lances: stats.lances || 0, eq: stats.equilibrio || 0,
      nivel, fases, cont, tat: [chances, achou], pad,
    };
  }

  function registrar(parsedGame, movesData, meta) {
    if (!parsedGame || !movesData || !movesData.length || typeof MoveClassifier === 'undefined') return;
    if (!movesData.some(m => m && m.evalAfter != null)) return;
    const h = parsedGame.headers || {};
    const wS = MoveClassifier.computeStats(movesData, true);
    const bS = MoveClassifier.computeStats(movesData, false);
    if (!(wS.lances > 0) || !(bS.lances > 0)) return;
    const n = k => parseInt(h[k] || '', 10) || 0;
    // Nível de cada lado SEM o Elo do próprio jogador (só o do adversário entra).
    const semW = Object.assign({}, h); delete semW.WhiteElo;
    const semB = Object.assign({}, h); delete semB.BlackElo;
    let nW = null, nB = null;
    try { nW = RatingModel.estimarPartida(wS, bS, semW).white; nB = RatingModel.estimarPartida(wS, bS, semB).black; } catch (e) { /* sem nível */ }
    const chave = parsedGame.moves.join(' ');
    // Abertura pelo livro ECO e o lance em que a partida saiu dele
    let ab = null;
    try { ab = OpeningDetector.detect(parsedGame.moves); } catch (e) { /* sem livro */ }
    const iSaida = movesData.findIndex(m => m && !m.isBook);
    const saida = iSaida >= 0 ? { ply: iSaida, cor: iSaida % 2 === 0 ? 'w' : 'b', san: parsedGame.moves[iSaida] } : null;
    // PGN enxuto (sem comentários nem relógio) para reabrir a análise depois
    const cab = ['Event', 'Site', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl']
      .filter(k => h[k]).map(k => `[${k} "${String(h[k]).replace(/"/g, "'")}"]`).join(String.fromCharCode(10));
    const corpo = parsedGame.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m).join(' ');
    const pgnCurto = parsedGame.startFEN ? '' : cab + String.fromCharCode(10, 10) + corpo + ' ' + (h.Result || '*');
    const abertura = ((document.getElementById('opening-name') || {}).textContent || '').replace(/Detectando.*|Fora de livro|Posição inicial/, '').trim();
    const item = {
      v: 1, id: Date.now(), quando: new Date().toISOString(),
      fonte: (meta && meta.fonte) || undefined, gameId: (meta && meta.gameId) || undefined,
      data: (h.UTCDate || h.Date || '').replace(/\?/g, '').replace(/\.+$/, ''),
      res: h.Result || '*', ritmo: h.TimeControl || '', site: h.Site || '', abertura,
      eco: ab ? ab.eco : '', abNome: ab ? ab.name : '', abVar: ab ? ab.variation : '',
      inicio: parsedGame.moves.slice(0, 24), saida, pgn: pgnCurto.slice(0, 6000),
      plies: parsedGame.moves.length, chave: chave.slice(0, 600),
      w: _lado(movesData, 'white', wS, nW, n('WhiteElo'), h.White),
      b: _lado(movesData, 'black', bS, nB, n('BlackElo'), h.Black),
    };
    if (!item.fonte) item.fonte = fonteDe(item);
    const lista = lerTudo().filter(x => x.chave !== item.chave && !(item.gameId && x.gameId === item.gameId));
    lista.unshift(item);
    // mais recentes primeiro pela data da partida (a sincronização chega fora de ordem)
    lista.sort((a, b) => (Date.parse((b.data || '').replace(/\./g, '-')) || b.id) - (Date.parse((a.data || '').replace(/\./g, '-')) || a.id));
    gravar(lista);
  }

  /* ── Quem é "você" ─────────────────────────────────────────── */
  const norm = s => String(s || '').trim().toLowerCase();
  function nomesDisponiveis(lista) {
    const c = new Map();
    (lista || ler()).forEach(x => ['w', 'b'].forEach(k => {
      const nm = (x[k] && x[k].nome || '').trim();
      if (!nm || /^(brancas|pretas|\?)$/i.test(nm)) return;
      const key = norm(nm);
      const atual = c.get(key) || { nome: nm, partidas: 0 };
      atual.partidas++; c.set(key, atual);
    }));
    return Array.from(c.values()).sort((a, b) => b.partidas - a.partidas);
  }
  function meusNomes() {
    // Com contas vinculadas, "você" são os usuários delas.
    const sites = sitesAtivos();
    if (sites) return sites.map(k => _contas[k]);
    try { const v = JSON.parse(localStorage.getItem(KEY_EU) || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) { /* ok */ }
    // Padrão: o último usuário buscado + "Você" (partidas contra o bot); se
    // nenhum aparece, o nome mais frequente.
    const disp = nomesDisponiveis();
    const set = new Set(disp.map(d => norm(d.nome)));
    const out = [];
    try { const u = JSON.parse(localStorage.getItem('gambyte_import_v1') || '{}').usuario; if (u && set.has(norm(u))) out.push(u); } catch (e) { /* ok */ }
    if (set.has('você')) out.push('Você');
    if (!out.length && disp.length) out.push(disp[0].nome);
    return out;
  }
  function definirMeusNomes(nomes) { try { localStorage.setItem(KEY_EU, JSON.stringify(nomes || [])); } catch (e) { /* ok */ } }

  /* ── Estatística ───────────────────────────────────────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const media = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  function desvio(a) {
    if (a.length < 2) return null;
    const m = media(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  }
  // Precisão de uma fase → nota 0–100 (40% vira 0, 100% vira 100).
  const notaPrec = acc => acc == null ? null : clamp(Math.round((acc - 40) / 0.6), 0, 100);

  // Minhas partidas: cada uma vira { eu, adv, cor, pontos, ... }
  function partidasDe(nomes, lista) {
    const quero = new Set((nomes || []).map(norm));
    const out = [];
    (lista || ler()).forEach(x => {
      let cor = null;
      if (quero.has(norm(x.w && x.w.nome))) cor = 'w';
      else if (quero.has(norm(x.b && x.b.nome))) cor = 'b';
      if (!cor) return;
      const eu = x[cor], adv = x[cor === 'w' ? 'b' : 'w'];
      const r = x.res;
      const pontos = r === '1/2-1/2' ? 0.5 : r === '1-0' ? (cor === 'w' ? 1 : 0) : r === '0-1' ? (cor === 'b' ? 1 : 0) : null;
      const quando = Date.parse((x.data || '').replace(/\./g, '-')) || Date.parse(x.quando) || x.id;
      out.push({ id: x.id, quando, cor, eu, adv, pontos, abertura: x.abNome || x.abertura, variante: x.abVar || '', eco: x.eco || '',
        ritmo: x.ritmo, plies: x.plies, inicio: x.inicio || null, saida: x.saida || null, temPgn: !!x.pgn, res: x.res });
    });
    return out.sort((a, b) => a.quando - b.quando);
  }

  // Distribuição do rating numa grade (100…3200 de 10 em 10).
  function rating(partidas) {
    const G = []; for (let r = 100; r <= 3200; r += 10) G.push(r);
    const logp = G.map(r => -0.5 * Math.pow((r - 1500) / 700, 2));
    let usados = 0, comResultado = 0;
    partidas.forEach(p => {
      const q = p.eu && p.eu.nivel;
      if (q > 0) {
        usados++;
        const sig = clamp(330 * Math.sqrt(18 / Math.max(8, p.eu.lances || 8)), 300, 620);
        for (let i = 0; i < G.length; i++) logp[i] += -0.5 * Math.pow((G[i] - q) / sig, 2);
      }
      // Resultado contra o adversário: Elo do PGN (peso cheio) ou, sem ele,
      // o nível estimado do adversário (peso menor, porque é estimativa).
      if (p.pontos != null) {
        const oppElo = p.adv && p.adv.elo > 0 ? p.adv.elo : 0;
        const opp = oppElo || (p.adv && p.adv.nivel) || 0;
        if (opp > 0) {
          comResultado++;
          const peso = oppElo ? 1 : 0.45;
          for (let i = 0; i < G.length; i++) {
            const E = 1 / (1 + Math.pow(10, (opp - G[i]) / 400));
            logp[i] += peso * (p.pontos * Math.log(Math.max(1e-9, E)) + (1 - p.pontos) * Math.log(Math.max(1e-9, 1 - E)));
          }
        }
      }
    });
    const mx = Math.max(...logp);
    const pr = logp.map(l => Math.exp(l - mx));
    const tot = pr.reduce((s, x) => s + x, 0);
    let acc = 0, p10 = null, p90 = null, m = 0;
    for (let i = 0; i < G.length; i++) {
      const w = pr[i] / tot; m += w * G[i]; acc += w;
      if (p10 == null && acc >= 0.10) p10 = G[i];
      if (p90 == null && acc >= 0.90) p90 = G[i];
    }
    // Piso de incerteza do próprio modelo (nenhuma estimativa é exata).
    const arr = v => Math.round(v / 25) * 25;
    const meio = arr(m);
    let lo = arr(p10), hi = arr(p90);
    if (meio - lo < 75) lo = meio - 75;
    if (hi - meio < 75) hi = meio + 75;
    return { valor: meio, min: Math.max(100, lo), max: hi, usados, comResultado, curva: G.map((r, i) => [r, pr[i] / tot]) };
  }

  function calcular(nomes, lista) {
    const ps = partidasDe(nomes, lista);
    const n = ps.length;
    const res = { n, partidas: ps, suficiente: n >= MIN_PARTIDAS, minimo: MIN_PARTIDAS };
    if (!n) return res;

    const lances = ps.reduce((s, p) => s + (p.eu.lances || 0), 0) || 1;
    const accs = ps.map(p => p.eu.acc).filter(v => v != null);
    res.precisao = media(accs);
    res.precisaoUlt = media(ps.slice(-10).map(p => p.eu.acc).filter(v => v != null));
    res.desvioPrec = desvio(accs);

    // Fases: média das partidas em que a fase existiu
    const fase = (k, lista2) => media(lista2.map(p => p.eu.fases && p.eu.fases[k]).filter(v => v != null));
    res.fases = { opening: fase('opening', ps), midgame: fase('midgame', ps), endgame: fase('endgame', ps) };
    res.fasesN = {
      opening: ps.filter(p => p.eu.fases && p.eu.fases.opening != null).length,
      midgame: ps.filter(p => p.eu.fases && p.eu.fases.midgame != null).length,
      endgame: ps.filter(p => p.eu.fases && p.eu.fases.endgame != null).length,
    };

    // Erros por 40 lances (fora do livro)
    const soma = k => ps.reduce((s, p) => s + ((p.eu.cont && p.eu.cont[k]) || 0), 0);
    const por40 = k => soma(k) * 40 / lances;
    res.erros = { blunder: por40('blunder'), mistake: por40('mistake'), miss: por40('miss'), inaccuracy: por40('inaccuracy') };
    res.bons = { brilliant: soma('brilliant'), great: soma('great') };

    // Tática: momentos de lance único encontrados, descontando chances perdidas
    const ch = ps.reduce((s, p) => s + ((p.eu.tat && p.eu.tat[0]) || 0), 0);
    const ac = ps.reduce((s, p) => s + ((p.eu.tat && p.eu.tat[1]) || 0), 0);
    res.tatica = { chances: ch, achou: ac, pct: ch ? ac / ch : null };

    // Resultados
    const comRes = ps.filter(p => p.pontos != null);
    res.pontos = comRes.length ? comRes.reduce((s, p) => s + p.pontos, 0) / comRes.length : null;
    res.vde = { v: comRes.filter(p => p.pontos === 1).length, e: comRes.filter(p => p.pontos === 0.5).length, d: comRes.filter(p => p.pontos === 0).length };

    // Elo informado nos PGNs (só referência; não entra direto no rating)
    const elos = ps.map(p => p.eu.elo).filter(v => v > 0);
    res.eloPgn = elos.length ? { media: Math.round(media(elos)), n: elos.length } : null;

    res.rating = rating(ps);
    res.rating.preliminar = n < MIN_PARTIDAS;

    // Radar (0–100)
    const segur = clamp(Math.round(100 - 22 * res.erros.blunder - 8 * res.erros.mistake - 6 * res.erros.miss - 2 * res.erros.inaccuracy), 0, 100);
    const tat = res.tatica.pct == null ? null
      : clamp(Math.round(res.tatica.pct * 100 - 6 * res.erros.miss + Math.min(8, (res.bons.brilliant + res.bons.great) * 40 / lances * 4)), 0, 100);
    const cons = res.desvioPrec == null || n < MIN_PARTIDAS ? null : clamp(Math.round(100 - 3.2 * res.desvioPrec - 10 * Math.max(0, res.erros.blunder - 0.5)), 0, 100);
    res.radar = [
      { k: 'abertura', nome: 'Abertura', o: 'Como você joga os primeiros lances depois da teoria.', como: 'Precisão média na fase de abertura (até o lance 10, com quase todas as peças), convertida para 0 a 100: 40% vira 0 e 100% vira 100.', v: notaPrec(res.fases.opening), info: `Precisão média nos lances de abertura: ${fmtPct(res.fases.opening)} em ${res.fasesN.opening} ${plural(res.fasesN.opening, 'partida', 'partidas')}.` },
      { k: 'meio', nome: 'Meio-jogo', o: 'A fase com mais peças e mais decisões.', como: 'Precisão média no meio-jogo, na mesma escala de 0 a 100.', v: notaPrec(res.fases.midgame), info: `Precisão média no meio-jogo: ${fmtPct(res.fases.midgame)} em ${res.fasesN.midgame} ${plural(res.fasesN.midgame, 'partida', 'partidas')}.` },
      { k: 'final', nome: 'Finais', o: 'Como você conduz posições com poucas peças.', como: 'Precisão média nos finais (6 peças ou menos), na mesma escala.', v: notaPrec(res.fases.endgame), info: res.fasesN.endgame ? `Precisão média nos finais: ${fmtPct(res.fases.endgame)} em ${res.fasesN.endgame} ${plural(res.fasesN.endgame, 'partida', 'partidas')}.` : 'Nenhuma partida analisada chegou ao final (poucas peças no tabuleiro).' },
      { k: 'tatica', nome: 'Tática', o: 'Se você acha o lance certo quando só um lance resolve.', como: 'Porcentagem de momentos de lance único (o melhor lance era bem melhor que o segundo) em que você jogou o lance do motor; chances perdidas descontam.', v: tat, info: res.tatica.chances ? `Achou o lance único em ${res.tatica.achou} de ${res.tatica.chances} momentos táticos; ${num(res.erros.miss)} chances perdidas a cada 40 lances.` : 'Ainda não houve momentos de lance único suficientes para medir.' },
      { k: 'consistencia', nome: 'Consistência', o: 'Se o seu nível se repete de uma partida para outra.', como: 'Parte de 100 e desconta a variação da precisão entre partidas e o excesso de gafes.', v: cons, info: cons == null ? `Precisa de pelo menos ${MIN_PARTIDAS} partidas.` : `A precisão varia ${num(res.desvioPrec)} pontos de uma partida para outra (quanto menos, mais regular).` },
      { k: 'seguranca', nome: 'Segurança', o: 'O quanto você evita entregar a partida.', como: 'Parte de 100 e desconta gafes, erros, chances perdidas e imprecisões a cada 40 lances.', v: segur, info: `A cada 40 lances: ${num(res.erros.blunder)} gafes, ${num(res.erros.mistake)} erros e ${num(res.erros.inaccuracy)} imprecisões.` },
    ];

    // Evolução: média móvel de 5 partidas da precisão e do nível de cada partida
    res.evolucao = ps.map((p, i) => {
      const jan = ps.slice(Math.max(0, i - 4), i + 1);
      return {
        i, quando: p.quando, acc: p.eu.acc, nivel: p.eu.nivel,
        accMedia: media(jan.map(x => x.eu.acc).filter(v => v != null)),
        nivelMedia: media(jan.map(x => x.eu.nivel).filter(v => v > 0)),
        rotulo: `${p.cor === 'w' ? p.eu.nome + ' x ' + p.adv.nome : p.adv.nome + ' x ' + p.eu.nome}`,
        pontos: p.pontos,
      };
    });

    // Aberturas mais jogadas
    const ab = new Map();
    ps.forEach(p => {
      const nm = (p.abertura || '').trim(); if (!nm) return;
      const a = ab.get(nm) || { nome: nm, n: 0, pts: 0, nPts: 0, acc: [] };
      a.n++; if (p.pontos != null) { a.pts += p.pontos; a.nPts++; }
      if (p.eu.fases && p.eu.fases.opening != null) a.acc.push(p.eu.fases.opening);
      ab.set(nm, a);
    });
    res.aberturas = Array.from(ab.values()).sort((a, b) => b.n - a.n).slice(0, 6)
      .map(a => ({ nome: a.nome, n: a.n, pontos: a.nPts ? a.pts / a.nPts : null, acc: media(a.acc) }));
    return res;
  }

  function num(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ','); }
  function fmtPct(v) { return v == null ? '—' : num(v) + '%'; }
  function plural(n, um, varios) { return n === 1 ? um : varios; }

  function pgnDe(id) { const x = lerTudo().find(e => String(e.id) === String(id)); return x ? x.pgn || '' : ''; }
  // Ids das partidas das contas já guardadas (a sincronização não repete)
  function idsGuardados() { return new Set(lerTudo().map(x => x.gameId).filter(Boolean)); }

  // Rating estimado depois de cada partida (para a curva de evolução)
  function evolucaoRating(partidas) {
    return partidas.map((p, i) => { const r = rating(partidas.slice(0, i + 1)); return { i, quando: p.quando, valor: r.valor, min: r.min, max: r.max }; });
  }

  // Ritmo pelo TimeControl do PGN ("180+2" → blitz)
  function ritmoDe(tc) {
    const m = String(tc || '').match(/^([0-9]+)(?:[+]([0-9]+))?/);
    if (!m) return '';
    const t = +m[1] + 40 * (+m[2] || 0);
    return t < 180 ? 'bullet' : t < 480 ? 'blitz' : t < 1500 ? 'rápida' : 'clássica';
  }

  return { registrar, ler, lerTudo, usarContas, sitesAtivos, fonteDe, idsGuardados, apagar, calcular, nomesDisponiveis, meusNomes, definirMeusNomes, rating, evolucaoRating, partidasDe, pgnDe, ritmoDe, MIN_PARTIDAS, num, fmtPct };
})();

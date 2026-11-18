/* ==============================================================
   MODULE: game-import.js
   Importa partidas sem copiar o PGN à mão, usando as APIs públicas
   oficiais (chamadas direto do navegador do visitante):
     - Lichess: link da partida  → /game/export/{id}
                nome de usuário  → /api/games/user/{nome}
     - Chess.com: nome de usuário → /pub/player/{nome}/games/{ano}/{mês}
   O Chess.com não oferece busca de partida só pelo link para outros
   sites; para um link de lá, o visitante informa o usuário.

   Extras:
     - Quem tem conta e vinculou Chess.com/Lichess na página da conta
       ganha botões com o próprio usuário (um clique lista as partidas).
     - Cada partida da lista recebe uma PRÉVIA rápida (profundidade 10,
       uma linha do motor): precisão e nível estimado de cada lado, com
       as mesmas fórmulas do cartão do jogador. A prévia para assim que
       uma análise de verdade começa, para não disputar o motor.
   Depende de: pgn-parser, move-classifier, rating-model, opening-detector,
               analysis-engine, stockfish-manager, auth-system, insights-ui
   ============================================================== */
const GameImport = (() => {
  const KEY = 'gambyte_import_v1';
  const SCAN_KEY = 'gambyte_scan_v2';   // v2: precisão e nível na escala nova
  const SCAN_DEPTH = 10;
  let site = 'chesscom';
  let usuario = '';   // usuário da última busca, para escolher o lado
  let jogos = [];
  let scanToken = 0;  // muda para cancelar a prévia em andamento
  let scanAtivo = false;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => String(v).replace('.', ',') + '%';
  const RITMO = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', daily: 'Correspondência', classical: 'Clássica', correspondence: 'Correspondência', ultraBullet: 'Ultrabullet' };
  const NOME_SITE = { chesscom: 'Chess.com', lichess: 'Lichess' };

  function lembrar() {
    try { localStorage.setItem(KEY, JSON.stringify({ site, usuario })); } catch (e) { /* sem armazenamento */ }
  }
  function status(msg, tipo = '') {
    const el = $('imp-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'imp-status' + (tipo ? ' ' + tipo : '');
  }
  function setSite(s) {
    site = s === 'lichess' ? 'lichess' : 'chesscom';
    document.querySelectorAll('[data-imp-site]').forEach(b => {
      const on = b.dataset.impSite === site;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const campo = $('imp-input');
    if (campo) campo.placeholder = site === 'lichess' ? 'Usuário ou link da partida no Lichess' : 'Usuário do Chess.com';
  }

  async function getResp(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 404) throw new Error('nao-encontrado');
    if (r.status === 429) throw new Error('limite');
    if (!r.ok) throw new Error('http-' + r.status);
    return r;
  }

  /* ── Chess.com ─────────────────────────────────────────────── */
  async function buscarChessCom(nome) {
    const base = `https://api.chess.com/pub/player/${encodeURIComponent(nome.toLowerCase())}`;
    const arq = await (await getResp(`${base}/games/archives`)).json();
    const meses = (arq.archives || []).slice(-2).reverse();
    let lista = [];
    for (const url of meses) {
      const dados = await (await getResp(url)).json();
      lista = lista.concat(dados.games || []);
      if (lista.length >= 20) break;
    }
    return lista
      .filter(g => g.rules === 'chess' && g.pgn)
      .sort((a, b) => (b.end_time || 0) - (a.end_time || 0))
      .slice(0, 24)
      .map(g => ({
        id: g.url || g.uuid || g.pgn.slice(0, 80),
        pgn: g.pgn,
        quando: (g.end_time || 0) * 1000,
        brancas: g.white?.username, eloB: g.white?.rating,
        pretas: g.black?.username, eloP: g.black?.rating,
        resultado: (g.pgn.match(/\[Result "([^"]+)"\]/) || [])[1] || '*',
        ritmo: RITMO[g.time_class] || g.time_class || '',
      }));
  }

  /* ── Lichess ───────────────────────────────────────────────── */
  async function buscarLichess(nome) {
    const r = await getResp(`https://lichess.org/api/games/user/${encodeURIComponent(nome)}?max=24&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&pgnInJson=true&clocks=false&evals=false&opening=false`,
      { headers: { Accept: 'application/x-ndjson' } });
    const texto = await r.text();
    return texto.split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(g => g.variant === 'standard' && g.pgn)
      .map(g => ({
        id: 'lichess:' + g.id,
        pgn: g.pgn,
        quando: g.lastMoveAt || g.createdAt || 0,
        brancas: g.players?.white?.user?.name || 'Anônimo', eloB: g.players?.white?.rating,
        pretas: g.players?.black?.user?.name || 'Anônimo', eloP: g.players?.black?.rating,
        resultado: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : (g.status === 'draw' || g.status === 'stalemate') ? '1/2-1/2' : '*',
        ritmo: RITMO[g.speed] || g.speed || '',
      }));
  }
  async function partidaLichess(id) {
    const r = await getResp(`https://lichess.org/game/export/${id}?clocks=false&evals=false`, { headers: { Accept: 'application/x-chess-pgn' } });
    return r.text();
  }

  /* ── Prévia rápida de cada partida ─────────────────────────── */
  function lerCacheScan() {
    try { return JSON.parse(localStorage.getItem(SCAN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function gravarCacheScan(id, r) {
    try {
      const c = lerCacheScan();
      c[id] = r;
      const chaves = Object.keys(c);
      if (chaves.length > 150) for (const k of chaves.slice(0, chaves.length - 150)) delete c[k];
      localStorage.setItem(SCAN_KEY, JSON.stringify(c));
    } catch (e) { /* armazenamento cheio ou bloqueado */ }
  }

  /**
   * Avalia cada posição da partida a uma profundidade baixa e devolve a
   * precisão e o nível estimado dos dois lados, com as mesmas funções do
   * cartão do jogador (MoveClassifier.computeStats / RatingModel).
   * Retorna null se a prévia foi cancelada no meio.
   */
  async function previa(pgn, token) {
    const g = PGNParser.parsePGN(pgn);
    const n = g.moves.length;
    if (n < 4) return null;
    const pos = [...g.fensBefore, g.fensAfter[n - 1]];
    const res = [];
    for (let i = 0; i < pos.length; i++) {
      if (token !== scanToken) return null;
      res.push(await StockfishManager.analyzePosition(pos[i], SCAN_DEPTH, 1));
    }
    if (token !== scanToken) return null;
    OpeningDetector.build();
    let fora = false;
    const md = [];
    for (let i = 0; i < n; i++) {
      const e0 = res[i].evals[0] ?? 0, e1 = res[i + 1].evals[0] ?? 0;
      const evalBefore = e0, bestEval = e0, evalAfter = -e1;
      if (!fora && !OpeningDetector.isBookPosition(g.fensAfter[i])) fora = true;
      const sq = g.moveSquares[i] || {};
      const isCheckmate = /#/.test(g.moves[i]);
      const opMate = res[i + 1].mateNs ? res[i + 1].mateNs[0] : null;
      const m = { index: i, color: i % 2 === 0 ? 'white' : 'black', evalBefore, evalAfter: isCheckmate ? 29999 : evalAfter, bestEval, isBook: !fora, isCheckmate, multiPVEvals: null };
      m.classification = !fora ? 'book' : MoveClassifier.classify({
        san: g.moves[i], evalBefore, evalAfter: m.evalAfter, bestEval,
        bestMoveUCI: res[i].bestMove, playedMoveUCI: sq.from && sq.to ? sq.from + sq.to : null,
        multiPVEvals: null, isBook: false, isWhite: m.color === 'white', moveIndex: i,
        isStalemate: false, isCheckmate,
        immediateCaptureValue: AnalysisEngine.computeImmediateCaptureValue(g.fensAfter[i], res[i + 1].bestMove),
        sacrificeValue: 0, pieceIsHanging: false, sacrificeIsRecapturable: false,
        mateForMover: res[i].mateNs ? res[i].mateNs[0] : null,
        opponentGetsMate: opMate != null && opMate > 0,
        depth: SCAN_DEPTH,
      });
      md.push(m);
    }
    const w = MoveClassifier.computeStats(md, true), b = MoveClassifier.computeStats(md, false);
    return {
      accB: w.accuracy, accP: b.accuracy,
      nivB: RatingModel.estimarPartida(w, b, g.headers).white,
      nivP: RatingModel.estimarPartida(w, b, g.headers).black,
    };
  }

  function pararPrevia() { scanToken++; scanAtivo = false; atualizarCabecalho(); }

  async function rodarPrevia() {
    const token = ++scanToken;
    const cache = lerCacheScan();
    for (const j of jogos) if (!j.scan && cache[j.id]) j.scan = cache[j.id];
    render();
    // espera o motor terminar de carregar (primeira visita baixa ~100 MB)
    for (let t = 0; t < 120 && !StockfishManager.isReady(); t++) {
      if (token !== scanToken) return;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!StockfishManager.isReady() || token !== scanToken) return;
    scanAtivo = true; atualizarCabecalho();
    for (let i = 0; i < jogos.length; i++) {
      if (token !== scanToken) return;
      const j = jogos[i];
      if (j.scan) continue;
      marcarLinha(i, 'scanning');
      let r = null;
      try { r = await previa(j.pgn, token); } catch (e) { r = null; }
      if (token !== scanToken) { marcarLinha(i, ''); return; }
      if (r) { j.scan = r; gravarCacheScan(j.id, r); }
      atualizarLinha(i);
    }
    scanAtivo = false; atualizarCabecalho();
  }

  /* ── Lista de partidas ─────────────────────────────────────── */
  function scanHTML(j, cor) {
    if (!j.scan) return `<span class="imp-scan pending" aria-hidden="true"></span>`;
    const acc = cor === 'white' ? j.scan.accB : j.scan.accP;
    const niv = cor === 'white' ? j.scan.nivB : j.scan.nivP;
    return `<span class="imp-scan" title="Prévia: precisão e nível estimado nesta partida"><b>${pct(acc)}</b><small><span class="imp-lbl">nível </span>${niv}</small></span>`;
  }
  function linhaHTML(g, i) {
    const eu = usuario.toLowerCase();
    const d = new Date(g.quando);
    const data = isNaN(d) || !g.quando ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const lado = (g.brancas || '').toLowerCase() === eu ? 'white' : (g.pretas || '').toLowerCase() === eu ? 'black' : '';
    const venceu = lado && ((lado === 'white' && g.resultado === '1-0') || (lado === 'black' && g.resultado === '0-1'));
    const perdeu = lado && ((lado === 'white' && g.resultado === '0-1') || (lado === 'black' && g.resultado === '1-0'));
    const res = !lado ? g.resultado : venceu ? 'Vitória' : perdeu ? 'Derrota' : g.resultado === '1/2-1/2' ? 'Empate' : '—';
    const cls = venceu ? 'win' : perdeu ? 'loss' : 'draw';
    const jogador = (cor, nome, elo) => `<span class="imp-pl${lado === cor ? ' is-me' : ''}"><i class="ins-side ins-side-${cor}"></i><span class="imp-pl-name">${esc(nome)}${elo ? ` <small>${elo}</small>` : ''}</span>${scanHTML(g, cor)}</span>`;
    return `<button type="button" class="imp-game" data-imp-game="${i}" id="imp-game-${i}">
        <span class="imp-g-date">${data}<small>${esc(g.ritmo)}</small></span>
        <span class="imp-g-players">${jogador('white', g.brancas, g.eloB)}${jogador('black', g.pretas, g.eloP)}</span>
        <span class="imp-g-res ${lado ? cls : ''}">${esc(res)}</span>
      </button>`;
  }
  function atualizarLinha(i) {
    const el = $(`imp-game-${i}`);
    if (!el) return;
    el.outerHTML = linhaHTML(jogos[i], i);
  }
  function marcarLinha(i, estado) {
    $(`imp-game-${i}`)?.classList.toggle('scanning', estado === 'scanning');
  }
  function atualizarCabecalho() {
    const h = $('imp-list-head');
    if (!h) return;
    if (!jogos.length) { h.hidden = true; return; }
    h.hidden = false;
    const feitos = jogos.filter(j => j.scan).length;
    const txt = h.querySelector('.imp-lh-text');
    const btn = h.querySelector('[data-imp-scan]');
    if (txt) txt.textContent = scanAtivo
      ? `Calculando a prévia (profundidade ${SCAN_DEPTH}): ${feitos} de ${jogos.length} partidas.`
      : feitos === jogos.length
        ? 'Prévia rápida: precisão e nível estimado de cada lado. Abra a partida para a análise completa.'
        : `Prévia rápida pausada: ${feitos} de ${jogos.length} partidas calculadas.`;
    if (btn) btn.hidden = scanAtivo || feitos === jogos.length;
  }
  function render() {
    const box = $('imp-list');
    if (!box) return;
    if (!jogos.length) { box.hidden = true; box.innerHTML = ''; atualizarCabecalho(); return; }
    box.hidden = false;
    box.innerHTML = jogos.map(linhaHTML).join('');
    atualizarCabecalho();
  }

  function carregar(pgn, ladoDe) {
    const campo = $('pgn-input');
    if (!campo || !pgn) return;
    pararPrevia();
    campo.value = pgn.trim();
    // Abre o painel do lado de quem importou, se essa pessoa jogou a partida.
    if (ladoDe && typeof InsightsUI !== 'undefined') {
      const w = (pgn.match(/\[White "([^"]+)"\]/) || [])[1] || '';
      const b = (pgn.match(/\[Black "([^"]+)"\]/) || [])[1] || '';
      const eu = ladoDe.toLowerCase();
      if (w.toLowerCase() === eu) InsightsUI.setPov('white');
      else if (b.toLowerCase() === eu) InsightsUI.setPov('black');
    }
    // Chama a análise direto: durante uma análise o botão fica desativado,
    // e um clique nele não faria nada. App.run interrompe a anterior.
    if (typeof App !== 'undefined' && App.run) App.run();
    else $('btn-analyze')?.click();
    $('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function erro(e, onde) {
    const m = String(e && e.message || e);
    if (m === 'nao-encontrado') status(onde === 'partida' ? 'Partida não encontrada. Confira o link.' : 'Usuário não encontrado. Confira a grafia.', 'error');
    else if (m === 'limite') status('O site de origem pediu uma pausa nas buscas. Tente de novo em um minuto.', 'error');
    else status('Não foi possível buscar agora. Verifique a conexão ou cole o PGN manualmente.', 'error');
  }

  async function buscar() {
    const campo = $('imp-input');
    const valor = (campo?.value || '').trim().replace(/^@/, '');
    if (!valor) { status('Digite um usuário ou cole o link de uma partida.', 'error'); campo?.focus(); return; }
    pararPrevia();
    jogos = []; render();

    // Link do Lichess: carrega a partida direto
    const li = valor.match(/lichess\.org\/(?:embed\/(?:game\/)?)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#]|$)/);
    if (li) {
      setSite('lichess');
      status('Buscando a partida no Lichess…');
      try { const pgn = await partidaLichess(li[1]); status('Partida carregada. Analisando…', 'ok'); carregar(pgn, usuario); }
      catch (e) { erro(e, 'partida'); }
      return;
    }
    // Link do Chess.com: não há busca pública pelo link
    if (/chess\.com\//i.test(valor)) {
      setSite('chesscom');
      status('O Chess.com não permite buscar uma partida só pelo link. Digite o usuário do Chess.com: a partida aparece na lista.', 'error');
      campo.value = ''; campo.focus();
      return;
    }
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(valor)) { status('Esse nome de usuário não parece válido.', 'error'); return; }

    usuario = valor; lembrar();
    status(`Buscando as últimas partidas de ${valor} no ${NOME_SITE[site]}…`);
    const btn = $('imp-btn'); if (btn) btn.disabled = true;
    try {
      const todas = site === 'lichess' ? await buscarLichess(valor) : await buscarChessCom(valor);
      // Partidas abandonadas antes de começar (0 a 5 lances) não têm o que analisar.
      const comLances = todas.filter(j => { try { return PGNParser.parsePGN(j.pgn).moves.length >= 6; } catch (e) { return false; } });
      jogos = comLances.slice(0, 12);
      const curtas = todas.length - comLances.length;
      const aviso = curtas ? ` ${curtas === 1 ? '1 partida curta demais foi ocultada' : curtas + ' partidas curtas demais foram ocultadas'} (abandonadas antes do sexto lance).` : '';
      if (!jogos.length) status('Nenhuma partida de xadrez padrão com lances suficientes nos últimos meses.' + aviso, 'error');
      else status(`${jogos.length} partidas recentes de ${valor}. Escolha uma para a análise completa.${aviso}`, 'ok');
      render();
      if (jogos.length) rodarPrevia();
    } catch (e) { erro(e, 'usuario'); }
    finally { if (btn) btn.disabled = false; }
  }

  function buscarComo(s, nome) {
    setSite(s);
    const campo = $('imp-input');
    if (campo) campo.value = nome;
    lembrar();
    buscar();
  }

  /* ── Atalhos das contas vinculadas ─────────────────────────── */
  function renderAtalhos(sess) {
    const box = $('imp-mine');
    if (!box) return;
    const linked = (sess && sess.linked) || {};
    const btns = ['chesscom', 'lichess'].filter(s => linked[s])
      .map(s => `<button type="button" class="imp-mine-btn" data-imp-mine="${s}" data-nome="${esc(linked[s])}"><span>${NOME_SITE[s]}</span><b>${esc(linked[s])}</b></button>`);
    if (btns.length) {
      box.innerHTML = `<span class="imp-mine-label">Suas contas</span>${btns.join('')}`;
    } else if (sess) {
      box.innerHTML = `<span class="imp-mine-hint">Vincule seu usuário do Chess.com ou do Lichess <a href="gambyte-login.html">na sua conta</a> para listar suas partidas com um clique.</span>`;
    } else {
      box.innerHTML = `<span class="imp-mine-hint"><a href="gambyte-login.html">Crie uma conta grátis</a> e vincule seu usuário para listar suas partidas com um clique.</span>`;
    }
    box.hidden = false;
  }

  /* ── Abas da caixa "Analisar uma partida" ─────────────────── */
  const KEY_ABA = 'gambyte_trazer_v1';
  function mostrarAba(qual, lembrarAba) {
    const caixa = $('trazer');
    if (!caixa) return;
    caixa.querySelectorAll('[data-trazer]').forEach(b => {
      const on = b.dataset.trazer === qual;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    caixa.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== qual; });
    if (lembrarAba) { try { localStorage.setItem(KEY_ABA, qual); } catch (e) { /* sem armazenamento */ } }
  }
  function initAbas() {
    const caixa = $('trazer');
    if (!caixa) return;
    // No celular, colar o PGN é o caminho mais rápido: abre nessa aba
    // (a não ser que a pessoa já tenha escolhido outra).
    const celular = window.matchMedia && matchMedia('(max-width:760px)').matches;
    let aba = celular ? 'pgn' : 'importar';
    try { const a = localStorage.getItem(KEY_ABA); if (a === 'pgn' || a === 'foto' || (celular && a === 'importar')) aba = a; } catch (e) { /* sem armazenamento */ }
    mostrarAba(aba);
    caixa.querySelector('.trazer-tabs')?.addEventListener('click', e => {
      const b = e.target.closest('[data-trazer]');
      if (!b) return;
      mostrarAba(b.dataset.trazer, true);
      if (b.dataset.trazer === 'pgn') $('pgn-input')?.focus();
      else if (b.dataset.trazer === 'importar') $('imp-input')?.focus();
    });
    // Atalhos do cartão "Resumo da partida" (antes da primeira análise)
    document.addEventListener('click', e => {
      const ir = e.target.closest('[data-ir-trazer]');
      if (!ir) return;
      e.preventDefault();
      mostrarAba(ir.dataset.irTrazer, true);
      caixa.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const alvo = $(ir.dataset.irTrazer === 'pgn' ? 'pgn-input' : 'imp-input');
      if (alvo) setTimeout(() => alvo.focus({ preventScroll: true }), 350);
    });
  }

  function init() {
    initAbas();
    const box = $('import-box');
    if (!box) return;
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (s.site) site = s.site;
      if (s.usuario) { usuario = s.usuario; const c = $('imp-input'); if (c) c.value = s.usuario; }
    } catch (e) { /* sem armazenamento */ }
    setSite(site);
    box.addEventListener('click', e => {
      const s = e.target.closest('[data-imp-site]');
      if (s) { setSite(s.dataset.impSite); lembrar(); return; }
      if (e.target.closest('#imp-btn')) { buscar(); return; }
      const mine = e.target.closest('[data-imp-mine]');
      if (mine) { buscarComo(mine.dataset.impMine, mine.dataset.nome); return; }
      if (e.target.closest('[data-imp-scan]')) { rodarPrevia(); return; }
      const g = e.target.closest('[data-imp-game]');
      if (g) { const jogo = jogos[+g.dataset.impGame]; if (jogo) { status('Partida aberta no tabuleiro. Escolha outra quando quiser.', 'ok'); carregar(jogo.pgn, usuario); } }
    });
    $('imp-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
    // Uma análise de verdade tem prioridade: a prévia para na hora.
    $('btn-analyze')?.addEventListener('click', () => { if (scanAtivo) pararPrevia(); }, true);

    let primeira = true;
    AuthSystem.onChange(sess => {
      renderAtalhos(sess);
      // index.html?importar=chesscom|lichess (vindo da página da conta)
      if (primeira && AuthSystem.isReady()) {
        primeira = false;
        const pedido = new URLSearchParams(location.search).get('importar');
        const nome = sess && sess.linked && sess.linked[pedido];
        if (nome) { mostrarAba('importar'); buscarComo(pedido, nome); $('trazer')?.scrollIntoView({ block: 'start' }); }
      }
    });
  }

  return { init, pararPrevia, renderAtalhos, mostrarAba };
})();

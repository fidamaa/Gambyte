/* Jogar contra o bot: escolha de nível e cor, a partida no tabuleiro e o
   envio do PGN para a análise completa no fim.
   Depende de: pgn-parser.js, board-ui.js, arrow-system.js,
               stockfish-manager.js, free-play.js (regras), bot-engine.js */
(function () {
  const $ = id => document.getElementById(id);
  const R = FreePlay.regras;
  const INICIAL = PGNParser.INITIAL_FEN;
  const NOMES = { 400: 'Iniciante', 800: 'Iniciante+', 1200: 'Intermediário', 1500: 'Intermediário+', 1800: 'Avançado', 2200: 'Mestre', 2500: 'Grão-mestre' };
  const DESC = {
    400: 'Erra muito e entrega peças com frequência. Para quem está aprendendo a mexer as peças.',
    800: 'Já desenvolve as peças, mas ainda deixa material solto e não vê muitas ameaças.',
    1200: 'Joga lances razoáveis, mas comete erros táticos de vez em quando.',
    1500: 'Sólido na maior parte da partida; os erros ficam mais raros e mais sutis.',
    1800: 'Bom cálculo e poucos erros graves. Exige plano para ganhar.',
    2200: 'Nível de mestre: pune quase toda imprecisão.',
    2500: 'O motor sem limite de força. Ganhar é para muito poucos.'
  };
  const nomeNivel = n => (n >= 2500 ? '2500+' : String(n));
  const guardar = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };
  const ler = (k, onde) => { try { return JSON.parse((onde || sessionStorage).getItem(k) || 'null'); } catch (e) { return null; } };
  const CHAVE_PARTIDA = 'gambyte_bot_partida', CHAVE_PREF = 'gambyte_bot_pref';

  // ── Estado ────────────────────────────────────────────────────
  let pref = ler(CHAVE_PREF, localStorage) || {};
  let nivel = BotEngine.NIVEIS.includes(pref.nivel) ? pref.nivel : 1200;
  let corPedida = ['w', 'b', 'x'].includes(pref.cor) ? pref.cor : 'w';

  let jogo = null;      // { nivel, cor, lances: [uci], sans: [san], fens: [fen], fim, voltas }
  let vez = 0;          // invalida respostas do bot de um momento anterior
  let pensando = false;
  let selecionada = null, alvos = [];
  let empateEspera = 0; // meios-lances até poder oferecer empate de novo
  let motorPronto = false;
  const motor = StockfishManager.init({ soRapido: true }).then(() => { motorPronto = true; mostrarMotor(); })
    .catch(() => { $('jg-motor').textContent = 'Não foi possível carregar o motor. Recarregue a página.'; });

  function mostrarMotor() {
    const el = $('jg-motor');
    if (el) el.textContent = motorPronto ? 'Motor pronto: Stockfish 18 no seu aparelho.' : 'Carregando o motor (7 MB)…';
  }

  // ── Tabuleiro ─────────────────────────────────────────────────
  function tamanho() {
    const caixa = document.querySelector('.jg-tab');
    const largura = caixa && caixa.clientWidth ? caixa.clientWidth : Math.min(innerWidth - 32, 560);
    const disp = Math.max(200, largura - (innerWidth > 760 ? 20 : 14));
    // No computador, o tabuleiro inteiro (com a faixa de baixo) cabe na tela
    // durante a partida; antes dela, o texto de cima pode empurrar um pouco.
    let altura = 9999;
    if (innerWidth > 760) {
      const topo = jogo && caixa ? caixa.getBoundingClientRect().top + scrollY : 190;
      altura = Math.max(320, innerHeight - Math.min(topo, 240) - 70);
    }
    return Math.floor(Math.min(600, disp, altura) / 8) * 8;
  }
  function montarTabuleiro() {
    const cv = $('board-canvas');
    BoardUI.init(cv, tamanho());
    ArrowSystem.init($('arrow-canvas'), cv, BoardUI.sqSize);
    ArrowSystem.setShowEngine(false);
    desenhar();
  }
  const fenAtual = () => (jogo ? jogo.fens[jogo.fens.length - 1] : INICIAL);
  function tabuleiro8(fen) {
    return fen.split(' ')[0].split('/').map(l => {
      const out = [];
      for (const ch of l) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(''); else out.push(ch); }
      return out;
    });
  }
  function ultimo() {
    const u = jogo && jogo.lances[jogo.lances.length - 1];
    return u ? [u.slice(0, 2), u.slice(2, 4)] : [null, null];
  }
  function desenhar(anim, reverso) {
    const [de, para] = ultimo();
    const b = tabuleiro8(fenAtual());
    if (anim) BoardUI.renderWithAnim(b, anim[0], anim[1], selecionada, alvos, { hlFrom: de, hlTo: para, semMover: !!anim[2], reverso: !!reverso });
    else BoardUI.render(b, de, para, selecionada, alvos);
    ArrowSystem.redraw();
  }

  // ── Partida ───────────────────────────────────────────────────
  const corDaVez = () => fenAtual().split(' ')[1];
  const vezDoJogador = () => jogo && !jogo.fim && !pensando && corDaVez() === jogo.cor;

  function novaPartida(restaurar) {
    vez++;
    pensando = false;
    selecionada = null; alvos = [];
    empateEspera = 0;
    if (restaurar) jogo = restaurar;
    else {
      const cor = corPedida === 'x' ? (Math.random() < 0.5 ? 'w' : 'b') : corPedida;
      jogo = { nivel, cor, lances: [], sans: [], fens: [INICIAL], fim: null, voltas: 0 };
    }
    BoardUI.setFlipped(jogo.cor === 'b');
    $('jg-config').hidden = true;
    $('jg-partida').hidden = false;
    $('jg-nome-bot').textContent = 'Bot do Gambyte · ' + nomeNivel(jogo.nivel);
    $('jg-nivel-bot').textContent = NOMES[jogo.nivel] + (jogo.cor === 'w' ? ' · pretas' : ' · brancas');
    $('jg-cor-voce').textContent = jogo.cor === 'w' ? 'Brancas' : 'Pretas';
    document.body.classList.add('jg-jogando');
    montarTabuleiro();
    atualizar();
    if (jogo.fim) mostrarFim();
    else if (corDaVez() !== jogo.cor) lanceDoBot();
  }

  function aplicar(uci) {
    const fen = fenAtual();
    const st = PGNParser.fenToBoard(fen);
    const novo = PGNParser.applyMoveUCI(st, uci);
    if (!novo) return false;
    jogo.sans.push(PGNParser.uciToSan(st, uci) || uci);
    jogo.lances.push(uci);
    jogo.fens.push(PGNParser.boardToFen(novo));
    if (empateEspera > 0) empateEspera--;
    const fim = R.status(fenAtual(), jogo.fens);
    if (fim) {
      if (fim.type === 'checkmate') terminar(fim.winner === 'white' ? 'w' : 'b', 'Xeque-mate');
      else terminar(null, R.rotulo(fim).replace(/^Empate — /, '').replace(/^./, c => c.toUpperCase()));
    }
    salvar();
    return true;
  }

  function terminar(vencedor, motivo) {
    jogo.fim = { vencedor, motivo };
    pensando = false;
    salvar();
    mostrarFim();
  }

  function mostrarFim() {
    const f = jogo.fim;
    const t = f.vencedor == null ? 'Empate' : f.vencedor === jogo.cor ? 'Você venceu!' : 'O bot venceu';
    $('jg-fim-titulo').textContent = t;
    $('jg-fim-motivo').textContent = f.motivo + (jogo.voltas ? ` · ${jogo.voltas} lance${jogo.voltas > 1 ? 's' : ''} desfeito${jogo.voltas > 1 ? 's' : ''}` : '');
    $('jg-fim').hidden = false;
    $('jg-fim').dataset.resultado = f.vencedor == null ? 'empate' : f.vencedor === jogo.cor ? 'vitoria' : 'derrota';
    atualizar();
    $('jg-analisar').focus({ preventScroll: true });
  }

  function salvar() {
    if (!jogo) return;
    guardar(CHAVE_PARTIDA, { nivel: jogo.nivel, cor: jogo.cor, lances: jogo.lances, fim: jogo.fim, voltas: jogo.voltas });
  }

  function restaurarSalva() {
    const s = ler(CHAVE_PARTIDA);
    if (!s || !Array.isArray(s.lances) || !BotEngine.NIVEIS.includes(s.nivel) || !s.lances.length) return false;
    const j = { nivel: s.nivel, cor: s.cor === 'b' ? 'b' : 'w', lances: [], sans: [], fens: [INICIAL], fim: s.fim || null, voltas: s.voltas || 0 };
    for (const u of s.lances) {
      const st = PGNParser.fenToBoard(j.fens[j.fens.length - 1]);
      const novo = st && PGNParser.applyMoveUCI(st, u);
      if (!novo) return false;
      j.sans.push(PGNParser.uciToSan(st, u) || u); j.lances.push(u); j.fens.push(PGNParser.boardToFen(novo));
    }
    novaPartida(j);
    return true;
  }

  // ── Bot ───────────────────────────────────────────────────────
  async function lanceDoBot() {
    const minha = ++vez;
    pensando = true;
    atualizar();
    const t0 = performance.now();
    if (!motorPronto) { $('jg-status').textContent = 'Carregando o motor…'; await motor; }
    if (minha !== vez) return;
    atualizar();
    let r = null;
    try { r = await BotEngine.escolher({ inicio: INICIAL, lances: jogo.lances.slice(), nivel: jogo.nivel }); } catch (e) { console.error('[Bot]', e); }
    if (minha !== vez) return;
    // "Pensar": de 0,5 a 2 s no total (lance único, mais rápido).
    const alvo = r && r.tipo === 'unico' ? 450 : 500 + Math.random() * 1500;
    const falta = alvo - (performance.now() - t0);
    if (falta > 0) await new Promise(ok => setTimeout(ok, falta));
    if (minha !== vez) return;
    pensando = false;
    const legais = R.lancesLegais(fenAtual());
    const uci = r && legais.includes(r.uci) ? r.uci : legais[Math.floor(Math.random() * legais.length)];
    if (!uci) { atualizar(); return; }
    aplicar(uci);
    desenhar([uci.slice(0, 2), uci.slice(2, 4)]);
    atualizar();
  }

  // ── Lance do jogador ──────────────────────────────────────────
  function destinoReal(de, para) {
    const lista = R.alvos(fenAtual(), de);
    if (lista.includes(para)) return para;
    // Roque levando o rei até a própria torre, como nos grandes sites.
    const st = PGNParser.fenToBoard(fenAtual());
    const p = c => st.board[8 - +c[1]][c.charCodeAt(0) - 97];
    const fila = st.turn === 'w' ? '1' : '8', rei = p(de), torre = p(para);
    if ((rei === 'K' || rei === 'k') && de === 'e' + fila && torre === (rei === 'K' ? 'R' : 'r') && para[1] === fila) {
      const r = para[0] === 'h' ? 'g' + fila : para[0] === 'a' ? 'c' + fila : null;
      if (r && lista.includes(r)) return r;
    }
    return null;
  }
  function movivel(sq) {
    if (!vezDoJogador() || !sq) return false;
    return R.alvos(fenAtual(), sq).length > 0;
  }
  function selecionar(sq) {
    selecionada = sq; alvos = R.alvos(fenAtual(), sq);
    desenhar();
  }
  function soltarSelecao() { if (!selecionada) return; selecionada = null; alvos = []; desenhar(); }
  function tentar(de, para, animar) {
    if (!vezDoJogador()) return false;
    const destino = destinoReal(de, para);
    if (!destino) return false;
    const st = PGNParser.fenToBoard(fenAtual());
    const peca = st.board[8 - +de[1]][de.charCodeAt(0) - 97];
    const promo = (peca === 'P' && destino[1] === '8') || (peca === 'p' && destino[1] === '1');
    const uci = de + destino + (promo ? 'q' : '');
    selecionada = null; alvos = [];
    if (!aplicar(uci)) { desenhar(); return false; }
    desenhar([de, destino, !animar]);
    atualizar();
    if (!jogo.fim) lanceDoBot();
    return true;
  }

  function ligarPonteiro() {
    const cv = $('board-canvas'), wrap = $('board-wrapper');
    const ghost = document.createElement('img');
    ghost.className = 'drag-ghost'; ghost.alt = ''; ghost.hidden = true;
    wrap.appendChild(ghost);
    let press = null;
    const sqAt = e => { const r = cv.getBoundingClientRect(); return BoardUI.xyToSq(e.clientX - r.left, e.clientY - r.top); };
    const pecaEm = sq => { const st = PGNParser.fenToBoard(fenAtual()); return st.board[8 - +sq[1]][sq.charCodeAt(0) - 97]; };
    const moverFantasma = e => {
      const r = wrap.getBoundingClientRect();
      const sz = BoardUI.sqSize() * (press && press.touch ? 1.35 : 1);
      const sobe = press && press.touch ? sz * 0.45 : 0;
      ghost.style.width = ghost.style.height = sz + 'px';
      ghost.style.transform = 'translate(' + (e.clientX - r.left - sz / 2) + 'px,' + (e.clientY - r.top - sz / 2 - sobe) + 'px)';
    };
    cv.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0], r = cv.getBoundingClientRect();
      const sq = BoardUI.xyToSq(t.clientX - r.left, t.clientY - r.top);
      if (sq && (movivel(sq) || (selecionada && destinoReal(selecionada, sq))) && e.cancelable) e.preventDefault();
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ArrowSystem.clearManual();
      const sq = sqAt(e);
      if (!sq || !vezDoJogador()) return;
      e.preventDefault();
      if (selecionada && destinoReal(selecionada, sq)) { tentar(selecionada, sq, true); press = null; return; }
      if (movivel(sq)) {
        const ja = selecionada === sq;
        if (!ja) selecionar(sq);
        press = { sq, x: e.clientX, y: e.clientY, id: e.pointerId, ja, arrastando: false, touch: e.pointerType !== 'mouse' };
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
      } else { soltarSelecao(); press = null; }
    });
    cv.addEventListener('pointermove', e => {
      if (!press || e.pointerId !== press.id) {
        if (e.pointerType !== 'mouse') return;
        const sq = sqAt(e);
        cv.style.cursor = sq && movivel(sq) ? 'grab' : sq && alvos.includes(sq) ? 'pointer' : 'default';
        return;
      }
      if (!press.arrastando) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < (press.touch ? 6 : 4)) return;
        press.arrastando = true;
        ghost.src = BoardUI.pieceSrc(pecaEm(press.sq));
        ghost.hidden = false;
        cv.style.cursor = 'grabbing';
        BoardUI.setDrag(press.sq);
      }
      moverFantasma(e);
      BoardUI.setHover(sqAt(e));
    });
    const soltar = (e, cancelar) => {
      if (!press || e.pointerId !== press.id) return;
      const p = press; press = null;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
      if (p.arrastando) {
        ghost.hidden = true;
        BoardUI.setHover(null); BoardUI.setDrag(null);
        cv.style.cursor = 'grab';
        const para = cancelar ? null : sqAt(e);
        if (para && para !== p.sq && tentar(p.sq, para, false)) return;
        desenhar();
      } else if (p.ja) soltarSelecao();
    };
    cv.addEventListener('pointerup', e => soltar(e, false));
    cv.addEventListener('pointercancel', e => soltar(e, true));
  }

  // ── Botões da partida ─────────────────────────────────────────
  function voltar() {
    if (!jogo || jogo.fim) return;
    // Desfaz até a última vez em que era a vez do jogador (o lance do bot e o seu).
    // Vez do jogador: desfaz a resposta do bot e o lance dele. Vez do bot
    // (ainda pensando): só o lance do jogador.
    let n = corDaVez() === jogo.cor ? 2 : 1;
    n = Math.min(n, jogo.lances.length);
    // Jogando de pretas, o primeiro lance do bot não se desfaz.
    if (jogo.cor === 'b' && jogo.lances.length - n < 1) n = jogo.lances.length - 1;
    if (n <= 0) return;
    vez++; pensando = false;
    const desfeito = jogo.lances[jogo.lances.length - 1];
    jogo.lances.length -= n; jogo.sans.length -= n; jogo.fens.length -= n;
    jogo.voltas++;
    selecionada = null; alvos = [];
    salvar();
    if (n === 1 && desfeito) desenhar([desfeito.slice(0, 2), desfeito.slice(2, 4)], true);
    else desenhar();
    atualizar();
    if (corDaVez() !== jogo.cor) lanceDoBot();
  }

  async function oferecerEmpate() {
    if (!vezDoJogador() || empateEspera > 0) return;
    const minha = ++vez;
    pensando = true;
    atualizar('Você ofereceu empate. O bot está pensando…');
    const botCor = jogo.cor === 'w' ? 'b' : 'w';
    const cp = await BotEngine.avaliar({ inicio: INICIAL, lances: jogo.lances.slice(), cor: botCor });
    await new Promise(ok => setTimeout(ok, 600));
    if (minha !== vez) return;
    pensando = false;
    // Aceita com a posição igual ou pior para ele.
    if (cp != null && cp <= 50) { terminar(null, 'Empate aceito pelo bot'); return; }
    empateEspera = 6;
    atualizar();
    aviso('O bot recusou o empate. Tente de novo daqui a alguns lances.');
  }

  let desistirTimer = null;
  function desistir() {
    if (!jogo || jogo.fim) return;
    const b = $('jg-desistir');
    if (!b.classList.contains('confirmar')) {
      b.classList.add('confirmar');
      b.querySelector('span').textContent = 'Confirmar desistência';
      clearTimeout(desistirTimer);
      desistirTimer = setTimeout(() => { b.classList.remove('confirmar'); b.querySelector('span').textContent = 'Desistir'; }, 3500);
      return;
    }
    clearTimeout(desistirTimer);
    b.classList.remove('confirmar'); b.querySelector('span').textContent = 'Desistir';
    vez++;
    terminar(jogo.cor === 'w' ? 'b' : 'w', 'Você desistiu');
  }

  // ── PGN e análise ─────────────────────────────────────────────
  function pgn() {
    const d = new Date();
    const data = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const bot = `Bot do Gambyte (${nomeNivel(jogo.nivel)})`;
    const f = jogo.fim;
    const res = !f ? '*' : f.vencedor == null ? '1/2-1/2' : f.vencedor === 'w' ? '1-0' : '0-1';
    const h = [
      ['Event', 'Partida contra o bot do Gambyte'], ['Site', 'gambyte.com.br'], ['Date', data],
      ['White', jogo.cor === 'w' ? 'Você' : bot], ['Black', jogo.cor === 'b' ? 'Você' : bot], ['Result', res],
      [jogo.cor === 'w' ? 'BlackElo' : 'WhiteElo', String(jogo.nivel)]
    ];
    if (f) h.push(['Termination', f.motivo]);
    let txt = h.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n';
    jogo.sans.forEach((s, i) => { txt += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s + ' '; });
    return txt + res;
  }
  function analisar() {
    if (!jogo || !jogo.lances.length) { aviso('A partida ainda não tem lances para analisar.'); return; }
    try { sessionStorage.setItem('gambyte_pgn_analisar', pgn()); } catch (e) { /* sem armazenamento */ }
    location.href = '/?analisar=bot';
  }

  // ── Tela ──────────────────────────────────────────────────────
  function aviso(msg) {
    const box = $('toast-container');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast info';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  function atualizar(msg) {
    if (!jogo) return;
    const status = $('jg-status');
    const xeque = !jogo.fim && PGNParser.isInCheck(PGNParser.fenToBoard(fenAtual()).board, corDaVez() === 'w');
    status.textContent = msg || (jogo.fim ? 'Partida encerrada'
      : pensando ? (motorPronto ? 'O bot está pensando…' : 'Carregando o motor…')
      : xeque ? 'Sua vez: você está em xeque!' : 'Sua vez');
    status.dataset.estado = jogo.fim ? 'fim' : pensando ? 'bot' : 'voce';
    $('jg-pensa').hidden = !pensando || !!jogo.fim;
    const lista = $('jg-lances');
    let html = '';
    for (let i = 0; i < jogo.sans.length; i += 2) {
      html += `<li><span class="jg-n">${i / 2 + 1}.</span><span>${jogo.sans[i]}</span><span>${jogo.sans[i + 1] || ''}</span></li>`;
    }
    lista.innerHTML = html || '<li class="jg-vazio">' + (jogo.cor === 'w' ? 'Faça o primeiro lance.' : 'O bot começa.') + '</li>';
    lista.scrollTop = lista.scrollHeight;
    const fim = !!jogo.fim;
    $('jg-acoes').hidden = fim;
    $('jg-fim').hidden = !fim;
    const minimo = jogo.cor === 'b' ? 1 : 0;
    $('jg-voltar').disabled = fim || jogo.lances.length <= minimo;
    $('jg-empate').disabled = fim || !vezDoJogador() || empateEspera > 0 || jogo.lances.length < 2;
    $('jg-desistir').disabled = fim;
  }

  function mostrarConfig() {
    vez++; pensando = false;
    try { sessionStorage.removeItem(CHAVE_PARTIDA); } catch (e) { /* ok */ }
    jogo = null;
    document.body.classList.remove('jg-jogando');
    $('jg-config').hidden = false;
    $('jg-partida').hidden = true;
    $('jg-pensa').hidden = true;
    $('jg-nome-bot').textContent = 'Bot do Gambyte';
    $('jg-nivel-bot').textContent = 'Escolha o nível e a cor';
    $('jg-cor-voce').textContent = '—';
    BoardUI.setFlipped(corPedida === 'b');
    montarTabuleiro();
    marcarEscolhas();
  }

  function marcarEscolhas() {
    for (const b of document.querySelectorAll('[data-nivel]')) b.setAttribute('aria-checked', String(+b.dataset.nivel === nivel));
    for (const b of document.querySelectorAll('[data-cor]')) b.setAttribute('aria-checked', String(b.dataset.cor === corPedida));
    $('jg-desc').textContent = DESC[nivel];
  }
  function guardarPref() { try { localStorage.setItem(CHAVE_PREF, JSON.stringify({ nivel, cor: corPedida })); } catch (e) { /* ok */ } }

  // Setas do teclado nos grupos de escolha (radiogroup).
  function teclasGrupo(grupo, attr, aoEscolher) {
    grupo.addEventListener('keydown', e => {
      const bs = [...grupo.querySelectorAll(`[${attr}]`)];
      const i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const b = bs[(i + d + bs.length) % bs.length];
      b.focus(); aoEscolher(b);
    });
  }

  function iniciar() {
    const niveis = document.querySelector('.jg-niveis'), cores = document.querySelector('.jg-cores');
    const porNivel = b => { nivel = +b.dataset.nivel; guardarPref(); marcarEscolhas(); };
    const porCor = b => { corPedida = b.dataset.cor; guardarPref(); marcarEscolhas(); if (!jogo) { BoardUI.setFlipped(corPedida === 'b'); desenhar(); } };
    niveis.addEventListener('click', e => { const b = e.target.closest('[data-nivel]'); if (b) porNivel(b); });
    cores.addEventListener('click', e => { const b = e.target.closest('[data-cor]'); if (b) porCor(b); });
    teclasGrupo(niveis, 'data-nivel', porNivel);
    teclasGrupo(cores, 'data-cor', porCor);
    $('jg-comecar').addEventListener('click', () => {
      novaPartida();
      if (innerWidth <= 760) document.querySelector('.jg-mesa').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('jg-voltar').addEventListener('click', voltar);
    $('jg-empate').addEventListener('click', oferecerEmpate);
    $('jg-desistir').addEventListener('click', desistir);
    $('jg-analisar').addEventListener('click', analisar);
    $('jg-revanche').addEventListener('click', () => novaPartida());
    $('jg-mudar').addEventListener('click', mostrarConfig);
    ligarPonteiro();
    // Largura da coluna mudou (janela, fontes carregando): refaz o tabuleiro.
    let t, largura = 0;
    const refazer = () => { clearTimeout(t); t = setTimeout(montarTabuleiro, 120); };
    addEventListener('resize', refazer);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(es => { const w = Math.round(es[0].contentRect.width); if (w !== largura) { largura = w; refazer(); } })
        .observe(document.querySelector('.jg-tab'));
    }
    mostrarMotor();
    if (!restaurarSalva()) mostrarConfig();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

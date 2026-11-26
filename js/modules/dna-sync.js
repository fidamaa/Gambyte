/* ==============================================================
   MODULE: dna-sync.js
   O DNA geral vem das partidas das CONTAS VINCULADAS (Chess.com e/ou
   Lichess, vinculadas na conta do Gambyte), não de qualquer partida
   analisada no site.

   - Busca as partidas mais recentes de cada conta vinculada.
   - Tudo o que ainda não está no DNA entra numa fila (guardada no
     aparelho, para continuar de onde parou).
   - Analisa uma partida por vez, com vários motores rápidos em paralelo
     (um por núcleo livre, até 3; 2 no celular), com a mesma análise da
     página inicial (motor rápido, profundidade 16) e registra o resumo
     no DNA (PlayerDNA.registrar, com a fonte e o id da partida).
   - Toda vez que a página abre, procura partidas novas.

   Depende de: auth-system.js, game-import.js (busca), pgn-parser.js,
   stockfish-manager.js, analysis-engine.js, player-dna.js
   ============================================================== */
const DNASync = (() => {
  const KEY_FILA = 'gambyte_dna_fila_v1';
  const KEY_FONTE = 'gambyte_dna_fonte_v1';
  const KEY_DESCARTE = 'gambyte_dna_descartes_v1';   // ids que não dá para analisar
  const POR_CONTA = 12;                                // partidas mais recentes de cada conta (igual à lista de importar)

  const ouvintes = [];
  let estado = { fase: 'parado', feitas: 0, total: 0, atual: null, erro: null };
  let rodando = false, motorPronto = null, parar = false;

  function avisar(mud) { Object.assign(estado, mud || {}); ouvintes.forEach(f => { try { f(estado); } catch (e) { /* ok */ } }); }
  function onChange(f) { ouvintes.push(f); f(estado); }

  const lerJSON = (k, pad) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? pad : v; } catch (e) { return pad; } };
  const gravarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* cheio */ } };

  function contas() {
    // Só no servidor local: ?contas=lichess:usuario,chesscom:usuario simula
    // contas vinculadas para testar sem login. Não vale no site publicado.
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      const m = location.search.match(/[?&]contas=([^&]+)/);
      if (m) { const c = {}; decodeURIComponent(m[1]).split(',').forEach(p => { const [k, v] = p.split(':'); if ((k === 'lichess' || k === 'chesscom') && /^[A-Za-z0-9_-]{2,30}$/.test(v || '')) c[k] = v; }); return c; }
    }
    try { const s = AuthSystem.currentSession(); const l = (s && s.linked) || {}; const c = {}; if (l.chesscom) c.chesscom = l.chesscom; if (l.lichess) c.lichess = l.lichess; return c; }
    catch (e) { return {}; }
  }
  function fonte() { return lerJSON(KEY_FONTE, 'ambos'); }
  function definirFonte(f) { gravarJSON(KEY_FONTE, f); }
  function fila() { return lerJSON(KEY_FILA, []); }

  // 1. Procura partidas novas das contas vinculadas
  async function buscarNovas() {
    const cs = contas();
    if (!Object.keys(cs).length) return 0;
    avisar({ fase: 'buscando', erro: null });
    const guardadas = PlayerDNA.idsGuardados();
    const descartes = new Set(lerJSON(KEY_DESCARTE, []));
    const atual = fila();
    const naFila = new Set(atual.map(x => x.id));
    let novas = 0;
    const buscou = new Set(), recentes = new Set();
    for (const site of Object.keys(cs)) {
      try {
        const lista = site === 'lichess' ? await GameImport.buscarLichess(cs[site], POR_CONTA) : await GameImport.buscarChessCom(cs[site], POR_CONTA, 4);
        buscou.add(site);
        for (const j of lista.slice(0, POR_CONTA)) {
          recentes.add(j.id);
          if (guardadas.has(j.id) || naFila.has(j.id) || descartes.has(j.id)) continue;
          atual.push({ id: j.id, site, pgn: j.pgn, quando: j.quando || 0 });
          naFila.add(j.id); novas++;
        }
      } catch (e) {
        avisar({ erro: `Não deu para buscar as partidas do ${site === 'lichess' ? 'Lichess' : 'Chess.com'} agora.` });
      }
    }
    // Na fila, só as mais recentes de cada conta (sai o que ficou de buscas antigas).
    const fila2 = atual.filter(x => !buscou.has(x.site) || recentes.has(x.id));
    fila2.sort((a, b) => (b.quando || 0) - (a.quando || 0));   // as mais recentes primeiro
    gravarJSON(KEY_FILA, fila2);
    return novas;
  }

  // 2. Analisa a fila, uma partida por vez
  function analisar(parsed) {
    return new Promise((ok, erro) => {
      let feito = false;
      AnalysisEngine.setCallbacks({ onProgress() {}, onMoveUpdate() {}, onComplete(todos) { feito = true; ok(todos); } });
      // se a análise for interrompida, termina sem onComplete: não fica preso
      AnalysisEngine.analyze(parsed).then(() => { if (!feito) erro(new Error('interrompida')); }, erro);
    });
  }
  async function processar() {
    if (rodando) return;
    rodando = true; parar = false;
    let q = fila();
    const total = q.length;
    let feitas = 0;
    avisar({ fase: q.length ? 'preparando' : 'em-dia', feitas: 0, total });
    if (q.length) {
      try {
        // Vários motores rápidos em paralelo: as posições de cada passada já
        // entram todas na fila, então cada núcleo livre adianta uma. No
        // celular no máximo 2, para não esquentar.
        const nucleos = navigator.hardwareConcurrency || 2;
        const celular = matchMedia('(hover: none) and (pointer: coarse)').matches;
        const motores = Math.min(celular ? 2 : 3, Math.max(1, nucleos - 1));
        if (!motorPronto) motorPronto = StockfishManager.init({ soRapido: true, motores });
        await motorPronto;
      } catch (e) {
        motorPronto = null;   // o "Continuar" tenta de novo, em vez de repetir o mesmo erro
        rodando = false; avisar({ fase: 'parado', erro: 'Não foi possível carregar o motor de análise. Toque em Continuar para tentar de novo.' }); return;
      }
    }
    while (!parar && (q = fila()).length) {
      const item = q[0];
      avisar({ fase: 'analisando', atual: item, feitas, total: Math.max(total, feitas + q.length) });
      let ok = false, descartar = false;
      try {
        const parsed = PGNParser.parsePGN(item.pgn);
        if (parsed.moves.length >= 6) {
          const moves = await analisar(parsed);
          PlayerDNA.registrar(parsed, moves, { fonte: item.site, gameId: item.id });
          ok = true;
        } else descartar = true;   // curta demais: não entra no DNA
      } catch (e) {
        console.warn('[DNA] partida não analisada', item.id, e);
        // Falha do motor pode ser passageira: a partida vai para o fim da
        // fila e só é descartada depois de 3 tentativas.
        item.tentativas = (item.tentativas || 0) + 1;
        descartar = item.tentativas >= 3;
      }
      if (descartar) gravarJSON(KEY_DESCARTE, lerJSON(KEY_DESCARTE, []).concat(item.id).slice(-500));
      const resto = fila().filter(x => x.id !== item.id);
      if (!ok && !descartar) resto.push(item);
      gravarJSON(KEY_FILA, resto);
      if (!ok && !descartar) {   // motor falhou: para aqui e espera o Continuar
        rodando = false;
        avisar({ fase: 'parado', atual: null, erro: 'A análise travou nesta partida. Toque em Continuar para tentar de novo.' });
        return;
      }
      feitas++;
      avisar({ feitas, nova: ok ? item : null });
    }
    rodando = false;
    avisar({ fase: fila().length ? 'parado' : 'em-dia', atual: null });
  }

  // Abre a página: procura partidas novas e analisa o que faltar.
  async function sincronizar() {
    if (!Object.keys(contas()).length) { avisar({ fase: 'sem-conta' }); return; }
    await buscarNovas();
    await processar();
  }
  function pausar() { parar = true; try { AnalysisEngine.abort(); } catch (e) { /* ok */ } }

  return { contas, fonte, definirFonte, fila, sincronizar, pausar, onChange, estado: () => estado };
})();

/* ==============================================================
   MODULE: game-import.js
   Importa partidas sem copiar o PGN à mão, usando as APIs públicas
   oficiais (chamadas direto do navegador do visitante):
     - Lichess: link da partida  → /game/export/{id}
                nome de usuário  → /api/games/user/{nome}
     - Chess.com: nome de usuário → /pub/player/{nome}/games/{ano}/{mês}
   O Chess.com não oferece busca de partida só pelo link para outros
   sites; para um link de lá, o visitante informa o usuário e a lista
   mostra a partida.
   Ao escolher uma partida, o PGN vai para o campo e a análise começa.
   Se o usuário informado jogou a partida, o painel já abre do lado dele.
   Depende de: auth-ui.js (avisos), insights-ui.js (lado do jogador)
   ============================================================== */
const GameImport = (() => {
  const KEY = 'gambyte_import_v1';
  let site = 'chesscom';
  let usuario = '';   // usuário da última busca, para escolher o lado
  let jogos = [];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RITMO = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', daily: 'Por correspondência', classical: 'Clássica', correspondence: 'Por correspondência', ultraBullet: 'Ultrabullet' };

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
    if (campo) campo.placeholder = site === 'lichess' ? 'Usuário ou link da partida no Lichess' : 'Seu usuário no Chess.com';
  }

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 404) throw new Error('nao-encontrado');
    if (r.status === 429) throw new Error('limite');
    if (!r.ok) throw new Error('http-' + r.status);
    return r;
  }

  /* ── Chess.com ─────────────────────────────────────────────── */
  async function buscarChessCom(nome) {
    const base = `https://api.chess.com/pub/player/${encodeURIComponent(nome.toLowerCase())}`;
    const arq = await (await getJSON(`${base}/games/archives`)).json();
    const meses = (arq.archives || []).slice(-2).reverse();
    if (!meses.length) return [];
    let lista = [];
    for (const url of meses) {
      const dados = await (await getJSON(url)).json();
      lista = lista.concat(dados.games || []);
      if (lista.length >= 12) break;
    }
    return lista
      .filter(g => g.rules === 'chess' && g.pgn)
      .sort((a, b) => (b.end_time || 0) - (a.end_time || 0))
      .slice(0, 12)
      .map(g => ({
        pgn: g.pgn,
        quando: (g.end_time || 0) * 1000,
        brancas: g.white?.username, eloB: g.white?.rating,
        pretas: g.black?.username, eloP: g.black?.rating,
        resultado: (g.pgn.match(/\[Result "([^"]+)"\]/) || [])[1] || '*',
        ritmo: RITMO[g.time_class] || g.time_class || '',
        url: g.url || '',
      }));
  }

  /* ── Lichess ───────────────────────────────────────────────── */
  async function buscarLichess(nome) {
    const r = await getJSON(`https://lichess.org/api/games/user/${encodeURIComponent(nome)}?max=12&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&pgnInJson=true&clocks=false&evals=false&opening=false`,
      { headers: { Accept: 'application/x-ndjson' } });
    const texto = await r.text();
    return texto.split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(g => g.variant === 'standard' && g.pgn)
      .map(g => ({
        pgn: g.pgn,
        quando: g.lastMoveAt || g.createdAt || 0,
        brancas: g.players?.white?.user?.name || 'Anônimo', eloB: g.players?.white?.rating,
        pretas: g.players?.black?.user?.name || 'Anônimo', eloP: g.players?.black?.rating,
        resultado: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : (g.status === 'draw' || g.status === 'stalemate') ? '1/2-1/2' : '*',
        ritmo: RITMO[g.speed] || g.speed || '',
        url: `https://lichess.org/${g.id}`,
      }));
  }
  async function partidaLichess(id) {
    const r = await getJSON(`https://lichess.org/game/export/${id}?clocks=false&evals=false`, { headers: { Accept: 'application/x-chess-pgn' } });
    return r.text();
  }

  /* ── Lista de partidas ─────────────────────────────────────── */
  function render() {
    const box = $('imp-list');
    if (!box) return;
    if (!jogos.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const eu = usuario.toLowerCase();
    box.innerHTML = jogos.map((g, i) => {
      const d = new Date(g.quando);
      const data = isNaN(d) || !g.quando ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const lado = (g.brancas || '').toLowerCase() === eu ? 'white' : (g.pretas || '').toLowerCase() === eu ? 'black' : '';
      const venceu = lado && ((lado === 'white' && g.resultado === '1-0') || (lado === 'black' && g.resultado === '0-1'));
      const perdeu = lado && ((lado === 'white' && g.resultado === '0-1') || (lado === 'black' && g.resultado === '1-0'));
      const res = !lado ? g.resultado : venceu ? 'Vitória' : perdeu ? 'Derrota' : g.resultado === '1/2-1/2' ? 'Empate' : '—';
      const cls = venceu ? 'win' : perdeu ? 'loss' : 'draw';
      const nomeB = `${esc(g.brancas)}${g.eloB ? ` <small>${g.eloB}</small>` : ''}`;
      const nomeP = `${esc(g.pretas)}${g.eloP ? ` <small>${g.eloP}</small>` : ''}`;
      return `<button type="button" class="imp-game" data-imp-game="${i}">
        <span class="imp-g-date">${data}<small>${esc(g.ritmo)}</small></span>
        <span class="imp-g-players"><span><i class="ins-side ins-side-white"></i>${nomeB}</span><span><i class="ins-side ins-side-black"></i>${nomeP}</span></span>
        <span class="imp-g-res ${lado ? cls : ''}">${esc(res)}</span>
      </button>`;
    }).join('');
  }

  function carregar(pgn, ladoDe) {
    const campo = $('pgn-input');
    if (!campo || !pgn) return;
    campo.value = pgn.trim();
    // Abre o painel do lado de quem importou, se essa pessoa jogou a partida.
    if (ladoDe && typeof InsightsUI !== 'undefined') {
      const w = (pgn.match(/\[White "([^"]+)"\]/) || [])[1] || '';
      const b = (pgn.match(/\[Black "([^"]+)"\]/) || [])[1] || '';
      const eu = ladoDe.toLowerCase();
      if (w.toLowerCase() === eu) InsightsUI.setPov('white');
      else if (b.toLowerCase() === eu) InsightsUI.setPov('black');
    }
    $('btn-analyze')?.click();
    campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function erro(e, onde) {
    const m = String(e && e.message || e);
    if (m === 'nao-encontrado') status(onde === 'partida' ? 'Partida não encontrada. Confira o link.' : 'Usuário não encontrado. Confira a grafia.', 'error');
    else if (m === 'limite') status('O site de origem pediu uma pausa nas buscas. Tente de novo em um minuto.', 'error');
    else status('Não foi possível buscar agora. Verifique a conexão ou cole o PGN manualmente.', 'error');
  }

  async function buscar() {
    const campo = $('imp-input');
    const valor = (campo?.value || '').trim();
    if (!valor) { status('Digite um usuário ou cole o link de uma partida.', 'error'); campo?.focus(); return; }
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
      status('O Chess.com não permite buscar uma partida só pelo link. Digite o seu usuário do Chess.com: a partida aparece na lista.', 'error');
      campo.value = ''; campo.focus();
      return;
    }
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(valor)) { status('Esse nome de usuário não parece válido.', 'error'); return; }

    usuario = valor; lembrar();
    status(`Buscando as últimas partidas de ${valor}…`);
    const btn = $('imp-btn'); if (btn) btn.disabled = true;
    try {
      jogos = site === 'lichess' ? await buscarLichess(valor) : await buscarChessCom(valor);
      if (!jogos.length) status('Nenhuma partida de xadrez padrão encontrada nos últimos meses.', 'error');
      else status(`${jogos.length} partidas recentes. Escolha uma para analisar.`, 'ok');
      render();
    } catch (e) { erro(e, 'usuario'); }
    finally { if (btn) btn.disabled = false; }
  }

  function init() {
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
      const g = e.target.closest('[data-imp-game]');
      if (g) { const jogo = jogos[+g.dataset.impGame]; if (jogo) { status('Partida carregada. Analisando…', 'ok'); carregar(jogo.pgn, usuario); } }
    });
    $('imp-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
  }

  return { init };
})();

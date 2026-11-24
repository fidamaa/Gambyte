#!/usr/bin/env node
/* ==============================================================
   Gerador da seção "Aprender" do Gambyte.

   Uso (na raiz do projeto):   node tools/build.mjs

   Lê os artigos em tools/artigos/*.html (um fragmento por artigo, com
   uma linha <!--meta {...}--> no topo) e gera:
     - aprender/<slug>.html      página completa de cada artigo
     - aprender/index.html       índice com todos os artigos
     - js/data/sample-games.js   partidas de exemplo usadas na página inicial
     - sitemap.xml               todas as páginas públicas

   Todo diagrama e toda sequência de lances são conferidos com o mesmo
   motor de regras do analisador (js/modules/pgn-parser.js): lance
   ilegal, xeque ou mate anotado errado interrompem o build com erro.
   Não edite os arquivos de aprender/ à mão — edite o fragmento e rode
   o build de novo.
   ============================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(ROOT, 'tools', 'artigos');
const OUT  = path.join(ROOT, 'aprender');
const SITE = 'https://gambyte.com.br';
const HOJE = new Date().toISOString().slice(0, 10);
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const dataExtenso = iso => { const [a, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };

const PGNParser = new Function(
  fs.readFileSync(path.join(ROOT, 'js/modules/pgn-parser.js'), 'utf8') + '\nreturn PGNParser;')();

const CATEGORIAS = [
  ['fundamentos', 'Fundamentos',         'Notação, valor das peças e os princípios que sustentam todo o resto.'],
  ['tatica',      'Tática',              'Os temas que decidem a maioria das partidas entre amadores.'],
  ['finais',      'Finais',              'Posições com poucas peças em que a técnica vale mais que o cálculo.'],
  ['estrategia',  'Estratégia e estudo', 'Planos, estrutura de peões, relógio e como treinar com as próprias partidas.'],
  ['aberturas',   'Aberturas',           'Ideias e planos das aberturas mais jogadas, sem decoreba de variantes.'],
  ['partidas',    'Partidas comentadas', 'Partidas clássicas explicadas lance a lance para abrir no analisador.'],
  ['gambyte',     'Por dentro do Gambyte', 'Como a ferramenta calcula o que mostra na tela.'],
];

const erros = [];
const falha = (arq, msg) => erros.push(`${arq}: ${msg}`);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── Regras: geração de lances para conferir xeque e mate ───────── */
const ehBranca = p => p !== '' && p === p.toUpperCase();
function temLanceLegal(state) {
  const brancas = state.turn === 'w', b = state.board;
  const tenta = (r, c, r2, c2) => {
    if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) return false;
    const alvo = b[r2][c2];
    if (alvo !== '' && ehBranca(alvo) === brancas) return false;
    const nb = b.map(l => l.slice());
    nb[r2][c2] = nb[r][c]; nb[r][c] = '';
    return !PGNParser.isInCheck(nb, brancas);
  };
  const raio = (r, c, dirs) => {
    for (const [dr, dc] of dirs) {
      let r2 = r + dr, c2 = c + dc;
      while (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) {
        if (tenta(r, c, r2, c2)) return true;
        if (b[r2][c2] !== '') break;
        r2 += dr; c2 += dc;
      }
    }
    return false;
  };
  const DIAG = [[1,1],[1,-1],[-1,1],[-1,-1]], RETA = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c];
    if (p === '' || ehBranca(p) !== brancas) continue;
    const t = p.toUpperCase();
    if (t === 'N' && [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].some(([dr, dc]) => tenta(r, c, r + dr, c + dc))) return true;
    if (t === 'K' && [...DIAG, ...RETA].some(([dr, dc]) => tenta(r, c, r + dr, c + dc))) return true;
    if ((t === 'B' || t === 'Q') && raio(r, c, DIAG)) return true;
    if ((t === 'R' || t === 'Q') && raio(r, c, RETA)) return true;
    if (t === 'P') {
      const d = brancas ? -1 : 1, ini = brancas ? 6 : 1;
      if (b[r + d]?.[c] === '') {
        if (tenta(r, c, r + d, c)) return true;
        if (r === ini && b[r + 2 * d][c] === '' && tenta(r, c, r + 2 * d, c)) return true;
      }
      for (const dc of [-1, 1]) {
        const alvo = b[r + d]?.[c + dc];
        if (alvo && ehBranca(alvo) !== brancas && tenta(r, c, r + d, c + dc)) return true;
      }
    }
  }
  return false;
}

/** Joga uma sequência em SAN a partir de um FEN, conferindo legalidade, xeque e mate. */
function jogar(arq, fen, lances) {
  let state = PGNParser.fenToBoard(fen);
  const tokens = lances.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)
    .filter(t => !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  let ultimo = null;
  // passo a passo para o diagrama interativo: FEN depois de cada lance e o lance com número
  const passos = [{ fen: PGNParser.boardToFen(state), lance: '' }];
  let num = +(fen.split(' ')[5] || 1) || 1;
  for (const san of tokens) {
    const antes = state;
    const prox = PGNParser.applyMove(state, san);
    if (!prox) { falha(arq, `lance ilegal "${san}" em "${lances}" (FEN ${PGNParser.boardToFen(antes)})`); return null; }
    // o próprio lance não pode deixar o rei de quem jogou em xeque
    if (PGNParser.isInCheck(prox.board, antes.turn === 'w')) { falha(arq, `"${san}" deixa o próprio rei em xeque em "${lances}"`); return null; }
    const xeque = PGNParser.isInCheck(prox.board, prox.turn === 'w');
    const mate  = xeque && !temLanceLegal(prox);
    const marca = san.endsWith('#') ? '#' : san.includes('+') ? '+' : '';
    const real  = mate ? '#' : xeque ? '+' : '';
    if (marca !== real) falha(arq, `"${san}" anotado como "${marca || 'sem xeque'}" mas é "${real || 'sem xeque'}" em "${lances}"`);
    ultimo = PGNParser.boardToFen(antes);
    state = prox;
    passos.push({ fen: PGNParser.boardToFen(state), lance: antes.turn === 'w' ? `${num}. ${san}` : `${num}... ${san}` });
    if (antes.turn === 'b') num++;
  }
  return { fen: PGNParser.boardToFen(state), fenAntesDoUltimo: ultimo, passos };
}

/* ── Diagrama estático (HTML puro, sem JavaScript na página) ────── */
const NOMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const NOMES_PT = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };
function diagrama(arq, a) {
  let fen = a.fen || PGNParser.INITIAL_FEN;
  if (!/^[pnbrqkPNBRQK1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+( \d+ \d+)?$/.test(fen)) falha(arq, `FEN malformado: ${fen}`);
  if (fen.split(' ').length === 4) fen += ' 0 1';
  const linhas = fen.split(' ')[0].split('/');
  if (linhas.length !== 8 || linhas.some(l => [...l].reduce((n, ch) => n + (/\d/.test(ch) ? +ch : 1), 0) !== 8)) falha(arq, `FEN com fileira errada: ${fen}`);
  if ((fen.split(' ')[0].match(/K/g) || []).length !== 1 || (fen.split(' ')[0].match(/k/g) || []).length !== 1) falha(arq, `FEN sem exatamente um rei de cada cor: ${fen}`);
  let passos = null;
  if (a.lances) {
    const r = jogar(arq, fen, a.lances);
    if (!r) return '';
    if (a.mostra !== 'antes') fen = r.fen;
    passos = { i: a.mostra === 'antes' ? 0 : r.passos.length - 1, f: r.passos.map(p => p.fen), l: r.passos.map(p => p.lance) };
  }
  if (!miniaturaAtual) miniaturaAtual = fen;
  diagramasAtual++;
  const st = PGNParser.fenToBoard(fen);
  // quem NÃO tem a vez não pode estar em xeque (posição impossível)
  if (PGNParser.isInCheck(st.board, st.turn !== 'w')) falha(arq, `posição impossível (lado sem a vez está em xeque): ${fen}`);
  const marcas = new Set((a.marca || '').split(/[\s,]+/).filter(Boolean));
  for (const m of marcas) if (!/^[a-h][1-8]$/.test(m)) falha(arq, `casa inválida em marca: ${m}`);
  let cel = '';
  const pecas = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const casa = 'abcdefgh'[c] + (8 - r), p = st.board[r][c];
    const cls = ['c', (r + c) % 2 ? 'cd' : 'cl', marcas.has(casa) ? 'm' : ''].filter(Boolean).join(' ');
    const coord = (c === 0 ? ` data-r="${8 - r}"` : '') + (r === 7 ? ` data-f="${'abcdefgh'[c]}"` : '');
    let img = '';
    if (p) {
      const cor = ehBranca(p) ? 'w' : 'b';
      img = `<img src="/pieces/${NOMES[p.toLowerCase()]}-${cor}.svg" alt="" width="60" height="60" loading="lazy" decoding="async">`;
      pecas.push(`${NOMES_PT[p.toLowerCase()]} ${cor === 'w' ? 'branco' : 'preto'} em ${casa}`.replace(/(dama|torre) (branc|pret)o/, '$1 $2a'));
    }
    cel += `<span class="${cls}"${coord}>${img}</span>`;
  }
  const vez = a.vez === 'nao' ? '' : `<span class="tab-vez ${st.turn === 'w' ? 'vb' : 'vp'}">${st.turn === 'w' ? 'Jogam as brancas' : 'Jogam as pretas'}</span>`;
  // "Abrir no tabuleiro": o analisador abre o FEN no tabuleiro livre (/?fen=...)
  const abrir = `<a class="tab-abrir" href="/?fen=${encodeURIComponent(PGNParser.boardToFen(st))}">${ic('tabuleiro')}<span>Abrir no tabuleiro</span></a>`;
  return `<figure class="tab-fig"${passos ? ` data-passos="${esc(JSON.stringify(passos))}"` : ''}><div class="tab" role="img" aria-label="Diagrama de xadrez: ${esc(pecas.join(', '))}.">${cel}</div>`
    + `<div class="tab-acoes">${abrir}</div>`
    + `<figcaption>${vez}${a.leg ? `<span>${a.leg}</span>` : ''}</figcaption></figure>`;
}
let miniaturaAtual = null, diagramasAtual = 0;

/* ── Ícones de traço fino (mesma família da barra de cima) ─────── */
const ICONES = {
  fundamentos: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  tatica: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  finais: '<path d="M4 22V4"/><path d="M4 4h13l-2.5 4.5L17 13H4"/>',
  estrategia: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  aberturas: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  partidas: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
  gambyte: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tabuleiro: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  teste: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  esq: '<path d="m15 18-6-6 6-6"/>',
  dir: '<path d="m9 18 6-6-6-6"/>',
  grade: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;

/* Miniatura do cartão: casas por CSS e só as peças em HTML. */
function miniatura(fen) {
  const st = PGNParser.fenToBoard(fen);
  let pecas = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = st.board[r][c];
    if (p) pecas += `<img src="/pieces/${NOMES[p.toLowerCase()]}-${ehBranca(p) ? 'w' : 'b'}.svg" alt="" style="grid-area:${r + 1}/${c + 1}" loading="lazy" decoding="async">`;
  }
  return `<span class="ap-mini" aria-hidden="true">${pecas}</span>`;
}

const TESTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'testes.json'), 'utf8'));

const attrs = s => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

/* ── Leitura dos artigos ───────────────────────────────────────── */
const partidas = {};
const artigos = fs.readdirSync(SRC).filter(f => f.endsWith('.html')).sort().map(arq => {
  const bruto = fs.readFileSync(path.join(SRC, arq), 'utf8').replace(/\r\n/g, '\n');
  const m = bruto.match(/^<!--meta\s*([\s\S]*?)-->\n?/);
  if (!m) { falha(arq, 'faltou a linha <!--meta {...}-->'); return null; }
  let meta;
  try { meta = JSON.parse(m[1]); } catch (e) { falha(arq, 'meta inválido: ' + e.message); return null; }
  meta.slug = arq.replace(/\.html$/, '');
  for (const k of ['titulo', 'descricao', 'categoria', 'ordem']) if (meta[k] == null) falha(arq, `meta sem "${k}"`);
  if (!CATEGORIAS.some(c => c[0] === meta.categoria)) falha(arq, `categoria desconhecida: ${meta.categoria}`);
  let corpo = bruto.slice(m[0].length);
  miniaturaAtual = null; diagramasAtual = 0;

  // [[partida id="x" titulo="..."]] PGN [[/partida]]
  corpo = corpo.replace(/\[\[partida ([^\]]*)\]\]([\s\S]*?)\[\[\/partida\]\]/g, (_, at, pgn) => {
    const a = attrs(at); pgn = pgn.trim();
    const lances = pgn.split('\n').filter(l => !l.trim().startsWith('[')).join(' ');
    const r = jogar(arq, PGNParser.INITIAL_FEN, lances);
    const parsed = PGNParser.parsePGN(pgn);
    const esperados = lances.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
    if (!r || parsed.moves.length !== esperados) falha(arq, `partida "${a.id}" não foi lida por inteiro pelo analisador`);
    partidas[a.id] = { titulo: a.titulo, pgn };
    return `<div class="pgn-box"><div class="pgn-box-top"><strong>${esc(a.titulo)}</strong>`
      + `<a class="btn-ap" href="/?exemplo=${a.id}">Abrir no analisador</a></div><pre>${esc(pgn)}</pre></div>`;
  });
  // [[tab fen="..." lances="..." mostra="antes" marca="e4 d5" leg="..." vez="nao"]]
  corpo = corpo.replace(/\[\[tab ([^\]]*)\]\]/g, (_, at) => diagrama(arq, attrs(at)));
  // [[l 1. e4 e5 2. Nf3]] → sequência conferida a partir da posição inicial;
  // [[l fen="..." 1. Nc7+]] → conferida a partir de um FEN
  corpo = corpo.replace(/\[\[l (?:fen="([^"]*)" )?([^\]]*)\]\]/g, (_, fen, seq) => {
    jogar(arq, fen ? (fen.split(' ').length === 4 ? fen + ' 0 1' : fen) : PGNParser.INITIAL_FEN, seq);
    return `<span class="lances">${esc(seq.trim())}</span>`;
  });
  if (/\[\[/.test(corpo)) falha(arq, 'sobrou marcação [[...]] não reconhecida: ' + corpo.match(/\[\[[^\]]{0,60}/)[0]);

  const texto = corpo.replace(/<[^>]+>/g, ' ');
  meta.palavras = texto.split(/\s+/).filter(Boolean).length;
  meta.minutos = Math.max(2, Math.round(meta.palavras / 190));
  const subt = [...corpo.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(x => ({ id: x[1], t: x[2] }));
  const teste = TESTES[meta.slug] || null;
  if (!teste) falha(arq, 'sem "Teste rápido" em tools/testes.json');
  for (const [n, q] of (teste || []).entries())
    if (!q.p || !Array.isArray(q.o) || q.o.length < 2 || !(q.c >= 0 && q.c < q.o.length) || !q.e) falha(arq, `pergunta ${n + 1} do teste incompleta`);
  return { meta, corpo, subt, teste, miniatura: miniaturaAtual, diagramas: diagramasAtual };
}).filter(Boolean);

artigos.sort((a, b) => a.meta.ordem - b.meta.ordem);
const porSlug = Object.fromEntries(artigos.map(a => [a.meta.slug, a]));
for (const a of artigos) for (const s of [...a.corpo.matchAll(/href="\/aprender\/([a-z0-9-]+)["#]/g)].map(x => x[1]))
  if (!porSlug[s]) falha(a.meta.slug, `link para artigo inexistente: ${s}`);

/* ── Molde das páginas ─────────────────────────────────────────── */
const NAV = atual => `<nav class="info-nav" aria-label="Navegação do Gambyte"><a class="info-brand" href="/" aria-label="Gambyte: página inicial"><img src="/logo.png" alt="" width="32" height="32"><span>Gambyte</span></a><div class="info-links">`
  + [['/', 'Analisar partida'], ['/aprender/', 'Aprender xadrez'], ['/como-usar', 'Como usar'], ['/guia', 'Guia de análise'], ['/sobre', 'Sobre'], ['/contato', 'Contato']]
    .map(([h, t]) => `<a href="${h}"${h === atual ? ' aria-current="page"' : ''}>${t}</a>`).join('')
  + `<a class="nav-loja" href="/gambyte-premium">Gambyte Pro</a>`
  + `</div><div class="info-nav-side"><a class="nav-pro" href="/gambyte-premium">Gambyte Pro</a></div></nav>`;
const FOOTER = `<footer class="info-footer"><div><strong>Gambyte</strong><p>Projeto independente de Rampini. Aprender com a prática.</p></div><nav aria-label="Informações institucionais"><a href="/sobre">Sobre</a><a href="/aprender/">Aprender xadrez</a><a href="/como-usar">Como usar</a><a href="/guia">Guia de análise</a><a href="/gambyte-premium">Gambyte Pro</a><a href="/contato">Contato</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos de Uso</a><a href="/licencas">Créditos e licença</a></nav><small>© 2026 Rampini · <a href="mailto:mrz0001474@gmail.com">mrz0001474@gmail.com</a></small></footer>`;
const head = ({ titulo, descricao, url, tipo, ld }) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} | Gambyte</title>
<meta name="description" content="${esc(descricao)}">
<meta name="author" content="Rampini">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${tipo}"><meta property="og:image" content="https://gambyte.com.br/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Gambyte: análise de partidas de xadrez grátis, em português"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://gambyte.com.br/og-image.png">
<meta property="og:title" content="${esc(titulo)} | Gambyte">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Gambyte">
<meta name="google-adsense-account" content="ca-pub-7858747311725137"><script src="/js/anuncios.js"></script><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7858747311725137" crossorigin="anonymous"></script>
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/logo.png" type="image/png" sizes="192x192">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site-info.css?v=10"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0d0f14"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-title" content="Gambyte">
<link rel="stylesheet" href="/aprender.css?v=5">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script src="/menu.js" defer></script>
<script src="/aprender.js?v=1" defer></script>
</head>
<!-- Página gerada por tools/build.mjs — edite o fragmento em tools/artigos/ e rode o build. -->`;

const nomeCat = id => CATEGORIAS.find(c => c[0] === id)[1];
const cartao = a => `<a class="ap-card" href="/aprender/${a.meta.slug}" data-slug="${a.meta.slug}">`
  + (a.miniatura ? miniatura(a.miniatura) : `<span class="ap-mini ap-mini-ic" aria-hidden="true">${ic(a.meta.categoria)}</span>`)
  + `<span class="ap-card-txt"><span class="ap-card-cat">${nomeCat(a.meta.categoria)}</span><strong>${esc(a.meta.titulo)}</strong><span class="ap-card-desc">${esc(a.meta.descricao)}</span>`
  + `<span class="ap-card-pe"><span class="ap-card-min">${ic('relogio')}${a.meta.minutos} min de leitura</span><span class="ap-card-lido">${ic('check')}Lido</span></span></span></a>`;

const testeHTML = t => `<section class="ap-teste" aria-labelledby="teste-t"><div class="ap-teste-topo"><span class="ap-teste-ic">${ic('teste')}</span><div><h2 id="teste-t">Teste rápido</h2><p>${t.length} perguntas para fixar o que você leu. Toque na resposta.</p></div></div>`
  + `<ol class="ap-qs">${t.map((q, n) => `<li class="ap-q" data-certa="${q.c}"><p class="ap-q-p"><span class="ap-q-n">${n + 1}</span>${esc(q.p)}</p><div class="ap-q-ops">`
    + q.o.map((o, i) => `<button type="button" class="ap-q-op" data-i="${i}"><span class="ap-q-letra">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`).join('')
    + `</div><p class="ap-q-exp" hidden>${esc(q.e)}</p></li>`).join('')}</ol>`
  + `<p class="ap-teste-placar" aria-live="polite"></p></section>`;

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html')) fs.unlinkSync(path.join(OUT, f));

for (const art of artigos) {
  const { meta, corpo, subt } = art;
  const url = `${SITE}/aprender/${meta.slug}`;
  const mesma = artigos.filter(a => a.meta.categoria === meta.categoria && a !== art);
  const i = artigos.indexOf(art);
  const relacionados = [...new Set([...(meta.relacionados || []).map(s => porSlug[s]).filter(Boolean), ...mesma, artigos[(i + 1) % artigos.length], artigos[(i + 2) % artigos.length]])]
    .filter(a => a && a !== art).slice(0, 3);
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: meta.titulo, description: meta.descricao,
    inLanguage: 'pt-BR', datePublished: meta.publicado || HOJE, dateModified: HOJE, mainEntityOfPage: url,
    author: { '@type': 'Person', name: 'Rampini', url: `${SITE}/sobre` },
    publisher: { '@type': 'Organization', name: 'Gambyte', logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` } },
    articleSection: nomeCat(meta.categoria), wordCount: meta.palavras,
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Gambyte', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Aprender xadrez', item: SITE + '/aprender/' },
      { '@type': 'ListItem', position: 3, name: meta.titulo, item: url }],
  }];
  const sumario = subt.length >= 3 ? `<nav class="ap-toc" aria-label="Neste artigo"><strong>Neste artigo</strong><ol>${subt.map(s => `<li><a href="#${s.id}">${s.t}</a></li>`).join('')}</ol></nav>` : '';
  const ant = artigos[i - 1], prox = artigos[i + 1];
  const seq = `<nav class="ap-seq" aria-label="Outros guias">`
    + (ant ? `<a class="ap-seq-a ap-seq-ant" href="/aprender/${ant.meta.slug}"><span>${ic('esq')}Anterior</span><strong>${esc(ant.meta.titulo)}</strong></a>` : '')
    + (prox ? `<a class="ap-seq-a ap-seq-prox" href="/aprender/${prox.meta.slug}"><span>Próximo${ic('dir')}</span><strong>${esc(prox.meta.titulo)}</strong></a>`
      : `<a class="ap-seq-a ap-seq-prox" href="/aprender/"><span>Fim da trilha${ic('dir')}</span><strong>Ver todos os guias</strong></a>`)
    + `</nav>`;
  const chips = `<div class="ap-chips"><span class="ap-chip">${ic(meta.categoria)}${nomeCat(meta.categoria)}</span><span class="ap-chip">${ic('relogio')}${meta.minutos} min</span>`
    + (art.diagramas ? `<span class="ap-chip">${ic('tabuleiro')}${art.diagramas} ${art.diagramas > 1 ? 'diagramas' : 'diagrama'}</span>` : '')
    + (art.teste ? `<a class="ap-chip ap-chip-link" href="#teste-t">${ic('teste')}Teste rápido</a>` : '') + `</div>`;
  const html = `${head({ titulo: meta.titulo, descricao: meta.descricao, url, tipo: 'article', ld })}
<body class="info-page ap-page ap-art" data-site="gambyte" data-slug="${meta.slug}">
${NAV('/aprender/')}
<main class="info-content ap-content">
<article>
<p class="info-kicker"><a href="/aprender/">Aprender xadrez</a> / ${nomeCat(meta.categoria)}</p>
<h1>${esc(meta.titulo)}</h1>
<p class="info-summary">${esc(meta.descricao)}</p>
${chips}
<p class="ap-meta">Por Rampini · Atualizado em ${dataExtenso(HOJE)}</p>
${['gambyte'].includes(meta.categoria) || ['notacao-algebrica', 'glossario', 'exportar-pgn', 'como-estudar-suas-partidas', 'gestao-do-tempo'].includes(meta.slug) ? '' : '<p class="ap-notacao">Os lances usam a notação do PGN: K é rei, Q dama, R torre, B bispo e N cavalo. <a href="/aprender/notacao-algebrica">Como ler a notação</a></p>'}
${sumario}
<div class="ap-corpo">
${corpo.trim()}
</div>
${art.teste ? testeHTML(art.teste) : ''}
<div class="ap-fim"><button type="button" class="ap-lido-btn" data-lido hidden>${ic('check')}<span>Marcar como lido</span></button>${seq}</div>
<aside class="ap-cta"><div><strong>Veja isso acontecer nas suas partidas</strong><p>Cole o PGN de um jogo seu e o Gambyte mostra, lance a lance, onde a avaliação mudou. É gratuito e roda no seu navegador.</p></div><a class="btn-ap btn-ap-solid" href="/">Analisar uma partida</a></aside>
</article>
<section class="ap-rel" aria-labelledby="rel-t"><h2 id="rel-t">Continue estudando</h2><div class="ap-grid">${relacionados.map(cartao).join('')}</div></section>
</main>
${FOOTER}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, meta.slug + '.html'), html);
}

/* ── Índice ────────────────────────────────────────────────────── */
{
  const url = `${SITE}/aprender/`;
  const descricao = 'Guias originais de xadrez em português: tática, finais, aberturas, estratégia e partidas clássicas comentadas, com diagramas e exemplos para testar no analisador.';
  const secoes = CATEGORIAS.map(([id, nome, desc]) => {
    const lista = artigos.filter(a => a.meta.categoria === id);
    return lista.length ? `<section class="ap-sec" aria-labelledby="c-${id}" data-cat="${id}"><div class="ap-sec-topo"><span class="ap-sec-ic">${ic(id)}</span><div><h2 id="c-${id}">${nome}</h2><p class="ap-sec-desc">${desc}</p></div></div><div class="ap-grid">${lista.map(cartao).join('')}</div></section>` : '';
  }).join('\n');
  const temas = CATEGORIAS.filter(c => artigos.some(a => a.meta.categoria === c[0])).map(([id, nome]) => {
    const n = artigos.filter(a => a.meta.categoria === id).length;
    return `<a class="ap-tema" href="#c-${id}" data-cat="${id}"><span class="ap-tema-ic">${ic(id)}</span><span class="ap-tema-txt"><strong>${nome}</strong><span class="ap-tema-n" data-total="${n}">${n} ${n > 1 ? 'guias' : 'guia'}</span></span><span class="ap-tema-barra" aria-hidden="true"><span></span></span></a>`;
  }).join('');
  const ld = [{
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Aprender xadrez', description: descricao, inLanguage: 'pt-BR', url,
    hasPart: artigos.map(a => ({ '@type': 'Article', headline: a.meta.titulo, url: `${SITE}/aprender/${a.meta.slug}` })),
  }];
  const total = artigos.reduce((n, a) => n + a.meta.minutos, 0);
  fs.writeFileSync(path.join(OUT, 'index.html'), `${head({ titulo: 'Aprender xadrez: guias de tática, finais e aberturas', descricao, url, tipo: 'website', ld })}
<body class="info-page ap-page ap-hub-page" data-site="gambyte">
${NAV('/aprender/')}
<main class="info-content ap-content ap-hub">
<div class="ap-hero">
<div class="ap-hero-txt">
<p class="info-kicker">Gambyte / Aprender xadrez</p>
<h1>Aprenda xadrez com exemplos que você pode testar</h1>
<p class="info-summary">${artigos.length} guias originais em português, com diagramas e sequências conferidas lance a lance. Leia um tema, depois procure o mesmo padrão em uma partida sua.</p>
<p class="ap-meta">${artigos.length} artigos · cerca de ${total} minutos de leitura no total · Atualizado em ${dataExtenso(HOJE)}</p>
</div>
<div class="ap-prog" data-total="${artigos.length}">
<div class="ap-prog-topo"><span class="ap-prog-anel" aria-hidden="true"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="ap-prog-arco" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="0 100"/></svg><b class="ap-prog-pct">0%</b></span><div><strong>Seu progresso</strong><span class="ap-prog-txt">Nenhum guia lido ainda. Os guias que você terminar ficam marcados aqui, neste aparelho.</span></div></div>
<a class="btn-ap btn-ap-solid ap-prog-btn" href="/aprender/${artigos[0].meta.slug}">Começar pelo primeiro guia</a>
</div>
</div>
<nav class="ap-temas" aria-label="Temas">${temas}</nav>
${secoes}
<aside class="ap-cta"><div><strong>Do estudo para a prática</strong><p>Depois de ler, cole o PGN de uma partida sua e veja onde esses temas apareceram. A análise é gratuita e roda no seu navegador.</p></div><a class="btn-ap btn-ap-solid" href="/">Analisar uma partida</a></aside>
</main>
${FOOTER}
</body>
</html>
`);
}

/* ── Partidas de exemplo para a página inicial ─────────────────── */
fs.writeFileSync(path.join(ROOT, 'js/data/sample-games.js'),
  `/* Gerado por tools/build.mjs a partir das partidas dos artigos — não edite à mão. */\nconst SAMPLE_GAMES = ${JSON.stringify(partidas, null, 2)};\n`);

/* ── Sitemap ───────────────────────────────────────────────────── */
{
  const fixas = ['', 'jogar', 'aprender/', 'como-usar', 'guia', 'sobre', 'contato', 'gambyte-premium', 'privacidade', 'termos', 'licencas'];
  const urls = [...fixas, ...artigos.map(a => `aprender/${a.meta.slug}`)];
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${SITE}/${u}</loc><lastmod>${HOJE}</lastmod></url>`).join('\n') + `\n</urlset>\n`);
}

if (erros.length) {
  console.error(`\n${erros.length} problema(s) encontrado(s):\n- ` + erros.join('\n- '));
  process.exit(1);
}
const totalPalavras = artigos.reduce((n, a) => n + a.meta.palavras, 0);
console.log(`OK: ${artigos.length} artigos, ${totalPalavras} palavras, ${Object.keys(partidas).length} partidas de exemplo.`);
for (const a of artigos) console.log(`  ${String(a.meta.palavras).padStart(5)} palavras  ${a.meta.slug}`);

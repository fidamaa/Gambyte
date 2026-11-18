/* ==============================================================
   MODULE: board-scan.js
   Reconhece a posição a partir de um PRINT de tela (Chess.com,
   Lichess, diagrama de livro), direto no aparelho, sem servidor.

   Não é IA generativa: é visão computacional clássica.
     1. Acha o tabuleiro: as divisas entre casas claras e escuras formam
        linhas em que o brilho sobe e desce alternadamente. Procuramos as
        7 linhas internas igualmente espaçadas na horizontal e na vertical.
     2. Em cada casa, separa o que é diferente da cor de fundo da própria
        casa (a borda da casa diz qual é o fundo). A maior mancha é a peça.
     3. Cor da peça: brilho mediano da mancha (peça branca é clara).
     4. Tipo da peça: compara a silhueta com os dois conjuntos de peças do
        site (formato e altura relativa ao rei).
   Depois, a pessoa confere tudo no editor (photo-position.js).

   Depende de: nada (usa só canvas). Usado por: photo-position.js
   ============================================================== */
const BoardScan = (() => {
  const N = 32;                 // lado da silhueta normalizada
  const TIPOS = ['p', 'n', 'b', 'r', 'q', 'k'];
  const NOME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  let modelos = null;           // [{ tipo, mask, relH }]

  // ── Utilidades de imagem ────────────────────────────────────
  function carregarImg(src) {
    return new Promise((ok, erro) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => erro(new Error('imagem'));
      im.src = src;
    });
  }

  function canvasDe(img, maxLado) {
    const k = Math.min(1, maxLado / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    return { cv, cx, w, h, data: cx.getImageData(0, 0, w, h).data };
  }

  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // Preenche buracos: tudo que não é alcançável a partir da borda vira peça.
  function preencher(mask, w, h) {
    const fora = new Uint8Array(w * h);
    const pilha = [];
    for (let x = 0; x < w; x++) { pilha.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { pilha.push(y * w, y * w + w - 1); }
    while (pilha.length) {
      const i = pilha.pop();
      if (fora[i] || mask[i]) continue;
      fora[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) pilha.push(i - 1);
      if (x < w - 1) pilha.push(i + 1);
      if (y > 0) pilha.push(i - w);
      if (y < h - 1) pilha.push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = fora[i] ? 0 : 1;
    return out;
  }

  // Maior mancha conectada (4-vizinhos).
  function maiorMancha(mask, w, h) {
    const rot = new Int32Array(w * h).fill(-1);
    let melhor = null, nMelhor = 0;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || rot[s] >= 0) continue;
      const pilha = [s], itens = [];
      rot[s] = s;
      while (pilha.length) {
        const i = pilha.pop();
        itens.push(i);
        const x = i % w, y = (i / w) | 0;
        const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of viz) if (j >= 0 && mask[j] && rot[j] < 0) { rot[j] = s; pilha.push(j); }
      }
      if (itens.length > nMelhor) { nMelhor = itens.length; melhor = itens; }
    }
    const out = new Uint8Array(w * h);
    if (melhor) for (const i of melhor) out[i] = 1;
    return { mask: out, area: nMelhor };
  }

  // Recorta a mancha e encaixa num quadrado N×N (centrada, apoiada embaixo).
  function normalizar(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const k = N / Math.max(bw, bh);
    const out = new Float32Array(N * N);
    const ox = (N - bw * k) / 2, oy = N - bh * k;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = Math.floor((x - ox) / k) + x0, sy = Math.floor((y - oy) / k) + y0;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && mask[sy * w + sx]) out[y * N + x] = 1;
    }
    // Versão "esticada": a silhueta ocupa o quadrado inteiro, ignorando a
    // proporção. Compara a FORMA de peças mais largas ou mais estreitas que
    // as dos moldes (as do Chess.com são bem mais largas).
    const ms = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = x0 + Math.min(bw - 1, Math.floor(x * bw / N)), sy = y0 + Math.min(bh - 1, Math.floor(y * bh / N));
      if (mask[sy * w + sx]) ms[y * N + x] = 1;
    }
    return { m: out, ms, bw, bh };
  }

  function iou(a, b) {
    let i = 0, u = 0;
    for (let k = 0; k < a.length; k++) { const x = a[k] > 0.5, y = b[k] > 0.5; if (x && y) i++; if (x || y) u++; }
    return u ? i / u : 0;
  }

  // Descritores de forma que mudam pouco de um desenho de peça para outro:
  //   assim: quanto a peça é diferente do próprio espelho (o cavalo é);
  //   perfil: largura em 16 alturas, em relação à largura máxima.
  function descrever(m) {
    let i = 0, u = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = m[y * N + x] > 0.5, b = m[y * N + (N - 1 - x)] > 0.5;
      if (a && b) i++; if (a || b) u++;
    }
    const perfilL = new Float32Array(16);
    let maxL = 1;
    for (let k = 0; k < 16; k++) {
      let l = 0;
      for (let y = k * 2; y < k * 2 + 2; y++) for (let x = 0; x < N; x++) if (m[y * N + x] > 0.5) l++;
      perfilL[k] = l / 2;
      if (perfilL[k] > maxL) maxL = perfilL[k];
    }
    for (let k = 0; k < 16; k++) perfilL[k] /= maxL;
    return { assim: u ? 1 - i / u : 0, perfil: perfilL };
  }

  // Pesos de cada pista, escolhidos testando 24 combinações em 23 prints
  // reais (Lichess e Chess.com) e 30 tabuleiros sintéticos. A silhueta
  // esticada (ms) e a proporção (asp) não ajudaram e ficam desligadas.
  const P = { m: 1, ms: 0, relH: 0.9, assim: 0.8, perfil: 0.5, asp: 0 };
  function nota(c, m) {
    let dp = 0;
    for (let k = 0; k < 16; k++) dp += Math.abs(c.perfil[k] - m.perfil[k]);
    return P.m * iou(c.mask, m.mask) + P.ms * iou(c.ms, m.ms) - P.relH * Math.abs(c.relH - m.relH)
      - P.assim * Math.abs(c.assim - m.assim) - P.perfil * dp / 16 - P.asp * Math.abs(Math.log(c.asp / m.asp));
  }

  // ── Modelos: silhuetas dos dois conjuntos de peças do site ──
  async function carregarModelos() {
    if (modelos) return modelos;
    const conjuntos = [
      t => `pieces/${NOME[t]}-w.svg`,
      t => `pieces/white-${NOME[t]}.png`,
    ];
    const lista = [];
    for (const src of conjuntos) {
      const doConjunto = [];
      for (const t of TIPOS) {
        let img;
        try { img = await carregarImg(src(t)); } catch (e) { continue; }
        const L = 96;
        const cv = document.createElement('canvas');
        cv.width = L; cv.height = L;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, L, L);
        const d = cx.getImageData(0, 0, L, L).data;
        const mask = new Uint8Array(L * L);
        for (let i = 0; i < L * L; i++) mask[i] = d[i * 4 + 3] > 100 ? 1 : 0;
        const cheia = preencher(mask, L, L);
        const n = normalizar(cheia, L, L);
        if (n) doConjunto.push({ tipo: t, mask: n.m, ms: n.ms, asp: n.bw / n.bh, h: n.bh });
      }
      const rei = doConjunto.find(m => m.tipo === 'k');
      for (const m of doConjunto) lista.push({ tipo: m.tipo, mask: m.mask, ms: m.ms, asp: m.asp, relH: rei ? m.h / rei.h : 1, ...descrever(m.mask) });
    }
    modelos = lista;
    return modelos;
  }

  // ── 1. Achar o tabuleiro ────────────────────────────────────
  // perfil[i] = força de "linha de tabuleiro" na coluna (ou linha) i:
  // só é alta se houver bordas subindo E descendo de brilho nela.
  function perfil(g, w, h, vertical, a0, a1) {
    const tam = vertical ? w : h;
    const pos = new Float32Array(tam), neg = new Float32Array(tam);
    if (vertical) {
      for (let y = a0; y < a1; y++) for (let x = 1; x < w - 1; x++) {
        const d = g[y * w + x + 1] - g[y * w + x - 1];
        if (d > 0) pos[x] += d; else neg[x] -= d;
      }
    } else {
      for (let y = 1; y < h - 1; y++) for (let x = a0; x < a1; x++) {
        const d = g[(y + 1) * w + x] - g[(y - 1) * w + x];
        if (d > 0) pos[y] += d; else neg[y] -= d;
      }
    }
    const out = new Float32Array(tam);
    const n = Math.max(1, a1 - a0);
    for (let i = 0; i < tam; i++) out[i] = Math.min(pos[i], neg[i]) / n;
    return out;
  }

  // As K melhores grades de 7 linhas internas: [{ o, s, nota }].
  function acharGrade(p, minS, maxS, K = 1) {
    const tam = p.length;
    const pico = x => {
      const i = Math.round(x);
      let m = 0;
      for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < tam && p[k] > m) m = p[k];
      return m;
    };
    let media = 0;
    for (let i = 0; i < tam; i++) media += p[i];
    media = media / tam + 1e-6;
    const lista = [];
    for (let s = minS; s <= maxS; s += 0.5) {
      let melhor = { o: 0, s, nota: 0 };
      for (let o = 0; o + 8 * s < tam; o += 0.5) {
        let linhas = 0, menor = Infinity, meios = 0;
        for (let k = 1; k <= 7; k++) {
          const v = pico(o + k * s);
          linhas += v;
          if (v < menor) menor = v;
          meios += p[Math.round(o + (k - 0.5) * s)] || 0;
        }
        meios += p[Math.round(o + 7.5 * s)] || 0;
        // Precisa que as 7 linhas apareçam (a menor delas pesa) e que o
        // meio das casas seja calmo.
        const nota = (linhas / 7 + menor - meios / 8) / media;
        if (nota > melhor.nota) melhor = { o, s, nota };
      }
      lista.push(melhor);
    }
    lista.sort((a, b) => b.nota - a.nota);
    const escolhidas = [];
    for (const c of lista) {
      if (escolhidas.some(e => Math.abs(e.o - c.o) < e.s / 2 && Math.abs(e.s - c.s) < e.s * 0.15)) continue;
      escolhidas.push(c);
      if (escolhidas.length >= K) break;
    }
    return K === 1 ? escolhidas[0] : escolhidas;
  }

  // Quanto a grade parece um tabuleiro de verdade: casas vizinhas com
  // cores diferentes e casas da mesma cor parecidas entre si.
  function xadrezado(g, w, h, x0, y0, sx, sy) {
    const par = [[], []];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = [];
      for (let k = 0; k < 12; k++) {
        const t = k / 12, lado = k % 4;
        const fx = lado === 0 ? 0.12 : lado === 1 ? 0.88 : 0.12 + 0.76 * t;
        const fy = lado === 2 ? 0.12 : lado === 3 ? 0.88 : 0.12 + 0.76 * t;
        const px = Math.min(w - 1, Math.max(0, Math.round(x0 + (c + fx) * sx)));
        const py = Math.min(h - 1, Math.max(0, Math.round(y0 + (r + fy) * sy)));
        v.push(g[py * w + px]);
      }
      v.sort((a, b) => a - b);
      par[(r + c) % 2].push(v[6]);
    }
    const med = a => a.reduce((s, x) => s + x, 0) / a.length;
    const desv = a => { const m = med(a); return a.reduce((s, x) => s + Math.abs(x - m), 0) / a.length; };
    return Math.abs(med(par[0]) - med(par[1])) / (4 + desv(par[0]) + desv(par[1]));
  }

  function acharTabuleiro(img) {
    const { w, h, data } = img;
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const menorLado = Math.min(w, h);
    const minS = Math.max(6, menorLado * 0.22 / 8), maxS = menorLado / 8;
    const faixa = (o, s, max) => [Math.max(0, Math.floor(o)), Math.min(max, Math.ceil(o + 8 * s))];
    // Várias candidatas em cada eixo; fica a combinação mais "xadrezada".
    let melhor = null;
    for (const gx0 of acharGrade(perfil(g, w, h, true, 0, h), minS, maxS, 5)) {
      for (const gy of acharGrade(perfil(g, w, h, false, ...faixa(gx0.o, gx0.s, w)), minS, maxS, 3)) {
        const gx = acharGrade(perfil(g, w, h, true, ...faixa(gy.o, gy.s, h)), minS, maxS);
        if (!gx) continue;
        const s = (gx.s + gy.s) / 2;
        if (Math.abs(gx.s - gy.s) / s > 0.08) continue;
        const x = xadrezado(g, w, h, gx.o, gy.o, gx.s, gy.s);
        const nota = x * Math.min(gx.nota, gy.nota);
        if (!melhor || nota > melhor.nota) melhor = { x: gx.o, y: gy.o, s, sx: gx.s, sy: gy.s, nota, xadrez: x, linhas: Math.min(gx.nota, gy.nota) };
      }
    }
    return melhor;
  }

  // ── 2–4. Ler cada casa ──────────────────────────────────────
  function lerCasa(img, x0, y0, s) {
    const { w, data } = img;
    const L = Math.max(12, Math.floor(s));
    const px = (x, y) => {
      const sx = Math.min(img.w - 1, Math.max(0, Math.floor(x0 + x * s / L)));
      const sy = Math.min(img.h - 1, Math.max(0, Math.floor(y0 + y * s / L)));
      const i = (sy * w + sx) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Fundo: mediana de um anel perto da borda da casa.
    const anel = [];
    const a = Math.max(1, Math.round(L * 0.05)), b = Math.max(a + 1, Math.round(L * 0.09));
    for (let y = a; y < L - a; y++) for (let x = a; x < L - a; x++) {
      if (x < b || x >= L - b || y < b || y >= L - b) anel.push(px(x, y));
    }
    const med = c => { const v = anel.map(p => p[c]).sort((m, n) => m - n); return v[v.length >> 1]; };
    const fundo = [med(0), med(1), med(2)];
    // Máscara do que difere do fundo (ignora 6% da borda).
    const ini = Math.round(L * 0.06), fim = L - ini, lado = fim - ini;
    const mask = new Uint8Array(lado * lado);
    const cores = [];
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      const p = px(x + ini, y + ini);
      const d = Math.max(Math.abs(p[0] - fundo[0]), Math.abs(p[1] - fundo[1]), Math.abs(p[2] - fundo[2]));
      if (d > 34) { mask[y * lado + x] = 1; cores.push(lum(p[0], p[1], p[2])); }
    }
    const mancha = maiorMancha(mask, lado, lado);
    if (mancha.area < lado * lado * 0.05) return { vazia: true };
    const cheia = preencher(mancha.mask, lado, lado);
    const n = normalizar(cheia, lado, lado);
    if (!n || n.bh < lado * 0.3) return { vazia: true };
    // Cor: brilho mediano do MIOLO da peça (a silhueta sem o contorno).
    // Peça branca tem miolo claro; peça preta, escuro, mesmo com detalhes
    // brancos desenhados por cima.
    const r = Math.max(1, Math.round(lado * 0.05));
    const miolo = [], todos = [];
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      if (!cheia[y * lado + x]) continue;
      const p = px(x + ini, y + ini);
      const v = lum(p[0], p[1], p[2]);
      todos.push(v);
      let dentro = true;
      for (let dy = -r; dy <= r && dentro; dy += r) for (let dx = -r; dx <= r; dx += r) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= lado || yy >= lado || !cheia[yy * lado + xx]) { dentro = false; break; }
      }
      if (dentro) miolo.push(v);
    }
    const base = miolo.length >= 12 ? miolo : todos;
    base.sort((m, k) => m - k);
    const brilho = base[base.length >> 1];
    return { vazia: false, mask: n.m, ms: n.ms, asp: n.bw / n.bh, h: n.bh / lado, branca: brilho > 128, ...descrever(n.m) };
  }

  // Quantas peças de cada tipo cabem de cada lado (promoções são raras;
  // se acontecerem, a pessoa corrige no editor).
  const LIMITE = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

  function classificar(casas) {
    // Altura relativa: em relação à peça mais alta do tabuleiro (o rei).
    const altas = casas.filter(c => !c.vazia).map(c => c.h).sort((a, b) => b - a);
    const ref = altas.length ? altas[Math.min(1, altas.length - 1)] : 1;
    for (const c of casas) {
      if (c.vazia) continue;
      c.relH = c.h / ref;
      c.notas = {};
      for (const m of modelos) {
        const v = nota(c, m);
        if (c.notas[m.tipo] == null || v > c.notas[m.tipo]) c.notas[m.tipo] = v;
      }
    }
    // 1. Num print, peças do mesmo tipo e cor são desenhadas iguais:
    //    agrupa cada cor em grupos de peças idênticas.
    const grupos = [];
    for (const branca of [true, false]) {
      const doLado = [];
      for (const c of casas.filter(x => !x.vazia && x.branca === branca)) {
        const g = doLado.find(gr => iou(gr.membros[0].mask, c.mask) > 0.86 && Math.abs(gr.membros[0].relH - c.relH) < 0.06);
        if (g) g.membros.push(c); else doLado.push({ branca, membros: [c] });
      }
      // 2. O maior grupo com 3 ou mais peças só pode ser o dos peões, e
      //    nenhum outro grupo dessa cor é peão.
      const maior = doLado.slice().sort((a, b) => b.membros.length - a.membros.length)[0];
      if (maior && maior.membros.length >= 3) {
        maior.fixo = 'p';
        const ref0 = maior.membros[0];
        for (const g of doLado) {
          if (g === maior) continue;
          // Peão quase igual (na casa clara x escura o recorte muda um pouco)
          // continua sendo peão; o resto não pode ser peão.
          const c = g.membros[0];
          if (iou(ref0.mask, c.mask) > 0.8 && Math.abs(ref0.relH - c.relH) < 0.04) g.fixo = 'p';
          else g.semPeao = true;
        }
      }
      grupos.push(...doLado);
    }
    // 3. O mesmo desenho aparece nas duas cores: junta cada grupo branco
    //    com o grupo preto de silhueta mais parecida (par mútuo), e o par
    //    recebe o mesmo tipo.
    const brancos = grupos.filter(g => g.branca && !g.fixo), pretos = grupos.filter(g => !g.branca && !g.fixo);
    const parecido = (a, b) => iou(a.membros[0].mask, b.membros[0].mask) - Math.abs(a.membros[0].relH - b.membros[0].relH);
    const unidades = [];
    const usadosPretos = new Set();
    for (const gb of brancos) {
      const melhor = pretos.slice().sort((x, y) => parecido(gb, y) - parecido(gb, x))[0];
      const volta = melhor && brancos.slice().sort((x, y) => parecido(y, melhor) - parecido(x, melhor))[0];
      if (melhor && volta === gb && !usadosPretos.has(melhor) && parecido(gb, melhor) > 0.72) {
        unidades.push([gb, melhor]); usadosPretos.add(melhor);
      } else unidades.push([gb]);
    }
    for (const gp of pretos) if (!usadosPretos.has(gp)) unidades.push([gp]);
    // 4. Escolha gulosa (melhor nota primeiro), respeitando quantas peças de
    //    cada tipo cabem de cada lado. O rei vem primeiro.
    const usados = { true: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, false: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
    for (const g of grupos) if (g.fixo) { usados[g.branca].p += g.membros.length; g.tipo = 'p'; }
    const membrosDe = u => u.flatMap(g => g.membros);
    const cabe = (u, t) => u.every(g => (t !== 'p' || !g.semPeao) && usados[g.branca][t] + g.membros.length <= LIMITE[t]);
    const opcoes = [];
    unidades.forEach((u, ui) => {
      const ms = membrosDe(u);
      for (const t of TIPOS) opcoes.push({ ui, t, v: ms.reduce((s, c) => s + c.notas[t], 0) / ms.length });
    });
    opcoes.sort((a, b) => (b.t === 'k') - (a.t === 'k') || b.v - a.v);
    const tipoDa = new Array(unidades.length).fill(null);
    for (const o of opcoes) {
      if (tipoDa[o.ui]) continue;
      const u = unidades[o.ui];
      if (o.t === 'k' && (u.some(g => g.membros.length !== 1) || o.v < Math.max(...membrosDe(u).map(c => Math.max(...Object.values(c.notas)))) - 0.25)) continue;
      if (!cabe(u, o.t)) continue;
      tipoDa[o.ui] = o.t;
      for (const g of u) usados[g.branca][o.t] += g.membros.length;
    }
    unidades.forEach((u, ui) => {
      for (const g of u) {
        // Sobrou sem lugar (promoção, por exemplo): fica o mais parecido.
        g.tipo = tipoDa[ui] || TIPOS.filter(x => x !== 'k' && (x !== 'p' || !g.semPeao)).sort((a, b) => g.membros[0].notas[b] - g.membros[0].notas[a])[0];
      }
    });
    // 5. Cada cor precisa de um rei: se faltou, vira rei o grupo de 1 peça
    //    mais parecido com rei.
    for (const branca of [true, false]) {
      const lado = grupos.filter(g => g.branca === branca);
      if (lado.length && !lado.some(g => g.tipo === 'k')) {
        const cand = lado.filter(g => g.membros.length === 1 && g.tipo !== 'p').sort((a, b) => b.membros[0].notas.k - a.membros[0].notas.k)[0];
        if (cand) cand.tipo = 'k';
      }
    }
    for (const g of grupos) for (const c of g.membros) {
      c.tipo = g.tipo;
      const ord = Object.values(c.notas).sort((a, b) => b - a);
      c.duvida = c.notas[g.tipo] < ord[0] - 0.001 || ord[0] - ord[1] < 0.05;
    }
  }

  /**
   * Lê um print. Devolve:
   *   { ok, linhas: 8 strings (fileira 8 → 1, colunas a → h, '.' vazio),
   *     duvidas: ['e4', ...], brancasEmbaixo, motivo }
   */
  async function lerPrint(src, opts = {}) {
    await carregarModelos();
    const imgEl = await carregarImg(src);
    const img = canvasDe(imgEl, 900);
    const tab = acharTabuleiro(img);
    if (opts.debug) console.log('[BoardScan] tabuleiro', JSON.stringify(tab));
    if (!tab || tab.xadrez < 1 || tab.linhas < 1.6 || tab.s < 8) {
      return { ok: false, motivo: 'Não encontrei um tabuleiro reto nesta imagem. Recorte o print deixando o tabuleiro inteiro. Se for foto de um tabuleiro de verdade, use "Tirar foto".' };
    }
    // Grade na tela (linha 0 = topo da imagem).
    const tela = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const casa = lerCasa(img, tab.x + c * tab.sx, tab.y + r * tab.sy, Math.min(tab.sx, tab.sy));
      casa.r = r; casa.c = c;
      tela.push(casa);
    }
    classificar(tela);
    // Orientação: peões brancos costumam estar mais perto de quem joga de
    // brancas; sem peões, decide pelos reis.
    const media = (lista) => lista.length ? lista.reduce((s, c) => s + c.r, 0) / lista.length : null;
    const pb = media(tela.filter(c => !c.vazia && c.tipo === 'p' && c.branca));
    const pp = media(tela.filter(c => !c.vazia && c.tipo === 'p' && !c.branca));
    const kb = media(tela.filter(c => !c.vazia && c.tipo === 'k' && c.branca));
    const kp = media(tela.filter(c => !c.vazia && c.tipo === 'k' && !c.branca));
    let brancasEmbaixo = true;
    if (pb != null && pp != null && Math.abs(pb - pp) > 0.5) brancasEmbaixo = pb > pp;
    else if (kb != null && kp != null && kb !== kp) brancasEmbaixo = kb > kp;

    const linhas = [], duvidas = [];
    for (let rank = 8; rank >= 1; rank--) {
      let l = '';
      for (let f = 0; f < 8; f++) {
        const r = brancasEmbaixo ? 8 - rank : rank - 1;
        const c = brancasEmbaixo ? f : 7 - f;
        const casa = tela[r * 8 + c];
        if (casa.vazia) { l += '.'; continue; }
        l += casa.branca ? casa.tipo.toUpperCase() : casa.tipo;
        if (casa.duvida) duvidas.push('abcdefgh'[f] + rank);
      }
      linhas.push(l);
    }
    const r = { ok: true, linhas, duvidas, brancasEmbaixo };
    if (opts.debug) { r._casas = tela; r._tab = tab; }
    return r;
  }

  return { lerPrint, carregarModelos, _pesos: P };
})();

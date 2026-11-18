/* ==============================================================
   MODULE: board-photo.js
   Lê a posição de uma FOTO de tabuleiro de verdade com o modelo próprio
   do Gambyte, rodando no navegador (ONNX Runtime Web, sem servidor e
   sem custo por foto). Treinado em E:\GambyteIA (ver scripts/).

   Passos (iguais aos do treino em Python):
     1. Rede de cantos (256x256): mapa de calor dos 4 cantos.
     2. Homografia: a foto vira uma vista de cima (8 casas de 64 px, com
        2 casas de margem acima para o corpo das peças).
     3. Rede de casas: cada casa vira um recorte 64x128 (a casa e a de
        cima; as colunas da esquerda espelhadas) e é classificada em
        13 classes: vazia + 12 peças.
     4. Orientação: escolhe o giro em que a posição é mais plausível.

   Depende de: js/vendor/ort/ (carregado só quando a foto é usada)
   ============================================================== */
const BoardPhoto = (() => {
  const CLASSES = ['.', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
  const T = 256, SQ = 64, MARGEM = 2, RW = 64, RH = 128;
  const MEDIA = [0.485, 0.456, 0.406], DESVIO = [0.229, 0.224, 0.225];
  const BASE = 'js/vendor/ort/';
  const MODELOS = 'modelos-ia/';
  let carregando = null;

  function carregarScript(src) {
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar o leitor de fotos.'));
      document.head.appendChild(s);
    });
  }

  async function iniciar() {
    if (carregando) return carregando;
    carregando = (async () => {
      if (typeof ort === 'undefined') await carregarScript(BASE + 'ort.wasm.min.js');
      ort.env.wasm.wasmPaths = new URL(BASE, location.href).href;   // precisa ser URL completa
      ort.env.wasm.numThreads = 1;
      const op = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const [cantos, casas] = await Promise.all([
        ort.InferenceSession.create(MODELOS + 'cantos.onnx', op),
        ort.InferenceSession.create(MODELOS + 'casas.onnx', op),
      ]);
      return { cantos, casas };
    })();
    carregando.catch(() => { carregando = null; });
    return carregando;
  }

  function carregarImg(src) {
    return new Promise((ok, erro) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => erro(new Error('Não consegui abrir esta imagem.'));
      im.src = src;
    });
  }

  // Imagem RGB (canvas) -> tensor normalizado [3,h,w] em `dest` a partir de `off`.
  function normalizar(data, w, h, dest, off) {
    const n = w * h;
    for (let i = 0; i < n; i++) {
      dest[off + i]         = (data[i * 4]     / 255 - MEDIA[0]) / DESVIO[0];
      dest[off + n + i]     = (data[i * 4 + 1] / 255 - MEDIA[1]) / DESVIO[1];
      dest[off + 2 * n + i] = (data[i * 4 + 2] / 255 - MEDIA[2]) / DESVIO[2];
    }
  }

  // ── 1. Cantos ───────────────────────────────────────────────
  function picos(h, n = 4, raio = 12) {
    const m = Float32Array.from(h), out = [];
    for (let k = 0; k < n; k++) {
      let iMax = 0;
      for (let i = 1; i < m.length; i++) if (m[i] > m[iMax]) iMax = i;
      const y = Math.floor(iMax / T), x = iMax % T;
      let sx = 0, sy = 0, s = 1e-6;
      for (let yy = Math.max(0, y - 3); yy < Math.min(T, y + 4); yy++)
        for (let xx = Math.max(0, x - 3); xx < Math.min(T, x + 4); xx++) {
          const v = Math.max(0, m[yy * T + xx]); sx += xx * v; sy += yy * v; s += v;
        }
      out.push([sx / s, sy / s, m[iMax]]);
      for (let yy = Math.max(0, y - raio); yy <= Math.min(T - 1, y + raio); yy++)
        for (let xx = Math.max(0, x - raio); xx <= Math.min(T - 1, x + raio); xx++) m[yy * T + xx] = -1e9;
    }
    return out;
  }

  // Ordem: superior-esquerdo, superior-direito, inferior-direito, inferior-esquerdo.
  function ordenar(pts) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    const o = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let i0 = 0;
    for (let i = 1; i < 4; i++) if (o[i][0] + o[i][1] < o[i0][0] + o[i0][1]) i0 = i;
    return o.slice(i0).concat(o.slice(0, i0));
  }

  // A foto é reduzida para 256x256 por amostragem bilinear simples, igual
  // ao treino (cv2.warpAffine): a redução "suave" do drawImage muda o que a
  // rede vê e piora os cantos (66% → 60% das casas nas fotos de teste).
  async function acharCantos(s, fonte, w, h) {
    const esc = T / Math.max(w, h), ox = (T - w * esc) / 2, oy = (T - h * esc) / 2;
    const px = new Uint8ClampedArray(T * T * 4);
    const pega = (xx, yy, c) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : fonte[(yy * w + xx) * 4 + c];
    for (let y = 0; y < T; y++) {
      const sy = (y - oy) / esc, y0 = Math.floor(sy), ay = sy - y0;
      for (let x = 0; x < T; x++) {
        const sx = (x - ox) / esc, x0 = Math.floor(sx), ax = sx - x0, o = (y * T + x) * 4;
        for (let c = 0; c < 3; c++) {
          px[o + c] = (pega(x0, y0, c) * (1 - ax) + pega(x0 + 1, y0, c) * ax) * (1 - ay) +
                      (pega(x0, y0 + 1, c) * (1 - ax) + pega(x0 + 1, y0 + 1, c) * ax) * ay;
        }
        px[o + 3] = 255;
      }
    }
    const x = new Float32Array(3 * T * T);
    normalizar(px, T, T, x, 0);
    const r = await s.cantos.run({ x: new ort.Tensor('float32', x, [1, 3, T, T]) });
    const z = r.y.data;
    const p = new Float32Array(T * T);
    for (let i = 0; i < p.length; i++) p[i] = 1 / (1 + Math.exp(-z[i]));
    const pk = picos(p);
    const pts = pk.map(([px, py]) => [(px - ox) / esc, (py - oy) / esc]);
    return { cantos: ordenar(pts), confianca: Math.min(...pk.map(q => q[2])) };
  }

  // ── 2. Homografia e vista de cima ───────────────────────────
  // Resolve a homografia que leva src[i] -> dst[i] (8 incógnitas).
  function homografia(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {           // eliminação de Gauss com pivô
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const hh = b.map((v, i) => v / A[i][i]);
    return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
  }

  function vistaDeCima(fonte, fw, fh, cantos) {
    const L = 8 * SQ, W = L, H = (8 + MARGEM) * SQ;
    const dst = [[0, MARGEM * SQ], [L, MARGEM * SQ], [L, MARGEM * SQ + L], [0, MARGEM * SQ + L]];
    const M = homografia(dst, cantos);      // vista de cima -> foto
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = M[6] * x + M[7] * y + M[8];
        let sx = (M[0] * x + M[1] * y + M[2]) / d, sy = (M[3] * x + M[4] * y + M[5]) / d;
        sx = Math.min(fw - 1, Math.max(0, sx)); sy = Math.min(fh - 1, Math.max(0, sy));
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(fw - 1, x0 + 1), y1 = Math.min(fh - 1, y0 + 1);
        const ax = sx - x0, ay = sy - y0, o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v00 = fonte[(y0 * fw + x0) * 4 + c], v01 = fonte[(y0 * fw + x1) * 4 + c];
          const v10 = fonte[(y1 * fw + x0) * 4 + c], v11 = fonte[(y1 * fw + x1) * 4 + c];
          out[o + c] = (v00 * (1 - ax) + v01 * ax) * (1 - ay) + (v10 * (1 - ax) + v11 * ax) * ay;
        }
        out[o + 3] = 255;
      }
    }
    return { data: out, w: W, h: H };
  }

  // ── 3. Casas ────────────────────────────────────────────────
  async function lerCasas(s, cima) {
    const n = RW * RH, x = new Float32Array(64 * 3 * n);
    const rec = new Uint8ClampedArray(n * 4);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const y0 = (MARGEM + r + 1) * SQ - 2 * SQ, x0 = c * SQ;
      for (let yy = 0; yy < RH; yy++) for (let xx = 0; xx < RW; xx++) {
        const sxx = c < 4 ? RW - 1 - xx : xx;          // metade esquerda espelhada
        const o = ((y0 + yy) * cima.w + x0 + sxx) * 4, d = (yy * RW + xx) * 4;
        rec[d] = cima.data[o]; rec[d + 1] = cima.data[o + 1]; rec[d + 2] = cima.data[o + 2]; rec[d + 3] = 255;
      }
      normalizar(rec, RW, RH, x, (r * 8 + c) * 3 * n);
    }
    const res = await s.casas.run({ x: new ort.Tensor('float32', x, [64, 3, RH, RW]) });
    const z = res.y.data, pr = [];
    for (let i = 0; i < 64; i++) {
      let m = -1e9;
      for (let k = 0; k < 13; k++) m = Math.max(m, z[i * 13 + k]);
      let soma = 0; const p = [];
      for (let k = 0; k < 13; k++) { const e = Math.exp(z[i * 13 + k] - m); p.push(e); soma += e; }
      pr.push(p.map(v => v / soma));
    }
    const esc = decodificar(ajustarCores(pr));
    return esc.map((peca, i) => ({ peca, prob: pr[i][CLASSES.indexOf(peca)] }));
  }

  // Separa as peças da foto em dois grupos de cor pelo maior "salto" em
  // quanto cada uma parece branca (igual a scripts/ler_foto.py).
  function ajustarCores(pr0) {
    const pr = pr0.map(p => p.slice());
    const ocup = [];
    for (let i = 0; i < 64; i++) if (pr[i][0] < 0.5) ocup.push(i);
    if (ocup.length < 4) return pr;
    const s = pr.map(p => { const b = p.slice(1, 7).reduce((a, c) => a + c, 0), n = p.slice(7, 13).reduce((a, c) => a + c, 0); return b / (b + n + 1e-9); });
    const ordem = ocup.slice().sort((a, b) => s[a] - s[b]);
    const n = ordem.length;
    let melhor = null;
    for (let j = 0; j < n - 1; j++) {
      if (j + 1 < 1 || j + 1 > 16 || n - (j + 1) > 16) continue;
      const salto = s[ordem[j + 1]] - s[ordem[j]];
      if (!melhor || salto > melhor.salto) melhor = { salto, j };
    }
    if (!melhor || melhor.salto < 0.15) return pr;
    const brancas = new Set(ordem.slice(melhor.j + 1));
    for (const i of ocup) {
      const tipo = [1, 2, 3, 4, 5, 6].map(k => pr[i][k] + pr[i][k + 6]);
      for (let k = 1; k < 13; k++) pr[i][k] = 0;
      for (let k = 0; k < 6; k++) pr[i][(brancas.has(i) ? 1 : 7) + k] = tipo[k];
    }
    return pr;
  }

  // Escolhe a peça de cada casa respeitando quantas cabem de cada tipo
  // (um rei de cada cor, até 8 peões…), as escolhas mais seguras primeiro.
  const LIMITE = { '.': 64, P: 8, p: 8, N: 2, n: 2, B: 2, b: 2, R: 2, r: 2, Q: 1, q: 1, K: 1, k: 1 };
  function decodificar(pr) {
    const ops = [];
    for (let i = 0; i < 64; i++) for (let k = 0; k < 13; k++) ops.push([pr[i][k], i, k]);
    ops.sort((a, b) => b[0] - a[0]);
    const usados = Object.fromEntries(CLASSES.map(c => [c, 0]));
    const esc = new Array(64).fill(null);
    for (const [, i, k] of ops) {
      const c = CLASSES[k];
      if (esc[i] === null && usados[c] < LIMITE[c]) { esc[i] = c; usados[c]++; }
    }
    for (const rei of ['K', 'k']) {
      if (usados[rei]) continue;
      const k = CLASSES.indexOf(rei);
      let iM = 0;
      for (let i = 1; i < 64; i++) if ((esc[i] === 'K' || esc[i] === 'k' ? -1 : pr[i][k]) > (esc[iM] === 'K' || esc[iM] === 'k' ? -1 : pr[iM][k])) iM = i;
      esc[iM] = rei;
    }
    return esc;
  }

  // ── 4. Orientação ───────────────────────────────────────────
  const girar = g => g.map((_, i) => g.map((__, j) => g[j][7 - i]));   // 90° anti-horário (np.rot90)

  // Devolve { g, k }: a grade na orientação padrão e quantos giros de 90°
  // (anti-horário) foram aplicados à grade como ela aparece na foto.
  function orientar(grade) {
    let melhor = null, notaM = -1e9, kM = 0, g = grade;
    for (let k = 0; k < 4; k++, g = girar(g)) {
      let nota = 0;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const p = g[i][j].peca;
        if (p === '.') continue;
        const fil = 8 - i;
        if (p === p.toUpperCase()) nota += (4.5 - fil) * (p === 'P' ? 1.5 : 1);
        else nota += (fil - 4.5) * (p === 'p' ? 1.5 : 1);
        if ((p === 'P' || p === 'p') && (fil === 1 || fil === 8)) nota -= 20;
      }
      if (nota > notaM) { notaM = nota; melhor = g; kM = k; }
    }
    return { g: melhor, k: kM };
  }

  /**
   * Lê a posição de uma foto. Devolve
   *   { ok, linhas: 8 textos (fileira 8 → 1, 'a' → 'h', '.' vazio),
   *     brancasEmbaixo: true, duvidas: ['e4', ...], cantos: 4 pontos na
   *     imagem, giro: giros de 90° da foto para a posição, motivo }
   */
  async function lerFoto(src) {
    const s = await iniciar();
    const img = await carregarImg(src);
    const fw = img.naturalWidth, fh = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = fw; cv.height = fh;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const pixels = cx.getImageData(0, 0, fw, fh).data;
    const { cantos, confianca } = await acharCantos(s, pixels, fw, fh);
    if (confianca < 0.25) {
      return { ok: false, motivo: 'Não encontrei o tabuleiro inteiro nesta foto. Tire de novo mostrando as 4 bordas do tabuleiro.' };
    }
    const cima = vistaDeCima(pixels, fw, fh, cantos);
    const casas = await lerCasas(s, cima);
    const grade = [];
    for (let r = 0; r < 8; r++) grade.push(casas.slice(r * 8, r * 8 + 8));
    const { g, k } = orientar(grade);
    const linhas = g.map(l => l.map(c => c.peca).join(''));
    const duvidas = [];
    g.forEach((l, i) => l.forEach((c, j) => { if (c.prob < 0.6) duvidas.push('abcdefgh'[j] + (8 - i)); }));
    return { ok: true, linhas, brancasEmbaixo: true, duvidas, cantos, giro: k };
  }

  return { lerFoto, iniciar };
})();

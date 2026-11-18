/* ==============================================================
   MODULE: photo-position.js
   Gambyte Pro: posição pela FOTO do tabuleiro ou por um PRINT de tela.

   - Foto (tabuleiro de verdade): lida pelo modelo próprio do Gambyte
     (board-photo.js), também no aparelho, sem servidor e sem custo.
   - Print (Chess.com, Lichess, diagrama): lido no próprio aparelho por
     BoardScan, sem enviar a imagem para lugar nenhum.
   Nos dois casos a posição abre num editor para conferir e corrigir
   (peças, vez de jogar, roques, lado de baixo) antes de ir ao tabuleiro.

   Depende de: board-scan.js, board-photo.js, auth-system.js,
               pgn-parser.js, board-ui.js (pieceSrc), app.js (loadPosition)
   ============================================================== */
const PhotoPosition = (() => {
  const $ = id => document.getElementById(id);
  const PECAS = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
  const NOMES = { K: 'Rei', Q: 'Dama', R: 'Torre', B: 'Bispo', N: 'Cavalo', P: 'Peão' };
  const MAX_LADO = 1280;   // suficiente para as peças e rápido no celular

  let ed = null;   // estado do editor

  // ── Acesso: só Pro ──────────────────────────────────────────
  function ehPro() { return typeof AuthSystem !== 'undefined' && AuthSystem.isPremium(); }

  function status(msg, tipo) {
    const el = $('foto-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'foto-status' + (tipo ? ' ' + tipo : '');
  }

  function logado() { return typeof AuthSystem !== 'undefined' && !!AuthSystem.currentSession(); }

  function mostrarBloqueio(titulo, texto) {
    const lock = $('foto-lock');
    if (!lock) return;
    lock.hidden = false;
    const t = lock.querySelector('[data-foto-lock-titulo]'), x = lock.querySelector('[data-foto-lock-texto]');
    if (t && titulo) t.textContent = titulo;
    if (x && texto) x.textContent = texto;
    lock.querySelector('[data-foto-entrar]').hidden = logado();
    lock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Antes de abrir a câmera ou o arquivo: todos seguem. O teste grátis é
  // conferido no servidor na hora de ler a imagem (usarFoto).
  function liberado() { return true; }

  // Na hora de ler a imagem: o Pro usa à vontade. Quem não é Pro gasta o
  // teste grátis, contado no servidor: com conta, uma vez por dia (por conta
  // e por IP); sem conta, uma vez só por IP.
  async function usarFoto() {
    if (ehPro()) return true;
    status(logado() ? 'Conferindo seu teste grátis de hoje…' : 'Conferindo seu teste grátis…', 'lendo');
    let r = null;
    try {
      const { data, error } = await supabaseClient.functions.invoke('foto-gratis', { body: {} });
      r = error ? null : data;
    } catch (e) { r = null; }
    if (r && r.ok) {
      if (r.semConta) status('Usando seu teste grátis. Para continuar depois, crie uma conta grátis: com ela você usa uma foto por dia.', 'lendo');
      else if (r.gratis) status('Usando sua foto grátis de hoje. Amanhã você ganha outra; no Pro é à vontade.', 'lendo');
      return true;
    }
    status('');
    GameImport.mostrarAba('foto', true);
    if (r && r.motivo === 'usada') mostrarBloqueio('Você já usou sua foto grátis de hoje.', r.mensagem || 'Volte amanhã ou assine o Pro para usar quantas vezes quiser.');
    else if (r && r.motivo === 'entrar') mostrarBloqueio('Você já usou o teste sem conta.', r.mensagem || 'Crie uma conta grátis para usar uma foto por dia, ou assine o Pro para usar quantas vezes quiser.');
    else status('Não consegui conferir seu teste grátis agora. Verifique a conexão e tente de novo.', 'erro');
    return false;
  }

  // ── Imagem: reduzir e converter ─────────────────────────────
  function lerArquivo(file) {
    return new Promise((ok, erro) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => ok({ im, url });
      im.onerror = () => { URL.revokeObjectURL(url); erro(new Error('Não consegui abrir esta imagem.')); };
      im.src = url;
    });
  }

  function reduzir(im) {
    const w = im.naturalWidth, h = im.naturalHeight;
    const k = Math.min(1, MAX_LADO / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  }

  // ── Leitura de foto pelo modelo próprio ─────────────────────
  async function lerFotoModelo(dataUrl) {
    status('Lendo a foto no seu aparelho… (na primeira vez, o leitor é baixado)', 'lendo');
    return BoardPhoto.lerFoto(dataUrl);
  }

  // ── Fluxo principal ─────────────────────────────────────────
  async function processar(file, modo) {
    if (!file || !/^image\//.test(file.type)) { status('Escolha um arquivo de imagem.', 'erro'); return; }
    if (!liberado()) return;
    let aberto;
    try { aberto = await lerArquivo(file); } catch (e) { status(e.message, 'erro'); return; }
    if (!(await usarFoto())) { URL.revokeObjectURL(aberto.url); return; }
    const dataUrl = reduzir(aberto.im);
    URL.revokeObjectURL(aberto.url);
    try {
      // Imagem escolhida ou colada: primeiro tenta ler como print (mais
      // rápido). Se não houver um tabuleiro reto, lê como foto de tabuleiro
      // de verdade, com o modelo próprio.
      if (modo === 'auto') {
        status('Procurando o tabuleiro na imagem…', 'lendo');
        const r = await BoardScan.lerPrint(dataUrl);
        if (r.ok) { status(''); abrirEditor(r, dataUrl, 'print'); return; }
        modo = 'foto';
      }
      if (modo === 'print') {
        status('Lendo o print no seu aparelho…', 'lendo');
        const r = await BoardScan.lerPrint(dataUrl);
        if (!r.ok) {
          status(r.motivo, 'erro');
          abrirEditor(null, dataUrl, 'print', true);
          return;
        }
        status('');
        abrirEditor(r, dataUrl, 'print');
      } else {
        const r = await lerFotoModelo(dataUrl);
        if (!r || !r.ok) {
          status((r && r.motivo) || 'Não encontrei um tabuleiro nesta foto.', 'erro');
          abrirEditor(null, dataUrl, 'foto', true);
          return;
        }
        status('');
        abrirEditor(r, dataUrl, 'foto');
      }
    } catch (e) {
      status(e.message || 'Algo deu errado ao ler a imagem.', 'erro');
    }
  }

  // ── Editor de posição ───────────────────────────────────────
  function tabuleiroDe(linhas) {
    return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
      const ch = linhas && linhas[r] ? linhas[r][c] : '.';
      return ch && /^[KQRBNPkqrbnp]$/.test(ch) ? ch : '';
    }));
  }
  const INICIAL = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];

  function abrirEditor(leitura, dataUrl, origem, vazio) {
    fecharEditor();
    ed = {
      board: tabuleiroDe(vazio ? INICIAL : leitura.linhas),
      brancasEmbaixo: leitura ? leitura.brancasEmbaixo !== false : true,
      vez: leitura && leitura.vez === 'pretas' ? 'b' : 'w',
      duvidas: new Set(leitura && leitura.duvidas ? leitura.duvidas : []),
      ferramenta: null,
      origem, dataUrl,
      roques: null,
      // Foto de tabuleiro: os 4 cantos (na imagem) e quantos giros de 90°
      // levam a grade da foto para a posição — vão junto se a pessoa
      // autorizar o envio para treinar o leitor.
      cantos: leitura && leitura.cantos ? leitura.cantos.map(q => [q[0], q[1]]) : [],
      giro: leitura && Number.isInteger(leitura.giro) ? leitura.giro : 0,
      lido: leitura && leitura.linhas ? leitura.linhas.join('/') : '',
    };
    ed.roques = roquesPossiveis();
    const el = document.createElement('div');
    el.className = 'pos-editor-fundo';
    el.id = 'pos-editor';
    el.innerHTML = `
      <div class="pos-editor" role="dialog" aria-modal="true" aria-labelledby="pos-ed-titulo">
        <div class="pos-ed-head">
          <h2 id="pos-ed-titulo">Confira a posição</h2>
          <button type="button" class="pos-ed-x" data-ed="fechar" aria-label="Fechar">×</button>
        </div>
        ${origem === 'foto' && !vazio ? '<p class="pos-ed-beta"><b>Experimental</b> A leitura de fotos de tabuleiro ainda está aprendendo e pode errar várias peças. Confira tudo antes de analisar. Ela melhora com as fotos que os jogadores autorizam enviar.</p>' : ''}
        <p class="pos-ed-sub">${vazio ?'Não deu para ler esta imagem. Monte a posição abaixo olhando a imagem ao lado.' : 'Compare com a imagem. Para corrigir uma casa, escolha a peça abaixo e clique na casa.'}${ed.duvidas.size ? ' As casas com contorno amarelo merecem um segundo olhar.' : ''}</p>
        <div class="pos-ed-corpo">
          <div class="pos-ed-esq">
            <div class="pos-ed-board" id="pos-ed-board"></div>
            <div class="pos-ed-paleta" id="pos-ed-paleta"></div>
          </div>
          <div class="pos-ed-dir">
            ${origem === 'foto'
              ? '<div class="pos-ed-foto"><canvas id="pos-ed-cv" aria-label="Foto com os cantos do tabuleiro"></canvas></div><p class="pos-ed-dica">Arraste os pontos verdes até os 4 cantos do tabuleiro.</p>'
              : `<img class="pos-ed-img" alt="Imagem enviada" src="${dataUrl}">`}
            <div class="pos-ed-grupo">
              <span class="pos-ed-rot">Vez de jogar</span>
              <div class="pos-ed-seg" data-grupo="vez">
                <button type="button" data-vez="w">Brancas</button><button type="button" data-vez="b">Pretas</button>
              </div>
            </div>
            <div class="pos-ed-grupo">
              <span class="pos-ed-rot">Lado de baixo na imagem</span>
              <div class="pos-ed-seg" data-grupo="lado">
                <button type="button" data-lado="w">Brancas</button><button type="button" data-lado="b">Pretas</button>
              </div>
            </div>
            <div class="pos-ed-grupo">
              <span class="pos-ed-rot">Roques ainda possíveis</span>
              <div class="pos-ed-roques" id="pos-ed-roques"></div>
            </div>
            <div class="pos-ed-acoes2">
              <button type="button" class="btn-secondary" data-ed="limpar">Limpar</button>
              <button type="button" class="btn-secondary" data-ed="inicial">Posição inicial</button>
              ${origem === 'foto' ? '<button type="button" class="btn-secondary" data-ed="girar" title="Gira a posição 90°, para fotos tiradas de lado">Girar 90°</button>' : ''}
              ${origem === 'print' ? '<button type="button" class="btn-secondary" data-ed="ia" title="Lê a imagem como foto de um tabuleiro de verdade">Ler como foto</button>' : ''}
            </div>
          </div>
        </div>
        <div class="pos-ed-fenrow">
          <label for="pos-ed-fen">FEN</label>
          <input type="text" id="pos-ed-fen" spellcheck="false" autocomplete="off" aria-label="FEN da posição">
          <button type="button" class="btn-secondary" data-ed="fen">Aplicar</button>
          <button type="button" class="btn-secondary" data-ed="copiar">Copiar</button>
        </div>
        ${origem === 'foto' ? `<label class="pos-ed-treino"><input type="checkbox" id="pos-ed-treino" data-treino-foto ${treinoAutorizado() ? 'checked' : ''}> <span><strong>Ajudar a melhorar o leitor de fotos</strong>Ao analisar, enviar esta foto com a posição que você conferiu, para treinar o leitor do Gambyte. Ela fica num armazenamento privado, sem seu nome ou e-mail, e é usada só para isso. <a href="privacidade.html#fotos-treino" target="_blank" rel="noopener">Saiba mais</a></span></label>` : ''}
        <p class="pos-ed-aviso" id="pos-ed-aviso" role="alert"></p>
        <div class="pos-ed-foot">
          <button type="button" class="btn-secondary" data-ed="fechar">Cancelar</button>
          <button type="button" class="btn-primary" data-ed="analisar">Analisar posição</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('pos-ed-aberto');
    el.addEventListener('click', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    if (origem === 'foto') ligarFoto();
    desenhar();
    el.querySelector('[data-ed="analisar"]').focus({ preventScroll: true });
  }

  function fecharEditor() {
    const el = $('pos-editor');
    if (el) el.remove();
    document.body.classList.remove('pos-ed-aberto');
    document.removeEventListener('keydown', aoTeclar);
    ed = null;
  }

  function aoTeclar(e) {
    if (e.key === 'Escape') fecharEditor();
    else if (e.key === 'Enter' && e.target && e.target.id === 'pos-ed-fen') {
      e.preventDefault();
      document.querySelector('#pos-editor [data-ed="fen"]')?.click();
    }
  }

  // Roques que a posição permite (rei e torre nas casas de origem).
  function roquesPossiveis() {
    const b = ed.board;
    return {
      K: b[7][4] === 'K' && b[7][7] === 'R',
      Q: b[7][4] === 'K' && b[7][0] === 'R',
      k: b[0][4] === 'k' && b[0][7] === 'r',
      q: b[0][4] === 'k' && b[0][0] === 'r',
    };
  }

  function desenhar() {
    if (!ed) return;
    const tab = $('pos-ed-board');
    let html = '';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const r = ed.brancasEmbaixo ? i : 7 - i, c = ed.brancasEmbaixo ? j : 7 - j;
      const sq = 'abcdefgh'[c] + (8 - r);
      const p = ed.board[r][c];
      const clara = (r + c) % 2 === 0;
      const coordF = i === 7 ? `<i class="pos-ed-cf">${'abcdefgh'[c]}</i>` : '';
      const coordR = j === 0 ? `<i class="pos-ed-cr">${8 - r}</i>` : '';
      html += `<button type="button" class="pos-ed-sq ${clara ? 'cl' : 'es'}${ed.duvidas.has(sq) ? ' duvida' : ''}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + (p === p.toUpperCase() ? 'branca ' : 'preta ') + NOMES[p.toUpperCase()].toLowerCase() : ' vazia'}">${p ? `<img src="${BoardUI.pieceSrc(p)}" alt="">` : ''}${coordR}${coordF}</button>`;
    }
    tab.innerHTML = html;
    const pal = $('pos-ed-paleta');
    pal.innerHTML = PECAS.map(p => `<button type="button" class="pos-ed-p${ed.ferramenta === p ? ' on' : ''}" data-peca="${p}" title="${NOMES[p.toUpperCase()]} ${p === p.toUpperCase() ? 'branco' : 'preto'}"><img src="${BoardUI.pieceSrc(p)}" alt="${NOMES[p.toUpperCase()]}"></button>`).join('')
      + `<button type="button" class="pos-ed-p apagar${ed.ferramenta === '' ? ' on' : ''}" data-peca="" title="Apagar">Apagar</button>`;
    document.querySelectorAll('#pos-editor [data-vez]').forEach(b => b.classList.toggle('on', b.dataset.vez === ed.vez));
    document.querySelectorAll('#pos-editor [data-lado]').forEach(b => b.classList.toggle('on', (b.dataset.lado === 'w') === ed.brancasEmbaixo));
    const pode = roquesPossiveis();
    const rq = [['K', 'Brancas O-O'], ['Q', 'Brancas O-O-O'], ['k', 'Pretas O-O'], ['q', 'Pretas O-O-O']];
    $('pos-ed-roques').innerHTML = rq.map(([k, t]) =>
      `<label class="${pode[k] ? '' : 'off'}"><input type="checkbox" data-roque="${k}" ${pode[k] && ed.roques[k] ? 'checked' : ''} ${pode[k] ? '' : 'disabled'}> ${t}</label>`).join('');
    validar();
  }

  function aoClicar(e) {
    if (e.target.id === 'pos-editor') { fecharEditor(); return; }
    const acao = e.target.closest('[data-ed]');
    if (acao) {
      const a = acao.dataset.ed;
      if (a === 'fechar') { fecharEditor(); return; }
      if (a === 'limpar') { ed.board = tabuleiroDe(null); ed.duvidas.clear(); }
      if (a === 'inicial') { ed.board = tabuleiroDe(INICIAL); ed.duvidas.clear(); ed.roques = { K: true, Q: true, k: true, q: true }; ed.vez = 'w'; }
      if (a === 'ia') { relerComoFoto(); return; }
      if (a === 'girar') {
        // Gira a posição 90° no sentido anti-horário (como np.rot90).
        const b = ed.board;
        ed.board = b.map((_, i) => b.map((__, j) => b[j][7 - i]));
        ed.duvidas = new Set([...ed.duvidas].map(q => {
          const c = q.charCodeAt(0) - 97, r = 8 - parseInt(q[1], 10);
          return 'abcdefgh'[r] + (8 - (7 - c));
        }));
        ed.giro = (ed.giro + 1) % 4;
        ed.roques = roquesPossiveis();
      }
      if (a === 'copiar') {
        navigator.clipboard?.writeText(fen()).then(() => aviso('FEN copiado.', true), () => aviso('Não foi possível copiar.', true));
        return;
      }
      if (a === 'fen') {
        const r = lerFEN($('pos-ed-fen').value);
        if (r.erro) { aviso(r.erro); return; }
        ed.board = r.board; ed.vez = r.vez; ed.roques = r.roques; ed.duvidas.clear();
        $('pos-ed-fen').blur();
      }
      if (a === 'analisar') { analisar(); return; }
      desenhar();
      return;
    }
    const peca = e.target.closest('[data-peca]');
    if (peca) { ed.ferramenta = ed.ferramenta === peca.dataset.peca ? null : peca.dataset.peca; desenhar(); return; }
    const vez = e.target.closest('[data-vez]');
    if (vez) { ed.vez = vez.dataset.vez; desenhar(); return; }
    const lado = e.target.closest('[data-lado]');
    if (lado) {
      const novo = lado.dataset.lado === 'w';
      if (novo !== ed.brancasEmbaixo) {
        // A imagem não muda: trocar o lado de baixo gira a leitura 180°.
        ed.board = ed.board.map(l => l.slice().reverse()).reverse();
        ed.duvidas = new Set([...ed.duvidas].map(s => 'abcdefgh'[7 - (s.charCodeAt(0) - 97)] + (9 - parseInt(s[1], 10))));
        ed.brancasEmbaixo = novo;
        ed.giro = (ed.giro + 2) % 4;
        ed.roques = roquesPossiveis();
      }
      desenhar();
      return;
    }
    const roque = e.target.closest('[data-roque]');
    if (roque) { ed.roques[roque.dataset.roque] = roque.checked; validar(); return; }
    const casa = e.target.closest('[data-sq]');
    if (casa) {
      const sq = casa.dataset.sq;
      const r = 8 - parseInt(sq[1], 10), c = sq.charCodeAt(0) - 97;
      if (ed.ferramenta == null) {
        // Sem peça escolhida: só explica como corrigir.
        aviso('Escolha uma peça abaixo do tabuleiro (ou "Apagar") e clique na casa.', true);
        return;
      }
      ed.board[r][c] = ed.board[r][c] === ed.ferramenta ? '' : ed.ferramenta;
      ed.duvidas.delete(sq);
      const antes = ed.roques;
      ed.roques = Object.fromEntries(Object.entries(roquesPossiveis()).map(([k, v]) => [k, v && (antes[k] !== false)]));
      desenhar();
    }
  }

  function aviso(msg, leve) {
    const el = $('pos-ed-aviso');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('leve', !!leve);
  }

  function fen() {
    const linhas = ed.board.map(l => {
      let s = '', v = 0;
      for (const p of l) { if (!p) v++; else { if (v) { s += v; v = 0; } s += p; } }
      return s + (v ? v : '');
    });
    const pode = roquesPossiveis();
    const roq = ['K', 'Q', 'k', 'q'].filter(k => pode[k] && ed.roques[k]).join('') || '-';
    return `${linhas.join('/')} ${ed.vez} ${roq} - 0 1`;
  }

  // Posição precisa ser jogável: um rei de cada cor, sem peão na primeira
  // ou na última fileira, e quem não joga não pode estar em xeque.
  function problema(b, vez) {
    const conta = p => b.flat().filter(x => x === p).length;
    if (conta('K') !== 1 || conta('k') !== 1) return 'A posição precisa de exatamente um rei branco e um rei preto.';
    if (b[0].some(p => p === 'P' || p === 'p') || b[7].some(p => p === 'P' || p === 'p')) return 'Há um peão na primeira ou na última fileira, o que não é possível.';
    const sqDe = p => { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === p) return 'abcdefgh'[c] + (8 - r); return null; };
    const reiQueNaoJoga = vez === 'w' ? sqDe('k') : sqDe('K');
    if (PGNParser.isSquareAttacked(b, reiQueNaoJoga, vez === 'w')) {
      return `O rei ${vez === 'w' ? 'preto' : 'branco'} está em xeque, então a vez seria ${vez === 'w' ? 'das pretas' : 'das brancas'}. Confira a vez de jogar.`;
    }
    return '';
  }

  // Lê um FEN (aceita só a parte das peças; o resto ganha valores padrão).
  // Devolve { board, vez, roques, fen } ou { erro }.
  function lerFEN(texto) {
    const partes = String(texto || '').trim().split(/\s+/);
    const linhas = (partes[0] || '').split('/');
    if (linhas.length !== 8) return { erro: 'FEN inválido: são necessárias 8 fileiras separadas por "/".' };
    const board = [];
    for (const l of linhas) {
      const fila = [];
      for (const ch of l) {
        if (/[1-8]/.test(ch)) for (let i = 0; i < +ch; i++) fila.push('');
        else if (/[pnbrqkPNBRQK]/.test(ch)) fila.push(ch);
        else return { erro: `FEN inválido: caractere "${ch}" não é uma peça.` };
      }
      if (fila.length !== 8) return { erro: 'FEN inválido: cada fileira precisa somar 8 casas.' };
      board.push(fila);
    }
    const vez = partes[1] === 'b' ? 'b' : 'w';
    const r = /^[KQkq]+$/.test(partes[2] || '') ? partes[2] : '';
    const roques = { K: r.includes('K'), Q: r.includes('Q'), k: r.includes('k'), q: r.includes('q') };
    const ep = /^[a-h][36]$/.test(partes[3] || '') ? partes[3] : '-';
    const meio = /^\d+$/.test(partes[4] || '') ? partes[4] : '0';
    const num = /^[1-9]\d*$/.test(partes[5] || '') ? partes[5] : '1';
    const erro = problema(board, vez);
    if (erro) return { erro };
    // Só mantém roques que a posição permite.
    const pode = {
      K: board[7][4] === 'K' && board[7][7] === 'R', Q: board[7][4] === 'K' && board[7][0] === 'R',
      k: board[0][4] === 'k' && board[0][7] === 'r', q: board[0][4] === 'k' && board[0][0] === 'r',
    };
    const roq = ['K', 'Q', 'k', 'q'].filter(k => roques[k] && pode[k]).join('') || '-';
    return { board, vez, roques, fen: `${partes[0]} ${vez} ${roq} ${ep} ${meio} ${num}` };
  }

  /** Abre direto no tabuleiro uma posição em FEN. Devolve '' ou a mensagem de erro. */
  function abrirFEN(texto, brancasEmbaixo = true) {
    const r = lerFEN(texto);
    if (r.erro) return r.erro;
    App.loadPosition(r.fen, brancasEmbaixo);
    return '';
  }

  function validar() {
    const msg = problema(ed.board, ed.vez);
    const campo = $('pos-ed-fen');
    if (campo && document.activeElement !== campo) campo.value = fen();
    aviso(msg);
    const bt = document.querySelector('#pos-editor [data-ed="analisar"]');
    if (bt) bt.disabled = !!msg;
    return !msg;
  }

  // ── Fotos corrigidas para treinar o leitor ──────────────────
  const CHAVE_TREINO = 'gambyte_treino_foto';
  function treinoAutorizado() {
    try { return localStorage.getItem(CHAVE_TREINO) === '1'; } catch (e) { return false; }
  }
  function guardarAutorizacao(sim) {
    try { localStorage.setItem(CHAVE_TREINO, sim ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    document.querySelectorAll('[data-treino-foto]').forEach(c => { c.checked = sim; });
  }
  // Filtro leve antes de enviar: só fotos em que há um tabuleiro marcado de
  // verdade (4 cantos formando um quadrilátero convexo que ocupa uma boa
  // parte da imagem) e uma posição possível (um rei de cada cor, até 32
  // peças). Isso já barra fotos que não são de tabuleiro.
  function fotoServeParaTreino(est, fenFinal) {
    const q = est.cantos;
    if (!q || q.length !== 4) return false;
    const img = est.tamanho || { w: 0, h: 0 };
    if (!img.w || !img.h) return false;
    if (!q.every(([x, y]) => x > -0.05 * img.w && x < 1.05 * img.w && y > -0.05 * img.h && y < 1.05 * img.h)) return false;
    let sinal = 0, area = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!z) return false;
      if (sinal && Math.sign(z) !== sinal) return false;      // não convexo
      sinal = Math.sign(z);
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) / 2 < 0.05 * img.w * img.h) return false;   // tabuleiro pequeno demais
    const pecas = fenFinal.split(' ')[0].replace(/[^a-zA-Z]/g, '');
    return pecas.length >= 2 && pecas.length <= 32 && (pecas.match(/K/g) || []).length === 1 && (pecas.match(/k/g) || []).length === 1;
  }
  // giro (foto -> posição, anti-horário) -> de que lado da foto ficam as brancas
  const LADO_DO_GIRO = ['baixo', 'esquerda', 'cima', 'direita'];
  function enviarTreino(est, fenFinal) {
    const corpo = {
      imagem: est.dataUrl.split(',')[1],
      fen: fenFinal.split(' ')[0],
      cantos: est.cantos,
      lado_brancas: LADO_DO_GIRO[est.giro % 4],
      lido: est.lido || '',
    };
    // Não segura a análise: envia em segundo plano e ignora falhas.
    supabaseClient.functions.invoke('foto-treino', { body: corpo }).catch(() => {});
  }

  // Foto com os cantos: arrastar os pontos (mouse ou dedo).
  function ligarFoto() {
    const cv = $('pos-ed-cv');
    const img = new Image();
    let arr = -1;
    const desenharFoto = () => {
      if (!img.naturalWidth) return;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const k = Math.max(2, img.naturalWidth / 260);
      if (ed.cantos.length) {
        cx.lineWidth = k; cx.strokeStyle = '#ecbd6e'; cx.fillStyle = 'rgba(236,189,110,.14)';
        cx.beginPath(); ed.cantos.forEach((q, i) => (i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])));
        if (ed.cantos.length === 4) { cx.closePath(); cx.fill(); }
        cx.stroke();
        for (const q of ed.cantos) { cx.beginPath(); cx.arc(q[0], q[1], k * 5, 0, 7); cx.fillStyle = '#5bc97a'; cx.fill(); cx.lineWidth = k; cx.strokeStyle = '#0d0f14'; cx.stroke(); }
      }
    };
    img.onload = () => {
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      if (ed) ed.tamanho = { w: img.naturalWidth, h: img.naturalHeight };
      desenharFoto();
    };
    img.src = ed.dataUrl;
    const ponto = e => { const r = cv.getBoundingClientRect(), k = cv.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      const q = ponto(e), raio = 28 * (cv.width / cv.getBoundingClientRect().width);
      arr = ed.cantos.findIndex(c => Math.hypot(c[0] - q[0], c[1] - q[1]) < raio);
      if (arr < 0 && ed.cantos.length < 4) { ed.cantos.push(q); arr = ed.cantos.length - 1; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      desenharFoto();
    });
    cv.addEventListener('pointermove', e => { if (arr >= 0) { ed.cantos[arr] = ponto(e); desenharFoto(); } });
    cv.addEventListener('pointerup', () => { arr = -1; });
    cv.addEventListener('pointercancel', () => { arr = -1; });
  }

  function analisar() {
    if (!validar()) return;
    const f = fen();
    const embaixo = ed.brancasEmbaixo;
    const caixa = $('pos-ed-treino');
    if (caixa) {
      guardarAutorizacao(caixa.checked);
      if (caixa.checked && logado() && fotoServeParaTreino(ed, f)) enviarTreino(ed, f);
    }
    fecharEditor();
    App.loadPosition(f, embaixo);
    status('Posição aberta no tabuleiro. Arraste as peças para continuar a partida.');
    $('board-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function relerComoFoto() {
    const dataUrl = ed.dataUrl;
    fecharEditor();
    try {
      const r = await lerFotoModelo(dataUrl);
      if (!r || !r.ok) { status((r && r.motivo) || 'Não encontrei um tabuleiro nesta imagem.', 'erro'); return; }
      status('');
      abrirEditor(r, dataUrl, 'foto');
    } catch (e) {
      status(e.message, 'erro');
    }
  }

  // ── Ligações da aba ─────────────────────────────────────────
  function init() {
    const box = $('foto-box');
    if (!box) return;
    const cam = $('foto-camera'), arq = $('foto-arquivo');
    const fecharMenu = () => { const m = $('foto-menu'); if (m) m.hidden = true; };
    // Botões de foto: na aba e no menu da câmera ao lado do tabuleiro.
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-foto]');
      if (!b) return;
      fecharMenu();
      if (!liberado()) return;
      if (b.dataset.foto === 'camera') cam.click();
      else arq.click();
    });
    cam.addEventListener('change', () => { processar(cam.files[0], 'foto'); cam.value = ''; });
    arq.addEventListener('change', () => { processar(arq.files[0], 'auto'); arq.value = ''; });
    // Arrastar a imagem para a área da aba.
    const zona = $('foto-zona');
    if (zona) {
      zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
      zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
      zona.addEventListener('drop', e => {
        e.preventDefault();
        zona.classList.remove('sobre');
        const f = e.dataTransfer?.files?.[0];
        if (f) processar(f, 'auto');
      });
    }
    // Colar uma imagem (Ctrl+V) com a aba aberta.
    document.addEventListener('paste', e => {
      if (box.hidden || ed) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      processar(item.getAsFile(), 'auto');
    });
    // Botão da câmera ao lado do tabuleiro: abre o menu de opções.
    const btn = $('btn-foto'), menu = $('foto-menu');
    if (btn && menu) {
      btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#foto-menu-wrap')) fecharMenu(); });
    }
    // Atalhos (cartão de destaque, texto de abertura) para a aba.
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-ir-foto]')) return;
      e.preventDefault();
      fecharMenu();
      GameImport.mostrarAba('foto', true);
      $('trazer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (typeof AuthSystem !== 'undefined') AuthSystem.onChange(() => { if (ehPro()) { const l = $('foto-lock'); if (l) l.hidden = true; } });
    // Autorização para usar as fotos no treino: a mesma escolha na aba e no editor.
    const aut = $('foto-treino');
    if (aut) aut.checked = treinoAutorizado();
    document.addEventListener('change', e => {
      if (e.target && e.target.matches && e.target.matches('[data-treino-foto]')) guardarAutorizacao(e.target.checked);
    });
  }

  return { init, abrirEditor, abrirFEN };
})();

document.addEventListener('DOMContentLoaded', () => PhotoPosition.init());

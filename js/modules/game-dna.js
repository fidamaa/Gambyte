/* ==============================================================
   MODULE: game-dna.js
   DNA DA PARTIDA: o retrato de UMA partida, só com os lances dela.

   É o par do DNA geral (player-dna.js), mas outro conceito e outro
   visual: aqui não há radar nem histórico. Mostra
     • a fita da partida: cada lance das brancas (em cima) e das pretas
       (embaixo), da cor da classificação, clicável;
     • o estilo apresentado nesta partida;
     • um duelo de barras brancas × pretas por característica
       (precisão, decisões, tática, estratégia, fases, consistência);
     • pontos fortes e dificuldades, em frases curtas.
   Tocar numa característica abre a explicação: o que é, como foi
   calculada e como cada lado foi nesta partida.
   Depende de: insights-engine.js, move-classifier.js
   ============================================================== */
const GameDNA = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const _cp = v => Math.abs(v) >= 29000 ? (v > 0 ? 1500 : -1500) : Math.max(-1500, Math.min(1500, v));
  const nota = acc => acc == null ? null : clamp(Math.round((acc - 40) / 0.6), 0, 100);
  const TOPO = ['brilliant', 'great', 'best-move', 'excellent'];
  const GRAVES = ['blunder', 'mistake', 'miss'];

  /* ── Cálculo (só esta partida) ─────────────────────────────── */
  function lado(moves, cor) {
    const meus = moves.filter(m => m && m.color === cor && m.classification);
    const fora = meus.filter(m => m.classification !== 'book');
    if (fora.length < 3) return null;
    const n = k => fora.filter(m => m.classification === k).length;
    const acc = InsightsEngine.calcAccuracy(moves, cor);
    const topo = fora.filter(m => TOPO.includes(m.classification)).length;

    // Tática: momentos de lance único (o melhor era bem melhor que o segundo)
    let chances = 0, achou = 0;
    const calmos = [];
    fora.forEach(m => {
      const ev = m.multiPVEvals;
      if (!ev || ev.length < 2 || ev[0] == null || ev[1] == null) { calmos.push(m); return; }
      const gap = _cp(ev[0]) - _cp(ev[1]);
      if (gap >= 150 && _cp(ev[0]) > -300) {
        chances++;
        if (m.bestMoveUCI && m.playedMoveUCI && m.bestMoveUCI.slice(0, 4) === m.playedMoveUCI.slice(0, 4)) achou++;
      } else if (gap < 60) calmos.push(m);
    });
    const tatica = chances ? clamp(Math.round(100 * achou / chances - 10 * n('miss')), 0, 100) : null;
    // Estratégia: precisão nos lances "calmos" (várias opções parecidas, sem tática forçada)
    const estrategia = calmos.length >= 4 ? nota(InsightsEngine.calcAccuracy(calmos, cor)) : null;
    const fases = InsightsEngine.calcPhaseAccuracy(moves, cor);
    const peso = n('blunder') * 3 + (n('mistake') + n('miss')) * 1.5 + n('inaccuracy') * 0.5;
    const consistencia = clamp(Math.round(100 * (1 - peso / fora.length)), 0, 100);
    // Maior sequência sem erro grave
    let seq = 0, maior = 0;
    fora.forEach(m => { if (GRAVES.includes(m.classification)) seq = 0; else maior = Math.max(maior, ++seq); });

    const forcantes = fora.filter(m => /[+x#]/.test(m.san || '')).length / fora.length;
    let ritmo = forcantes > 0.45 ? 'ativo e forçante' : forcantes < 0.25 ? 'posicional, de manobras' : 'misto';
    // Estilo desta partida: a qualidade (pela precisão) e o tipo de jogo
    const criativo = n('brilliant') + n('great') >= 1;
    let perfil = acc == null ? 'Equilibrado'
      : acc >= 92 ? (criativo ? 'Preciso e criativo' : 'Preciso')
      : acc >= 85 ? (criativo ? 'Sólido e criativo' : 'Sólido')
      : acc >= 75 ? 'Irregular' : 'Instável';

    const facetas = [
      { k: 'precisao', nome: 'Precisão', v: acc == null ? null : Math.round(acc), mostra: acc == null ? '—' : String(acc).replace('.', ',') + '%',
        o: 'Quão perto dos melhores lances do motor cada lado jogou, na mesma escala dos grandes sites.',
        como: 'Média da precisão de cada lance fora do livro de aberturas.' },
      { k: 'decisoes', nome: 'Decisões', v: Math.round(100 * topo / fora.length), mostra: Math.round(100 * topo / fora.length) + '%',
        o: 'Quantas escolhas ficaram entre as melhores opções do motor.',
        como: 'Lances classificados como melhor lance, excelente, ótimo ou brilhante, sobre os lances fora do livro.' },
      { k: 'tatica', nome: 'Tática', v: tatica, mostra: chances ? `${achou}/${chances}` : '—',
        o: 'Se o lado encontrou o lance certo quando só um lance resolvia.',
        como: 'Momentos em que o melhor lance era bem melhor que o segundo; desconta 10 pontos por chance perdida.' },
      { k: 'estrategia', nome: 'Estratégia', v: estrategia, mostra: estrategia == null ? '—' : estrategia,
        o: 'A qualidade das decisões calmas, quando várias jogadas eram parecidas e não havia tática forçada.',
        como: 'Precisão só nos lances em que as três melhores opções do motor ficaram próximas.' },
      { k: 'abertura', nome: 'Abertura', v: nota(fases.opening), mostra: fases.opening == null ? '—' : Math.round(fases.opening) + '%',
        o: 'Como foram os primeiros lances depois da teoria.', como: 'Precisão na fase de abertura (até o lance 10, com quase todas as peças).' },
      { k: 'meio', nome: 'Meio-jogo', v: nota(fases.midgame), mostra: fases.midgame == null ? '—' : Math.round(fases.midgame) + '%',
        o: 'O jogo depois da abertura, com muitas peças em jogo.', como: 'Precisão na fase de meio-jogo.' },
      { k: 'final', nome: 'Final', v: nota(fases.endgame), mostra: fases.endgame == null ? '—' : Math.round(fases.endgame) + '%',
        o: 'O jogo com 6 peças ou menos.', como: 'Precisão na fase de final. Se a partida não chegou ao final, fica sem nota.' },
      { k: 'consistencia', nome: 'Consistência', v: consistencia, mostra: consistencia,
        o: 'Se o nível se manteve do começo ao fim ou oscilou com erros graves.',
        como: `Desconta gafes (3×), erros e chances perdidas (1,5×) e imprecisões (0,5×) sobre os lances jogados. Maior sequência sem erro grave: ${maior} lances.` },
    ];
    const comNota = facetas.filter(f => f.v != null && f.k !== 'precisao');
    const ord = comNota.slice().sort((a, b) => b.v - a.v);
    return {
      cor, acc, fora: fora.length, perfil, ritmo, maior, facetas,
      fortes: ord.slice(0, 2).filter(f => f.v >= 55),
      fracos: ord.slice(-2).reverse().filter(f => f.v < 70),
      erros: { gafes: n('blunder'), erros: n('mistake'), chances: n('miss'), imprecisoes: n('inaccuracy') },
    };
  }

  function calcular(moves) {
    if (!moves || !moves.some(m => m && m.classification)) return null;
    return { white: lado(moves, 'white'), black: lado(moves, 'black') };
  }

  /* ── Desenho ───────────────────────────────────────────────── */
  const COR = { book: 'var(--book)', brilliant: 'var(--brilliant)', great: 'var(--great)', excellent: 'var(--excellent)', 'best-move': 'var(--best-move)', good: 'var(--good)', inaccuracy: 'var(--inaccuracy)', mistake: 'var(--mistake)', miss: 'var(--miss)', blunder: 'var(--blunder)' };
  let _moves = null, _nomes = { white: 'Brancas', black: 'Pretas' }, _pov = 'both', _idx = -1, _aberta = null;
  const rot = m => `${Math.floor(m.index / 2) + 1}${m.color === 'white' ? '.' : '...'} ${m.san || ''}`;

  function fita(moves) {
    const linha = cor => moves.filter(m => m && m.color === cor).map(m => {
      const perda = Math.max(0, Math.min(1, ((m.evalBefore ?? 0) - (m.evalAfter ?? 0)) / 300));
      const alt = m.classification ? 30 + Math.round(70 * (GRAVES.includes(m.classification) || m.classification === 'inaccuracy' ? Math.max(.45, perda) : .3)) : 12;
      const nome = (typeof MoveClassifier !== 'undefined' && MoveClassifier.LABELS[m.classification]) || '';
      return `<button type="button" class="gd-t${m.index === _idx ? ' on' : ''}" data-ir-lance="${m.index}" style="--c:${COR[m.classification] || 'rgba(255,255,255,.12)'};--h:${alt}%" title="${esc(rot(m))}${nome ? ' · ' + esc(nome) : ''}" aria-label="${esc(rot(m))}${nome ? ', ' + esc(nome) : ''}"></button>`;
    }).join('');
    return `<div class="gd-fita" role="group" aria-label="Fita da partida: cada lance, da cor da classificação">
      <div class="gd-fita-l gd-w">${linha('white')}</div><div class="gd-fita-eixo"></div><div class="gd-fita-l gd-b">${linha('black')}</div></div>`;
  }

  function render() {
    const box = $('game-dna');
    if (!box) return;
    const d = calcular(_moves);
    if (!d || (!d.white && !d.black)) {
      box.innerHTML = `<div class="gd-vazio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12"/><path d="M8.5 7h7M8.5 17h7M10 12h4"/></svg><p><strong>DNA desta partida</strong>Aparece assim que a análise classifica os lances. Ele descreve só esta partida; o retrato de todas as suas partidas fica em <a href="/dna">Seu DNA</a>.</p></div>`;
      return;
    }
    const foco = _pov === 'both' ? null : _pov;
    const ladoCard = cor => {
      const p = d[cor];
      if (!p) return `<div class="gd-lado gd-${cor}"><span class="gd-quem">${esc(_nomes[cor])}</span><p class="gd-sem">Poucos lances fora do livro.</p></div>`;
      return `<div class="gd-lado gd-${cor}${foco && foco !== cor ? ' apagado' : ''}">
        <span class="gd-quem"><i></i>${esc(_nomes[cor])}</span>
        <strong class="gd-estilo">${esc(p.perfil || 'Equilibrado')}</strong>
        <span class="gd-ritmo">Jogo ${esc(p.ritmo)}</span>
        ${p.fortes.length ? `<p class="gd-mais">+ ${p.fortes.map(f => esc(f.nome.toLowerCase())).join(', ')}</p>` : ''}
        ${p.fracos.length ? `<p class="gd-menos">− ${p.fracos.map(f => esc(f.nome.toLowerCase())).join(', ')}</p>` : ''}
      </div>`;
    };
    const fac = (d.white || d.black).facetas.map((_, i) => {
      const w = d.white && d.white.facetas[i], b = d.black && d.black.facetas[i], f = w || b;
      const barra = (x, cor) => `<span class="gd-barra gd-${cor}${foco && foco !== cor ? ' apagado' : ''}"><i style="--v:${x && x.v != null ? x.v : 0}%"></i><em>${x ? esc(x.mostra) : '—'}</em></span>`;
      const aberta = _aberta === f.k;
      return `<li class="gd-fac${aberta ? ' aberta' : ''}">
        <button type="button" class="gd-fac-btn" data-faceta="${f.k}" aria-expanded="${aberta}">${barra(w, 'white')}<span class="gd-fac-nome">${esc(f.nome)}</span>${barra(b, 'black')}</button>
        ${aberta ? `<div class="gd-exp"><p><b>O que é.</b> ${esc(f.o)}</p><p><b>Como foi calculado.</b> ${esc(f.como)}</p><p><b>Nesta partida.</b> ${esc(_nomes.white)}: ${w ? esc(w.mostra) : '—'} · ${esc(_nomes.black)}: ${b ? esc(b.mostra) : '—'}.</p></div>` : ''}
      </li>`;
    }).join('');
    box.innerHTML = `
      <header class="gd-topo"><span class="gd-selo">DNA da partida</span><span class="gd-sub">só esta partida · não entra média de outras</span></header>
      ${fita(_moves)}
      <div class="gd-lados">${ladoCard('white')}${ladoCard('black')}</div>
      <ul class="gd-facs" aria-label="Características desta partida, brancas à esquerda e pretas à direita">${fac}</ul>
      <p class="gd-pe">Toque numa característica para ver como ela foi calculada. O retrato de várias partidas está em <a href="/dna">Seu DNA</a>.</p>`;
  }

  let raf = 0;
  function agendar() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function init() {
    const box = $('game-dna');
    if (!box) return;
    box.addEventListener('click', e => {
      const t = e.target.closest('[data-ir-lance]');
      if (t) { document.querySelector(`.move-item[data-index="${t.dataset.irLance}"]`)?.click(); return; }
      const f = e.target.closest('[data-faceta]');
      if (f) { _aberta = _aberta === f.dataset.faceta ? null : f.dataset.faceta; render(); }
    });
    window.addEventListener('gambyte:lances', e => {
      const d = e.detail || {};
      _moves = d.movesData || null;
      const h = (d.parsed && d.parsed.headers) || {};
      _nomes = { white: h.White || 'Brancas', black: h.Black || 'Pretas' };
      agendar();
    });
    window.addEventListener('gambyte:partida', () => { _moves = null; _aberta = null; agendar(); });
    window.addEventListener('gambyte:lance-atual', e => {
      _idx = (e.detail || {}).idx;
      box.querySelectorAll('.gd-t').forEach(t => t.classList.toggle('on', +t.dataset.irLance === _idx));
    });
    window.addEventListener('gambyte:pov', e => { _pov = e.detail || 'both'; agendar(); });
    render();
  }

  return { init, calcular };
})();

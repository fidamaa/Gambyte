/* ==============================================================
   MODULE: insights-ui.js
   Renderiza o painel de insights (Resumo, Por Lance, DNA).
   Depende de: insights-engine.js, auth-system.js
   ============================================================== */
const InsightsUI = (() => {
  let _globalData = null;

  function init() {
    updatePremiumGates();
  }

  function updatePremiumGates() {
    const isPrem = AuthSystem.isPremium();
    ['premium-global-wrap','premium-move-wrap','premium-dna-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (isPrem) el.classList.remove('locked');
        else el.classList.add('locked');
      }
    });
  }

  function switchTab(tab, btn) {
    document.querySelectorAll('.insights-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.insights-tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`insights-tab-${tab}`)?.classList.add('active');
  }

  function fmt(v) {
    if (v == null) return '—';
    if (Math.abs(v) > 9000) return (v > 0 ? '+M' : '-M');
    const sign = v > 0 ? '+' : '';
    return sign + (v/100).toFixed(2);
  }

  function renderGlobalInsights(movesData, isPartial = false) {
    _globalData = movesData;
    const section = document.getElementById('insights-section');
    if (section) section.classList.add('visible');

    // ── Indicador de análise parcial ──────────────────────────
    const partialBanner = document.getElementById('insights-partial-banner');
    if (partialBanner) {
      partialBanner.style.display = isPartial ? 'flex' : 'none';
    }

    const wAcc = InsightsEngine.calcAccuracy(movesData,'white');
    const bAcc = InsightsEngine.calcAccuracy(movesData,'black');
    const blundersTotal = movesData.filter(m=>m.classification==='blunder').length;

    // Free stats
    el('ig-accuracy-w').textContent = wAcc+'%';
    el('ig-accuracy-b').textContent = bAcc+'%';
    el('ig-blunders-free').textContent = blundersTotal;

    // Momento crítico — com identificação de quem errou
    const critical = InsightsEngine.findCriticalMoment(movesData);
    if (critical) {
      const whoLabel = critical.color === 'white' ? '⬜ Brancas' : '⬛ Pretas';
      const rawDrop = Math.min(Math.abs(critical.evalBefore - critical.evalAfter), 800);
      el('ig-critical-move').textContent = 'Lance '+((critical.index||0)+1)+' · '+whoLabel;
      el('ig-critical-desc').textContent = 'Queda de '+rawDrop.toFixed(0)+'cp';
    }

    // Erros por cor
    const wBlunders     = movesData.filter(m=>m.color==='white'&&m.classification==='blunder').length;
    const bBlunders     = movesData.filter(m=>m.color==='black'&&m.classification==='blunder').length;
    const wMistakes     = movesData.filter(m=>m.color==='white'&&m.classification==='mistake').length;
    const bMistakes     = movesData.filter(m=>m.color==='black'&&m.classification==='mistake').length;
    const wInac         = movesData.filter(m=>m.color==='white'&&m.classification==='inaccuracy').length;
    const bInac         = movesData.filter(m=>m.color==='black'&&m.classification==='inaccuracy').length;
    el('ig-errors-total').innerHTML =
      `<span style="color:#ddd">⬜ ${wBlunders}/${wMistakes}/${wInac}</span><br>`+
      `<span style="color:#8888bb;font-size:15px">⬛ ${bBlunders}/${bMistakes}/${bInac}</span>`;
    el('ig-errors-sub').textContent = 'Gafes / Erros / Imprecisões';

    // ── Precisão por fase — SEPARADA por cor ──────────────────
    const wPhase = InsightsEngine.calcPhaseAccuracy(movesData,'white');
    const bPhase = InsightsEngine.calcPhaseAccuracy(movesData,'black');

    // Fase mais fraca (pior das 6 combinações cor×fase)
    const allPhaseVals = [
      { key:'opening', color:'Brancas', val:wPhase.opening },
      { key:'midgame', color:'Brancas', val:wPhase.midgame },
      { key:'endgame', color:'Brancas', val:wPhase.endgame },
      { key:'opening', color:'Pretas',  val:bPhase.opening },
      { key:'midgame', color:'Pretas',  val:bPhase.midgame },
      { key:'endgame', color:'Pretas',  val:bPhase.endgame },
    ].filter(x=>x.val!=null).sort((a,b)=>a.val-b.val);

    if (allPhaseVals.length) {
      const phaseLabels = { opening:'Abertura', midgame:'Meio-jogo', endgame:'Final' };
      const worst = allPhaseVals[0];
      el('ig-weak-phase').textContent = phaseLabels[worst.key];
      el('ig-weak-phase-sub').textContent = worst.color+' — '+worst.val+'% precisão';
    }

    // Barras por cor (branca = barra cheia, preta = barra com opacidade)
    setBarById('phase-bar-opening-w','phase-pct-opening-w', wPhase.opening);
    setBarById('phase-bar-opening-b','phase-pct-opening-b', bPhase.opening);
    setBarById('phase-bar-midgame-w','phase-pct-midgame-w', wPhase.midgame);
    setBarById('phase-bar-midgame-b','phase-pct-midgame-b', bPhase.midgame);
    setBarById('phase-bar-endgame-w','phase-pct-endgame-w', wPhase.endgame);
    setBarById('phase-bar-endgame-b','phase-pct-endgame-b', bPhase.endgame);

    // Maior erro
    const blunder = InsightsEngine.findBiggestBlunder(movesData);
    if (blunder) {
      const whoStr = blunder.move.color === 'white' ? '⬜ Brancas' : '⬛ Pretas';
      el('bml-move').textContent   = 'Lance '+((blunder.move.index||0)+1)+' · '+whoStr;
      el('bml-loss').textContent   = blunder.loss.toFixed(0)+'cp';
      el('bml-played').textContent = blunder.move.san || '—';
      el('bml-best').textContent   = blunder.move.bestMoveUCI || '—';
      el('bml-explanation').textContent =
        `${whoStr}: ao jogar ${blunder.move.san}, perdeu ${blunder.loss.toFixed(0)} centipawns de vantagem. `
        + `O lance correto era ${blunder.move.bestMoveUCI||'outro'}, que mantinha a vantagem.`;
    }

    // Chart insights
    const ci = InsightsEngine.chartInsights(movesData);
    const ciContainer = document.getElementById('chart-insights-list');
    if (ciContainer) {
      ciContainer.innerHTML = ci.map(i=>`<span class="chart-insight-pill ${i.type}">${i.text}</span>`).join('');
    }

    // Rating — novo modelo CPL Contextual
    const rating = InsightsEngine.estimateRating(movesData);
    el('ig-rating').textContent = rating.emoji + ' ' + rating.rating;
    el('ig-rating-range').textContent = rating.range;
    // Mostrar rating por cor se disponível
    const ratingExtra = document.getElementById('ig-rating-extra');
    if (ratingExtra) {
      const wStr = rating.wRating ? `⬜ ${rating.wRating}` : '';
      const bStr = rating.bRating ? `⬛ ${rating.bRating}` : '';
      ratingExtra.textContent = [wStr, bStr].filter(Boolean).join('  ·  ');
    }

    // ── Sugestões — AMBAS as cores ────────────────────────────
    const suggW = InsightsEngine.suggestions(movesData, 'white');
    const suggB = InsightsEngine.suggestions(movesData, 'black');
    const renderSugg = (list, sugg) => {
      if (!list) return;
      list.innerHTML = sugg.map((s,i)=>`
        <div class="suggestion-item ${s.level}">
          <span class="suggestion-num">${i+1}.</span>
          <span class="suggestion-text">${s.text}</span>
        </div>`).join('');
    };
    renderSugg(document.getElementById('suggestions-list-w'), suggW);
    renderSugg(document.getElementById('suggestions-list-b'), suggB);

    // DNA
    const dnaData = InsightsEngine.dna(movesData);
    el('dna-profile').textContent = `${dnaData.white.emoji} ${dnaData.white.profile} (Brancas) · ${dnaData.black.emoji} ${dnaData.black.profile} (Pretas)`;
    el('dna-desc').textContent = `Brancas: ${dnaData.white.tags.join(', ')}. Pretas: ${dnaData.black.tags.join(', ')}.`;
    const tagsEl = document.getElementById('dna-tags');
    if (tagsEl) {
      const allTags = [...new Set([...dnaData.white.tags, ...dnaData.black.tags])];
      tagsEl.innerHTML = allTags.map(t=>`<span class="dna-tag">${t}</span>`).join('');
    }
    const patternsEl = document.getElementById('dna-patterns');
    if (patternsEl) {
      patternsEl.innerHTML = dnaData.patterns.map(p =>
        `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);">
           <span style="color:var(--accent);flex-shrink:0">◆</span>${p}
         </div>`
      ).join('');
    }

    updatePremiumGates();
  }

  function renderMoveInsight(moveData) {
    if (!moveData) return;
    const insight = InsightsEngine.moveInsight(moveData);
    if (!insight) return;

    // SAN and classification badge
    const sanEl = document.getElementById('mi-san');
    const clsEl = document.getElementById('mi-cls-badge');
    if (sanEl) sanEl.textContent = moveData.san || '—';
    if (clsEl) {
      const clsColors = {
        brilliant:'#5bc9b8', great:'#9b7de0', excellent:'#5bc97a', 'best-move':'#59b8e0',
        good:'#c9c45b', inaccuracy:'#e09b5b',
        mistake:'#e05c5c', miss:'#e0785b', blunder:'#e03030', book:'#8890a8'
      };
      const clsLabels = {
        brilliant:'Brilhante!', great:'Ótimo', excellent:'Excelente', 'best-move':'Melhor Lance',
        good:'Boa', inaccuracy:'Imprecisão',
        mistake:'Erro', miss:'Chance Perdida', blunder:'Gafe', book:'Livro'
      };
      const color = clsColors[moveData.classification] || 'var(--text2)';
      clsEl.textContent = clsLabels[moveData.classification] || '—';
      clsEl.style.cssText = `background:${color}22;color:${color};border:1px solid ${color}44;border-radius:99px;padding:3px 9px;`;
    }

    // Evals
    const evalBefore = moveData.evalBefore ?? 0;
    const evalAfter  = moveData.evalAfter  ?? 0;
    const diff = evalAfter - evalBefore;

    setEvalEl('mi-eval-before', evalBefore);
    setEvalEl('mi-eval-after',  evalAfter);
    const diffEl = document.getElementById('mi-eval-diff');
    if (diffEl) {
      diffEl.textContent = (diff >= 0 ? '+' : '') + (diff/100).toFixed(2);
      diffEl.className = 'mie-value ' + (diff >= 0 ? 'positive' : 'negative');
    }

    // Comment
    const commentEl = document.getElementById('mi-comment');
    if (commentEl) {
      commentEl.textContent = insight.comment;
      const colors = { blunder:'rgba(201,48,48,.15)', mistake:'rgba(224,92,92,.1)', inaccuracy:'rgba(224,155,91,.1)',
                       brilliant:'rgba(91,201,184,.1)', great:'rgba(155,125,224,.1)', excellent:'rgba(91,201,122,.1)',
                       'best-move':'rgba(89,184,224,.1)', miss:'rgba(224,120,91,.1)' };
      commentEl.style.background = colors[moveData.classification] || 'rgba(255,255,255,.02)';
      const borderColors = { blunder:'var(--blunder)', mistake:'var(--mistake)', inaccuracy:'var(--inaccuracy)',
                             brilliant:'var(--brilliant)', great:'var(--great)', excellent:'var(--excellent)',
                             'best-move':'var(--best-move)', miss:'var(--miss)' };
      commentEl.style.borderLeftColor = borderColors[moveData.classification] || 'var(--border2)';
    }

    // Flags
    const flagsEl = document.getElementById('mi-flags');
    if (flagsEl) {
      flagsEl.innerHTML = insight.flags.map(f=>
        `<span class="move-flag ${f.type}">${f.text}</span>`
      ).join('');
    }

    // Best move suggestion
    const bmsEl = document.getElementById('mi-best-suggestion');
    const bmMoveEl = document.getElementById('mi-best-move');
    const bmGainEl = document.getElementById('mi-best-gain');
    if (bmsEl && moveData.bestMoveUCI && moveData.playedMoveUCI !== moveData.bestMoveUCI) {
      bmsEl.style.display = 'flex';
      if (bmMoveEl) bmMoveEl.textContent = moveData.bestMoveUCI;
      if (bmGainEl && insight.loss > 0) bmGainEl.textContent = `(+${insight.loss.toFixed(0)}cp)`;
    } else if (bmsEl) {
      bmsEl.style.display = 'none';
    }
  }

  // helpers
  function el(id) { return document.getElementById(id) || { textContent:'', innerHTML:'' }; }
  function avg2(a,b) { if(a==null&&b==null)return null; if(a==null)return b; if(b==null)return a; return Math.round((a+b)/2); }
  function setBar(barId, pctId, val) {
    const bar = document.getElementById(barId);
    const pct = document.getElementById(pctId);
    if (!bar || !pct || val==null) return;
    bar.style.width = val+'%';
    pct.textContent = val+'%';
  }
  function setBarById(barId, pctId, val) {
    const bar = document.getElementById(barId);
    const pct = document.getElementById(pctId);
    if (!bar || !pct) return;
    if (val == null) { pct.textContent = '—'; return; }
    bar.style.width = val+'%';
    pct.textContent = val+'%';
  }
  function switchSuggTab(color) {
    const wList  = document.getElementById('suggestions-list-w');
    const bList  = document.getElementById('suggestions-list-b');
    const wBtn   = document.getElementById('sugg-tab-w');
    const bBtn   = document.getElementById('sugg-tab-b');
    if (!wList || !bList) return;
    const isW = color === 'white';
    wList.style.display = isW ? 'flex' : 'none';
    bList.style.display = isW ? 'none' : 'flex';
    if (wBtn) { wBtn.style.background = isW ? 'var(--bg2)' : 'transparent'; wBtn.style.color = isW ? '#ddd' : 'var(--text3)'; }
    if (bBtn) { bBtn.style.background = isW ? 'transparent' : 'var(--bg2)'; bBtn.style.color = isW ? 'var(--text3)' : '#8888bb'; }
  }
  function setEvalEl(id, val) {
    const el2 = document.getElementById(id);
    if (!el2) return;
    const fmted = val == null ? '—' : (Math.abs(val) > 9000 ? (val>0?'+M':'-M') : (val>=0?'+':'')+(val/100).toFixed(2));
    el2.textContent = fmted;
    el2.className = 'mie-value ' + (val > 0 ? 'positive' : val < 0 ? 'negative' : '');
  }

  return { init, updatePremiumGates, switchTab, switchSuggTab, renderGlobalInsights, renderMoveInsight };
})();

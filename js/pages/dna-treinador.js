/* Página /dna: o Treinador do Gambyte (Pro).
   Monta um resumo do DNA (só números: precisão por fase, erros, tática,
   aberturas com resultado...) e pede à função "treinador" do Supabase um
   plano de treino pessoal, escrito pelo Claude. Um relatório por semana,
   ou antes disso com 5 partidas novas. Quem não é Pro vê o convite.
   Depende de: auth-system.js (supabaseClient), player-dna.js */
(function () {
  const $ = id => document.getElementById(id);
  const box = $('dna-treinador');
  if (!box) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  const dataBR = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
  // Para o aviso de quando libera: com hora se for nas próximas 24 h.
  const quandoBR = iso => { const d = new Date(iso); if (isNaN(d)) return ''; return d - Date.now() < 864e5 ? `hoje ou amanhã às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`.replace('hoje ou amanhã', d.getDate() === new Date().getDate() ? 'hoje' : 'amanhã') : `em ${dataBR(iso)}`; };
  const ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="m15 14 2 2 4-4"/></svg>';
  let estado = { carregado: false, ultimo: null, proximoEm: null, ocupado: false, erro: '', aviso: '' };

  /* ── O resumo do DNA que vai para o treinador (só números) ─────── */
  function resumoDNA() {
    const d = PlayerDNA.calcular(PlayerDNA.meusNomes());
    if (!d || !d.n) return null;
    const ps = d.partidas || [];
    const somaPad = k => ps.reduce((s, p) => s + ((p.eu && p.eu.pad && p.eu.pad[k]) || 0), 0);
    const ab = new Map();
    ps.forEach(p => {
      if (!p.minha) return;
      const k = p.cor + '|' + p.minha;
      const a = ab.get(k) || { cor: p.cor === 'w' ? 'brancas' : 'pretas', abertura: p.minha, jogos: 0, pts: 0, nPts: 0, acc: [], contra: new Map() };
      a.jogos++;
      if (p.pontos != null) { a.pts += p.pontos; a.nPts++; }
      if (p.eu.fases && p.eu.fases.opening != null) a.acc.push(p.eu.fases.opening);
      if (p.deles) a.contra.set(p.deles, (a.contra.get(p.deles) || 0) + 1);
      ab.set(k, a);
    });
    const aberturas = Array.from(ab.values()).sort((a, b) => b.jogos - a.jogos).slice(0, 8).map(a => ({
      cor: a.cor, abertura: a.abertura, jogos: a.jogos,
      pontos_pct: a.nPts ? Math.round(100 * a.pts / a.nPts) : null,
      precisao_na_abertura: a.acc.length ? r1(a.acc.reduce((s, x) => s + x, 0) / a.acc.length) : null,
      contra: Array.from(a.contra, ([nome, jogos]) => ({ nome, jogos })).sort((x, y) => y.jogos - x.jogos).slice(0, 3),
    }));
    const ritmos = {};
    ps.forEach(p => { const r = PlayerDNA.ritmoDe(p.ritmo); if (r) ritmos[r] = (ritmos[r] || 0) + 1; });
    const ult = ps.slice(-12), ant = ps.slice(0, -12);
    const mediaAcc = l => { const v = l.map(p => p.eu.acc).filter(x => x != null); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null; };
    return {
      n_partidas: d.n,
      rating_estimado: d.rating ? { valor: Math.round(d.rating.valor), faixa_min: Math.round(d.rating.min), faixa_max: Math.round(d.rating.max) } : null,
      resultados: d.pontos == null ? null : { pontos_pct: Math.round(d.pontos * 100), vitorias: d.vde.v, empates: d.vde.e, derrotas: d.vde.d },
      precisao_media: r1(d.precisao),
      precisao_ultimas_12: ps.length > 12 ? mediaAcc(ult) : null,
      precisao_antes_das_ultimas_12: ant.length ? mediaAcc(ant) : null,
      precisao_por_fase: { abertura: r1(d.fases.opening), meio_jogo: r1(d.fases.midgame), final: r1(d.fases.endgame) },
      notas_0_a_100: Object.fromEntries(d.radar.map(e => [e.nome, e.v])),
      erros_a_cada_40_lances: { gafes: r1(d.erros.blunder), erros: r1(d.erros.mistake), chances_perdidas: r1(d.erros.miss), imprecisoes: r1(d.erros.inaccuracy) },
      lances_especiais: { brilhantes: d.bons.brilliant, otimos: d.bons.great },
      tatica: { momentos_de_lance_unico: d.tatica.chances, achou_o_lance: d.tatica.achou },
      erros_graves: { total: somaPad('graves'), com_a_posicao_melhor: somaPad('vant'), no_ultimo_terco_da_partida: somaPad('fim') },
      aberturas, ritmos,
    };
  }

  /* ── Conversa com a função ───────────────────────────────────── */
  async function chamar(corpo) {
    const { data, error } = await supabaseClient.functions.invoke('treinador', { body: corpo });
    if (!error) return data;
    let msg = 'O Treinador não respondeu agora. Tente de novo mais tarde.';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* sem corpo */ }
    throw new Error(msg);
  }
  async function carregar() {
    try {
      const r = await chamar({ acao: 'ultimo' });
      estado = { ...estado, carregado: true, ultimo: r.ultimo || null, proximoEm: r.proximo_em || null, erro: '' };
    } catch (e) { estado = { ...estado, carregado: true, erro: e.message }; }
    render();
  }
  async function gerar() {
    const dna = resumoDNA();
    if (!dna) { estado.erro = 'Ainda não há partidas suas no DNA.'; render(); return; }
    estado = { ...estado, ocupado: true, erro: '', aviso: '' }; render();
    try {
      const r = await chamar({ acao: 'gerar', dna });
      estado = { ...estado, ocupado: false, ultimo: r.ultimo || estado.ultimo, proximoEm: r.proximo_em || estado.proximoEm };
      if (r.limite) estado.aviso = r.faltam_partidas > 0
        ? `Um relatório novo fica disponível ${quandoBR(r.proximo_em)}, ou antes disso com mais ${r.faltam_partidas} ${r.faltam_partidas === 1 ? 'partida analisada' : 'partidas analisadas'}.`
        : `Um relatório novo fica disponível ${quandoBR(r.proximo_em)}.`;
    } catch (e) { estado = { ...estado, ocupado: false, erro: e.message }; }
    render();
  }

  /* ── Desenho ─────────────────────────────────────────────────── */
  function relatorioHTML(u) {
    const r = u.relatorio;
    return `<p class="tr-manchete">${esc(r.manchete)}</p>
      <p class="tr-resumo">${esc(r.resumo)}</p>
      ${r.aviso_dados ? `<p class="tr-aviso">${esc(r.aviso_dados)}</p>` : ''}
      ${r.fortes.length ? `<div class="tr-fortes"><span class="tr-rot">O que já funciona</span><ul>${r.fortes.map(f => `<li><b>${esc(f.titulo)}</b> ${esc(f.detalhe)}</li>`).join('')}</ul></div>` : ''}
      <div class="tr-prios"><span class="tr-rot">O que treinar primeiro</span><ol>${r.prioridades.map(p => `<li>
        <strong>${esc(p.titulo)}</strong>
        <p><i>Por quê</i>${esc(p.porque)}</p>
        <p><i>Como treinar</i>${esc(p.como_treinar)}</p>
        ${p.guia ? `<a href="/aprender/${esc(p.guia)}">Abrir o guia</a>` : ''}</li>`).join('')}</ol></div>
      ${r.plano_semana.length ? `<div class="tr-plano"><span class="tr-rot">Plano da semana</span><ul>${r.plano_semana.map(t => `<li><b>${esc(t.quando)}</b><span>${esc(t.tarefa)}</span></li>`).join('')}</ul></div>` : ''}
      <p class="tr-pe">Relatório de ${dataBR(u.criado_em)}, com ${u.n_partidas} partidas. Escrito por IA a partir dos números do seu DNA; confira os detalhes no radar e nas abas.</p>`;
  }
  function render() {
    const s = AuthSystem.currentSession && AuthSystem.currentSession();
    const pro = !!(s && AuthSystem.isPremium());
    const topo = `<header class="tr-topo"><span class="tr-ico">${ICO}</span><div><h2>Treinador do Gambyte <span class="tab-pro">PRO</span></h2><p>Um plano de treino escrito para você, a partir das suas partidas.</p></div></header>`;
    if (!pro) {
      box.innerHTML = `${topo}<p class="tr-convite">Com o Pro, o treinador lê o seu DNA (precisão por fase, erros, tática, aberturas) e diz o que mais está segurando o seu jogo, o que treinar primeiro e um plano para a semana.</p>
        <a class="dna-btn" href="/gambyte-premium">Conhecer o Pro</a>`;
      return;
    }
    if (!estado.carregado) { box.innerHTML = `${topo}<p class="tr-status">Carregando…</p>`; return; }
    const u = estado.ultimo;
    const podeNovo = !u || !estado.proximoEm || new Date(estado.proximoEm) <= new Date();
    const botao = estado.ocupado
      ? `<button type="button" class="dna-btn" disabled><span class="cavalo-carregando" aria-hidden="true"><i></i></span>O treinador está lendo o seu DNA…</button>`
      : `<button type="button" class="dna-btn" data-tr-gerar>${u ? (podeNovo ? 'Pedir um relatório novo' : 'Atualizar o relatório') : 'Pedir a análise do treinador'}</button>`;
    box.innerHTML = `${topo}
      ${u ? relatorioHTML(u) : '<p class="tr-convite">O treinador lê os números do seu DNA e escreve o que mais está segurando o seu jogo, o que treinar primeiro e um plano para a semana. Um relatório por semana, ou antes disso com 5 partidas novas.</p>'}
      ${estado.erro ? `<p class="tr-erro" role="alert">${esc(estado.erro)}</p>` : ''}
      ${estado.aviso ? `<p class="tr-aviso" role="status">${esc(estado.aviso)}</p>` : ''}
      <div class="tr-acoes">${botao}</div>`;
  }

  box.addEventListener('click', e => { if (e.target.closest('[data-tr-gerar]') && !estado.ocupado) gerar(); });
  let pedido = false;
  AuthSystem.onChange(() => {
    const s = AuthSystem.currentSession();
    if (s && AuthSystem.isPremium() && !pedido) { pedido = true; render(); carregar(); return; }
    render();
  });
})();

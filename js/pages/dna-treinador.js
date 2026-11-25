/* Página /dna: o Treinador do Gambyte (Pro), no próprio navegador.
   Sem API e sem IA generativa: um motor de regras com pesos lê os números
   do DNA (precisão por fase, erros, tática, aberturas com resultado...),
   dá uma nota de gravidade a cada problema possível, escolhe os mais
   graves e monta o relatório com os números da própria pessoa. Nunca
   inventa dado: cada frase sai de um número do DNA.
   Os pesos ficam em DIAGNOSTICOS (o campo `nota`); ajustar o treinador é
   ajustar essas notas. Quem não é Pro vê o convite.
   Depende de: auth-system.js, player-dna.js, dna-sync.js (opcional) */
const TreinadorDNA = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  const n1 = v => String(r1(v)).replace('.', ',');           // 64.3 → "64,3"
  const pct = v => n1(v) + '%';
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="m15 14 2 2 4-4"/></svg>';

  /* ── Os números do DNA que o treinador lê ─────────────────────── */
  function resumoDNA(d) {
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
    const aberturas = Array.from(ab.values()).sort((a, b) => b.jogos - a.jogos).map(a => ({
      cor: a.cor, abertura: a.abertura, jogos: a.jogos,
      pontos_pct: a.nPts ? Math.round(100 * a.pts / a.nPts) : null,
      contra: Array.from(a.contra, ([nome, jogos]) => ({ nome, jogos })).sort((x, y) => y.jogos - x.jogos),
    }));
    const ult = ps.slice(-12), ant = ps.slice(0, -12);
    const mediaAcc = l => { const v = l.map(p => p.eu.acc).filter(x => x != null); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null; };
    const radar = Object.fromEntries(d.radar.map(e => [e.k, e.v]));
    return {
      n: d.n,
      rating: d.rating ? Math.round(d.rating.valor) : null,
      pontos: d.pontos == null ? null : Math.round(d.pontos * 100),
      precisao: r1(d.precisao),
      precUlt: ps.length > 12 ? mediaAcc(ult) : null,
      precAnt: ps.length > 12 && ant.length ? mediaAcc(ant) : null,
      fases: { abertura: r1(d.fases.opening), meio: r1(d.fases.midgame), final: r1(d.fases.endgame) },
      radar,
      erros: { gafes: r1(d.erros.blunder), erros: r1(d.erros.mistake), chances: r1(d.erros.miss), imprecisoes: r1(d.erros.inaccuracy) },
      tatica: { momentos: d.tatica.chances, achou: d.tatica.achou },
      graves: { total: somaPad('graves'), vant: somaPad('vant'), fim: somaPad('fim') },
      aberturas,
    };
  }

  /* ── Diagnósticos possíveis ───────────────────────────────────────
     Cada um: nota(x) → gravidade (0 = não se aplica; quanto maior, mais
     urgente), e o texto montado só com os números de x. */
  const GUIA_ABERTURA = nome => /sicil/i.test(nome) ? 'defesa-siciliana' : /italian/i.test(nome) ? 'abertura-italiana' : /gambito da dama|queen's gambit/i.test(nome) ? 'gambito-da-dama' : 'principios-de-abertura';
  const outrasFases = x => [x.fases.abertura, x.fases.meio].filter(v => v != null);
  const media = l => l.length ? l.reduce((s, v) => s + v, 0) / l.length : null;
  const piorAbertura = x => x.aberturas.filter(a => a.jogos >= 4 && a.pontos_pct != null && a.pontos_pct <= 35).sort((a, b) => a.pontos_pct - b.pontos_pct)[0] || null;

  const DIAGNOSTICOS = [
    {
      k: 'final',
      nota: x => {
        const f = x.fases.final, o = media(outrasFases(x));
        if (f == null || o == null) return 0;
        return Math.max(0, (o - f) / 12) + Math.max(0, (75 - f) / 15);
      },
      manchete: x => `Os finais estão custando pontos: sua precisão cai para ${pct(x.fases.final)} quando sobram poucas peças.`,
      titulo: 'Converter posições nos finais',
      porque: x => `Nos finais sua precisão é ${pct(x.fases.final)}, contra ${pct(media(outrasFases(x)))} no resto da partida.`,
      como: 'Reserve 15 minutos por dia para finais de rei e peão e de torre. Jogue contra o bot posições já ganhas até converter sem perder a vantagem. Melhorou quando a precisão nos finais passar de 75%.',
      guia: 'finais-de-rei-e-peao',
      tarefa: '20 minutos de finais de rei e peão; depois 2 finais ganhos contra o bot.',
    },
    {
      k: 'vantagem',
      nota: x => x.graves.total >= 4 ? Math.max(0, (x.graves.vant / x.graves.total - 0.3) * 4) : 0,
      manchete: x => `Você deixa escapar partidas ganhas: ${x.graves.vant} dos seus ${x.graves.total} erros graves vieram com a posição a seu favor.`,
      titulo: 'Fechar as partidas que já estão ganhas',
      porque: x => `${x.graves.vant} dos ${x.graves.total} erros graves aconteceram quando você já estava melhor.`,
      como: 'Com vantagem, antes de cada lance faça o checklist de 10 segundos: xeques, capturas e ameaças do adversário. Prefira trocar peças e simplificar. Anote nas próximas 5 partidas quantas vezes errou estando melhor.',
      guia: 'valor-das-pecas',
      tarefa: '3 partidas de 10 minutos usando o checklist em todo lance com vantagem.',
    },
    {
      k: 'relogio',
      nota: x => x.graves.total >= 4 ? Math.max(0, (x.graves.fim / x.graves.total - 0.45) * 3.5) : 0,
      manchete: x => `O fim da partida pesa: ${x.graves.fim} dos ${x.graves.total} erros graves aconteceram no último terço do jogo.`,
      titulo: 'Guardar tempo para o fim da partida',
      porque: x => `${x.graves.fim} dos ${x.graves.total} erros graves foram no último terço da partida, quando o relógio costuma apertar.`,
      como: 'Na abertura, jogue os lances que você já conhece mais rápido e guarde tempo. Tente chegar ao lance 30 com pelo menos um terço do tempo inicial. Se jogar blitz, alterne com partidas de 10 ou 15 minutos.',
      guia: 'gestao-do-tempo',
      tarefa: '3 partidas de 15 minutos olhando o relógio no lance 20 e no lance 30.',
    },
    {
      k: 'gafes',
      nota: x => Math.max(0, (x.erros.gafes - 0.6) / 0.8),
      manchete: x => `As gafes decidem suas partidas: são ${n1(x.erros.gafes)} a cada 40 lances.`,
      titulo: 'Parar de entregar peças',
      porque: x => `Você comete ${n1(x.erros.gafes)} gafes a cada 40 lances, o tipo de erro que perde a partida de uma vez.`,
      como: 'Antes de soltar a peça, pergunte: ela fica defendida? O adversário tem xeque, captura ou ameaça depois do meu lance? Faça isso em todo lance por uma semana, mesmo nos fáceis.',
      guia: 'pecas-indefesas',
      tarefa: 'Revise as gafes das 3 últimas partidas e escreva o que o adversário ameaçava.',
    },
    {
      k: 'tatica',
      nota: x => {
        if (!x.tatica.momentos || x.tatica.momentos < 8) return 0;
        const p = x.tatica.achou / x.tatica.momentos;
        return Math.max(0, (0.7 - p) * 4) + Math.max(0, (x.erros.chances - 0.8) / 1.5);
      },
      manchete: x => `A tática está escapando: você achou ${x.tatica.achou} de ${x.tatica.momentos} lances únicos.`,
      titulo: 'Enxergar mais lances táticos',
      porque: x => `Nos momentos em que só um lance resolvia, você achou ${x.tatica.achou} de ${x.tatica.momentos} (${Math.round(100 * x.tatica.achou / x.tatica.momentos)}%)${x.erros.chances >= 0.5 ? `, e deixou passar ${n1(x.erros.chances)} chances a cada 40 lances` : ''}.`,
      como: 'Resolva 15 exercícios de tática por dia, sem pressa, calculando até o fim antes de jogar. Comece por garfos e cravadas. Melhorou quando passar de 70% dos lances únicos.',
      guia: 'garfo',
      tarefa: '15 exercícios de tática por dia (garfos, cravadas, ataques descobertos).',
    },
    {
      k: 'abertura-ruim',
      nota: x => { const a = piorAbertura(x); return a ? 0.8 + (35 - a.pontos_pct) / 40 : 0; },
      manchete: x => { const a = piorAbertura(x); return `Uma abertura está pesando: ${a.abertura} de ${a.cor} rende só ${a.pontos_pct}% dos pontos.`; },
      titulo: x => `Rever a abertura ${piorAbertura(x).abertura}`,
      porque: x => { const a = piorAbertura(x); const c = a.contra[0]; return `De ${a.cor}, ${a.abertura} rendeu ${a.pontos_pct}% dos pontos em ${a.jogos} partidas${c ? `, a maioria contra ${c.nome}` : ''}.`; },
      como: 'Revise lance a lance as 2 últimas derrotas com essa abertura e ache o momento em que a partida virou. Depois estude a linha principal até o lance 10 e o plano típico do meio-jogo.',
      guia: x => GUIA_ABERTURA(piorAbertura(x).abertura),
      tarefa: x => `Revise 2 derrotas recentes com a abertura ${piorAbertura(x).abertura}, lance a lance.`,
    },
    {
      k: 'abertura',
      nota: x => {
        const a = x.fases.abertura, m = x.fases.meio;
        if (a == null) return 0;
        return Math.max(0, (82 - a) / 10) + (m != null ? Math.max(0, (m - a) / 15) : 0);
      },
      manchete: x => `A partida começa mal: sua precisão na abertura é ${pct(x.fases.abertura)}.`,
      titulo: 'Sair melhor da abertura',
      porque: x => `Nos primeiros lances sua precisão é ${pct(x.fases.abertura)}${x.fases.meio != null ? `, contra ${pct(x.fases.meio)} no meio-jogo` : ''}.`,
      como: 'Siga os princípios: centro, desenvolvimento das peças menores e roque cedo, sem mexer a mesma peça duas vezes. Escolha uma abertura de brancas e uma defesa de pretas e jogue sempre as mesmas por um mês.',
      guia: 'principios-de-abertura',
      tarefa: 'Escolha uma abertura de brancas e uma de pretas e estude os 8 primeiros lances de cada.',
    },
    {
      k: 'meio',
      nota: x => {
        const m = x.fases.meio;
        if (m == null) return 0;
        const outras = [x.fases.abertura, x.fases.final].filter(v => v != null);
        return Math.max(0, (78 - m) / 10) + (outras.length ? Math.max(0, (media(outras) - m) / 15) : 0);
      },
      manchete: x => `O meio-jogo é onde você mais perde precisão: ${pct(x.fases.meio)}.`,
      titulo: 'Fortalecer o meio-jogo',
      porque: x => `Sua precisão no meio-jogo é ${pct(x.fases.meio)}${x.erros.imprecisoes >= 4 ? `, com ${n1(x.erros.imprecisoes)} imprecisões a cada 40 lances` : ''}.`,
      como: 'Quando não houver tática, escolha o lance pelo plano: qual peça está pior, qual é a casa boa para ela, onde a estrutura de peões manda jogar. Revise uma partida por dia procurando esses momentos.',
      guia: 'estrutura-de-peoes',
      tarefa: 'Revise 1 partida por dia marcando os lances em que você não tinha plano.',
    },
    {
      k: 'consistencia',
      nota: x => x.radar.consistencia != null ? Math.max(0, (50 - x.radar.consistencia) / 15) : 0,
      manchete: () => 'Seu nível varia muito de uma partida para outra.',
      titulo: 'Jogar sempre no seu nível',
      porque: x => `Sua nota de consistência é ${x.radar.consistencia} de 100: algumas partidas são muito boas e outras bem abaixo.`,
      como: 'Jogue menos partidas seguidas e pare depois de duas derrotas. Antes de cada partida, lembre do checklist de 10 segundos. Revise as piores partidas para ver o que elas têm em comum.',
      guia: 'como-estudar-suas-partidas',
      tarefa: 'Jogue no máximo 5 partidas por dia e pare depois de 2 derrotas seguidas.',
    },
  ];

  /* ── Pontos fortes (só o que se destaca) ──────────────────────── */
  function fortes(x) {
    const out = [];
    const fasesOk = [['abertura', 'Abertura'], ['meio', 'Meio-jogo'], ['final', 'Finais']].filter(([k]) => x.fases[k] != null);
    const melhor = fasesOk.sort((a, b) => x.fases[b[0]] - x.fases[a[0]])[0];
    if (melhor && x.fases[melhor[0]] >= 85) out.push({ titulo: melhor[1], detalhe: `${pct(x.fases[melhor[0]])} de precisão, a sua melhor fase.` });
    const boa = x.aberturas.filter(a => a.jogos >= 4 && a.pontos_pct != null && a.pontos_pct >= 60).sort((a, b) => b.pontos_pct - a.pontos_pct)[0];
    if (boa) out.push({ titulo: boa.abertura, detalhe: `De ${boa.cor}, ${boa.pontos_pct}% dos pontos em ${boa.jogos} partidas.` });
    if (x.tatica.momentos >= 8 && x.tatica.achou / x.tatica.momentos >= 0.75) out.push({ titulo: 'Tática', detalhe: `Achou ${x.tatica.achou} de ${x.tatica.momentos} lances únicos.` });
    if (x.erros.gafes != null && x.erros.gafes < 0.4) out.push({ titulo: 'Poucas gafes', detalhe: x.erros.gafes === 0 ? 'Nenhuma gafe nas partidas analisadas.' : `Só ${n1(x.erros.gafes)} a cada 40 lances.` });
    if (x.precUlt != null && x.precAnt != null && x.precUlt - x.precAnt >= 2) out.push({ titulo: 'Em evolução', detalhe: `Precisão de ${pct(x.precUlt)} nas últimas 12 partidas, contra ${pct(x.precAnt)} antes.` });
    if (!out.length && melhor) out.push({ titulo: melhor[1], detalhe: `${pct(x.fases[melhor[0]])} de precisão, a sua melhor fase até aqui.` });
    return out.slice(0, 3);
  }

  /* ── O relatório ──────────────────────────────────────────────── */
  const val = (v, x) => (typeof v === 'function' ? v(x) : v);
  // Abaixo desta nota, a diferença é pequena demais para chamar de problema.
  const MINIMA = 0.5;
  // Sem nenhum ponto fraco claro: o próximo passo é subir o nível do desafio.
  const SEM_FRAQUEZA = {
    nota: () => 1, manchete: () => 'Nenhum ponto fraco grande aparece nos seus números: o próximo passo é subir o nível do desafio.',
    titulo: 'Jogar contra adversários mais fortes',
    porque: x => `Sua precisão média é ${pct(x.precisao)} e nenhuma fase ou tipo de erro se destaca negativamente.`,
    como: 'Jogue partidas mais longas (15 minutos ou mais) contra adversários ou contra o bot acima do seu nível, e revise cada derrota procurando o primeiro lance ruim.',
    guia: 'como-estudar-suas-partidas',
    tarefa: '2 partidas longas contra o bot 200 pontos acima do seu nível estimado, revisando cada uma.',
  };
  function gerar(d) {
    const x = resumoDNA(d);
    if (!x) return null;
    const ranking = DIAGNOSTICOS.map(g => ({ g, s: g.nota(x) })).filter(r => r.s >= MINIMA).sort((a, b) => b.s - a.s);
    // Dois diagnósticos com o mesmo guia contam como um (ex.: gafes e vantagem)
    const vistos = new Set(), escolhidos = [];
    for (const r of ranking) {
      const guia = val(r.g.guia, x);
      if (vistos.has(guia)) continue;
      vistos.add(guia); escolhidos.push(r);
      if (escolhidos.length === 3) break;
    }
    if (!escolhidos.length) escolhidos.push({ g: SEM_FRAQUEZA, s: 1 });
    const prioridades = escolhidos.map(({ g }) => ({ titulo: val(g.titulo, x), porque: g.porque(x), como_treinar: g.como, guia: val(g.guia, x) }));
    const DIAS = ['Segunda', 'Quarta', 'Sexta'];
    const plano = escolhidos.map(({ g }, i) => ({ quando: DIAS[i], tarefa: val(g.tarefa, x) }));
    plano.push({ quando: 'Fim de semana', tarefa: 'Analise no Gambyte as partidas da semana e compare a precisão com a da semana anterior.' });
    const fr = [];
    fr.push(`Sua precisão média é ${pct(x.precisao)} em ${plural(x.n, 'partida', 'partidas')}${x.rating ? `, o que dá um nível estimado perto de ${x.rating}` : ''}.`);
    const fs = [['abertura', 'abertura'], ['meio', 'meio-jogo'], ['final', 'final']].filter(([k]) => x.fases[k] != null).sort((a, b) => x.fases[b[0]] - x.fases[a[0]]);
    if (fs.length >= 2) fr.push(`Você joga melhor ${fs[0][1] === 'abertura' ? 'a abertura' : 'o ' + fs[0][1]} (${pct(x.fases[fs[0][0]])}) e pior ${fs[fs.length - 1][1] === 'abertura' ? 'a abertura' : 'o ' + fs[fs.length - 1][1]} (${pct(x.fases[fs[fs.length - 1][0]])}).`);
    if (x.pontos != null) fr.push(`Fez ${x.pontos}% dos pontos possíveis.`);
    return {
      manchete: escolhidos[0].g.manchete(x),
      resumo: fr.join(' '),
      fortes: fortes(x),
      prioridades,
      plano_semana: plano,
      aviso_dados: x.n < 10 ? `Com ${plural(x.n, 'partida', 'partidas')} o retrato ainda é um começo; a partir de 10 o diagnóstico fica mais firme.` : '',
      n: x.n,
    };
  }

  /* ── Desenho ─────────────────────────────────────────────────── */
  function relatorioHTML(r) {
    return `<p class="tr-manchete">${esc(r.manchete)}</p>
      <p class="tr-resumo">${esc(r.resumo)}</p>
      ${r.aviso_dados ? `<p class="tr-aviso">${esc(r.aviso_dados)}</p>` : ''}
      ${r.fortes.length ? `<div class="tr-fortes"><span class="tr-rot">O que já funciona</span><ul>${r.fortes.map(f => `<li><b>${esc(f.titulo)}</b> ${esc(f.detalhe)}</li>`).join('')}</ul></div>` : ''}
      ${r.prioridades.length ? `<div class="tr-prios"><span class="tr-rot">O que treinar primeiro</span><ol>${r.prioridades.map(p => `<li>
        <strong>${esc(p.titulo)}</strong>
        <p><i>Por quê</i>${esc(p.porque)}</p>
        <p><i>Como treinar</i>${esc(p.como_treinar)}</p>
        ${p.guia ? `<a href="/aprender/${esc(p.guia)}">Abrir o guia</a>` : ''}</li>`).join('')}</ol></div>` : ''}
      <div class="tr-plano"><span class="tr-rot">Plano da semana</span><ul>${r.plano_semana.map(t => `<li><b>${esc(t.quando)}</b><span>${esc(t.tarefa)}</span></li>`).join('')}</ul></div>
      <p class="tr-pe">Feito pelo Gambyte com os números do seu DNA (${plural(r.n, 'partida', 'partidas')}). Atualiza sozinho a cada partida nova.</p>`;
  }
  function render() {
    const box = document.getElementById('dna-treinador');
    if (!box) return;
    const s = AuthSystem.currentSession && AuthSystem.currentSession();
    const pro = !!(s && AuthSystem.isPremium());
    const topo = `<header class="tr-topo"><span class="tr-ico">${ICO}</span><div><h2>Treinador do Gambyte <span class="tab-pro">PRO</span></h2><p>O que mais está segurando o seu jogo e o que treinar primeiro.</p></div></header>`;
    if (!pro) {
      box.innerHTML = `${topo}<p class="tr-convite">Com o Pro, o treinador lê o seu DNA (precisão por fase, erros, tática, aberturas) e diz o que mais está segurando o seu jogo, o que treinar primeiro e um plano para a semana.</p>
        <a class="dna-btn" href="/gambyte-premium">Conhecer o Pro</a>`;
      return;
    }
    let r = null;
    try { r = gerar(PlayerDNA.calcular(PlayerDNA.meusNomes())); } catch (e) { console.warn('[Treinador]', e); }
    box.innerHTML = topo + (r ? relatorioHTML(r) : '<p class="tr-convite">O treinador aparece assim que houver partidas suas analisadas no DNA.</p>');
  }

  function init() {
    if (!document.getElementById('dna-treinador')) return;
    AuthSystem.onChange(render);
    window.addEventListener('dna:nomes', render);
    // Partida nova analisada: o relatório se atualiza (no máximo 1 vez por segundo)
    let t = 0;
    if (typeof DNASync !== 'undefined') DNASync.onChange(e => { if (e && e.nova) { clearTimeout(t); t = setTimeout(render, 1000); } });
  }
  init();
  return { gerar, resumoDNA, DIAGNOSTICOS, render };
})();

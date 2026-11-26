/* ==============================================================
   MODULE: dna-nuvem.js
   Guarda o DNA na conta do Gambyte (tabela partidas_analisadas no
   Supabase), para ele abrir pronto em qualquer aparelho.

   - O navegador continua sendo a cópia rápida: a página mostra na hora o
     que já está guardado nele.
   - Com a pessoa logada: baixa da conta os resumos que este aparelho
     ainda não tem e envia os que a conta ainda não tem.
   - Cada partida analisada depois disso vai para a conta logo em seguida.
   - Se a tabela ainda não existir (migração não aplicada) ou a internet
     falhar, tudo segue só no navegador, sem erro na tela.

   Depende de: supabase-config.js, auth-system.js, player-dna.js
   ============================================================== */
const DNANuvem = (() => {
  const TABELA = 'partidas_analisadas';
  const KEY_ENVIADAS = 'gambyte_dna_nuvem_v1';   // { uid: [chaves já na conta] }
  const LOTE = 50;

  let uid = null, prontoP = null, fimPronto = null, desligado = false;
  const ouvintes = [];
  function aoMudar(f) { ouvintes.push(f); }
  const avisar = n => ouvintes.forEach(f => { try { f(n); } catch (e) { /* ok */ } });

  const lerEnviadas = () => { try { return JSON.parse(localStorage.getItem(KEY_ENVIADAS) || '{}') || {}; } catch (e) { return {}; } };
  function marcarEnviadas(chaves) {
    const t = lerEnviadas(), s = new Set(t[uid] || []);
    chaves.forEach(c => s.add(c));
    t[uid] = Array.from(s).slice(-600);
    try { localStorage.setItem(KEY_ENVIADAS, JSON.stringify(t)); } catch (e) { /* cheio */ }
  }
  // Tabela que não existe (migração não aplicada): para de tentar nesta visita.
  const semTabela = err => err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache/i.test(err.message || ''));

  async function enviar(itens) {
    if (desligado || !uid || !itens.length) return;
    for (let i = 0; i < itens.length; i += LOTE) {
      const parte = itens.slice(i, i + LOTE).filter(x => x && x.chave);
      const { error } = await supabaseClient.from(TABELA)
        .upsert(parte.map(x => ({ user_id: uid, chave: x.chave, resumo: x })), { onConflict: 'user_id,chave', ignoreDuplicates: true });
      if (error) { if (semTabela(error)) desligado = true; console.warn('[DNA na conta] não enviou:', error.message); return; }
      marcarEnviadas(parte.map(x => x.chave));
    }
  }

  async function baixar() {
    const { data, error } = await supabaseClient.from(TABELA)
      .select('chave, resumo').order('criado_em', { ascending: false }).limit(400);
    if (error) { if (semTabela(error)) desligado = true; console.warn('[DNA na conta] não baixou:', error.message); return 0; }
    marcarEnviadas((data || []).map(r => r.chave));
    const n = PlayerDNA.mesclar((data || []).map(r => r.resumo));
    if (n) avisar(n);
    return n;
  }

  async function sincronizar() {
    try {
      await baixar();
      if (desligado || PlayerDNA.emExemplo()) return;
      const ja = new Set(lerEnviadas()[uid] || []);
      await enviar(PlayerDNA.lerTudo().filter(x => !ja.has(x.chave)));
    } catch (e) { console.warn('[DNA na conta]', e && e.message); }
  }

  // Quem chama pronto() (a busca de partidas novas do DNA) espera a conta
  // ser lida, para não analisar de novo o que já veio de outro aparelho.
  function pronto() {
    if (!prontoP) prontoP = new Promise(r => { fimPronto = r; });
    return Promise.race([prontoP, new Promise(r => setTimeout(r, 8000))]);
  }
  pronto();

  AuthSystem.onChange(s => {
    if (!AuthSystem.isReady()) return;
    const novo = (s && s.uid) || null;
    if (novo === uid) { if (!novo) fimPronto(); return; }
    uid = novo; desligado = false;
    if (!uid) { fimPronto(); return; }
    sincronizar().finally(() => fimPronto());
  });

  // Partida analisada agora: vai para a conta.
  PlayerDNA.aoRegistrar(item => { if (uid && !desligado) enviar([item]); });

  // Apagar o DNA também na conta.
  async function apagarTudo() {
    if (!uid || desligado) return;
    const { error } = await supabaseClient.from(TABELA).delete().eq('user_id', uid);
    if (error) { console.warn('[DNA na conta] não apagou:', error.message); return; }
    const t = lerEnviadas(); delete t[uid];
    try { localStorage.setItem(KEY_ENVIADAS, JSON.stringify(t)); } catch (e) { /* ok */ }
  }

  return { pronto, aoMudar, apagarTudo, logado: () => !!uid };
})();

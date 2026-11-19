/* ==============================================================
   MODULE: auth-system.js
   Autenticação real (Supabase Auth) + status Premium (Postgres/RLS).

   Antes disso era tudo localStorage: senha em btoa() (reversível numa
   linha) e "premium" era só um campo que qualquer um podia virar true
   pelo DevTools. Agora a conta é uma conta de verdade, e "premium" só
   muda quando o webhook do Mercado Pago confirma um pagamento aprovado
   (ver supabase/functions/webhook-mp) — o cliente não tem permissão de
   escrever esse campo (ver supabase/migrations/0001_init.sql, RLS).

   Depende de: supabase-config.js (já deve ter criado `supabaseClient`
               antes deste arquivo carregar).
   ============================================================== */
const AuthSystem = (() => {
  let _session   = null;   // { uid, email, name, premium } | null
  let _ready     = false;  // já resolveu o estado inicial de auth?
  const _listeners = [];
  let _premiumChannel = null;
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function activePremium(profile) {
    return !!(profile?.premium && profile.proximo_vencimento && Date.parse(profile.proximo_vencimento) > Date.now());
  }

  function _linkedFrom(user) {
    const md = (user && user.user_metadata) || {};
    const limpa = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{2,30}$/.test(v)) ? v : '';
    return { chesscom: limpa(md.chesscom), lichess: limpa(md.lichess) };
  }

  function _notify() {
    _lembrarPerfil();
    for (const cb of _listeners) { try { cb(_session); } catch (e) { console.error(e); } }
  }

  // Guarda nome e Pro da sessão para o cabeçalho das outras páginas
  // (menu.js mostra o perfil sem precisar carregar o login inteiro).
  function _lembrarPerfil() {
    if (!_ready) return;
    try {
      if (_session) localStorage.setItem('gambyte_perfil', JSON.stringify({
        nome: _session.name || (_session.email || '').split('@')[0],
        pro: isPremium(),
      }));
      else localStorage.removeItem('gambyte_perfil');
    } catch (e) { /* sem armazenamento */ }
  }

  // Chama cb toda vez que login/logout ou o status premium mudar. Chama
  // também imediatamente com o estado atual (mesmo que ainda seja
  // "carregando" — cheque isReady() se precisar distinguir isso).
  function onChange(cb) {
    _listeners.push(cb);
    cb(_session);
    return () => { const i = _listeners.indexOf(cb); if (i >= 0) _listeners.splice(i, 1); };
  }

  function isReady() { return _ready; }

  async function _loadProfile(uid) {
    const { data, error } = await supabaseClient
      .from('profiles').select('*').eq('id', uid).single();
    if (error) { console.error('[AuthSystem] Erro ao carregar perfil:', error); return; }
    if (_session && _session.uid === uid && data) {
      _session.premium = activePremium(data);
      _session.expiresAt = data.proximo_vencimento;
      _session.assinaturaCartao = data.stripe_status || null;   // assinatura no Stripe (cartão)
      _session.cancelada = !!data.cancelado_em;
      if (data.name) _session.name = data.name;
      _notify();
    }
  }

  function _watchPremium(uid) {
    if (_premiumChannel) { supabaseClient.removeChannel(_premiumChannel); _premiumChannel = null; }
    _premiumChannel = supabaseClient
      .channel(`profile-${uid}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => {
          if (_session && _session.uid === uid) {
            _session.premium = activePremium(payload.new);
            _session.expiresAt = payload.new.proximo_vencimento;
            _session.assinaturaCartao = payload.new.stripe_status || null;
            _session.cancelada = !!payload.new.cancelado_em;
            if (payload.new.name) _session.name = payload.new.name;
            _notify();
          }
        })
      .subscribe();
  }

  async function _applySession(session) {
    if (_premiumChannel) { supabaseClient.removeChannel(_premiumChannel); _premiumChannel = null; }
    const user = session && session.user;
    if (user) {
      _session = {
        uid:     user.id,
        email:   user.email,
        name:    (user.user_metadata && user.user_metadata.name) || (user.email ? user.email.split('@')[0] : ''),
        premium: false, // atualizado assim que o perfil carregar
        // Usuários de xadrez vinculados pelo próprio usuário (só leitura de
        // partidas públicas). Ficam nos metadados da conta no Supabase Auth.
        linked:  _linkedFrom(user),
      };
      _notify();
      await _loadProfile(user.id);
      _watchPremium(user.id);
    } else {
      _session = null;
      _notify();
    }
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    // Supabase recomenda não aguardar outras chamadas Auth dentro deste callback.
    setTimeout(() => _applySession(session).finally(() => { _ready = true; _notify(); }), 0);
  });

  function _friendlyError(err) {
    const msg = (err && err.message) || '';
    const map = [
      [/already registered/i,      'Email já cadastrado. Tente fazer login.'],
      [/invalid login credentials/i,'Email ou senha incorretos.'],
      [/invalid email/i,            'Email inválido.'],
      [/password should be at least|weak password/i, 'Use uma senha de pelo menos 12 caracteres.'],
      [/email not confirmed/i, 'Confirme seu e-mail antes de entrar.'],
      [/rate limit/i,               'Muitas tentativas. Tente novamente em alguns minutos.'],
      [/network/i,                  'Falha de conexão. Verifique sua internet.'],
    ];
    for (const [re, friendly] of map) if (re.test(msg)) return friendly;
    return msg ? ('Erro: ' + msg) : 'Erro desconhecido.';
  }

  async function register(email, password, name) {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { name: name || '' } },
      });
      if (error) return { ok: false, msg: _friendlyError(error) };
      // O perfil em public.profiles é criado pelo trigger handle_new_user
      // (Postgres) — não escrevemos nada na tabela aqui de propósito.
      return { ok: true, needsConfirmation: !data.session };
    } catch (err) {
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  async function login(email, password) {
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, msg: _friendlyError(error) };
      return { ok: true };
    } catch (err) {
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  function logout() { return supabaseClient.auth.signOut(); }

  /** Salva os usuários de Chess.com/Lichess vinculados à conta. Vazio remove. */
  async function setLinkedAccounts({ chesscom, lichess }) {
    if (!_session) return { ok: false, msg: 'Entre na sua conta primeiro.' };
    const data = {};
    if (chesscom !== undefined) data.chesscom = chesscom || '';
    if (lichess !== undefined) data.lichess = lichess || '';
    try {
      const { data: res, error } = await supabaseClient.auth.updateUser({ data });
      if (error) return { ok: false, msg: _friendlyError(error) };
      if (_session && res && res.user) { _session.linked = _linkedFrom(res.user); _notify(); }
      return { ok: true };
    } catch (err) {
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  function currentSession() { return _session; }
  function isPremium() { return !!(_session && activePremium({ premium: _session.premium, proximo_vencimento: _session.expiresAt })); }

  // ── Pagamento — chama as Edge Functions, nunca ativa premium local ──

  async function refreshPremiumStatus() {
    if (!_session) return { premium: false };
    const { data, error } = await supabaseClient.functions.invoke('verificar-premium');
    if (error) throw new Error(error.message);
    return data;
  }

  // Assinatura por cartão (Stripe): abre o pagamento ou o portal de gestão.
  async function abrirStripe(qual) {
    const { data, error } = await supabaseClient.functions.invoke(qual === 'portal' ? 'stripe-portal' : 'stripe-checkout', { body: {} });
    if (error || !data || !data.url) {
      let msg = 'Não consegui abrir o pagamento agora. Tente de novo em instantes.';
      try { const j = error && error.context && await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* sem corpo */ }
      if (data && data.error) msg = data.error;
      return { ok: false, msg };
    }
    window.location.href = data.url;
    return { ok: true };
  }

  // Ao voltar do pagamento: confere a assinatura direto no Stripe (segunda
  // via do webhook) e recarrega o perfil.
  async function sincronizarStripe() {
    if (!_session) return null;
    try {
      const { data } = await supabaseClient.functions.invoke('stripe-sincronizar', { body: {} });
      await _loadProfile(_session.uid);
      return data || null;
    } catch (e) { return null; }
  }

  async function cancelSubscription() {
    const { data, error } = await supabaseClient.functions.invoke('cancelar-assinatura');
    if (error) throw new Error(error.message);
    return data;
  }

  return {
    register, login, logout, currentSession, isPremium, setLinkedAccounts,
    onChange, isReady, refreshPremiumStatus, cancelSubscription, escapeHTML, abrirStripe, sincronizarStripe,
  };
})();

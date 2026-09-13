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

  function _notify() {
    for (const cb of _listeners) { try { cb(_session); } catch (e) { console.error(e); } }
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
      .from('profiles').select('name, premium').eq('id', uid).single();
    if (error) { console.error('[AuthSystem] Erro ao carregar perfil:', error); return; }
    if (_session && _session.uid === uid && data) {
      _session.premium = !!data.premium;
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
            _session.premium = !!payload.new.premium;
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
    _applySession(session).finally(() => { _ready = true; _notify(); });
  });

  function _friendlyError(err) {
    const msg = (err && err.message) || '';
    const map = [
      [/already registered/i,      'Email já cadastrado. Tente fazer login.'],
      [/invalid login credentials/i,'Email ou senha incorretos.'],
      [/invalid email/i,            'Email inválido.'],
      [/password should be at least/i, 'A senha deve ter pelo menos 6 caracteres.'],
      [/rate limit/i,               'Muitas tentativas. Tente novamente em alguns minutos.'],
      [/network/i,                  'Falha de conexão. Verifique sua internet.'],
    ];
    for (const [re, friendly] of map) if (re.test(msg)) return friendly;
    return msg ? ('Erro: ' + msg) : 'Erro desconhecido.';
  }

  async function register(email, password, name) {
    try {
      const { error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { name: name || '' } },
      });
      if (error) return { ok: false, msg: _friendlyError(error) };
      // O perfil em public.profiles é criado pelo trigger handle_new_user
      // (Postgres) — não escrevemos nada na tabela aqui de propósito.
      return { ok: true };
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

  function currentSession() { return _session; }
  function isPremium() { return !!(_session && _session.premium); }

  // ── Pagamento — chama as Edge Functions, nunca ativa premium local ──
  async function startCheckout() {
    if (!_session) throw new Error('Faça login antes de assinar.');
    const { data, error } = await supabaseClient.functions.invoke('criar-pagamento');
    if (error) throw new Error((data && data.error) || error.message || 'Erro ao iniciar pagamento.');
    if (data && data.error) throw new Error(data.error);
    return data; // { init_point, sandbox_init_point, preference_id }
  }

  async function refreshPremiumStatus() {
    if (!_session) return { premium: false };
    const { data, error } = await supabaseClient.functions.invoke('verificar-premium');
    if (error) throw new Error(error.message);
    return data;
  }

  async function cancelSubscription() {
    const { data, error } = await supabaseClient.functions.invoke('cancelar-assinatura');
    if (error) throw new Error(error.message);
    return data;
  }

  return {
    register, login, logout, currentSession, isPremium,
    onChange, isReady, startCheckout, refreshPremiumStatus, cancelSubscription,
  };
})();

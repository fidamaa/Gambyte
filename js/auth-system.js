/* ==============================================================
   MODULE: auth-system.js
   Camada de dados de autenticação e premium (localStorage).
   ============================================================== */
const AuthSystem = (() => {
  const USERS_KEY  = 'chesslens_users';
  const SESSION_KEY = 'chesslens_session';

  function getUsers()   { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch(e){return{};} }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch(e){return null;} }
  function saveSession(s){ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function register(email, password, name) {
    const users = getUsers();
    if (users[email]) return { ok: false, msg: 'Email já cadastrado.' };
    users[email] = { email, password: btoa(password), name, premium: false, createdAt: Date.now() };
    saveUsers(users);
    const session = { email, name, premium: false };
    saveSession(session);
    return { ok: true, session };
  }

  function login(email, password) {
    const users = getUsers();
    const u = users[email];
    if (!u) return { ok: false, msg: 'Email não encontrado.' };
    if (u.password !== btoa(password)) return { ok: false, msg: 'Senha incorreta.' };
    const session = { email, name: u.name, premium: u.premium };
    saveSession(session);
    return { ok: true, session };
  }

  function logout() { clearSession(); }

  function activatePremium(email) {
    const users = getUsers();
    if (!users[email]) return false;
    users[email].premium = true;
    saveUsers(users);
    const sess = getSession();
    if (sess && sess.email === email) {
      sess.premium = true;
      saveSession(sess);
    }
    return true;
  }

  function currentSession() { return getSession(); }
  function isPremium() { const s = getSession(); return s && s.premium; }

  return { register, login, logout, activatePremium, currentSession, isPremium };
})();

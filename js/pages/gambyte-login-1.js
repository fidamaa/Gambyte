
/* AuthSystem vem de js/modules/auth-system.js (Supabase Auth de verdade —
   mesma conta usada no analisador, sem duplicar lógica localStorage). */

/* ── UI Logic ── */
function switchTab(tab) {
  document.getElementById('tab-login-btn').classList.toggle('active', tab==='login');
  document.getElementById('tab-register-btn').classList.toggle('active', tab==='register');
  document.getElementById('form-login').classList.toggle('active', tab==='login');
  document.getElementById('form-register').classList.toggle('active', tab==='register');
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') { inp.type='text'; btn.textContent='Ocultar'; btn.setAttribute('aria-label','Ocultar senha'); btn.setAttribute('aria-pressed','true'); }
  else                         { inp.type='password'; btn.textContent='Mostrar'; btn.setAttribute('aria-label','Mostrar senha'); btn.setAttribute('aria-pressed','false'); }
}

function checkPwStrength(pw) {
  const fill  = document.getElementById('pw-fill');
  const label = document.getElementById('pw-label');
  if (!pw) { fill.style.width='0%'; label.textContent=''; return; }
  let score = 0;
  if (pw.length >= 6)  score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { pct:'10%', color:'var(--red)', text:'Fraca' },
    { pct:'30%', color:'var(--red)', text:'Fraca' },
    { pct:'55%', color:'var(--orange, #e09b5b)', text:'Média' },
    { pct:'80%', color:'#c9c45b', text:'Boa' },
    { pct:'100%',color:'var(--green)', text:'Forte' }
  ];
  const l = levels[Math.min(score, 4)];
  fill.style.width = l.pct;
  fill.style.background = l.color;
  label.textContent = l.text;
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.add('visible');
}
function hideErr(id) { document.getElementById(id).classList.remove('visible'); }
function showSuc(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.add('visible');
}

function showToast(msg, type='info') {
  const c = document.getElementById('toast-area');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

async function doLogin() {
  hideErr('login-error');
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  if (!email || !pw) { showErr('login-error','Preencha todos os campos.'); return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Entrando…';
  const res = await AuthSystem.login(email, pw);
  btn.disabled = false; btn.textContent = 'Entrar na conta';
  if (res.ok) {
    showToast('✅ Login realizado!', 'success');
    setTimeout(() => window.location.href = 'index.html', 800);
  } else {
    showErr('login-error', res.msg);
  }
}

async function doRegister() {
  hideErr('register-error');
  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const pw      = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  if (!name || !email || !pw) { showErr('register-error','Preencha todos os campos.'); return; }
  if (pw !== confirm)         { showErr('register-error','As senhas não coincidem.'); return; }
  if (pw.length < 12)         { showErr('register-error','Use uma senha de pelo menos 12 caracteres.'); return; }
  const btn = document.getElementById('btn-register');
  btn.disabled = true; btn.textContent = 'Criando conta…';
  const res = await AuthSystem.register(email, pw, name);
  btn.disabled = false; btn.textContent = 'Criar conta grátis';
  if (res.ok) {
    if (res.needsConfirmation) {
      showSuc('register-success', 'Confira seu e-mail para confirmar o cadastro antes de entrar. Se já tiver uma conta, use a opção de login.');
    } else {
      showToast('Conta criada com sucesso!', 'success');
      setTimeout(() => window.location.href = 'index.html', 900);
    }
  } else {
    showErr('register-error', res.msg);
  }
}

async function doLogout() {
  await AuthSystem.logout();
  showToast('Sessão encerrada.', 'info');
  setTimeout(() => location.reload(), 600);
}

// Enter key support
['login-email','login-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
});
['reg-name','reg-email','reg-password','reg-confirm'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });
});

/* ── Floating background pieces ── */
function spawnPieces() {
  const container = document.getElementById('bg-pieces');
  const pieces = ['♔','♕','♖','♗','♘','♙','♚','♛','♜','♝','♞','♟'];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'bg-piece';
    p.textContent = pieces[Math.floor(Math.random()*pieces.length)];
    p.style.cssText = `
      left: ${Math.random()*100}%;
      animation-duration: ${18+Math.random()*20}s;
      animation-delay: ${-Math.random()*20}s;
      font-size: ${60+Math.random()*60}px;
    `;
    container.appendChild(p);
  }
}

/* ── Init ── */
function renderSession(sess) {
  if (sess) {
    // Show logged-in panel
    document.getElementById('auth-tabs').style.display  = 'none';
    document.getElementById('auth-forms').style.display = 'none';
    const panel = document.getElementById('logged-in-panel');
    panel.classList.add('visible');
    const initials = (sess.name||sess.email).charAt(0).toUpperCase();
    document.getElementById('li-avatar').textContent = initials;
    document.getElementById('li-name').textContent   = sess.name || 'Usuário';
    document.getElementById('li-email').textContent  = sess.email;
    const badge = document.getElementById('li-badge');
    if (sess.premium) {
      badge.textContent = 'Gambyte Pro';
      badge.className   = 'logged-in-badge premium';
      document.getElementById('li-promo').style.display = 'none';
    } else {
      badge.textContent = 'Conta Gratuita';
      badge.className   = 'logged-in-badge free';
    }
  } else {
    document.getElementById('auth-tabs').style.display  = '';
    document.getElementById('auth-forms').style.display = '';
    document.getElementById('logged-in-panel').classList.remove('visible');
  }
}

function init() {
  spawnPieces();
  // onChange já dispara uma vez com o estado atual (mesmo antes do
  // Supabase Auth resolver) e de novo sempre que login/logout/premium
  // mudar — assim o painel não fica preso no estado de quando a página
  // carregou.
  AuthSystem.onChange(renderSession);
}

document.addEventListener('DOMContentLoaded', init);

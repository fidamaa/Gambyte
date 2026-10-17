
/* AuthSystem vem de js/modules/auth-system.js — conta e status premium de
   verdade (Supabase Auth + Postgres/RLS), mesma sessão usada no analisador. */

/* ── UI ── */
function showToast(msg, type='info') {
  const c = document.getElementById('toast-area');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

function toggleFaq(btn) {
  const item = btn.parentElement;
  item.classList.toggle('open');
}

function openCheckout() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';

  const sess = AuthSystem.currentSession();
  if (!sess) {
    showStep('step-auth-check');
  } else if (sess.premium) {
    showStep('step-already-premium');
  } else {
    showStep('step-payment');
    document.getElementById('modal-title-text').textContent = 'Finalizar Assinatura';
    document.getElementById('payment-error').style.display = 'none';
  }
}

function closeCheckout() {
  document.getElementById('modal-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function closeCheckoutOnOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeCheckout();
}

function showStep(id) {
  document.querySelectorAll('.payment-step').forEach(el => el.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function goToLogin() {
  closeCheckout();
  // Store intent to come back
  sessionStorage.setItem('gambyte_redirect', 'premium');
  window.location.href = 'gambyte-login.html';
}

// Abre somente a cobrança oficial fornecida pelo titular; não confirma pagamento.
function doPayment() {
  const session = AuthSystem.currentSession();
  if (!session) { showStep('step-auth-check'); return; }
  const link = document.createElement('a');
  link.href = 'https://nubank.com.br/cobrar/54sp2d/6ad303d5-0da2-4794-b326-64203c26e6c9';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showPayErr(msg) {
  const el = document.getElementById('payment-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

/* ── User status bar ── */
function renderUserBar(sess) {
  const bar = document.getElementById('user-status-bar');
  if (!bar) return;
  if (sess) {
    bar.innerHTML = `
      <span class="ubar-name">${AuthSystem.escapeHTML(sess.name || sess.email.split('@')[0])}</span>
      ${sess.premium ? '<span class="ubar-badge">PRO</span>' : ''}
    `;
  } else {
    bar.innerHTML = '';
  }
}

/* ── Check redirect intent (voltou do login pra terminar a assinatura) ── */
function checkRedirect(sess) {
  const intent = sessionStorage.getItem('gambyte_redirect');
  if (intent === 'premium') {
    sessionStorage.removeItem('gambyte_redirect');
    if (sess && !sess.premium) setTimeout(openCheckout, 400);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let redirectChecked = false;
  AuthSystem.onChange(sess => {
    renderUserBar(sess);
    if (!redirectChecked && AuthSystem.isReady()) {
      redirectChecked = true;
      checkRedirect(sess);
    }
    // O acesso só muda quando o perfil é atualizado no servidor.
    const overlay = document.getElementById('modal-overlay');
    if (overlay.classList.contains('visible') && sess && sess.premium) {
      document.getElementById('modal-title-text').textContent = ' Assinatura Ativada';
      showStep('step-success');
      showToast(' Gambyte Pro ativado com sucesso!', 'success');
    }
  });
});

// Keyboard close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCheckout();
});

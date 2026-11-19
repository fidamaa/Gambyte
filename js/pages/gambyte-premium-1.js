
/* Página do Gambyte Pro.
   AuthSystem vem de js/modules/auth-system.js: conta e status do Pro de
   verdade (Supabase Auth + Postgres/RLS), a mesma sessão do analisador.
   Esta página nunca ativa o Pro: ela só abre a cobrança e reage quando o
   perfil é atualizado no servidor. */

// Pagamento: só assinatura no cartão, pelo Stripe.
const comCartao = sess => !!(sess && ['active', 'trialing', 'past_due'].includes(sess.assinaturaCartao));

/* ── UI ── */
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-area');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const aberto = item.classList.toggle('open');
  btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
}

/* Dias inteiros que faltam até o vencimento (0 = vence hoje). */
function diasRestantes(sess) {
  if (!sess || !sess.expiresAt) return null;
  const ms = Date.parse(sess.expiresAt) - Date.now();
  return isNaN(ms) ? null : Math.max(0, Math.floor(ms / 86400000));
}
function dataVencimento(sess) {
  const d = new Date(sess.expiresAt);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function showStep(id) {
  document.querySelectorAll('.payment-step').forEach(el => el.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function showPaymentStep(sess, titulo) {
  showStep('step-payment');
  document.getElementById('modal-title-text').textContent = titulo || 'Assinar o Gambyte Pro';
  showPayErr('');
}

function openCheckout() {
  document.getElementById('modal-overlay').classList.add('visible');
  document.body.style.overflow = 'hidden';

  const sess = AuthSystem.currentSession();
  if (!sess) {
    showStep('step-auth-check');
    document.getElementById('modal-title-text').textContent = 'Assinar o Gambyte Pro';
  } else if (sess.premium) {
    const dias = diasRestantes(sess);
    document.getElementById('modal-title-text').textContent = 'Sua assinatura';
    const cartao = comCartao(sess);
    document.getElementById('already-premium-text').textContent = dias == null
      ? 'Sua conta tem acesso a todos os recursos do Pro.'
      : cartao
        ? `Assinatura no cartão ativa. Próxima renovação em ${dataVencimento(sess)}.`
        : `Acesso liberado até ${dataVencimento(sess)} (${dias === 0 ? 'último dia' : dias === 1 ? 'falta 1 dia' : 'faltam ' + dias + ' dias'}). Não há cobrança automática.`;
    document.getElementById('already-portal').hidden = !(sess.assinaturaCartao);
    showStep('step-already-premium');
  } else {
    showPaymentStep(sess);
  }
}

function closeCheckout() {
  document.getElementById('modal-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function goToLogin() {
  closeCheckout();
  sessionStorage.setItem('gambyte_redirect', 'premium'); // volta pra cá depois do login
  window.location.href = 'gambyte-login.html';
}

// Cartão: abre o Checkout do Stripe (ou o portal de quem já assina).
async function abrirCartao(qual) {
  if (!AuthSystem.currentSession()) { showStep('step-auth-check'); return; }
  showPayErr('');
  showToast(qual === 'portal' ? 'Abrindo o portal da assinatura…' : 'Abrindo o pagamento seguro…', 'info');
  const r = await AuthSystem.abrirStripe(qual);
  if (!r.ok) { showPayErr(r.msg); showToast(r.msg, 'error'); }
}


function showPayErr(msg) {
  const el = document.getElementById('payment-error');
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

/* ── Estado da conta no topo e no botão de assinatura ── */
function renderUserBar(sess) {
  const bar = document.getElementById('user-status-bar');
  if (bar) {
    bar.innerHTML = sess ? `
      <span class="ubar-name">${AuthSystem.escapeHTML(sess.name || sess.email.split('@')[0])}</span>
      ${sess.premium ? '<span class="ubar-badge">PRO</span>' : ''}` : '<a class="nav-pro" href="gambyte-login.html">Entrar</a>';
  }

  const status = document.getElementById('pro-status');
  const cta = document.getElementById('btn-subscribe');
  if (!status || !cta) return;
  if (sess && sess.premium) {
    const dias = diasRestantes(sess);
    const acabando = dias != null && dias <= 5;
    status.hidden = false;
    status.className = 'pro-status' + (acabando ? ' ending' : '');
    status.textContent = dias == null
      ? 'Seu Gambyte Pro está ativo.'
      : acabando
        ? comCartao(sess) ? `Seu Gambyte Pro renova em ${dataVencimento(sess)}.` : `Seu Gambyte Pro termina em ${dataVencimento(sess)} (${dias === 0 ? 'hoje' : dias === 1 ? 'falta 1 dia' : 'faltam ' + dias + ' dias'}). Para continuar depois dessa data, assine com cartão.`
        : comCartao(sess)
          ? `Seu Gambyte Pro está ativo no cartão. Próxima renovação em ${dataVencimento(sess)}.`
          : `Seu Gambyte Pro está ativo até ${dataVencimento(sess)}. Não há cobrança automática.`;
    cta.textContent = 'Ver minha assinatura';
  } else {
    status.hidden = true;
    cta.textContent = 'Assinar por R$ 9,90';
  }
}

/* ── Voltou do login para terminar a assinatura ── */
function checkRedirect(sess) {
  if (sessionStorage.getItem('gambyte_redirect') !== 'premium') return;
  sessionStorage.removeItem('gambyte_redirect');
  if (sess && !sess.premium) setTimeout(openCheckout, 400);
}

document.addEventListener('DOMContentLoaded', () => {
  // Voltou do Checkout do Stripe.
  const volta = new URLSearchParams(location.search).get('stripe');
  if (volta === 'ok') {
    showToast('Pagamento recebido. Ativando o seu Pro…', 'success');
    // Confere no Stripe algumas vezes até a assinatura aparecer.
    let tentativas = 0;
    const conferir = async () => {
      if (!AuthSystem.isReady() || !AuthSystem.currentSession()) { if (++tentativas < 20) setTimeout(conferir, 1000); return; }
      const r = await AuthSystem.sincronizarStripe();
      if (r && r.premium) { showToast('Gambyte Pro ativado.', 'success'); return; }
      if (++tentativas < 8) setTimeout(conferir, 3000);
    };
    conferir();
  }
  else if (volta === 'cancelado') showToast('Pagamento cancelado. Nada foi cobrado.', 'info');
  if (volta) history.replaceState(null, '', location.pathname);
  let redirectChecked = false;
  let eraPro = null;
  AuthSystem.onChange(sess => {
    renderUserBar(sess);
    if (!redirectChecked && AuthSystem.isReady()) {
      redirectChecked = true;
      checkRedirect(sess);
    }
    // O acesso só muda quando o perfil é atualizado no servidor. Se isso
    // acontecer com o checkout aberto, mostra a confirmação na hora.
    const agoraPro = !!(sess && sess.premium);
    const overlay = document.getElementById('modal-overlay');
    const pagando = document.getElementById('step-payment').classList.contains('active');
    if (eraPro === false && agoraPro && overlay.classList.contains('visible') && pagando) {
      document.getElementById('modal-title-text').textContent = 'Assinatura ativada';
      showStep('step-success');
      showToast('Gambyte Pro ativado.', 'success');
    }
    if (AuthSystem.isReady()) eraPro = agoraPro;
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCheckout();
});

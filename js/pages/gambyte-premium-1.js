
/* Página do Gambyte Pro.
   AuthSystem vem de js/modules/auth-system.js: conta e status do Pro de
   verdade (Supabase Auth + Postgres/RLS), a mesma sessão do analisador.
   Esta página nunca ativa o Pro: ela só abre a cobrança e reage quando o
   perfil é atualizado no servidor. */

const NUBANK_URL = 'https://nubank.com.br/cobrar/54sp2d/6ad303d5-0da2-4794-b326-64203c26e6c9';
const WHATS_URL  = 'https://wa.me/5521986996374?text=';
// Assinatura por cartão (Stripe). Fica escondida até o Stripe estar
// configurado no Supabase (chaves, preço e webhook): aí basta trocar para true.
const CARTAO_LIGADO = true;
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
  // Mostra o e-mail da conta e já deixa a mensagem do WhatsApp preenchida com ele.
  const email = (sess && sess.email) || '';
  document.getElementById('pay-email').textContent = email || '—';
  const cartao = document.getElementById('pay-cartao');
  if (cartao) cartao.hidden = !CARTAO_LIGADO;
  const periodo = document.getElementById('pay-periodo');
  if (periodo) periodo.textContent = CARTAO_LIGADO ? 'Cartão: todo mês · Pix: um mês' : 'Um mês, sem renovação automática';
  document.getElementById('whats-link').href = WHATS_URL +
    encodeURIComponent(`Olá! Fiz o Pix do Gambyte Pro. O e-mail da minha conta é: ${email}`);
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
    document.getElementById('already-acoes').hidden = cartao;
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

// Abre somente a cobrança oficial fornecida pelo titular; não confirma pagamento.
function doPayment() {
  const session = AuthSystem.currentSession();
  if (!session) { showStep('step-auth-check'); return; }
  window.open(NUBANK_URL, '_blank', 'noopener,noreferrer');
  showPayErr('');
  showToast('Cobrança aberta em outra aba. Depois de pagar, avise pelo WhatsApp.', 'success');
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
        ? comCartao(sess) ? `Seu Gambyte Pro renova em ${dataVencimento(sess)}.` : `Seu Gambyte Pro termina em ${dataVencimento(sess)} (${dias === 0 ? 'hoje' : dias === 1 ? 'falta 1 dia' : 'faltam ' + dias + ' dias'}). Para continuar depois dessa data, faça um novo Pix e avise pelo WhatsApp.`
        : comCartao(sess)
          ? `Seu Gambyte Pro está ativo no cartão. Próxima renovação em ${dataVencimento(sess)}.`
          : `Seu Gambyte Pro está ativo até ${dataVencimento(sess)}. Não há cobrança automática.`;
    cta.textContent = acabando && !comCartao(sess) ? 'Pagar mais um mês' : 'Ver minha assinatura';
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
  if (volta === 'ok') showToast('Pagamento recebido. O Pro é ativado em alguns segundos.', 'success');
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

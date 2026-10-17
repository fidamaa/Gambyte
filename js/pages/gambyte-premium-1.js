
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

// Redireciona pro Checkout Pro do Mercado Pago — o pagamento em si (Pix,
// cartão, boleto) acontece 100% no ambiente deles, nunca aqui. O Gambyte
// só sabe que virou Premium quando o webhook (functions/index.js)
// confirmar o pagamento aprovado; não existe mais "ativar premium" client-side.
async function doPayment() {
  const btn = document.getElementById('btn-pay');
  btn.disabled = true;
  btn.textContent = ' Gerando pagamento…';
  showPayErr(null);

  try {
    const { init_point, sandbox_init_point } = await AuthSystem.startCheckout();
    // Em produção (Access Token real) init_point é o link de verdade;
    // sandbox_init_point só existe testando com credenciais de teste.
    const checkoutUrl = new URL(init_point || sandbox_init_point);
    if (checkoutUrl.protocol !== 'https:' || !['www.mercadopago.com.br', 'sandbox.mercadopago.com.br'].includes(checkoutUrl.hostname)) {
      throw new Error('Endereço de pagamento inválido.');
    }
    window.location.href = checkoutUrl.href;
  } catch (err) {
    console.error('[doPayment]', err);
    btn.disabled = false;
    btn.textContent = ' Ir para pagamento seguro (Mercado Pago)';
    showPayErr(err.message || 'Não foi possível iniciar o pagamento. Tente novamente.');
  }
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

// status=success/failure/pending vem do back_urls configurado em
// criarPagamento (functions/index.js) — o pagamento pode levar alguns
// segundos pra ser confirmado pelo webhook, então isso é só feedback
// visual; quem manda de verdade é o Firestore (via AuthSystem.onChange).
function checkPaymentReturn() {
  const status = new URLSearchParams(location.search).get('status');
  if (status === 'success') {
    showToast('Pagamento recebido! Confirmando sua assinatura…', 'success');
  } else if (status === 'pending') {
    showToast('Pagamento em análise (comum no boleto/Pix). Assim que aprovado, o Premium ativa sozinho.', 'info');
  } else if (status === 'failure') {
    showToast('Pagamento não foi concluído. Você pode tentar de novo quando quiser.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkPaymentReturn();
  let redirectChecked = false;
  AuthSystem.onChange(sess => {
    renderUserBar(sess);
    if (!redirectChecked && AuthSystem.isReady()) {
      redirectChecked = true;
      checkRedirect(sess);
    }
    // Se o modal de checkout estiver aberto e o Firestore confirmar
    // premium em tempo real (webhook do MP chegou), avança pro sucesso.
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

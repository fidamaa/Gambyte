/* Liga os botões da página do Gambyte Pro (sem handlers inline, por causa da CSP). */
document.addEventListener('click', event => {
  const faq = event.target.closest('.faq-question');
  if (faq) { toggleFaq(faq); return; }

  if (event.target.id === 'modal-overlay') { closeCheckout(); return; }

  const el = event.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'voltar':  window.location.href = 'index.html'; break;
    case 'assinar': openCheckout(); break;
    case 'fechar':  closeCheckout(); break;
    case 'login':   goToLogin(); break;
    case 'pagar':   doPayment(); break;
    case 'renovar': showPaymentStep(AuthSystem.currentSession(), 'Pagar mais um mês'); break;
  }
});

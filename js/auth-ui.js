/* ==============================================================
   MODULE: auth-ui.js
   Renderiza o cabeçalho (login/premium) e toasts.
   Depende de: auth-system.js, insights-ui.js
   ============================================================== */
const AuthUI = (() => {
  function showToast(msg, type='info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function renderHeader() {
    const area = document.getElementById('header-auth-area');
    if (!area) return;
    const sess = AuthSystem.currentSession();
    if (sess) {
      const initials = (sess.name || sess.email).charAt(0).toUpperCase();
      area.innerHTML = `
        ${!sess.premium ? `<button class="btn-premium-header" onclick="AuthUI.openPremiumPage()">⭐ Assinar Gambyte Pro</button>` : ''}
        <a class="user-avatar-btn" href="gambyte-login.html" title="Perfil">
          <div class="user-avatar">${initials}</div>
          <span class="user-name-display">${sess.name || sess.email.split('@')[0]}</span>
          ${sess.premium ? '<span class="user-premium-badge">Gambyte Pro</span>' : ''}
        </a>
      `;
    } else {
      area.innerHTML = `
        <button class="btn-login-header" onclick="window.location.href='gambyte-login.html'">Entrar</button>
        <button class="btn-premium-header" onclick="AuthUI.openPremiumPage()">⭐ Premium</button>
      `;
    }
    // Update pro toggle
    const proToggle = document.getElementById('pro-deep-toggle');
    if (proToggle) {
      proToggle.disabled = !AuthSystem.isPremium();
    }
    // Update premium gates in insights
    InsightsUI.updatePremiumGates();
  }

  function handleProToggleClick(e) {
    if (!AuthSystem.isPremium()) {
      e.preventDefault();
      showToast('🔒 Análise Profunda requer conta Premium.', 'error');
      openPremiumPage();
    }
  }

  function openPremiumPage() {
    window.open('gambyte-premium.html', '_blank');
  }

  function init() {
    renderHeader();
    // Listen for premium activation from other tabs
    window.addEventListener('storage', () => renderHeader());
  }

  return { init, renderHeader, handleProToggleClick, openPremiumPage, showToast };
})();

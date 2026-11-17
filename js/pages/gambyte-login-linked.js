/* Página da conta: vincular os usuários do Chess.com e do Lichess.
   O vínculo só guarda o nome de usuário na conta do Gambyte. Ele serve
   para listar as partidas públicas no analisador com um clique; não
   acessa nem altera nada nas contas do Chess.com ou do Lichess. */
(function () {
  const SITES = {
    chesscom: { nome: 'Chess.com', checar: u => `https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}` },
    lichess:  { nome: 'Lichess',   checar: u => `https://lichess.org/api/user/${encodeURIComponent(u)}` },
  };
  const $ = id => document.getElementById(id);

  function status(site, msg, tipo) {
    const el = $(`lk-status-${site}`);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'lk-status' + (tipo ? ' ' + tipo : '');
  }

  function render(sess) {
    const box = $('linked-accounts');
    if (!box) return;
    box.hidden = !sess;
    if (!sess) return;
    const linked = sess.linked || {};
    for (const site of Object.keys(SITES)) {
      const atual = linked[site] || '';
      const campo = $(`lk-input-${site}`);
      const linha = $(`lk-row-${site}`);
      const ver = $(`lk-view-${site}`);
      if (campo && document.activeElement !== campo) campo.value = atual;
      if (linha) linha.classList.toggle('is-linked', !!atual);
      if (ver) { ver.hidden = !atual; ver.href = `index.html?importar=${site}`; }
      const rem = $(`lk-remove-${site}`);
      if (rem) rem.hidden = !atual;
    }
  }

  async function salvar(site) {
    const campo = $(`lk-input-${site}`);
    const nome = (campo?.value || '').trim().replace(/^@/, '');
    if (!nome) { status(site, 'Digite o nome de usuário.', 'error'); return; }
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(nome)) { status(site, 'Esse nome de usuário não parece válido.', 'error'); return; }
    const btn = $(`lk-save-${site}`);
    if (btn) btn.disabled = true;
    status(site, `Conferindo o usuário no ${SITES[site].nome}…`);
    try {
      const r = await fetch(SITES[site].checar(nome));
      if (r.status === 404) { status(site, `Usuário não encontrado no ${SITES[site].nome}.`, 'error'); return; }
      if (!r.ok) { status(site, 'Não foi possível conferir agora. Tente de novo em instantes.', 'error'); return; }
      const dados = await r.json().catch(() => ({}));
      const oficial = dados.username || dados.name || nome;   // grafia oficial do site
      const res = await AuthSystem.setLinkedAccounts({ [site]: oficial });
      if (!res.ok) { status(site, res.msg || 'Não foi possível salvar.', 'error'); return; }
      status(site, `Vinculado: ${oficial}. No analisador, o botão com esse nome lista suas partidas.`, 'ok');
    } catch (e) {
      status(site, 'Não foi possível conferir agora. Verifique a conexão.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function remover(site) {
    const res = await AuthSystem.setLinkedAccounts({ [site]: '' });
    if (res.ok) { const c = $(`lk-input-${site}`); if (c) c.value = ''; status(site, 'Vínculo removido.', 'ok'); }
    else status(site, res.msg || 'Não foi possível remover.', 'error');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const box = $('linked-accounts');
    if (!box) return;
    box.addEventListener('click', e => {
      const s = e.target.closest('[data-lk-save]');
      if (s) { salvar(s.dataset.lkSave); return; }
      const r = e.target.closest('[data-lk-remove]');
      if (r) remover(r.dataset.lkRemove);
    });
    box.addEventListener('keydown', e => {
      const c = e.target.closest('[data-lk-input]');
      if (c && e.key === 'Enter') { e.preventDefault(); salvar(c.dataset.lkInput); }
    });
    AuthSystem.onChange(render);
  });
  window.GambyteLinked = { render };
})();

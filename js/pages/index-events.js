/* Chave "Análise Profunda": quem não é Pro é levado à página do plano. */
document.querySelector('[data-onclick="index-1"]').addEventListener('click', function (event) { AuthUI.handleProToggleClick(event); });

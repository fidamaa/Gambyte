// Teste do classificador de estilo (player-dna.js) com 50 perfis inventados.
// Cada perfil: números brutos como o DNA calcula e o estilo que um treinador
// daria. Rodar: node tools/teste-estilo.js
//   forc: parte dos lances com xeque/captura · avanco: peças no campo do adversário
//   taticaPct: lances únicos achados · golpesPorPartida: brilhantes+ótimos por partida
//   gafes40: gafes a cada 40 lances · desvio: variação da precisão entre partidas
//   precMeio: precisão no meio-jogo · accPior: precisão quando estava pior
const fs = require('fs');
const path = require('path');
global.document = { getElementById: () => null };
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '', hostname: 'x' };
const PlayerDNA = eval(fs.readFileSync(path.join(__dirname, '..', 'js/modules/player-dna.js'), 'utf8') + ';PlayerDNA');

const P = (esperado, forc, avanco, taticaPct, golpesPorPartida, gafes40, desvio, precMeio, accPior, nota) =>
  ({ esperado, b: { forc, avanco, taticaPct, golpesPorPartida, gafes40, desvio, precMeio, accPior }, nota });

const CASOS = [
  // Atacantes: muito forçante, peças avançadas, aceita risco
  P('atacante', 0.50, 0.52, 0.65, 0.6, 1.2, 9, 78, 70, 'atacante clássico de clube'),
  P('atacante', 0.47, 0.48, 0.60, 0.5, 1.4, 10, 75, 66, 'ataca e entrega peças'),
  P('atacante', 0.52, 0.55, 0.70, 0.7, 1.0, 8, 80, 72, 'atacante forte'),
  P('atacante', 0.45, 0.50, 0.58, 0.4, 1.1, 9, 76, null, 'sem dado de resistência'),
  P('atacante', 0.49, 0.45, 0.62, 0.5, 1.3, 11, 74, 68, 'agressivo e oscilante'),
  P('atacante', 0.48, 0.53, 0.66, 0.6, 0.9, 8, 79, 71, 'atacante com boa segurança'),
  P('atacante', 0.51, 0.50, null, 0.5, 1.2, 9, 77, 69, 'poucos momentos táticos'),
  P('atacante', 0.46, 0.49, 0.63, 0.5, 1.0, 9, 78, 70, 'atacante mediano'),
  // Táticos: acham combinações, muitos golpes
  P('tatico', 0.40, 0.40, 0.88, 1.1, 0.6, 7, 84, 74, 'enxerga tudo'),
  P('tatico', 0.42, 0.38, 0.85, 1.0, 0.7, 7, 83, 72, 'tático forte'),
  P('tatico', 0.38, 0.42, 0.90, 1.2, 0.5, 6, 86, 76, 'combinativo de alto nível'),
  P('tatico', 0.44, 0.44, 0.82, 0.9, 0.8, 8, 82, 70, 'golpes frequentes'),
  P('tatico', 0.39, 0.36, 0.86, 1.0, 0.6, 7, 85, null, 'sem resistência'),
  P('tatico', 0.41, 0.40, 0.84, 1.1, 0.7, 8, 83, 73, 'tático regular'),
  P('tatico', 0.43, 0.41, 0.87, 0.95, 0.6, 7, 84, 71, 'tático clássico'),
  P('tatico', 0.37, 0.39, 0.83, 1.0, 0.8, 8, 81, 72, 'tático de clube'),
  // Sólidos: quase não erram e jogam igual sempre
  P('solido', 0.32, 0.32, 0.70, 0.3, 0.25, 4, 88, 75, 'muralha'),
  P('solido', 0.30, 0.30, 0.68, 0.2, 0.3, 4.5, 87, 74, 'sólido de torneio'),
  P('solido', 0.33, 0.34, 0.72, 0.3, 0.2, 3.5, 89, 76, 'sólido forte'),
  P('solido', 0.31, 0.31, 0.66, 0.25, 0.35, 5, 86, null, 'sem resistência'),
  P('solido', 0.34, 0.33, 0.71, 0.35, 0.3, 4, 87, 73, 'regular e seguro'),
  P('solido', 0.29, 0.29, 0.69, 0.2, 0.25, 4, 88, 74, 'sólido calmo'),
  P('solido', 0.32, 0.35, 0.67, 0.3, 0.3, 4.5, 85, 72, 'sólido de clube'),
  P('solido', 0.33, 0.30, null, 0.3, 0.3, 4, 87, 75, 'poucos momentos táticos'),
  // Posicionais: pouco forçante, ótimos nos lances calmos
  P('posicional', 0.22, 0.22, 0.62, 0.3, 0.4, 5, 93, 74, 'manobrador'),
  P('posicional', 0.24, 0.20, 0.60, 0.25, 0.5, 5.5, 92, 72, 'estrategista'),
  P('posicional', 0.21, 0.24, 0.64, 0.35, 0.45, 5, 94, 75, 'posicional forte'),
  P('posicional', 0.25, 0.23, 0.58, 0.3, 0.5, 6, 91, null, 'sem resistência'),
  P('posicional', 0.23, 0.21, 0.61, 0.3, 0.45, 5.5, 92, 73, 'joga devagar e bem'),
  P('posicional', 0.20, 0.25, 0.63, 0.25, 0.4, 5, 93, 74, 'posicional puro'),
  P('posicional', 0.26, 0.22, 0.60, 0.3, 0.55, 6, 90, 71, 'posicional de clube'),
  P('posicional', 0.22, 0.19, null, 0.3, 0.5, 5.5, 92, 73, 'sem dado de tática'),
  // Defensores: brilham quando estão pior
  P('defensor', 0.33, 0.30, 0.66, 0.4, 0.6, 7, 82, 88, 'salva partida perdida'),
  P('defensor', 0.35, 0.32, 0.64, 0.4, 0.7, 7.5, 80, 86, 'lutador'),
  P('defensor', 0.31, 0.29, 0.68, 0.45, 0.55, 6.5, 83, 90, 'defensor forte'),
  P('defensor', 0.34, 0.33, 0.62, 0.35, 0.75, 8, 79, 85, 'resiste e contra-ataca'),
  P('defensor', 0.32, 0.31, 0.65, 0.4, 0.65, 7, 81, 87, 'defensor de clube'),
  P('defensor', 0.36, 0.30, 0.63, 0.4, 0.7, 7.5, 80, 89, 'teimoso'),
  P('defensor', 0.33, 0.28, null, 0.4, 0.6, 7, 82, 86, 'poucos momentos táticos'),
  P('defensor', 0.30, 0.32, 0.66, 0.4, 0.6, 7, 82, 88, 'defensor calmo'),
  // Irregulares: muitos erros e nível que oscila
  P('irregular', 0.40, 0.38, 0.45, 0.2, 2.2, 15, 66, 55, 'iniciante'),
  P('irregular', 0.42, 0.40, 0.42, 0.15, 2.0, 14, 68, 52, 'oscila muito'),
  P('irregular', 0.38, 0.36, 0.40, 0.1, 2.4, 16, 64, 50, 'muitas gafes'),
  P('irregular', 0.44, 0.42, 0.48, 0.25, 1.9, 13, 69, null, 'sem resistência'),
  P('irregular', 0.41, 0.37, null, 0.2, 2.1, 15, 67, 54, 'poucos dados de tática'),
  P('irregular', 0.39, 0.39, 0.46, 0.2, 2.3, 14, 65, 53, 'iniciante esforçado'),
  P('irregular', 0.43, 0.41, 0.44, 0.15, 2.0, 16, 66, 51, 'altos e baixos'),
  P('irregular', 0.37, 0.35, 0.43, 0.1, 2.5, 15, 63, 49, 'começando agora'),
  // Casos de fronteira
  P('atacante', 0.50, 0.50, 0.85, 0.9, 1.0, 9, 80, 70, 'atacante que também acha tática (fronteira atacante/tático)'),
  P('solido', 0.27, 0.26, 0.66, 0.25, 0.3, 4, 91, 74, 'sólido e calmo (fronteira sólido/posicional)'),
];

let ok = 0;
const erros = [];
const matriz = {};
for (const c of CASOS) {
  const r = PlayerDNA.classificarEstilo(c.b);
  // Vale o primeiro; num empate (estilo misto), vale também o segundo.
  const got = r ? (r.misto && r.segundo.k === c.esperado ? c.esperado : r.estilo.k) : 'nada';
  matriz[c.esperado] = matriz[c.esperado] || {};
  matriz[c.esperado][got] = (matriz[c.esperado][got] || 0) + 1;
  if (got === c.esperado) ok++;
  else erros.push(`  esperado ${c.esperado}, deu ${got} (${r ? r.ranking.slice(0, 3).map(x => `${x.k} ${x.pct}%`).join(', ') : '-'}): ${c.nota}`);
}
console.log(`Acertos: ${ok} de ${CASOS.length}`);
console.log('Por estilo esperado:', JSON.stringify(matriz));
if (erros.length) console.log('Erros:\n' + erros.join('\n'));
process.exitCode = ok === CASOS.length ? 0 : 1;

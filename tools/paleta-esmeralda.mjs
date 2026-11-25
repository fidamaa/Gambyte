// Troca a identidade dourada pela verde-esmeralda (rodado uma vez no redesign).
// Uso: node tools/paleta-esmeralda.mjs arquivo1 arquivo2 ...
import fs from 'node:fs';
const HEX = {
  // dourados → esmeralda
  'ecbd6e': '3fd69a', 'f6d391': '8ff0c4', 'f4cc80': '6ee7b4', 'd39a45': '14a372', 'ffbe3c': '3fd69a',
  'e8a020': '22b77f', 'f5c542': '4fe0a6', 'f3d9a8': 'b5f5d8', 'ecd9b9': 'c4efdc',
  '7a6233': '1f6b4f', '5c4b2c': '184f3c', '51422b': '17463a', '1a1408': '04140d', '1b1a14': '0a1410',
  // fundos azulados → preto-esverdeado profundo
  '0d0f14': '07090b', '13161e': '0c1013', '1a1e2a': '11171b', '252a38': '1b2529', '2e3448': '26333a',
  '151923': '0e1316', '161b26': '0f1518', '1b2130': '121a1d', '121721': '0b1012', '1f2636': '141c20',
  '1a2030': '111a1d', '262d3c': '1a2428', '32394a': '24323a', '394459': '2b3a42', '30384a': '24323a',
  '2b2f3c': '1d2629', '232838': '172024', '20253a': '151e22', '1e2331': '141b1f',
  // textos
  '555d78': '56655f', 'b4bdd0': 'b3c2bd', 'b9c2d3': 'b7c5c0', '8b95ad': '8a9a96', 'cbd2df': 'c8d4cf',
  'd3d9e6': 'd0dbd6', 'e8eaf0': 'e9efed', '7c86a3': '7a8a86', 'cdd4e3': 'cbd6d1', 'aeb8cc': 'adbcb7',
  'a6afc5': 'a4b3ae', '8e97ab': '8d9b97', 'd5d9e6': 'd2dcd8', 'eef0f6': 'eef3f1',
};
const RGB = [
  ['236, ?189, ?110', '63,214,154'], ['255, ?190, ?60', '63,214,154'], ['211, ?154, ?69', '20,163,114'],
  ['246, ?211, ?145', '143,240,196'], ['244, ?204, ?128', '110,231,180'],
  ['13, ?15, ?20', '7,9,11'], ['21, ?25, ?35', '14,19,22'],
];
for (const f of process.argv.slice(2)) {
  let s = fs.readFileSync(f, 'utf8'); const antes = s;
  s = s.replace(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?(?![0-9a-fA-F])/g, (m, h, alfa) => {
    const n = HEX[h.toLowerCase()]; return n ? '#' + n + (alfa || '') : m;
  });
  for (const [de, para] of RGB) s = s.replace(new RegExp('rgba?[(]' + de, 'g'), m => m.slice(0, m.indexOf('(') + 1) + para);
  if (s !== antes) { fs.writeFileSync(f, s); console.log('trocado', f); }
}

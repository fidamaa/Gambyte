/* ==============================================================
   DATA: eco-data.js
   Base de dados ECO (Encyclopaedia of Chess Openings)
   Formato: [sequência de lances, código ECO, nome, variação]
   Usado por: opening-detector.js (constrói uma Trie a partir daqui)
   ============================================================== */
const ECO_RAW = [["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6 d4 Bd6 Re1 Qh4 g3 Qh3 Be3 Bg4 Qd3 Rae8 Nd2 Re6 a4 Qh5","C89","Ruy Lopez","Marshall, main line, Spassky variation"],["d4 d5 c4 e6 Nc3 Nf6 Nf3 c6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 a6 e4 c5 e5 cxd4 Nxb5 Nxe5 Nxe5 axb5 O-O Qd5 Qe2 Ba6 Bg5","D49","QGD semi-Slav","Meran, Rellstab attack"],["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6 d4 Bd6 Re1 Qh4 g3 Qh3","C89","Ruy Lopez","Marshall, main line, 14...Qh3"]];

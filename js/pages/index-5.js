
  // O .wasm do Stockfish (~108MB) fica hospedado à parte, num bucket
  // R2 (o Cloudflare Pages recusa qualquer arquivo acima de 25MB). Em
  // desenvolvimento local, deixe vazio — o .wasm é servido pelo próprio
  // dev-server.py, na mesma pasta do .js.
  const STOCKFISH_WASM_CDN_BASE_URL = 'https://pub-94a7965d8e8b4ad78fa49c8be7a840b7.r2.dev';

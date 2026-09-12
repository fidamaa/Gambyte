#!/usr/bin/env python3
"""
Servidor de desenvolvimento local com os headers COOP/COEP necessarios
para o navegador habilitar SharedArrayBuffer (exigido pelo build
multi-thread do Stockfish, stockfish-18-multi.js).

Sem esses headers, o navegador nao expoe SharedArrayBuffer e o app
cai automaticamente para o build single-thread (stockfish-manager.js
detecta isso via self.crossOriginIsolated).

Uso: python dev-server.py [porta]  (porta padrao: 8000)

Para producao (hospedagem real), esses mesmos dois headers precisam
ser configurados no servidor/CDN de verdade para o multi-thread
funcionar para os visitantes do site.
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class COOPCOEPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # ThreadingHTTPServer (nao HTTPServer simples) -- os arquivos .wasm do
    # Stockfish tem ~110MB cada; um servidor single-thread trava todas as
    # outras requisicoes enquanto serve um arquivo grande.
    server = ThreadingHTTPServer(("", port), COOPCOEPHandler)
    print(f"Servindo em http://localhost:{port} com headers COOP/COEP (SharedArrayBuffer habilitado)")
    server.serve_forever()

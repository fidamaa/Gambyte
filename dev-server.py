#!/usr/bin/env python3
"""
Servidor de desenvolvimento local com:

1) Headers COOP/COEP necessarios para o navegador habilitar
   SharedArrayBuffer (exigido pelo build multi-thread do Stockfish,
   stockfish-18-multi.js -- hoje nao usado por padrao, mas o header
   nao atrapalha e mantem a porta aberta caso isso mude no futuro).

2) Cache-Control: no-cache em TODA resposta. Isso NAO desliga o cache
   do navegador -- faz o navegador sempre perguntar ao servidor "isso
   mudou?" (via If-Modified-Since) antes de reusar uma copia salva. Se
   nao mudou, o servidor responde 304 (rapido, sem reenviar o arquivo).
   Se mudou, manda o arquivo novo. Sem isso, qualquer atualizacao de
   codigo pode ficar "presa" no cache do navegador de quem visitou o
   site antes -- cada usuario precisaria limpar o cache manualmente
   pra ver a versao nova, o que nao e aceitavel em producao.

Uso: python dev-server.py [porta]  (porta padrao: 8000)

Para producao (hospedagem real), configure o mesmo header
Cache-Control no servidor/CDN de verdade (ex.: Netlify/Vercel via
arquivo de config, Apache via .htaccess, Nginx via add_header) --
esse script python e so para teste local.
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class COOPCOEPHandler(SimpleHTTPRequestHandler):
    # HTTP/1.1 com keep-alive correto -- o http.server padrao usa HTTP/1.0,
    # o que pode fazer o Chrome reaproveitar conexoes de forma inconsistente
    # e devolver erros 400 esporadicos ao servir os .wasm grandes do Stockfish.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # Sempre revalidar com o servidor antes de usar cache -- garante
        # que ninguem fica preso numa versao antiga do site sem precisar
        # limpar cache manualmente.
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # ThreadingHTTPServer (nao HTTPServer simples) -- os arquivos .wasm do
    # Stockfish tem ~110MB cada; um servidor single-thread trava todas as
    # outras requisicoes enquanto serve um arquivo grande.
    server = ThreadingHTTPServer(("", port), COOPCOEPHandler)
    print(f"Servindo em http://localhost:{port} com headers COOP/COEP (SharedArrayBuffer habilitado)")
    server.serve_forever()

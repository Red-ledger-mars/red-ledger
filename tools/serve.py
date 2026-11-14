"""Serve the project folder for local work, telling the browser not to keep
old copies. Without this a browser can run yesterday's script with today's
page after a file changes.

Usage: python3 tools/serve.py [port] [--lan]
Default port 8765. Open http://localhost:8765 on this machine. With --lan
the page can also be opened from a phone or tablet on the same Wi-Fi, at
http://<this machine's address>:<port>.

Private folders and hidden files are never served.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Notes and settings that stay on this machine, whoever asks.
PRIVATE = {"brief", "CLAUDE.md", "node_modules"}


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        if any(p.startswith(".") or p in PRIVATE for p in parts):
            self.send_error(404)
            return None
        return super().send_head()

    def log_message(self, *args):
        pass  # keep the terminal quiet


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    server = ThreadingHTTPServer((host, port), partial(NoCacheHandler, directory=str(ROOT)))
    print(f"Red Ledger at http://localhost:{port}" + (" and on this network" if host != "127.0.0.1" else ""))
    server.serve_forever()

#!/usr/bin/env python3
"""Static dev server for Shapemaker: python -m http.server with no caching.

The app is ES modules loaded straight from disk; without cache headers the
browser applies heuristic freshness and keeps serving an edited module for
minutes or hours. Serve from the project root:

    python3 scripts/dev-server.py [port]      # default 8000
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter than the default
        if "404" in str(args) or "500" in str(args):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Serving {root} at http://localhost:{port}/ (no-store)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

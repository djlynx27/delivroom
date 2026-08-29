"""Local HTTP bridge so MacroDroid (no SSH/ADB access from the phone) can
trigger scripts/scrape_lyft_metrics.py over Tailscale/local wifi.

Auth: same shared-secret pattern as ingest-lyft-screenshots' INGEST_LYFT_API_KEY
— set LYFT_BRIDGE_API_KEY (env or .env) and pass it as ?token=... or
Authorization: Bearer <token>. Listening on 0.0.0.0 makes this reachable by
every device on the same wifi/tailnet, not just the phone, so the token is
what actually gates who can make this machine spawn a process — refuses
every request if the key isn't set, rather than silently running open.

Usage:
    python scripts/server.py
    python scripts/server.py --port 5000
    python scripts/server.py --selftest   # offline check, no device/network needed
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from scrape_lyft_metrics import _load_dotenv  # reuse the existing minimal .env loader

RUN_LOCK = threading.Lock()
RUNNING = False
LAST_TRIGGERED_AT: float | None = None

# Backstop for a MacroDroid "Application Launched" trigger (fires every time
# the PWA is foregrounded, potentially many times an hour) -- independent of
# the already_running dedup above, which only protects against overlapping
# runs, not back-to-back ones. See docs/ingest-lyft-screenshots-macrodroid.md §8.
MIN_TRIGGER_INTERVAL_S = 300


def _script_path() -> Path:
    return Path(__file__).resolve().parent / "scrape_lyft_metrics.py"


def _is_authorized(handler: BaseHTTPRequestHandler, query: dict) -> bool:
    expected = os.environ.get("LYFT_BRIDGE_API_KEY")
    if not expected:
        return False
    token = query.get("token", [None])[0]
    if not token:
        auth = handler.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[len("Bearer "):]
    return token == expected


def _mark_finished() -> None:
    global RUNNING
    with RUN_LOCK:
        RUNNING = False


def _spawn_scrape() -> None:
    proc = subprocess.Popen([sys.executable, str(_script_path())])

    def _wait() -> None:
        proc.wait()
        _mark_finished()

    threading.Thread(target=_wait, daemon=True).start()


class BridgeHandler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self) -> None:
        global RUNNING, LAST_TRIGGERED_AT
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/health":
            self._json(200, {"status": "ok"})
            return

        if parsed.path != "/run-lyft-scrape":
            self._json(404, {"error": "not found"})
            return

        if not _is_authorized(self, query):
            self._json(401, {"error": "unauthorized"})
            return

        now_monotonic = time.monotonic()
        with RUN_LOCK:
            already_running = RUNNING
            since_last = (
                None if LAST_TRIGGERED_AT is None else now_monotonic - LAST_TRIGGERED_AT
            )
            rate_limited = (
                not already_running
                and since_last is not None
                and since_last < MIN_TRIGGER_INTERVAL_S
            )
            if not already_running and not rate_limited:
                RUNNING = True
                LAST_TRIGGERED_AT = now_monotonic

        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if already_running:
            self._json(200, {"status": "already_running", "timestamp": timestamp})
            return
        if rate_limited:
            retry_after = round(MIN_TRIGGER_INTERVAL_S - since_last)  # type: ignore[arg-type]
            self._json(
                200,
                {"status": "rate_limited", "retry_after_seconds": retry_after, "timestamp": timestamp},
            )
            return

        _spawn_scrape()
        self._json(200, {"status": "triggered", "timestamp": timestamp})

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        self._handle()

    def do_POST(self) -> None:  # noqa: N802 - stdlib method name
        self._handle()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        pass  # quiet by default; MacroDroid may poll this repeatedly


# ── Self-check (no device/network required beyond localhost) ────────────────


def _selftest() -> None:
    import urllib.error
    import urllib.request

    global _spawn_scrape, LAST_TRIGGERED_AT, MIN_TRIGGER_INTERVAL_S

    os.environ["LYFT_BRIDGE_API_KEY"] = "test-token"
    calls: list[int] = []
    release = threading.Event()
    original_spawn = _spawn_scrape
    original_interval = MIN_TRIGGER_INTERVAL_S
    LAST_TRIGGERED_AT = None
    # Tiny interval for the already_running/retrigger-after-finish flow below
    # -- the real 5-minute value is exercised separately, further down.
    MIN_TRIGGER_INTERVAL_S = 0.05

    def stub_spawn() -> None:
        calls.append(1)

        def worker() -> None:
            release.wait(timeout=2)
            _mark_finished()

        threading.Thread(target=worker, daemon=True).start()

    _spawn_scrape = stub_spawn
    server = ThreadingHTTPServer(("127.0.0.1", 0), BridgeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        base = f"http://127.0.0.1:{port}"

        with urllib.request.urlopen(f"{base}/health", timeout=2) as resp:
            assert resp.status == 200
            assert json.loads(resp.read())["status"] == "ok"

        try:
            urllib.request.urlopen(f"{base}/run-lyft-scrape", timeout=2)
            raise AssertionError("expected 401 without a token")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401

        try:
            urllib.request.urlopen(f"{base}/run-lyft-scrape?token=wrong", timeout=2)
            raise AssertionError("expected 401 with a wrong token")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401

        with urllib.request.urlopen(f"{base}/run-lyft-scrape?token=test-token", timeout=2) as resp:
            body = json.loads(resp.read())
            assert body["status"] == "triggered", body
        assert calls == [1]

        # A second trigger while the (stubbed) run is still in flight must not
        # spawn a second process -- it should report already_running instead.
        with urllib.request.urlopen(f"{base}/run-lyft-scrape?token=test-token", timeout=2) as resp:
            body = json.loads(resp.read())
            assert body["status"] == "already_running", body
        assert calls == [1], "must not spawn a second run while one is in flight"

        release.set()
        time.sleep(0.1)  # let the worker thread's _mark_finished() land

        with urllib.request.urlopen(f"{base}/run-lyft-scrape?token=test-token", timeout=2) as resp:
            body = json.loads(resp.read())
            assert body["status"] == "triggered", body
        assert len(calls) == 2, "should spawn again once the previous run finished + interval elapsed"

        # Now exercise the real 5-minute backstop: immediately re-triggering
        # must be rate-limited even though the previous run already finished.
        MIN_TRIGGER_INTERVAL_S = original_interval
        with urllib.request.urlopen(f"{base}/run-lyft-scrape?token=test-token", timeout=2) as resp:
            body = json.loads(resp.read())
            assert body["status"] == "rate_limited", body
            assert 0 < body["retry_after_seconds"] <= MIN_TRIGGER_INTERVAL_S, body
        assert len(calls) == 2, "must not spawn while rate-limited"
    finally:
        server.shutdown()
        _spawn_scrape = original_spawn
        MIN_TRIGGER_INTERVAL_S = original_interval
        LAST_TRIGGERED_AT = None
        os.environ.pop("LYFT_BRIDGE_API_KEY", None)

    print("selftest OK")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="offline check, no device/network needed")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    if args.selftest:
        _selftest()
        return 0

    _load_dotenv()
    if not os.environ.get("LYFT_BRIDGE_API_KEY"):
        print(
            "LYFT_BRIDGE_API_KEY not set (env or .env) -- /run-lyft-scrape will refuse every request.",
            file=sys.stderr,
        )

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"Lyft bridge listening on {args.host}:{args.port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

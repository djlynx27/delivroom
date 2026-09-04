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
import re
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

# ── Overlay heartbeat ─────────────────────────────────────────────────────
# MacroDroid's floating overlay over Lyft Driver intermittently fails to
# render (service stays alive, it just doesn't draw). MacroDroid exposes no
# generic "run macro X" broadcast -- only a per-macro "Intent Received"
# trigger the user must configure in-app with a custom action string. So
# this polls via adb and re-fires that action when the overlay's missing;
# it can't create the trigger for you.
ADB_PATH = os.environ.get("ADB_PATH", "adb")
ADB_SERIAL = os.environ.get("ADB_SERIAL")  # set if more than one device/emulator is attached
LYFT_PACKAGE = "com.lyft.android.driver"
MACRODROID_PACKAGE = "com.arlosoft.macrodroid"
OVERLAY_RECOVERY_ACTION = os.environ.get("MACRODROID_OVERLAY_RECOVERY_ACTION")
HEARTBEAT_INTERVAL_S = 12
# Give the macro a chance to actually redraw before checking again -- and
# keep a broken macro from turning into a broadcast storm.
RECOVERY_COOLDOWN_S = 60

_FOCUS_PACKAGE_RE = re.compile(r"mCurrentFocus=Window\{[^ ]+ [^ ]+ ([\w.]+)/")


def _adb(args: list[str], timeout: float = 5.0) -> str | None:
    """Runs `adb [-s SERIAL] <args>`; returns stdout, or None if the device
    isn't reachable right now (unplugged, wifi debugging dropped, adb not on
    PATH). Callers treat None as "skip this poll", never as "overlay missing"
    -- a disconnected phone must not look like a broken macro."""
    cmd = [ADB_PATH]
    if ADB_SERIAL:
        cmd += ["-s", ADB_SERIAL]
    cmd += args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


def _focused_package(window_dump: str) -> str | None:
    match = _FOCUS_PACKAGE_RE.search(window_dump)
    return match.group(1) if match else None


def _has_window_from_package(window_dump: str, package: str) -> bool:
    return f"package={package}" in window_dump


def _check_overlay_once() -> bool | None:
    """True = Lyft is focused and MacroDroid has no window on screen (needs
    recovery). False = fine (Lyft not focused, or overlay is present). None =
    device unreachable this poll."""
    dump = _adb(["shell", "dumpsys", "window"])
    if dump is None:
        return None
    if _focused_package(dump) != LYFT_PACKAGE:
        return False
    return not _has_window_from_package(dump, MACRODROID_PACKAGE)


def _should_fire_recovery(overlay_missing: bool, last_recovery_at: float | None, now: float) -> bool:
    if not overlay_missing:
        return False
    return last_recovery_at is None or now - last_recovery_at >= RECOVERY_COOLDOWN_S


def _fire_recovery() -> None:
    if not OVERLAY_RECOVERY_ACTION:
        print(
            "[heartbeat] overlay missing over Lyft, but MACRODROID_OVERLAY_RECOVERY_ACTION "
            "isn't set -- add an 'Intent Received' trigger to the overlay macro in "
            "MacroDroid, give it a custom action string, and set that action here.",
            flush=True,
        )
        return
    _adb(["shell", "am", "broadcast", "-a", OVERLAY_RECOVERY_ACTION])
    print(f"[heartbeat] overlay missing over Lyft -- fired recovery broadcast: {OVERLAY_RECOVERY_ACTION}", flush=True)


def _heartbeat_loop(stop_event: threading.Event) -> None:
    last_recovery_at: float | None = None
    while not stop_event.is_set():
        status = _check_overlay_once()
        if status is not None:
            now = time.monotonic()
            if _should_fire_recovery(status, last_recovery_at, now):
                _fire_recovery()
                last_recovery_at = now
        stop_event.wait(HEARTBEAT_INTERVAL_S)

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
        # Every request logged to stdout (captured into scripts/bridge.log by
        # start-bridge.bat) -- this is the only visibility into whether
        # MacroDroid's request ever actually arrived. The docs push drivers
        # toward `?token=<LYFT_BRIDGE_API_KEY>` (MacroDroid's HTTP Request
        # action doesn't do custom headers as easily as query strings), and
        # args[0] here is self.requestline -- the raw request line including
        # that query string -- so the shared secret must be redacted before
        # it reaches a persistent on-disk log.
        line = re.sub(r"token=[^&\s\"]+", "token=REDACTED", format % args)
        print(f"{self.address_string()} - {line}", flush=True)


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

    _selftest_heartbeat()
    print("selftest OK")


def _selftest_heartbeat() -> None:
    global OVERLAY_RECOVERY_ACTION, _adb

    lyft_focus_no_overlay = 'mCurrentFocus=Window{aaf17f6 u0 com.lyft.android.driver/com.lyft.android.driver.app.ui.DriverMainActivity}\nsome other window package=com.android.systemui'
    lyft_focus_with_overlay = 'mCurrentFocus=Window{aaf17f6 u0 com.lyft.android.driver/com.lyft.android.driver.app.ui.DriverMainActivity}\nmOwnerUid=11210 package=com.arlosoft.macrodroid'
    settings_focused = 'mCurrentFocus=Window{e410645 u0 com.android.settings/com.android.settings.SubSettings}'

    assert _focused_package(lyft_focus_no_overlay) == "com.lyft.android.driver"
    assert _focused_package("no focus line here") is None
    assert _has_window_from_package(lyft_focus_with_overlay, MACRODROID_PACKAGE) is True
    assert _has_window_from_package(lyft_focus_no_overlay, MACRODROID_PACKAGE) is False

    # Cooldown: no prior recovery -> fire; too soon after one -> don't; past
    # the cooldown -> fire again. Never fires when overlay isn't missing.
    assert _should_fire_recovery(True, None, 100.0) is True
    assert _should_fire_recovery(True, 100.0, 130.0) is False
    assert _should_fire_recovery(True, 100.0, 161.0) is True
    assert _should_fire_recovery(False, None, 100.0) is False

    original_adb = _adb
    original_action = OVERLAY_RECOVERY_ACTION
    calls: list[tuple] = []
    dumps = iter([lyft_focus_no_overlay, lyft_focus_with_overlay, settings_focused, None])

    def stub_adb(args, timeout=5.0):
        calls.append(tuple(args))
        return next(dumps)

    _adb = stub_adb
    try:
        assert _check_overlay_once() is True  # Lyft focused, no macrodroid window
        assert _check_overlay_once() is False  # Lyft focused, overlay present
        assert _check_overlay_once() is False  # settings focused, not Lyft at all
        assert _check_overlay_once() is None  # device unreachable this poll
        assert all(c == ("shell", "dumpsys", "window") for c in calls)

        _adb = lambda args, timeout=5.0: (calls.append(tuple(args)), None)[1]  # noqa: E731

        # No recovery action configured -> warns, never calls adb again.
        OVERLAY_RECOVERY_ACTION = None
        calls.clear()
        _fire_recovery()
        assert calls == []

        # Configured -> broadcasts exactly that action.
        OVERLAY_RECOVERY_ACTION = "com.delivroom.SHOW_OVERLAY"
        calls.clear()
        _fire_recovery()
        assert calls == [("shell", "am", "broadcast", "-a", "com.delivroom.SHOW_OVERLAY")]
    finally:
        _adb = original_adb
        OVERLAY_RECOVERY_ACTION = original_action


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="offline check, no device/network needed")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--no-heartbeat", action="store_true", help="disable the overlay-watchdog adb poll")
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

    stop_heartbeat = threading.Event()
    if not args.no_heartbeat:
        if not OVERLAY_RECOVERY_ACTION:
            print(
                "MACRODROID_OVERLAY_RECOVERY_ACTION not set -- heartbeat will detect a missing "
                "overlay but can't recover it until the macro has an Intent Received trigger.",
                file=sys.stderr,
            )
        threading.Thread(target=_heartbeat_loop, args=(stop_heartbeat,), daemon=True).start()

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"Lyft bridge listening on {args.host}:{args.port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_heartbeat.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Force Delivroom's Service Worker to skip-waiting on a connected Android
device over ADB + Chrome DevTools Protocol (CDP) — the non-destructive
alternative to `adb shell pm clear com.android.chrome` (see CLAUDE.md
"Topologie réelle": that would wipe the Supabase session + Maxymo config,
since the SW/PWA storage lives inside Chrome's own data on a WebAPK install).

What this actually does, matching the recipe already documented in
CLAUDE.md: forward the device's CDP socket to a local TCP port, find the
Delivroom tab/WebAPK among the open targets, then use CDP's Runtime.evaluate
to run `registration.waiting.postMessage({type:'SKIP_WAITING'})` in that
page's own JS context — exactly the message src/sw.ts already listens for
(see the comment in that file explaining why skipWaiting isn't unconditional).
Preserves auth/localStorage/IndexedDB; only busts the stale precached build.

No third-party dependencies (stdlib only) — this repo's other device scripts
(scripts/server.py) follow the same convention.

Usage:
    python scripts/force_refresh_device.py                # first adb device found
    python scripts/force_refresh_device.py --serial <id>   # adb -s <id>
    python scripts/force_refresh_device.py --transport <id> # adb -t <id>
    python scripts/force_refresh_device.py --url-filter delivroom
    python scripts/force_refresh_device.py --selftest      # offline logic check
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

DEFAULT_URL_FILTER = "delivroom"
DEFAULT_PORT = 9222
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def adb_base_args(serial: str | None, transport: str | None) -> list[str]:
    args = ["adb"]
    if transport:
        args += ["-t", transport]
    elif serial:
        args += ["-s", serial]
    return args


def adb_forward(serial: str | None, transport: str | None, port: int) -> None:
    args = adb_base_args(serial, transport) + [
        "forward",
        f"tcp:{port}",
        "localabstract:chrome_devtools_remote",
    ]
    subprocess.run(args, check=True, capture_output=True, text=True)


def find_target(targets: list[dict], url_filter: str) -> dict | None:
    """Pick the first page-type target whose url/title matches url_filter
    (case-insensitive substring). Pure function — covered by --selftest."""
    needle = url_filter.lower()
    for target in targets:
        if target.get("type") != "page":
            continue
        haystack = f"{target.get('url', '')} {target.get('title', '')}".lower()
        if needle in haystack:
            return target
    return None


def fetch_targets(port: int) -> list[dict]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as resp:
        return json.load(resp)


# ── Minimal raw WebSocket client (RFC 6455) — just enough to send one CDP
# JSON-RPC frame and read the matching response. No third-party dep. ────────


def ws_connect(url: str) -> socket.socket:
    # url like ws://127.0.0.1:9222/devtools/page/<id>
    assert url.startswith("ws://"), f"unexpected CDP url scheme: {url}"
    rest = url[len("ws://") :]
    host_port, _, path = rest.partition("/")
    path = "/" + path
    host, _, port_str = host_port.partition(":")
    port = int(port_str) if port_str else 80

    sock = socket.create_connection((host, port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(handshake.encode())
    response = sock.recv(4096)
    if b"101" not in response.split(b"\r\n", 1)[0]:
        raise RuntimeError(f"WebSocket handshake failed: {response!r}")
    return sock


def ws_send_text(sock: socket.socket, payload: str) -> None:
    data = payload.encode("utf-8")
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    length = len(data)
    if length <= 125:
        header = struct.pack("!BB", 0x81, 0x80 | length)
    elif length <= 0xFFFF:
        header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
    else:
        header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)
    sock.sendall(header + mask + masked)


def ws_recv_text(sock: socket.socket, timeout: float = 10.0) -> str:
    sock.settimeout(timeout)
    header = sock.recv(2)
    if len(header) < 2:
        raise RuntimeError("WebSocket connection closed before response")
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            break
        payload += chunk
    return payload.decode("utf-8")


SKIP_WAITING_JS = (
    "navigator.serviceWorker.getRegistration().then(r => "
    "{ if (r && r.waiting) { r.waiting.postMessage({type:'SKIP_WAITING'}); "
    "return 'skip-waiting-sent'; } return r ? 'no-waiting-worker' : 'no-registration'; })"
)


def run_skip_waiting(ws_url: str) -> str:
    sock = ws_connect(ws_url)
    try:
        request = {
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": SKIP_WAITING_JS, "awaitPromise": True},
        }
        ws_send_text(sock, json.dumps(request))
        raw = ws_recv_text(sock)
        result = json.loads(raw)
        return result.get("result", {}).get("result", {}).get("value", "unknown")
    finally:
        sock.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default=None, help="adb -s <serial>")
    parser.add_argument("--transport", default=None, help="adb -t <transport_id>")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--url-filter", default=DEFAULT_URL_FILTER)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    print(f"[force-refresh] forwarding tcp:{args.port} -> chrome_devtools_remote ...")
    adb_forward(args.serial, args.transport, args.port)

    targets = fetch_targets(args.port)
    target = find_target(targets, args.url_filter)
    if not target:
        print(
            f"[force-refresh] no open tab matching '{args.url_filter}' found. "
            "Open Delivroom on the device first.",
            file=sys.stderr,
        )
        return 1

    print(f"[force-refresh] found target: {target.get('title')} -- {target.get('url')}")
    outcome = run_skip_waiting(target["webSocketDebuggerUrl"])
    print(f"[force-refresh] result: {outcome}")

    if outcome == "skip-waiting-sent":
        print("[force-refresh] waiting SW told to activate -- the page's own "
              "controllerchange handler will reload it shortly.")
        return 0
    if outcome == "no-waiting-worker":
        print("[force-refresh] no new build is waiting -- already up to date.")
        return 0
    print("[force-refresh] no SW registration found on that page.", file=sys.stderr)
    return 1


def run_selftest() -> int:
    """Offline checks for the pure logic — no device, no network."""
    targets = [
        {"type": "background_page", "url": "chrome-extension://abc/bg.html"},
        {"type": "page", "url": "https://example.com/", "title": "Example"},
        {
            "type": "page",
            "url": "https://delivroom.vercel.app/drive",
            "title": "Delivroom",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/1",
        },
    ]
    match = find_target(targets, "delivroom")
    assert match is not None, "expected a match for 'delivroom'"
    assert match["url"] == "https://delivroom.vercel.app/drive"

    assert find_target(targets, "nope-not-present") is None

    # WS frame encode/decode round-trip against a hand-built server frame.
    payload = "hello"
    data = payload.encode("utf-8")
    server_frame = struct.pack("!BB", 0x81, len(data)) + data

    class _FakeSocket:
        def __init__(self, buf: bytes):
            self._buf = buf

        def settimeout(self, _t: float) -> None:
            pass

        def recv(self, n: int) -> bytes:
            chunk, self._buf = self._buf[:n], self._buf[n:]
            return chunk

    decoded = ws_recv_text(_FakeSocket(server_frame))
    assert decoded == payload, f"round-trip mismatch: {decoded!r}"

    print("[force-refresh] selftest OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

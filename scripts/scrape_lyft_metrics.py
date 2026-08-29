"""Capture hidden demand-metric screenshots from the Lyft Driver app and sync
them to Delivroom's ingest-lyft-screenshots Edge Function.

Automates: Map Layers -> "Maximise your earnings" sheet -> Wait times /
Recent ride demand / Nearby drivers, screenshotting each, then POSTs the 3
images + device GPS to ingest-lyft-screenshots, which does the actual vision
extraction server-side via Gemini (never client-side — this script never
touches a vision API key, only the shared INGEST_LYFT_API_KEY secret already
used for the existing MacroDroid integration, see
docs/ingest-lyft-screenshots-macrodroid.md).

Requirements:
    pip install uiautomator2 pillow
    python -m uiautomator2 init   # once, to install the uiautomator2 agent on the device
    adb connect <device-ip>:5555  # if over Tailscale/wifi instead of USB

Config (env vars, or a `.env` file at the repo root — see .env.example):
    VITE_SUPABASE_URL      # already set for the app itself
    INGEST_LYFT_API_KEY    # same value as `supabase secrets set INGEST_LYFT_API_KEY=...`

Usage:
    python scripts/scrape_lyft_metrics.py
    python scripts/scrape_lyft_metrics.py --lat 45.5017 --lng -73.5673  # skip dumpsys GPS parsing
    python scripts/scrape_lyft_metrics.py --no-sync    # capture only, don't POST
    python scripts/scrape_lyft_metrics.py --selftest   # offline check, no device needed
"""

from __future__ import annotations

import argparse
import base64
import datetime
import io
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

APP_PACKAGE = "com.lyft.android.driver"
OUTPUT_DIR = Path("./captures")
POST_CLICK_WAIT_S = 1.5
SHEET_TITLE = "Maximise your earnings"
INGEST_ENDPOINT_PATH = "/functions/v1/ingest-lyft-screenshots"

# Icon-only FAB, no visible text — try a few common selector strategies in
# order since the exact resourceId/description isn't verified against a live
# build. Run with --dump-hierarchy to inspect the real tree if none match.
MAP_LAYERS_SELECTORS = [
    {"description": "Map layers"},
    {"descriptionContains": "layer"},
    {"resourceIdMatches": r".*map_layers.*"},
]

# "key" matches the *_image_base64 field ingest-lyft-screenshots expects.
FEATURES = [
    {"text": "Wait times", "filename": "wait_times.png", "key": "wait_times"},
    {
        "text": "Recent ride demand",
        "filename": "recent_demand.png",
        "key": "recent_demand",
        "ensure_text": "Past 30 min",
    },
    {"text": "Nearby drivers", "filename": "nearby_drivers.png", "key": "nearby_drivers"},
]


class UiDevice(Protocol):
    """Minimal slice of the uiautomator2.Device interface this script uses."""

    def app_start(self, package: str) -> None: ...
    def __call__(self, **kwargs): ...
    def press(self, key: str) -> None: ...
    def screenshot(self, format: str = "pillow"): ...
    def shell(self, cmd): ...


def find_map_layers_button(d: UiDevice):
    for selector in MAP_LAYERS_SELECTORS:
        el = d(**selector)
        if el.exists:
            return el
    return None


def ensure_option_selected(d: UiDevice, text: str) -> None:
    """Click a toggle/chip by text if it exists and isn't already selected."""
    el = d(text=text)
    if not el.exists:
        return
    info = el.info or {}
    if not info.get("selected", False):
        el.click()
        time.sleep(0.5)


# ── GPS (best-effort) ────────────────────────────────────────────────────────

GPS_LOCATION_RE = re.compile(r"Location\[(\w+)\s+([\-0-9.]+),([\-0-9.]+)")
GPS_PROVIDER_PRIORITY = ("fused", "gps", "network")


def parse_gps_from_dumpsys(output: str) -> tuple[float, float] | None:
    """Extracts the best available lat/lng from `dumpsys location` output.
    Prefers fused > gps > network providers; falls back to the last match of
    any provider name. Returns None if nothing parseable was found."""
    matches = GPS_LOCATION_RE.findall(output)
    if not matches:
        return None

    by_provider: dict[str, tuple[float, float]] = {}
    for provider, lat, lng in matches:
        try:
            by_provider[provider] = (float(lat), float(lng))
        except ValueError:
            continue

    for provider in GPS_PROVIDER_PRIORITY:
        if provider in by_provider:
            return by_provider[provider]

    if by_provider:
        return next(iter(by_provider.values()))
    return None


def get_gps_location(d: UiDevice) -> tuple[float, float] | None:
    """Best-effort GPS via `dumpsys location`'s last known fix. This is
    fragile across Android versions/OEM skins and depends on some app having
    recently requested a location — pass --lat/--lng explicitly when
    reliability matters more than full automation."""
    try:
        result = d.shell(["dumpsys", "location"])
        output = getattr(result, "output", None) or str(result)
    except Exception:
        return None
    return parse_gps_from_dumpsys(output)


# ── Screenshot capture ───────────────────────────────────────────────────────


def render_screenshot_png(img) -> tuple[str, bytes]:
    from PIL import PngImagePlugin

    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    meta = PngImagePlugin.PngInfo()
    meta.add_text("timestamp", timestamp)
    meta.add_text("source", "scrape_lyft_metrics.py")

    buffer = io.BytesIO()
    img.save(buffer, format="PNG", pnginfo=meta)
    return timestamp, buffer.getvalue()


def save_screenshot_with_timestamp(d: UiDevice, path: Path) -> tuple[str, bytes]:
    img = d.screenshot(format="pillow")
    timestamp, png_bytes = render_screenshot_png(img)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes)
    return timestamp, png_bytes


def capture_feature(d: UiDevice, feature: dict, output_dir: Path) -> tuple[dict, bytes | None]:
    name = feature["text"]
    result: dict = {"feature": name, "success": False, "path": None, "timestamp": None, "error": None}
    png_bytes: bytes | None = None

    try:
        button = d(text=name)
        if not button.wait(timeout=5):
            raise RuntimeError(f'"{name}" not found in bottom sheet')
        button.click()

        ensure_text = feature.get("ensure_text")
        if ensure_text:
            ensure_option_selected(d, ensure_text)

        time.sleep(POST_CLICK_WAIT_S)

        path = output_dir / feature["filename"]
        result["timestamp"], png_bytes = save_screenshot_with_timestamp(d, path)
        result["path"] = str(path)
        result["success"] = True
    except Exception as exc:  # noqa: BLE001 - one failed feature shouldn't abort the run
        result["error"] = str(exc)
    finally:
        d.press("back")
        time.sleep(0.3)

    return result, png_bytes


# ── Sync to ingest-lyft-screenshots ──────────────────────────────────────────


def _load_dotenv(path: Path | None = None) -> None:
    """Minimal KEY=VALUE .env loader — doesn't override already-set env vars."""
    path = path or Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


def build_ingest_payload(
    images: dict[str, bytes], lat: float | None, lng: float | None
) -> dict:
    payload: dict = {
        f"{key}_image_base64": "data:image/png;base64," + base64.b64encode(data).decode("ascii")
        for key, data in images.items()
    }
    if lat is not None and lng is not None:
        payload["latitude"] = lat
        payload["longitude"] = lng
    return payload


def post_to_ingest(
    payload: dict, base_url: str, api_key: str, timeout: float = 30
) -> dict:
    req = urllib.request.Request(
        base_url.rstrip("/") + INGEST_ENDPOINT_PATH,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return {"posted": True, "status_code": resp.status, "response": body}
    except urllib.error.HTTPError as exc:
        return {"posted": False, "status_code": exc.code, "error": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001 - a network hiccup shouldn't crash the capture run
        return {"posted": False, "error": str(exc)}


def sync_to_ingest(images: dict[str, bytes], lat: float | None, lng: float | None) -> dict:
    base_url = os.environ.get("VITE_SUPABASE_URL")
    api_key = os.environ.get("INGEST_LYFT_API_KEY")
    if not base_url or not api_key:
        return {
            "posted": False,
            "error": "VITE_SUPABASE_URL / INGEST_LYFT_API_KEY not set (env or .env)",
        }
    return post_to_ingest(build_ingest_payload(images, lat, lng), base_url, api_key)


# ── Orchestration ─────────────────────────────────────────────────────────────


def run(
    output_dir: Path = OUTPUT_DIR,
    lat: float | None = None,
    lng: float | None = None,
    sync: bool = True,
) -> dict:
    import uiautomator2 as u2

    _load_dotenv()

    summary: dict = {
        "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "features": [],
        "gps": None,
        "sync": None,
        "success": False,
        "error": None,
    }

    try:
        d = u2.connect()
        d.app_start(APP_PACKAGE)
        time.sleep(1.5)

        if lat is not None and lng is not None:
            summary["gps"] = {"latitude": lat, "longitude": lng, "source": "cli"}
        else:
            gps = get_gps_location(d)
            if gps is not None:
                lat, lng = gps
                summary["gps"] = {"latitude": lat, "longitude": lng, "source": "dumpsys"}

        layers_button = find_map_layers_button(d)
        if layers_button is None:
            raise RuntimeError(
                "Map layers button not found — none of MAP_LAYERS_SELECTORS matched. "
                "Run with --dump-hierarchy and update MAP_LAYERS_SELECTORS."
            )
        layers_button.click()

        if not d(text=SHEET_TITLE).wait(timeout=5):
            raise RuntimeError(f'Bottom sheet "{SHEET_TITLE}" did not appear')

        images: dict[str, bytes] = {}
        results = []
        for feature in FEATURES:
            result, png_bytes = capture_feature(d, feature, output_dir)
            results.append(result)
            if png_bytes is not None:
                images[feature["key"]] = png_bytes
        summary["features"] = results
        summary["success"] = all(f["success"] for f in results)

        if sync:
            if summary["success"]:
                summary["sync"] = sync_to_ingest(images, lat, lng)
            else:
                summary["sync"] = {"posted": False, "error": "capture incomplete, skipping sync"}
    except Exception as exc:  # noqa: BLE001 - surfaced in the JSON result instead of a traceback
        summary["error"] = str(exc)

    summary["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return summary


def dump_hierarchy() -> None:
    import uiautomator2 as u2

    d = u2.connect()
    d.app_start(APP_PACKAGE)
    time.sleep(1.5)
    print(d.dump_hierarchy())


# ── Self-check (no device required) ─────────────────────────────────────────


class _StubElement:
    def __init__(self, exists: bool, info: dict | None = None):
        self.exists = exists
        self.info = info or {}

    def wait(self, timeout: float = 5) -> bool:
        return self.exists

    def click(self) -> None:
        pass


class _StubDevice:
    """Fakes just enough of uiautomator2.Device for capture_feature()."""

    def __init__(self):
        self.pressed_back = 0

    def __call__(self, **kwargs):
        return _StubElement(exists=True, info={"selected": True})

    def press(self, key: str) -> None:
        if key == "back":
            self.pressed_back += 1

    def screenshot(self, format: str = "pillow"):
        from PIL import Image

        return Image.new("RGB", (4, 4))


def _selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = _StubDevice()
        out_dir = Path(tmp) / "captures"
        captures = [capture_feature(d, feature, out_dir) for feature in FEATURES]
        results = [r for r, _ in captures]
        images = {f["key"]: png for f, (_, png) in zip(FEATURES, captures) if png is not None}

        assert len(results) == 3, "expected one result per feature"
        assert all(r["success"] for r in results), f"expected all captures to succeed: {results}"
        assert d.pressed_back == 3, "back should be pressed once per feature"
        assert set(images) == {"wait_times", "recent_demand", "nearby_drivers"}
        for r, feature in zip(results, FEATURES):
            p = Path(r["path"])
            assert p.exists(), f"screenshot file missing: {p}"
            assert p.name == feature["filename"]
            assert r["timestamp"] is not None

        # Payload building: base64 round-trips and lat/lng only attached when both given.
        payload = build_ingest_payload(images, 45.5017, -73.5673)
        assert payload["latitude"] == 45.5017 and payload["longitude"] == -73.5673
        decoded = base64.b64decode(payload["wait_times_image_base64"].split(",", 1)[1])
        assert decoded == images["wait_times"]
        assert "latitude" not in build_ingest_payload(images, None, None)

    # GPS parsing (pure function, no device needed).
    dumpsys_sample = (
        "  last location=Location[fused 45.501700,-73.567300 hAcc=15.0 et=+1h23m45s123ms]\n"
        "  last location=Location[gps 45.500000,-73.560000 hAcc=5.0]\n"
    )
    assert parse_gps_from_dumpsys(dumpsys_sample) == (45.5017, -73.5673), "should prefer fused over gps"
    assert parse_gps_from_dumpsys("no location data here") is None

    print("selftest OK")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="offline check, no device needed")
    parser.add_argument("--dump-hierarchy", action="store_true", help="print the current UI tree and exit")
    parser.add_argument("--lat", type=float, default=None, help="override GPS latitude (skips dumpsys parsing)")
    parser.add_argument("--lng", type=float, default=None, help="override GPS longitude (skips dumpsys parsing)")
    parser.add_argument("--no-sync", action="store_true", help="capture only, don't POST to ingest-lyft-screenshots")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    if args.selftest:
        _selftest()
        return 0
    if args.dump_hierarchy:
        dump_hierarchy()
        return 0

    result = run(output_dir=args.output_dir, lat=args.lat, lng=args.lng, sync=not args.no_sync)
    print(json.dumps(result, indent=2))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())

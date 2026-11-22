"""Local, opt-in capture of Kyoto road maps for licensed internal art previews."""

import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
from functools import lru_cache


ROOT = Path(__file__).resolve().parent
_slot = threading.BoundedSemaphore(1)


class CaptureError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.status = code, status


def _opt_in():
    folder = os.environ.get("LOCALAPPDATA")
    if not folder or not Path(folder).is_absolute():
        return None
    return Path(folder) / "Project_Aina" / "kyoto-google-art.enabled"


def enable():
    path = _opt_in()
    if not path:
        raise ValueError("Local application data is unavailable.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("kyoto-roadmap-local-preview-v1", encoding="ascii")


def enabled():
    path = _opt_in()
    return bool(path and path.is_file())


@lru_cache(maxsize=1)
def _kyoto_boundary():
    with (ROOT / "data" / "kyoto-city-boundary.json").open(encoding="utf-8") as source:
        return json.load(source)["polygons"]


def _inside_ring(lng, lat, ring):
    inside = False
    ax, ay = ring[-1]
    for bx, by in ring:
        if (ay > lat) != (by > lat) and lng < (bx - ax) * (lat - ay) / (by - ay) + ax:
            inside = not inside
        ax, ay = bx, by
    return inside


def _kyoto_frame(bounds):
    south, north, west, east = (bounds[k] for k in ("south", "north", "west", "east"))
    if not (-85 <= south < north <= 85 and -180 <= west < east <= 180):
        return False
    # Center the frame within Kyoto. Allow map margins to span a city boundary.
    if north-south > 0.5 or east-west > 0.5:
        return False
    lat, lng = (north+south)/2, (east+west)/2
    return any(_inside_ring(lng, lat, rings[0]) and
               not any(_inside_ring(lng, lat, hole) for hole in rings[1:])
               for rings in _kyoto_boundary())


def capture(payload, host):
    if not enabled():
        raise CaptureError("google_disabled", "Google art previews are disabled on this computer.", 403)
    if host not in {"127.0.0.1:5173", "localhost:5173"}:
        raise CaptureError("invalid_origin", "Open the local atlas to create a preview.", 403)
    b = payload.get("bounds") if isinstance(payload, dict) else None
    if not isinstance(b, dict) or not all(type(b.get(k)) in (float, int) and
                                          (isinstance(b[k], int) or math.isfinite(b[k]))
                                          for k in ("north", "south", "west", "east")):
        raise CaptureError("invalid_bounds", "Invalid map framing.")
    if not _kyoto_frame(b):
        raise CaptureError("outside_kyoto", "Center the road map in Kyoto city and zoom in to capture it.")
    width, height = payload.get("width", 1024), payload.get("height", 1280)
    if (type(width) is not int or type(height) is not int or not (160 <= width <= 2560 and 160 <= height <= 2560)
            or width * height > 4_000_000):
        raise CaptureError("invalid_size", "Unsupported screenshot dimensions.")
    supplied = payload.get("labels", {})
    if not isinstance(supplied, dict):
        raise CaptureError("invalid_labels", "Invalid map label settings.")
    labels = {k: supplied.get(k) is not False for k in ("master", "business", "attractions", "transit", "roads")}
    chrome_paths = [Path(os.environ.get(var, "")) / subpath
                    for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")
                    for subpath in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe")]
    browser = next((p for p in chrome_paths if p.is_absolute() and p.is_file()), None)
    node = shutil.which("node")
    if not node or not browser:
        raise CaptureError("capture_unavailable", "Google capture requires local Chrome or Edge and Node.js.", 503)
    if not _slot.acquire(blocking=False):
        raise CaptureError("busy", "A map capture is already running. Try again shortly.", 409)
    try:
        camera = {k: b[k] for k in ("north", "south", "east", "west")}
        request = {"bounds": camera, "lang": "en" if payload.get("lang") == "en" else "zh-CN", "host": host,
                   "width": width, "height": height, "labels": labels}
        result = subprocess.run([node, str(ROOT / "tools" / "capture-roadmap.cjs"), str(browser)],
                                input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=45, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode or not result.stdout.startswith(b"{") or len(result.stdout) > 10_000_000:
            raise CaptureError("capture_failed", "Google's Kyoto road map did not finish loading.", 503)
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError) as error:
        raise CaptureError("capture_failed", "Google road map capture is unavailable.", 503) from error
    finally:
        _slot.release()

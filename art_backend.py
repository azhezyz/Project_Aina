"""Server-only OpenAI image editing for Aina's illustrated route maps."""

import base64
import binascii
import hashlib
import http.client
import json
import struct
import threading
import time


MODEL = "gpt-image-2.6-sunburst"
WIDTH, HEIGHT = 1024, 1280
PNG_PREFIX = "data:image/png;base64,"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_ENCODED = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_REQUEST_BYTES = 2 * MAX_ENCODED + 4096
STYLES = {
    "watercolor": "Delicate transparent watercolor washes on warm paper, muted sage and ochre.",
    "ink": "Fine pen-and-ink linework on ivory paper, restrained hatching and pale grey washes.",
    "woodcut": "A hand-printed Japanese woodblock palette of indigo, faded green and warm cream.",
}


class ArtError(Exception):
    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        super().__init__(message)


def check_png(encoded, *, markup=False):
    """Check the canvas contract without allocating a decompressed raster."""
    if not isinstance(encoded, str) or not 0 < len(encoded) <= MAX_ENCODED:
        raise ValueError()
    data = base64.b64decode(encoded, validate=True)
    if not (57 <= len(data) <= MAX_IMAGE_BYTES
            and data.startswith(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
            and data.endswith(b"\x00\x00\x00\x00IEND\xaeB\x60\x82")
            and struct.unpack(">II", data[16:24]) == (WIDTH, HEIGHT)):
        raise ValueError()
    has_alpha = data[25] in (4, 6)
    has_pixels = False
    offset = 8
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError()
        length = int.from_bytes(data[offset:offset + 4], "big")
        end = offset + 8 + length
        kind = data[offset + 4:offset + 8]
        if end + 4 > len(data) or binascii.crc32(memoryview(data)[offset + 4:end]) != int.from_bytes(data[end:end + 4], "big"):
            raise ValueError()
        if kind == b"IEND" and (length or end + 4 != len(data)):
            raise ValueError()
        if kind == b"IDAT" and length:
            has_pixels = True
        elif kind == b"tRNS":
            has_alpha = True
        offset = end + 4
    if not has_pixels or (markup and not has_alpha):
        raise ValueError()


def parse_request(raw):
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):
        raise ArtError(400, "invalid_request", "Send a JSON object with a style, reference and markup.") from None
    if not isinstance(body, dict) or set(body) != {"style", "reference", "markup"}:
        raise ArtError(400, "invalid_request", "Send a style, reference and markup.")
    style = body["style"]
    if not isinstance(style, str) or style not in STYLES:
        raise ArtError(400, "unsupported_style", "Choose an available map style.")
    try:
        for field in ("reference", "markup"):
            image = body[field]
            if not isinstance(image, str) or not image.startswith(PNG_PREFIX):
                raise ValueError()
            check_png(image[len(PNG_PREFIX):], markup=field == "markup")
    except ValueError:
        raise ArtError(400, "invalid_image", f"Use {WIDTH} × {HEIGHT} PNGs with a transparent guide layer.") from None
    return body


def provider_error(status, content):
    try:
        info = json.loads(content)["error"]
        code = info.get("code") or info.get("type") or ""
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        code = ""
    if code in ("insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "billing_limit_user_error") or status == 402:
        return ArtError(402, "billing", "OpenAI reports insufficient quota or a billing limit.")
    if status == 401:
        return ArtError(502, "invalid_key", "OpenAI rejected the server's API key.")
    if code in ("content_policy_violation", "moderation_blocked", "safety_violations"):
        return ArtError(422, "content_policy", "OpenAI declined this image edit.")
    if status in (403, 404):
        return ArtError(502, "model_access", "OpenAI denied access to the image editing model.")
    if status == 429:
        return ArtError(429, "rate_limit", "OpenAI's rate limit was reached. Try again later.")
    if status in (408, 504):
        return ArtError(504, "timeout", "OpenAI timed out. Check API usage before trying again.")
    return ArtError(502, "upstream", "OpenAI could not complete this image edit.")


def edit_image(body, key):
    prompt = (
        "Paint the provided walking map as a full-bleed, north-up, two-dimensional cartographic illustration. "
        + STYLES[body["style"]] +
        " Preserve the exact frame, scale, coordinates, street topology, riverbanks, green spaces and intersections. "
        "Keep all ground features aligned with the input edge to edge. The separate markup shows a walk and its "
        "numbered stops solely as registration guides. Omit every guide stroke, marker, route color and number "
        "from your output. Keep the underlying streets visible at those locations. Do not add routes, roads, "
        "buildings, symbols, lettering, labels, captions, legends, borders, perspective or decorative landmarks. "
        "Keep the original map attribution and credit area along the bottom edge legible and in the same position. "
        "The application will draw the exact route and labels after you return the painted basemap."
    )
    payload = json.dumps({
        "model": MODEL, "images": [{"image_url": body["reference"]}],
        "markup": {"image_url": body["markup"]}, "prompt": prompt,
        "size": f"{WIDTH}x{HEIGHT}", "quality": "medium", "output_format": "png", "n": 1,
    }, separators=(",", ":")).encode("ascii")
    # A single fixed TLS destination, with no redirect following or automatic POST retries.
    conn = http.client.HTTPSConnection("api.openai.com", timeout=300)
    try:
        conn.request("POST", "/v1/images/edits", body=payload, headers={
            "Authorization": "Bearer " + key, "Content-Type": "application/json",
            "Accept": "application/json",
        })
        response = conn.getresponse()
        if response.status != 200:
            raise provider_error(response.status, response.read(65536))
        content = response.read(MAX_ENCODED + 65537)
        if len(content) > MAX_ENCODED + 65536:
            raise ValueError()
        encoded = json.loads(content)["data"][0]["b64_json"]
        check_png(encoded)
        return PNG_PREFIX + encoded
    except TimeoutError:
        raise ArtError(504, "timeout", "The image request timed out. Check API usage before trying again.") from None
    except (OSError, http.client.HTTPException):
        raise ArtError(502, "upstream", "The connection to OpenAI failed. Check API usage before trying again.") from None
    except (ValueError, KeyError, IndexError, TypeError, RecursionError):
        raise ArtError(502, "upstream", "OpenAI returned an unreadable image or an unexpected canvas size.") from None
    finally:
        conn.close()


class ArtMapEditor:
    """Serialize billable edits and replay an immediate duplicate's successful result."""

    def __init__(self):
        self.lock = threading.Lock()
        self.recent = None

    def generate(self, raw, key):
        if not self.lock.acquire(blocking=False):
            raise ArtError(409, "busy", "A map is being generated. Wait for it to finish.")
        try:
            body = parse_request(raw)
            signature = hashlib.sha256()
            for field in ("style", "reference", "markup"):
                signature.update(body[field].encode("ascii"))
                signature.update(b"\x00")
            digest = signature.digest()
            if self.recent:
                previous, expires, image = self.recent
                if previous == digest and time.monotonic() < expires:
                    return image
            self.recent = None
            image = edit_image(body, key)
            self.recent = (digest, time.monotonic() + 5, image)
            return image
        finally:
            self.lock.release()

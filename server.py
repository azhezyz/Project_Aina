"""Run Project_Aina locally and configure its local service credentials."""

import argparse
import ctypes
from ctypes import wintypes
import getpass
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.parse import unquote, urlsplit

import art_backend
import google_art


PORT = 5173
WEB_ROOT = Path(__file__).resolve().parent / "web"
KEY_ENV = "AINA_GOOGLE_MAPS_BROWSER_KEY"
DIAGNOSTIC_FILE = "google-maps-diagnostic.json"
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
OPENAI_KEY_FILE = "openai-key.dpapi"
ART_EDITOR = art_backend.ArtMapEditor()


class DataBlob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(data, *, encrypt):
    if sys.platform != "win32":
        raise ValueError("Windows is required for the encrypted key store. On other platforms use an environment variable.")
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    operation = crypt.CryptProtectData if encrypt else crypt.CryptUnprotectData
    blob_ptr = ctypes.POINTER(DataBlob)
    # Both APIs permit NULL for the optional description, entropy and prompt.
    operation.argtypes = [
        blob_ptr, ctypes.c_void_p, blob_ptr, ctypes.c_void_p,
        ctypes.c_void_p, wintypes.DWORD, blob_ptr,
    ]
    operation.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(data)
    source = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = DataBlob()
    try:
        # CRYPTPROTECT_UI_FORBIDDEN. Omitting LOCAL_MACHINE uses the current user.
        if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
            raise OSError(f"The Windows key store failed (error {ctypes.get_last_error()}).")
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.memset(buffer, 0, len(buffer))
        if result.data:
            if not encrypt:
                ctypes.memset(result.data, 0, result.size)
            kernel.LocalFree(result.data)


def local_file(name):
    folder = os.environ.get("LOCALAPPDATA")
    if not folder or not Path(folder).is_absolute():
        raise ValueError("The Windows local application data directory is unavailable.")
    return Path(folder) / "Project_Aina" / name


def validated_key(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", value):
        raise ValueError("Enter a single browser API key containing letters, digits, hyphens or underscores.")
    return value


def load_key():
    if os.environ.get(KEY_ENV):
        return validated_key(os.environ[KEY_ENV])
    if sys.platform != "win32":
        return ""
    try:
        encrypted = local_file("google-maps-key.dpapi").read_bytes()
    except FileNotFoundError:
        return ""
    return validated_key(dpapi(encrypted, encrypt=False).decode("ascii"))


def write_local_file(name, data):
    destination = local_file(name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as temporary:
            temporary.write(data)
        os.replace(temporary_name, destination)
    finally:
        Path(temporary_name).unlink(missing_ok=True)


def save_key(value):
    encrypted = dpapi(validated_key(value).encode("ascii"), encrypt=True)
    write_local_file("google-maps-key.dpapi", encrypted)


def validated_openai_key(value):
    if not re.fullmatch(r"[A-Za-z0-9._-]{8,1024}", value):
        raise ValueError("Enter one OpenAI API key.")
    return value


def load_openai_key():
    if os.environ.get("OPENAI_API_KEY"):
        return validated_openai_key(os.environ["OPENAI_API_KEY"])
    if sys.platform != "win32":
        return ""
    try:
        secret = local_file(OPENAI_KEY_FILE).read_bytes()
    except FileNotFoundError:
        return ""
    return validated_openai_key(dpapi(secret, encrypt=False).decode("ascii"))


def billing_diagnostic(key):
    return {"keySha256": hashlib.sha256(key.encode("ascii")).hexdigest(), "code": "billing-disabled"}


def local_config():
    key = load_key()
    config = {"googleMapsBrowserKey": key}
    if key:
        try:
            recorded = json.loads(local_file(DIAGNOSTIC_FILE).read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return config
        if recorded == billing_diagnostic(key):
            config["googleMapsLastDiagnostic"] = recorded["code"]
    return config


class SiteHandler(BaseHTTPRequestHandler):
    server_version = "Project_Aina"
    sys_version = ""

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def config_allowed(self, host):
        site = self.headers.get_all("Sec-Fetch-Site", [])
        if site and site not in (["none"], ["same-origin"]):
            return False
        origin = f"http://{host}"
        origins = self.headers.get_all("Origin", [])
        if origins and origins != [origin]:
            return False
        referrers = self.headers.get_all("Referer", [])
        if not referrers:
            return True
        if len(referrers) != 1:
            return False
        referrer = urlsplit(referrers[0])
        return referrer.scheme == "http" and referrer.netloc.lower() == host

    def send_content_headers(self, kind, length):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(length))
        self.end_headers()

    def serve(self, *, include_body):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0].lower() not in ALLOWED_HOSTS:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        try:
            request = urlsplit(self.path)
            if request.scheme or request.netloc or not request.path.startswith("/"):
                raise ValueError()
            path = unquote(request.path, errors="strict")
            if path == "/api/art-map/status":
                if not self.config_allowed(hosts[0].lower()):
                    self.send_json(403, {"error": {"code": "forbidden", "message": "Open this atlas locally."}}, include_body)
                    return
                try:
                    configured = bool(load_openai_key())
                except (ValueError, OSError):
                    self.send_json(503, {"error": {"code": "key_store", "message": "The OpenAI key store is unavailable."}}, include_body)
                    return
                self.send_json(200, {
                    "configured": configured, "model": art_backend.MODEL,
                    "styles": list(art_backend.STYLES), "maxImageBytes": art_backend.MAX_IMAGE_BYTES,
                    "googleKyoto": google_art.enabled(),
                }, include_body)
                return
            if path == "/local-config.js":
                if not self.config_allowed(hosts[0].lower()):
                    self.send_error(HTTPStatus.FORBIDDEN)
                    return
                self.serve_config(include_body)
                return
            parts = (path[1:] if path != "/" else "index.html").split("/")
            # Reject traversal, Windows drive/stream names and hidden files.
            if any(not p or p.startswith(".") or p.endswith((" ", ".")) or
                   any(c in p for c in '\\:\x00') for p in parts):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            root = WEB_ROOT.resolve(strict=True)
            file = root.joinpath(*parts).resolve(strict=True)
            if not file.is_relative_to(root) or not file.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
        except (ValueError, UnicodeError):
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        except (OSError, RuntimeError):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.serve_file(file, include_body)

    def serve_file(self, file, include_body):
        kind = {
            ".js": "text/javascript; charset=utf-8",
            ".mjs": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
        }.get(file.suffix.lower()) or mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        try:
            source = file.open("rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with source:
            self.send_content_headers(kind, os.fstat(source.fileno()).st_size)
            if include_body:
                try:
                    shutil.copyfileobj(source, self.wfile)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

    def serve_config(self, include_body):
        try:
            config = local_config()
        except (ValueError, OSError):
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Local key store is unavailable")
            return
        body = f"window.AINA_CONFIG = {json.dumps(config)};\n".encode("utf-8")
        self.send_content_headers("text/javascript; charset=utf-8", len(body))
        if include_body:
            self.wfile.write(body)

    def send_json(self, status, payload, include_body=True):
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def read_art_request(self, maximum):
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Content-Encoding"):
            raise art_backend.ArtError(400, "invalid_request", "Send a JSON body with its length.")
        if len(self.headers.get_all("Content-Type", [])) != 1 or self.headers.get_content_type() != "application/json":
            raise art_backend.ArtError(415, "invalid_request", "Send application/json.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            raise art_backend.ArtError(400, "invalid_request", "A valid content length is required.")
        size = int(lengths[0])
        if size > maximum:
            raise art_backend.ArtError(413, "too_large", "The map request exceeds the size limit.")
        self.connection.settimeout(30)
        try:
            raw = self.rfile.read(size)
        except TimeoutError:
            raise art_backend.ArtError(408, "timeout", "The local upload timed out.") from None
        if size != len(raw):
            raise art_backend.ArtError(400, "invalid_request", "The upload was incomplete.")
        return raw

    def handle_art_post(self):
        hosts = self.headers.get_all("Host", [])
        host = hosts[0].lower() if len(hosts) == 1 else ""
        try:
            allowed = host in ALLOWED_HOSTS and self.headers.get_all("Origin") == ["http://" + host] and self.config_allowed(host)
        except ValueError:
            allowed = False
        if not allowed:
            raise art_backend.ArtError(403, "forbidden", "Generate maps from the local atlas page.")
        if self.path == "/api/art-map/google-reference":
            if not google_art.enabled():
                raise art_backend.ArtError(403, "google_disabled", "Licensed Kyoto map capture has not been enabled.")
            raw = self.read_art_request(4096)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (ValueError, RecursionError):
                raise art_backend.ArtError(400, "invalid_request", "Send a JSON object with map bounds.") from None
            if not isinstance(payload, dict):
                raise art_backend.ArtError(400, "invalid_request", "Send an object with map bounds.")
            return google_art.capture(payload, host)
        if self.path != "/api/art-map":
            raise art_backend.ArtError(404, "not_found", "Unknown endpoint.")
        raw = self.read_art_request(art_backend.MAX_REQUEST_BYTES)
        try:
            key = load_openai_key()
        except (OSError, ValueError):
            raise art_backend.ArtError(503, "key_store", "The OpenAI key store is unavailable.") from None
        if not key:
            raise art_backend.ArtError(503, "not_configured", "Configure an OpenAI API key on the local server.")
        return {"image": ART_EDITOR.generate(raw, key)}

    def do_POST(self):
        try:
            try:
                payload = self.handle_art_post()
            except (art_backend.ArtError, google_art.CaptureError) as exc:
                self.send_json(exc.status, {"error": {"code": exc.code, "message": str(exc)}})
                return
            self.send_json(200, payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            pass

    def do_GET(self):
        self.serve(include_body=True)

    def do_HEAD(self):
        self.serve(include_body=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--set-key", action="store_true", help="enter the browser key in a hidden terminal prompt")
    group.add_argument("--set-key-stdin", action="store_true", help="read the browser key from a noninteractive pipe")
    group.add_argument("--set-openai-key", "--set-openai-key-stdin", action="store_true", help="store an OpenAI API key from a hidden prompt or a redirected line")
    group.add_argument("--enable-kyoto-art", action="store_true", help="enable licensed Kyoto Google road-map capture on this computer")
    group.add_argument("--record-billing-disabled", action="store_true", help="record a confirmed billing error for the current key")
    group.add_argument("--clear-diagnostic", action="store_true", help="remove the saved Google Maps diagnostic")
    args = parser.parse_args()
    try:
        if args.enable_kyoto_art:
            google_art.enable()
            print("Enabled licensed Kyoto map capture for this local installation.")
            return 0
        if args.set_openai_key:
            if sys.stdin.isatty():
                key = getpass.getpass("OpenAI API key (hidden): ")
            else:
                key = sys.stdin.buffer.read(1027).decode("ascii").removesuffix("\n").removesuffix("\r")
            write_local_file(OPENAI_KEY_FILE, dpapi(validated_openai_key(key).encode("ascii"), encrypt=True))
            print("OpenAI API key saved for this Windows user.")
            return 0
        if args.record_billing_disabled:
            key = load_key()
            if not key:
                raise ValueError("Configure a browser key before recording a billing error.")
            write_local_file(DIAGNOSTIC_FILE, json.dumps(billing_diagnostic(key)).encode("utf-8"))
            print("Recorded the billing-disabled diagnostic for the current key.")
            return 0
        if args.clear_diagnostic:
            local_file(DIAGNOSTIC_FILE).unlink(missing_ok=True)
            print("Cleared the Google Maps diagnostic.")
            return 0
        if args.set_key or args.set_key_stdin:
            if args.set_key:
                if not sys.stdin.isatty():
                    parser.error("--set-key requires an interactive terminal.")
                key = getpass.getpass("Google Maps browser key (hidden): ")
            else:
                if sys.stdin.isatty():
                    parser.error("--set-key-stdin requires redirected input.")
                key = sys.stdin.buffer.read(259).decode("ascii").removesuffix("\n").removesuffix("\r")
            save_key(key)
            print("Google Maps browser key saved for this Windows user.")
            return 0
        if not (WEB_ROOT / "index.html").is_file():
            raise ValueError("Missing web/index.html next to server.py.")
        with ThreadingHTTPServer(("127.0.0.1", PORT), SiteHandler) as server:
            print(f"Project_Aina is running at http://127.0.0.1:{PORT}/", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, EOFError) as error:
        # Decode exceptions can include fragments of user input.
        message = "Input must contain one ASCII API key." if isinstance(error, UnicodeError) else str(error)
        print(message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

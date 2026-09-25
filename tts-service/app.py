"""Local Bangla text-to-speech for the spoken case-status route (A5): BanglaTTS 0.0.3, a wrapper around Silero v3_indic.

Set up once with `npm run tts:setup`, then start with `npm run tts`. It listens on 127.0.0.1 only; the Node API is its
one caller and sends only sentences it built from fixed templates. The model silently skips digits, so text holding
any digit is refused rather than read aloud with the number missing: callers must write numbers as Bangla words.
The Silero model is licensed CC BY-NC-SA 4.0 (non-commercial), so this service is for the demo only.
"""
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

# `npm run tts` starts this with the system Python; hand over to the service's own environment and wait for it.
if VENV_PYTHON.exists() and Path(sys.prefix).resolve() != VENV.resolve():
    sys.exit(subprocess.run([str(VENV_PYTHON), __file__, *sys.argv[1:]]).returncode)

# aksharamukha (BanglaTTS's transliterator) has an unused `from ast import Str`, and Python 3.14 removed ast.Str.
ast.Str = getattr(ast, "Str", str)
try:
    import numpy as np
    import banglatts.tts
    from aksharamukha import transliterate
except ImportError:
    sys.exit("BanglaTTS is not installed. Run `npm run tts:setup` first.")

# Pin the model code torch.hub downloads and runs to a reviewed commit, instead of whatever master holds that day.
# torch.hub only validates branch heads and tags, so validation is skipped for this exact commit.
banglatts.tts.MODEL_REPO = "snakers4/silero-models:d9355348e2781dc8fa25a135d1602c530afae24c"

PORT = int(os.environ.get("TTS_PORT", "5055"))
VOICE = os.environ.get("TTS_VOICE", "female")
RATE = 24000  # a Silero-native rate; BanglaTTS's own 44100 default plays the model's 48000 output slow and deep
MAX_CHARS = 600
# Bangla letters, signs, and punctuation only. Bangla digits (U+09E6-U+09EF) and ASCII digits are excluded.
SPEAKABLE = re.compile(r"^[ঀ-৥ৰ-৿‌‍\s,.?!।;:'\"()\-–]+$")
SENTENCE_END = re.compile(r"(?<=[।?!.])\s+")
PAUSE = np.zeros(int(RATE * 0.3), dtype=np.int16)
FFMPEG = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "pipe:0",
          "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"]


def speak(text):
    """Speaks each sentence separately (the model degrades on long input) and returns one MP3."""
    parts = []
    for sentence in filter(None, (part.strip() for part in SENTENCE_END.split(text))):
        roman = transliterate.process("Bengali", "ISO", sentence)
        audio = tts.model.apply_tts(text=roman, speaker=tts.voice, sample_rate=RATE).numpy()
        parts += [(np.clip(audio, -1, 1) * 32767).astype(np.int16), PAUSE]
    pcm = np.concatenate(parts[:-1]).tobytes()
    return subprocess.run(FFMPEG, input=pcm, capture_output=True, check=True).stdout


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "Not found."})
        self.reply(200, {"ok": True, "engine": "BanglaTTS 0.0.3 (Silero v3_indic)", "voice": VOICE, "sampleRate": RATE})

    def do_POST(self):
        if self.path != "/speak":
            return self.reply(404, {"error": "Not found."})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 8192:
                raise ValueError
            text = json.loads(self.rfile.read(length)).get("text")
        except (ValueError, AttributeError):
            return self.reply(400, {"error": 'Send JSON {"text": "..."}.'})
        if not isinstance(text, str) or not 0 < len(text.strip()) <= MAX_CHARS or not SPEAKABLE.match(text):
            return self.reply(400, {"error": f"Text must be 1-{MAX_CHARS} characters of Bangla, with numbers as words."})
        started = time.perf_counter()
        try:
            audio = speak(text.strip())
        except Exception as error:  # the Node API then shows the sentence as text instead
            print(f"Speech failed: {type(error).__name__}", file=sys.stderr)
            return self.reply(500, {"error": "Speech failed."})
        elapsed = round((time.perf_counter() - started) * 1000)
        print(f"Spoke {len(text)} characters in {elapsed} ms")  # never the text itself: it describes a real case
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Server-Timing", f"tts;dur={elapsed}")
        self.end_headers()
        self.wfile.write(audio)

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg was not found on PATH; install it to encode speech as MP3.")
    started = time.perf_counter()
    # The first start downloads the pinned model code and the model (about 56 MB) into tts-service/models.
    tts = banglatts.tts.BanglaTTS(voice=VOICE, save_location=str(HERE / "models"), device="cpu", skip_validation=True)
    print(f"BanglaTTS ready in {time.perf_counter() - started:.1f} s on http://127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

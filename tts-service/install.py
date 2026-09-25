"""Creates tts-service/.venv and installs the pinned BanglaTTS stack with CPU-only PyTorch. Run: npm run tts:setup"""
import os
import shutil
import subprocess
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

if not PYTHON.exists():
    venv.create(VENV, with_pip=True)
subprocess.run([str(PYTHON), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(HERE / "requirements.txt")],
               check=True)
if not shutil.which("ffmpeg"):
    print("Warning: ffmpeg is not on PATH. Install it before `npm run tts`.")
print("BanglaTTS environment ready. Start the service with: npm run tts")

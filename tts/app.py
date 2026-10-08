"""Self-hosted TTS: Piper (de, en, fr) + MeloTTS (ko). POST /synthesize {"text", "lang"} -> audio/mpeg."""
import os
import subprocess
import tempfile
import threading

from flask import Flask, Response, jsonify, request

VOICES_DIR = os.environ.get("VOICES_DIR", "/voices")
PIPER_VOICES = {
    "de": "de_DE-thorsten-high",
    "en": "en_US-lessac-medium",
    "fr": "fr_FR-siwis-medium",
}
MAX_CHARS = 500

app = Flask(__name__)
_melo = None
_melo_lock = threading.Lock()


def melo():
    """MeloTTS is heavy (PyTorch) — load lazily, once."""
    global _melo
    with _melo_lock:
        if _melo is None:
            from melo.api import TTS
            _melo = TTS(language="KR", device="cpu")
        return _melo


def to_mp3(wav_path: str) -> bytes:
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", wav_path, "-ac", "1", "-b:a", "64k", "-f", "mp3", "-"],
        check=True, capture_output=True,
    )
    return out.stdout


@app.post("/synthesize")
def synthesize():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    lang = str(body.get("lang", "")).lower()
    if not text or len(text) > MAX_CHARS:
        return jsonify(error="text is empty or too long"), 400

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "out.wav")
        try:
            if lang in PIPER_VOICES:
                model = os.path.join(VOICES_DIR, PIPER_VOICES[lang] + ".onnx")
                subprocess.run(
                    ["piper", "--model", model, "--output_file", wav, "--length_scale", "1.1"],
                    input=text.encode(), check=True, capture_output=True, timeout=60,
                )
            elif lang == "ko":
                m = melo()
                m.tts_to_file(text, m.hps.data.spk2id["KR"], wav, speed=0.9, quiet=True)
            else:
                return jsonify(error=f"unsupported language {lang!r}"), 400
            return Response(to_mp3(wav), mimetype="audio/mpeg")
        except subprocess.CalledProcessError as e:
            app.logger.error("tts failed: %s", e.stderr.decode(errors="ignore"))
            return jsonify(error="synthesis failed"), 500
        except Exception as e:  # noqa: BLE001
            app.logger.exception("tts failed")
            return jsonify(error=str(e)), 500


@app.get("/healthz")
def healthz():
    return jsonify(status="ok")

FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git curl build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# CPU-only PyTorch keeps the image much smaller than the CUDA build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir flask gunicorn piper-tts \
       git+https://github.com/myshell-ai/MeloTTS.git \
    && python -m unidic download

# Piper voices (check each MODEL_CARD license before commercial use).
ARG HF=https://huggingface.co/rhasspy/piper-voices/resolve/main
RUN mkdir -p /voices && cd /voices && \
    for v in de/de_DE/thorsten/high/de_DE-thorsten-high \
             en/en_US/lessac/medium/en_US-lessac-medium \
             fr/fr_FR/siwis/medium/fr_FR-siwis-medium; do \
      n=$(basename $v); \
      curl -fsSL -o $n.onnx $HF/$v.onnx && curl -fsSL -o $n.onnx.json $HF/$v.onnx.json; \
    done

# Pre-download the Korean MeloTTS model so the first request isn't slow.
RUN python -c "from melo.api import TTS; TTS(language='KR', device='cpu')"

COPY app.py .
EXPOSE 5000
CMD ["gunicorn", "-w", "1", "--threads", "4", "-t", "120", "-b", "0.0.0.0:5000", "app:app"]

import sys
import os
import json
import base64
import time
import io
import random

# Monkeypatch torchaudio.load to use soundfile (avoids torchcodec and dynamic dylib dependencies)
import soundfile as sf
import torch
import torchaudio

def sf_load(filepath, *args, **kwargs):
    data, sr = sf.read(filepath)
    tensor = torch.from_numpy(data).float()
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)
    else:
        tensor = tensor.T
    return tensor, sr

torchaudio.load = sf_load

# Add venv bin to PATH for imageio-ffmpeg
venv_bin = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.venv-voice/bin"))
if os.path.exists(venv_bin) and venv_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = f"{venv_bin}:{os.environ.get('PATH', '')}"

def log(msg):
    sys.stderr.write(f"[NeuralTTSWorker] {msg}\n")
    sys.stderr.flush()

log("Starting Neural TTS Worker...")

f5_model = None

def get_model():
    global f5_model
    if f5_model is None:
        log("Loading F5TTS model into memory (Apple Silicon MPS)...")
        from f5_tts.api import F5TTS
        f5_model = F5TTS()
        log(f"F5TTS loaded successfully on device: {f5_model.device}")
    return f5_model

def handle_infer(req):
    model = get_model()
    ref_file = req.get("ref_file")
    ref_text = req.get("ref_text", "The quick brown fox jumps over the lazy dog near the calm blue river.")
    gen_text = req.get("text", "")
    nfe_step = req.get("nfe_step", 16)
    speed = req.get("speed", 1.0)

    if not ref_file or not os.path.exists(ref_file):
        return {"status": "error", "error": f"Reference audio not found: {ref_file}"}
    if not gen_text or not gen_text.strip():
        return {"status": "error", "error": "Empty text to synthesize"}

    start = time.time()
    # Safe seed within 32-bit uint limit
    safe_seed = random.randint(0, 4294967295)

    wav, sr, _ = model.infer(
        ref_file=ref_file,
        ref_text=ref_text,
        gen_text=gen_text.strip(),
        nfe_step=nfe_step,
        speed=speed,
        seed=safe_seed,
    )
    synth_duration_ms = int((time.time() - start) * 1000)
    log(f"Synthesized '{gen_text[:35]}...' in {synth_duration_ms}ms ({len(wav)/sr:.2f}s audio)")

    # Encode wav to memory buffer
    bio = io.BytesIO()
    sf.write(bio, wav, sr, format="WAV")
    audio_bytes = bio.getvalue()
    b64_data = base64.b64encode(audio_bytes).decode("ascii")

    return {
        "status": "ok",
        "format": "wav",
        "sampleRate": sr,
        "durationMs": synth_duration_ms,
        "data": b64_data,
    }

def main():
    # Preload model immediately
    get_model()
    log("Neural Worker ready for commands on stdin.")
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "init":
                get_model()
                resp = {"status": "ok", "device": f5_model.device}
            elif cmd == "infer":
                resp = handle_infer(req)
                resp["id"] = req.get("id")
            elif cmd == "ping":
                resp = {"status": "pong"}
            else:
                resp = {"status": "error", "error": f"Unknown command: {cmd}"}
        except Exception as e:
            log(f"Error handling request: {e}")
            resp = {"status": "error", "error": str(e), "id": req.get("id") if "req" in locals() else None}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()

import sys
import os
import json
import base64
import time
import io
import random

# Protocol IPC channel: save true stdout for JSON protocol lines, redirect sys.stdout to stderr
protocol_stdout = sys.stdout
sys.stdout = sys.stderr

import soundfile as sf
import torch

def log(msg):
    sys.stderr.write(f"[Qwen3Worker] {msg}\n")
    sys.stderr.flush()

log("Initializing Qwen3-TTS Neural Worker...")

qwen_model = None
cached_prompt = None
cached_ref_file = None

def get_device_and_dtype():
    if torch.backends.mps.is_available():
        return "mps", torch.bfloat16
    return "cpu", torch.float32

def load_model():
    global qwen_model
    if qwen_model is None:
        device, dtype = get_device_and_dtype()
        log(f"Loading Qwen/Qwen3-TTS-12Hz-0.6B-Base on {device} ({dtype})...")
        t0 = time.time()
        from qwen_tts import Qwen3TTSModel
        qwen_model = Qwen3TTSModel.from_pretrained(
            "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
            device_map=device,
            dtype=dtype,
        )
        log(f"Qwen3-TTS loaded successfully in {time.time() - t0:.2f}s")
    return qwen_model

def set_voice_profile(ref_file):
    global cached_prompt, cached_ref_file
    if not ref_file or not os.path.exists(ref_file):
        log(f"Reference audio not found: {ref_file}")
        return False
    try:
        model = load_model()
        log(f"Precomputing speaker voice embedding from {ref_file}...")
        t0 = time.time()
        cached_prompt = model.create_voice_clone_prompt(
            ref_audio=ref_file,
            x_vector_only_mode=True
        )
        cached_ref_file = ref_file
        log(f"Speaker voice embedding precomputed in {time.time() - t0:.2f}s")
        return True
    except Exception as e:
        log(f"Failed precomputing voice clone prompt: {e}")
        return False

def handle_infer(req):
    model = load_model()
    gen_text = req.get("text", "").strip()
    ref_file = req.get("ref_file")
    language = req.get("language", "English")

    if not gen_text:
        return {"status": "error", "error": "Empty text to synthesize"}

    # Update or load prompt if needed
    global cached_prompt, cached_ref_file
    if cached_prompt is None or (ref_file and ref_file != cached_ref_file and os.path.exists(ref_file)):
        target_ref = ref_file or os.path.abspath("storage/voice_profiles/user_voice.wav")
        if not set_voice_profile(target_ref):
            return {"status": "error", "error": f"Failed setting reference audio: {target_ref}"}

    num_words = len(gen_text.split())
    # Cap max_new_tokens generously for the sentence length to prevent runaway generation
    max_tokens = max(50, num_words * 14)

    start = time.time()
    try:
        wavs, sr = model.generate_voice_clone(
            text=gen_text,
            language=language,
            voice_clone_prompt=cached_prompt,
            max_new_tokens=max_tokens,
        )
        synth_duration_ms = int((time.time() - start) * 1000)
        audio_data = wavs[0]
        audio_dur = len(audio_data) / sr
        rtf = (synth_duration_ms / 1000.0) / max(audio_dur, 0.001)
        log(f"Synthesized '{gen_text[:40]}...' in {synth_duration_ms}ms ({audio_dur:.2f}s audio, RTF: {rtf:.2f})")

        # Encode to WAV buffer
        bio = io.BytesIO()
        sf.write(bio, audio_data, sr, format="WAV")
        audio_bytes = bio.getvalue()
        b64_data = base64.b64encode(audio_bytes).decode("ascii")

        return {
            "status": "ok",
            "format": "wav",
            "sampleRate": sr,
            "durationMs": synth_duration_ms,
            "audioDurationSec": audio_dur,
            "rtf": round(rtf, 2),
            "data": b64_data,
        }
    except Exception as e:
        log(f"Synthesis failed: {e}")
        return {"status": "error", "error": str(e)}

def main():
    # Warm up model immediately
    load_model()
    # Auto-load existing user voice if available
    default_ref = os.path.abspath("storage/voice_profiles/user_voice.wav")
    if os.path.exists(default_ref):
        set_voice_profile(default_ref)

    log("Qwen3-TTS Worker ready for commands on stdin.")
    protocol_stdout.write(json.dumps({"status": "ready"}) + "\n")
    protocol_stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = None
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "init":
                load_model()
                device, dtype = get_device_and_dtype()
                resp = {"status": "ok", "device": device, "dtype": str(dtype)}
            elif cmd == "set_voice":
                ref_file = req.get("ref_file")
                success = set_voice_profile(ref_file)
                resp = {"status": "ok" if success else "error", "id": req.get("id")}
            elif cmd == "infer":
                resp = handle_infer(req)
                resp["id"] = req.get("id")
            elif cmd == "ping":
                resp = {"status": "pong", "id": req.get("id")}
            else:
                resp = {"status": "error", "error": f"Unknown command: {cmd}"}
        except Exception as e:
            log(f"Worker exception: {e}")
            resp = {"status": "error", "error": str(e), "id": req.get("id") if req else None}

        protocol_stdout.write(json.dumps(resp) + "\n")
        protocol_stdout.flush()

if __name__ == "__main__":
    main()

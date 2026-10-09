"""Canal Studio sidecar: Kokoro TTS, faster-whisper transcription and subject cutouts.

Run: venv\\Scripts\\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import gc
import glob
import logging
import os
import sys
import threading
from pathlib import Path

# CUDA DLLs installed by pip (nvidia-cublas-cu12, nvidia-cudnn-cu12) are not on the
# default DLL search path on Windows. Add them before ctranslate2 is imported.
_site = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
for _bin in glob.glob(str(_site / "*" / "bin")):
    os.add_dll_directory(_bin)
    os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

log = logging.getLogger("canal")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
for _noisy in ("httpx", "huggingface_hub", "urllib3"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

app = FastAPI(title="Canal Studio sidecar")
_lock = threading.Lock()

SAMPLE_RATE = 24000

# Kokoro v1.0 English voices. a* = American, b* = British; f = female, m = male.
VOICES = [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole",
    "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
    "am_puck", "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
]

_pipelines: dict[str, object] = {}
_whisper: dict[str, object] = {"model": None, "key": None, "device": None}


def _pipeline(voice: str):
    from kokoro import KPipeline

    lang = voice[0] if voice[:1] in ("a", "b") else "a"
    if lang not in _pipelines:
        log.info("Loading Kokoro pipeline lang=%s", lang)
        _pipelines[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang]


def _load_whisper(model: str, device: str):
    from faster_whisper import WhisperModel

    key = (model, device)
    if _whisper["key"] == key and _whisper["model"] is not None:
        return _whisper["model"]
    _unload_whisper()
    compute = "float16" if device == "cuda" else "int8"
    log.info("Loading Whisper %s on %s (%s)", model, device, compute)
    _whisper["model"] = WhisperModel(model, device=device, compute_type=compute)
    _whisper["key"] = key
    _whisper["device"] = device
    return _whisper["model"]


def _unload_whisper():
    _whisper["model"] = None
    _whisper["key"] = None
    _whisper["device"] = None
    gc.collect()


class TtsRequest(BaseModel):
    text: str
    voice: str = "am_michael"
    speed: float = 1.0
    out_path: str


class TranscribeRequest(BaseModel):
    audio_path: str
    model: str = "small.en"
    device: str = "auto"  # auto | cuda | cpu
    initial_prompt: str | None = None


@app.get("/health")
def health():
    return {
        "ok": True,
        "kokoro_loaded": list(_pipelines.keys()),
        "whisper": {"key": _whisper["key"], "device": _whisper["device"]},
    }


@app.get("/voices")
def voices():
    return {"voices": VOICES}


@app.post("/tts")
def tts(req: TtsRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    with _lock:
        pipeline = _pipeline(req.voice)
        chunks = []
        for result in pipeline(text, voice=req.voice, speed=req.speed, split_pattern=r"\n+"):
            audio = result.audio
            if audio is None:
                continue
            chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
    if not chunks:
        raise HTTPException(500, "Kokoro produced no audio")
    audio = np.concatenate(chunks)
    out = Path(req.out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.wav")
    sf.write(tmp, audio, SAMPLE_RATE, subtype="PCM_16")
    os.replace(tmp, out)
    return {"path": str(out), "duration": len(audio) / SAMPLE_RATE}


def _transcribe(req: TranscribeRequest, device: str):
    model = _load_whisper(req.model, device)
    segments, info = model.transcribe(
        req.audio_path,
        language="en",
        word_timestamps=True,
        vad_filter=False,
        beam_size=5,
        initial_prompt=req.initial_prompt,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    return {"words": words, "duration": info.duration, "device": device}


@app.post("/transcribe")
def transcribe(req: TranscribeRequest):
    if not Path(req.audio_path).exists():
        raise HTTPException(404, f"audio not found: {req.audio_path}")
    with _lock:
        devices = ["cuda", "cpu"] if req.device == "auto" else [req.device]
        errors = []
        for device in devices:
            try:
                return _transcribe(req, device)
            except Exception as exc:  # DLL or CUDA errors surface here, often only at first decode
                log.warning("Whisper on %s failed: %s", device, exc)
                errors.append(f"{device}: {exc}")
                _unload_whisper()
        raise HTTPException(500, "; ".join(errors))


# IS-Net (DIS) background removal, the "isnet-general-use" weights published by rembg (Apache-2.0).
CUTOUT_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
CUTOUT_MODEL = Path.home() / ".cache" / "canal-studio" / "isnet-general-use.onnx"
_cutout: dict[str, object] = {"session": None}


class CutoutRequest(BaseModel):
    image_path: str
    out_path: str


def _cutout_session():
    if _cutout["session"] is None:
        import onnxruntime as ort

        if not CUTOUT_MODEL.exists():
            import urllib.request

            log.info("Downloading %s", CUTOUT_URL)
            CUTOUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
            tmp = CUTOUT_MODEL.with_suffix(".part")
            urllib.request.urlretrieve(CUTOUT_URL, tmp)
            os.replace(tmp, CUTOUT_MODEL)
        # CPU on purpose: one image takes a couple of seconds and ComfyUI may hold the GPU.
        _cutout["session"] = ort.InferenceSession(str(CUTOUT_MODEL), providers=["CPUExecutionProvider"])
    return _cutout["session"]


@app.post("/cutout")
def cutout(req: CutoutRequest):
    """Cut the main subject out of an image: writes an RGBA PNG and returns how much of the frame it covers."""
    from PIL import Image

    if not Path(req.image_path).exists():
        raise HTTPException(404, f"image not found: {req.image_path}")
    with _lock:
        session = _cutout_session()
        img = Image.open(req.image_path).convert("RGB")
        x = np.asarray(img.resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
        x = x / max(float(x.max()), 1e-6) - 0.5
        x = x.transpose(2, 0, 1)[None]
        pred = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
        pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size, Image.LANCZOS)
    out = Path(req.out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    rgba = img.copy()
    rgba.putalpha(mask)
    rgba.save(out)
    solid = np.asarray(mask) > 127
    coverage = float(solid.mean())
    # Horizontal center of the subject (0 left, 1 right): the text goes on the other side.
    cols = solid.sum(axis=0)
    center_x = float((cols * np.arange(len(cols))).sum() / max(cols.sum(), 1) / max(len(cols) - 1, 1))
    return {"path": str(out), "coverage": coverage, "center_x": center_x}


class FocusRequest(BaseModel):
    image_path: str


@app.post("/focus")
def focus(req: FocusRequest):
    """Where to keep an image when it is cropped: the top of its main subject (a person's head).

    Returns x, y (0-1 of the image) and aspect (width / height); x and y are null when there is
    no clear subject (too small, or most of the frame), so the crop stays centered.
    """
    from PIL import Image

    if not Path(req.image_path).exists():
        raise HTTPException(404, f"image not found: {req.image_path}")
    with _lock:
        session = _cutout_session()
        img = Image.open(req.image_path).convert("RGB")
        x = np.asarray(img.resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
        x = x / max(float(x.max()), 1e-6) - 0.5
        x = x.transpose(2, 0, 1)[None]
        pred = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
        pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    aspect = img.width / img.height
    solid = pred > 0.5
    coverage = float(solid.mean())
    if coverage < 0.03 or coverage > 0.9:
        return {"x": None, "y": None, "aspect": aspect}
    rows = np.where(solid.any(axis=1))[0]
    top, bottom = np.percentile(rows, [1, 99])
    # The head sits in the top part of the subject; its center x is taken from that band only.
    head = int(top + 0.12 * (bottom - top))
    band = solid[int(top) : max(head * 2 - int(top), int(top) + 1)]
    cols = np.where(band.any(axis=0))[0] if band.any() else np.where(solid.any(axis=0))[0]
    size = solid.shape[0] - 1
    return {"x": float(cols.mean() / size), "y": float(head / size), "aspect": aspect}


@app.post("/unload")
def unload():
    """Release Whisper (and its VRAM) before ComfyUI runs."""
    with _lock:
        _unload_whisper()
        _cutout["session"] = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
    return {"ok": True}

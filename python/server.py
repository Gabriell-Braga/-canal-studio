"""Canal Studio sidecar: Kokoro TTS, faster-whisper transcription and subject cutouts.

Run: venv\\Scripts\\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import gc
import glob
import importlib.util
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
        "insightface": importlib.util.find_spec("insightface") is not None,
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
    # Crop the PNG to the subject (thumbnails place the subject by its own edges).
    trim: bool = False


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
    solid = np.asarray(mask) > 127
    coverage = float(solid.mean())
    # Mean luminance (0-1) of the subject: thumbnails pick a background that contrasts with it.
    lum = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    luminance = float(lum[solid].mean()) if solid.any() else 0.5
    if req.trim and solid.any():
        ys, xs = np.nonzero(solid)
        rgba = rgba.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    rgba.save(out)
    # Horizontal center of the subject (0 left, 1 right): the text goes on the other side.
    cols = solid.sum(axis=0)
    center_x = float((cols * np.arange(len(cols))).sum() / max(cols.sum(), 1) / max(len(cols) - 1, 1))
    return {
        "path": str(out),
        "coverage": coverage,
        "center_x": center_x,
        "luminance": luminance,
        "width": rgba.width,
        "height": rgba.height,
    }


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


class DepthRequest(BaseModel):
    image_path: str
    out_path: str


_depth: dict[str, object] = {"pipe": None}


@app.post("/depth")
def depth(req: DepthRequest):
    """Depth map of a picture for 2.5D parallax: grayscale PNG, white = near.

    Depth Anything V2 Small (Apache-2.0) on CPU. spread is the standard deviation of the map
    (0-1): a flat scan or a page has almost none, a photo with a clear subject has plenty.
    """
    from PIL import Image

    if not Path(req.image_path).exists():
        raise HTTPException(404, f"image not found: {req.image_path}")
    with _lock:
        if _depth["pipe"] is None:
            from transformers import pipeline

            _depth["pipe"] = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
        img = Image.open(req.image_path).convert("RGB")
        small = img.copy()
        small.thumbnail((1024, 1024))
        pred = np.asarray(_depth["pipe"](small)["predicted_depth"].squeeze().cpu().numpy(), dtype=np.float32)
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    out = Path(req.out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size, Image.BICUBIC).save(out)
    return {"path": str(out), "spread": float(pred.std())}


class RegionsRequest(BaseModel):
    image_path: str
    count: int = 4


@app.post("/salient_regions")
def salient_regions(req: RegionsRequest):
    """Boxes (x, y, w, h as 0-1 of the image) of the salient objects, biggest first: the parts
    of a picture worth a close-up (a face, a hand, a bottle, an engraving inside a page)."""
    import cv2
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
    solid = (pred > 0.5).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    boxes = []
    for i in range(1, n):
        x0, y0, w, h, area = (int(v) for v in stats[i])
        if area < 0.005 * solid.size:
            continue
        boxes.append({"x": x0 / 1024, "y": y0 / 1024, "w": w / 1024, "h": h / 1024, "area": area / solid.size})
    boxes.sort(key=lambda b: b["area"], reverse=True)
    return {"boxes": boxes[: req.count], "width": img.width, "height": img.height}


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


# InsightFace (buffalo_l: RetinaFace detection + ArcFace embeddings), CPU on purpose like the cutout.
_faces: dict[str, object] = {"app": None}


class FaceInfoRequest(BaseModel):
    path: str


class FaceSimilarityRequest(BaseModel):
    a: str
    b: str


def _face_app():
    if _faces["app"] is None:
        try:
            from insightface.app import FaceAnalysis
        except ImportError:
            raise HTTPException(501, "insightface não instalado: venv\Scripts\pip install insightface onnxruntime")
        fa = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        fa.prepare(ctx_id=-1, det_size=(640, 640))
        _faces["app"] = fa
    return _faces["app"]


def _faces_of(path: str):
    import cv2

    if not Path(path).exists():
        raise HTTPException(404, f"image not found: {path}")
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)  # imread fails on non-ASCII paths
    if img is None:
        raise HTTPException(400, f"not an image: {path}")
    with _lock:
        return img, _face_app().get(img)


def _yaw(face) -> float:
    pose = getattr(face, "pose", None)
    if pose is not None:
        return float(pose[1])
    # 5-point fallback: nose offset from the eye midpoint, relative to eye distance (~0.5 at 45 degrees).
    (lx, _), (rx, _), (nx, _) = face.kps[0], face.kps[1], face.kps[2]
    return float(np.degrees(np.arcsin(np.clip(2 * (nx - (lx + rx) / 2) / max(abs(rx - lx), 1e-6), -1, 1))) / 2)


@app.post("/face_info")
def face_info(req: FaceInfoRequest):
    """Faces in a photo, biggest first: box [x, y, w, h], yaw in degrees, blur = Laplacian variance (higher is sharper)."""
    import cv2

    img, faces = _faces_of(req.path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    out = []
    for f in faces:
        x0, y0, x1, y1 = (int(v) for v in f.bbox)
        x0, y0 = max(x0, 0), max(y0, 0)
        crop = gray[y0:y1, x0:x1]
        # Fixed size so the blur score does not depend on the face's resolution.
        blur = float(cv2.Laplacian(cv2.resize(crop, (256, 256)), cv2.CV_64F).var()) if crop.size else 0.0
        out.append({"box": [x0, y0, x1 - x0, y1 - y0], "height": y1 - y0, "yaw": _yaw(f), "blur": blur})
    out.sort(key=lambda f: f["box"][2] * f["box"][3], reverse=True)
    return {"faces": out, "width": img.shape[1], "height": img.shape[0]}


@app.post("/face_similarity")
def face_similarity(req: FaceSimilarityRequest):
    """Cosine similarity of the ArcFace embeddings of the biggest face in each image."""
    embs = []
    for p in (req.a, req.b):
        _, faces = _faces_of(p)
        if not faces:
            raise HTTPException(422, f"no face found: {p}")
        biggest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        embs.append(biggest.normed_embedding)
    return {"similarity": float(np.dot(embs[0], embs[1]))}


class ColorMatchRequest(BaseModel):
    reference: str
    path: str
    min_height: int = 1080


@app.post("/color_match")
def color_match(req: ColorMatchRequest):
    """Upscale `path` (Lanczos) to min_height if smaller, match its colors to `reference`
    (per-channel mean/std in LAB) and overwrite it. Used after an expression edit."""
    import cv2

    src = cv2.imdecode(np.fromfile(req.reference, dtype=np.uint8), cv2.IMREAD_COLOR)
    dst = cv2.imdecode(np.fromfile(req.path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if src is None or dst is None:
        raise HTTPException(404, "image not found")
    if dst.shape[0] < req.min_height:
        scale = req.min_height / dst.shape[0]
        dst = cv2.resize(dst, (round(dst.shape[1] * scale), req.min_height), interpolation=cv2.INTER_LANCZOS4)
    s = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float32)
    d = cv2.cvtColor(dst, cv2.COLOR_BGR2LAB).astype(np.float32)
    for c in range(3):
        d[..., c] = (d[..., c] - d[..., c].mean()) / max(float(d[..., c].std()), 1e-6) * s[..., c].std() + s[..., c].mean()
    out = cv2.cvtColor(np.clip(d, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    ok, buf = cv2.imencode(Path(req.path).suffix or ".png", out)
    if not ok:
        raise HTTPException(500, "encode failed")
    buf.tofile(req.path)
    return {"path": req.path, "width": out.shape[1], "height": out.shape[0]}


class ThumbCheckRequest(BaseModel):
    image_path: str
    width: int = 246
    height: int = 138


@app.post("/thumb_check")
def thumb_check(req: ThumbCheckRequest):
    """How a thumbnail reads at mobile feed size: subject coverage and contrast.

    coverage: share of the frame the main subject (salient object) fills.
    contrast: RMS contrast of the luminance (0-1). subject_contrast: luminance gap between the
    subject and the background (0-1).
    """
    from PIL import Image

    if not Path(req.image_path).exists():
        raise HTTPException(404, f"image not found: {req.image_path}")
    small = Image.open(req.image_path).convert("RGB").resize((req.width, req.height), Image.LANCZOS)
    with _lock:
        session = _cutout_session()
        x = np.asarray(small.resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
        x = x / max(float(x.max()), 1e-6) - 0.5
        x = x.transpose(2, 0, 1)[None]
        pred = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
        pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    mask = np.asarray(Image.fromarray((pred * 255).astype(np.uint8)).resize(small.size)) > 127
    lum = np.asarray(small.convert("L"), dtype=np.float32) / 255.0
    inside = float(lum[mask].mean()) if mask.any() else 0.0
    outside = float(lum[~mask].mean()) if (~mask).any() else 0.0
    return {
        "coverage": float(mask.mean()),
        "contrast": float(lum.std()),
        "subject_contrast": abs(inside - outside),
    }


_ocr: dict[str, object] = {"engine": None}


class OcrRequest(BaseModel):
    image_path: str


def _ocr_engine():
    if _ocr["engine"] is None:
        try:
            from rapidocr import RapidOCR  # PaddleOCR (PP-OCR) models on onnxruntime
        except ImportError:
            raise HTTPException(501, "rapidocr não instalado: pip install rapidocr")
        _ocr["engine"] = RapidOCR()
    return _ocr["engine"]


@app.post("/ocr")
def ocr(req: OcrRequest):
    """Words of a scanned ad with their boxes, like ALTO: x, y, w, h as 0-1 of the image.

    Small scans are upscaled first (OCR needs ~30 px letters). confidence is the mean word
    score, 0-100.
    """
    from PIL import Image

    if not Path(req.image_path).exists():
        raise HTTPException(404, f"image not found: {req.image_path}")
    img = Image.open(req.image_path).convert("RGB")
    width, height = img.size
    scale = 1.0
    if min(width, height) < 1400:
        scale = 1400 / min(width, height)
        img = img.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    with _lock:
        result = _ocr_engine()(np.asarray(img), return_word_box=True)
    words = []
    for line in result.word_results or ():
        for text, score, quad in line:
            xs = [p[0] for p in quad]
            ys = [p[1] for p in quad]
            sw, sh = img.size
            words.append(
                {
                    "text": text,
                    "conf": round(float(score) * 100, 1),
                    "x": min(xs) / sw,
                    "y": min(ys) / sh,
                    "w": (max(xs) - min(xs)) / sw,
                    "h": (max(ys) - min(ys)) / sh,
                }
            )
    confidence = round(sum(w["conf"] for w in words) / len(words), 1) if words else 0.0
    return {"width": width, "height": height, "confidence": confidence, "words": words}

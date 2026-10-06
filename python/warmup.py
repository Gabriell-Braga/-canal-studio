"""Download Kokoro and Whisper weights once, so the first night run does not wait on them."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402

out = Path(tempfile.gettempdir()) / "canal-warmup.wav"
print("Kokoro:", server.tts(server.TtsRequest(text="Warm up.", voice="am_michael", out_path=str(out))))
model = sys.argv[1] if len(sys.argv) > 1 else "small.en"
result = server.transcribe(server.TranscribeRequest(audio_path=str(out), model=model))
print("Whisper:", result["device"], [w["word"] for w in result["words"]])

# Canal Studio

Windows desktop app that produces long-form videos for a faceless English-language YouTube channel. Everything runs locally and free. The user approves the script and the final video; the rest runs in a queue, with heavy work in a night window.

Full specification: [PROMPT_CANAL_STUDIO.md](PROMPT_CANAL_STUDIO.md).

## Status

- [x] Phase 0: environment, `scripts/check-setup.ps1`, Electron app with the Services screen
- [ ] Phase 1: scripts (database, Kanban, Ollama, batch review)
- [ ] Phase 2: queue and worker
- [ ] Phase 3: audio and captions
- [ ] Phase 4: scenes and render
- [ ] Phase 5: final review and thumbnails
- [ ] Phase 6: YouTube
- [ ] Phase 7: packaging

## Requirements

| Tool | Install |
|---|---|
| Node.js 20+ | `winget install OpenJS.NodeJS.LTS` |
| Python 3.11 | `winget install Python.Python.3.11` |
| Git | `winget install Git.Git` |
| FFmpeg | `winget install Gyan.FFmpeg` |
| Ollama + `qwen3:14b` | `winget install Ollama.Ollama`, then `ollama pull qwen3:14b` (~9 GB) |
| ComfyUI portable (NVIDIA) | Extract to `D:\ComfyUI_windows_portable`, SDXL base 1.0 in `ComfyUI\models\checkpoints` |

Check everything with:

```powershell
npm run check-setup
```

## Development

```powershell
npm install
npm run dev
```

## Layout

```
electron/   main process: services, database, queue, steps
src/        React UI
shared/     types shared by main, preload and UI
remotion/   video and thumbnail compositions (Phase 4)
python/     FastAPI sidecar: Kokoro + faster-whisper (Phase 3)
scripts/    check-setup.ps1 and utilities
dados/      local data, not in git
```

## Licenses

- **Remotion** is free for individuals and small companies. Larger companies need a company license. See remotion.dev/license.
- **SDXL base 1.0** uses the CreativeML Open RAIL++-M license, which allows commercial use under its use restrictions.
- **Flux.1 Dev** is not used, because its license restricts commercial use of the model.
- Check the license of every model you add for commercial use.

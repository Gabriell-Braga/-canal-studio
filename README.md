# Canal Studio

Windows desktop app that produces long-form videos for a faceless English-language YouTube channel. Everything runs locally and free: the script comes from Ollama, the voice from Kokoro, captions from faster-whisper, images from ComfyUI (SDXL), stock footage and photos from Pixabay and Wikimedia Commons (Pexels optional), and the render from Remotion.

You approve the script and the final video. Everything else is automatic, queued, and the heavy work runs in a night window.

The UI is in Brazilian Portuguese. Code and video content are in English. Full specification: [PROMPT_CANAL_STUDIO.md](PROMPT_CANAL_STUDIO.md).

## Contents

- [Installation](#installation)
- [Daily use](#daily-use)
- [How the pipeline works](#how-the-pipeline-works)
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [YouTube policy on inauthentic and repetitive content](#youtube-policy-on-inauthentic-and-repetitive-content)
- [Licenses](#licenses)
- [Development](#development)

## Installation

### 1. Requirements

| Tool | Why | Install |
|---|---|---|
| NVIDIA GPU, 12 GB VRAM | Ollama, Whisper, ComfyUI | Driver from nvidia.com |
| Node.js 20+ | Remotion render worker (development only) | `winget install OpenJS.NodeJS.LTS` |
| Python 3.11 | Voice and caption server | `winget install Python.Python.3.11` |
| FFmpeg | Audio joining, loudness, frames | `winget install Gyan.FFmpeg` |
| Ollama + `qwen3:14b` | Scripts, review, titles | `winget install Ollama.Ollama`, then `ollama pull qwen3:14b` (~9 GB) |
| ComfyUI portable (NVIDIA) | AI images | Extract the release from github.com/Comfy-Org/ComfyUI to `D:\ComfyUI_windows_portable` |
| SDXL base 1.0 | Image model | `sd_xl_base_1.0.safetensors` (~6.9 GB) in `ComfyUI\models\checkpoints` |

Check everything at once:

```powershell
npm run check-setup
```

The app has the same check on the **Serviços** screen.

### 2. Install the app

Run `Canal Studio-<version>-setup.exe` from `dist/`. It installs for the current user, with no administrator rights.

### 3. First start

1. Open **Serviços**. Click **Instalar** on "Servidor Python". This creates a virtual environment and downloads Kokoro, faster-whisper and the CUDA libraries (about 3 GB on disk, several minutes). Follow the progress in **Fila e Worker → Logs**.
2. Open **Configurações**:
   - Paste your **Pixabay API key**: create a free account at pixabay.com, then open pixabay.com/api/docs while logged in; the key is shown under "Parameters".
   - Wikimedia Commons needs no key and is on by default (historical photos, paintings and maps).
   - Pexels paused new API keys in 2026. Paste a Pexels key only if you already have one.
   - Check the ComfyUI folder.
   - Choose a voice and click **Ouvir amostra**.
   - Set the night window, the limit of videos per night, and the publish slots.
3. Put background music in `dados\musica` (the data folder is shown in Configurações → Sistema). Use tracks from the YouTube Audio Library. Without music, videos have narration only.
4. Connect YouTube: see [YouTube setup](#youtube-setup).

### YouTube setup

The **Canal** screen has a step-by-step guide. Summary:

1. In console.cloud.google.com, create a project and enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Configure the OAuth consent screen as **External**, in **Testing** mode, and add the channel's Google account as a test user.
3. Create an OAuth client ID of type **Desktop app**. Paste the Client ID and Client secret in **Configurações → YouTube**.
4. On **Canal**, click **Conectar YouTube** and accept in the browser.

Important limits:

- **Quota.** The default quota is 10,000 units per day. One upload with a thumbnail costs about 1,650 units, so about 6 uploads per day. The Canal screen shows today's usage.
- **Unverified projects.** Until your Google Cloud project passes the YouTube API audit, YouTube locks uploads as private. Videos still upload and keep their schedule, but you must make them public in YouTube Studio or request the audit ("YouTube API Services – Audit and Quota Extension").
- **Testing mode tokens** expire after 7 days. Reconnect on the Canal screen when an upload fails with an authentication error.
- **Custom thumbnails** need a phone-verified channel (youtube.com/verify).

## Channels

The app runs several YouTube channels side by side. It opens on the channel picker; switch channels from the card at the top of the sidebar.

- **Per channel** (Configurações do canal): name and color, script and review prompts, default length and niche, voice, captions, music volume and music folder, templates, AI image ratio, stock provider order, publish slots and time zone, synthetic content default, and the YouTube connection.
- **Shared** (Configurações gerais): Ollama model, night window and nightly limit, Whisper, ComfyUI, Pixabay and Pexels keys, Wikimedia CC BY option, Google Cloud client, data folder, startup. There is one GPU, so the queue is shared and shows which channel each job belongs to.
- A new channel can start from another channel's settings. Changing it never touches the original.
- The first channel keeps everything that existed before multi-channel support (videos, settings, YouTube login) and its music stays in `dados\musica`. Other channels use `dados\canais\<id>\musica` (Configurações do canal → Abrir).

## Shorts

Open a finished video → **Shorts** tab → choose how many → **Gerar shorts**. The local model picks the strongest stretches of consecutive scenes (18–52 s) that open with a surprising line and stop on a cliffhanger. Each short:

- is vertical 1080x1920: blurred background, the scene media cropped tall in the middle, a headline on top and big word-by-word captions;
- reuses the video's narration, scene media and music, so no new GPU images are needed;
- ends with a card "Watch the full video" with the video's thumbnail and title, an arrow to the description, and a narrated line in the channel's voice (Configurações do canal → Shorts);
- uploads only after the full video is on YouTube, with `▶ Watch the full video: https://youtu.be/…` at the top of the description and `#shorts` at the end;
- is scheduled one day after the full video (one short per day).

The YouTube API cannot set a short's **Related video** link (the clickable pill under shorts). Set it once per short in YouTube Studio → the short → Related video. Shorts can also be generated automatically when a video reaches the final review (Configurações do canal → Shorts).

## Media sources

| Source | Best for | Key | License |
|---|---|---|---|
| Pixabay | Modern stock videos and photos | Free | Pixabay Content License |
| Wikimedia Commons | Historical photos, paintings, maps | None | Public domain / CC0 (CC BY optional, credited) |
| NASA Image and Video Library | Space, rockets, Earth from orbit (video and photo) | None | NASA media, generally not copyrighted |
| The Met Open Access | Art, objects and history in public domain | None | CC0 |
| Internet Archive (Prelinger) | Vintage public-domain films (low resolution, archive look) | None | Public domain |
| Pexels | Stock videos and photos | Existing keys only | Pexels License |

Each channel picks its sources and their order (Configurações do canal → Imagens). Long archive and NASA clips are trimmed to a stretch from the middle of the file before use. Checked and left out: Art Institute of Chicago (image server blocks automated downloads), Library of Congress (bot protection), Openverse (5 anonymous requests per hour), Unsplash (requires hotlinking).

## Daily use

1. **Produção** → paste topics, one per line → **Adicionar** → **Gerar roteiros**. Scripts run right away (about 1 minute per 10 minutes of video).
2. **Revisão de roteiros** → read each script and its alerts. Red "Checar fato" alerts are claims the model may have invented: verify them. Edit, redo, or select several and click **Aprovar selecionados**.
3. Approved videos wait in the queue for the night window (default 01:00–07:00). Leave the PC on; the app keeps it awake while it works. To start now, use **Fila e Worker → Rodar agora**.
4. In the morning, a Windows notification lists the videos ready for final review. Open each one from **Produção**:
   - **Cenas**: swap a scene for another stock result, generate an AI image, or pick a file from your PC (this locks the scene). Then click **Re-renderizar**.
   - **Publicação**: pick one of the 3 thumbnails, edit title, description, tags and date, and check the synthetic content box.
   - **Aprovar e agendar**. The video gets the next free slot and uploads at night as private with `publishAt`, so YouTube publishes it at the slot.

Both approvals are mandatory. Nothing is ever published without the final approval.

## How the pipeline works

```
TOPIC_QUEUED → SCRIPT_GENERATING → SCRIPT_REVIEW (you)
→ PRODUCTION_QUEUED → AUDIO → SCENES → RENDERING → THUMBNAIL
→ FINAL_REVIEW (you) → SCHEDULED → PUBLISHED
ERROR at any step, with "Tentar de novo a partir desta etapa"
```

| Step | What it does | GPU |
|---|---|---|
| script | Ollama structured JSON, validated with Zod, plus a self-review with fact alerts | yes |
| audio | Kokoro per scene (cached by text), joined with pauses, compressed, loudnorm to -14 LUFS | yes* |
| transcribe | faster-whisper word timestamps (CUDA, CPU fallback) | yes |
| scenes | Stock video/photo from the channel's providers in order (Pixabay, Wikimedia Commons, Pexels), otherwise SDXL in ComfyUI, all images of a video in one batch | yes |
| render | Remotion in a separate process: Ken Burns, crossfades, word-by-word captions, music | yes |
| thumbnail | 3 options: headline from the LLM, background from AI image or video frames | yes |
| metadata | Final title (≤70 chars), description with chapters, 10–15 tags | yes |
| upload | YouTube `videos.insert` private + `publishAt`, then `thumbnails.set` | no |

\* Kokoro runs on the CPU; the step still takes the GPU lock because Whisper follows it.

Queue rules: one GPU job at a time; at most 2 non-GPU jobs in parallel; night jobs start only inside the window; up to 3 attempts with 1, 5 and 15 minute back-off; jobs interrupted by a crash or shutdown go back to the queue on the next start; every step skips work whose output already exists.

VRAM on 12 GB: Ollama runs with `keep_alive: 0`; before ComfyUI the app unloads Ollama and Whisper; after each image batch it calls ComfyUI `POST /free`.

## Configuration reference

All settings live on **Configurações** and are stored in the local SQLite database (`dados\canal.db`, table `settings`). Secrets: the YouTube refresh token is encrypted with Windows DPAPI (Electron `safeStorage`). The Pixabay and Pexels keys and the Google client secret are stored in the local database, never in the code.

Templates: three looks rotate between videos so the channel does not look identical every time:

- **documentary**: serif captions in a dark box at the bottom, warm grade.
- **bold**: heavy uppercase captions with outline, center-low, high contrast.
- **minimal**: clean sans-serif captions with shadow, light grade.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Servidor Python não instalado" | Serviços → Instalar on "Servidor Python". |
| Whisper says it fell back to CPU | The CUDA DLLs did not load. It still works, slower. Set Configurações → Legendas → Dispositivo to CPU to skip the attempt. |
| ComfyUI does not start | Check the folder in Configurações. Start `run_nvidia_gpu.bat` by hand to see its error. |
| "Nenhum banco de imagens ativo" in the logs | Add a Pixabay key or enable Wikimedia Commons in Configurações do canal. |
| Pixabay "Limite atingido" | The free API allows 100 searches per minute. The scene tries the next provider, then AI. Searches are cached for 24 h. |
| Pexels "Request API access" says key issuance is paused | Pexels stopped issuing new keys. Use Pixabay and Wikimedia Commons instead. |
| Wikimedia images look old | That is the archive: great for history topics. Put Pixabay first for modern topics. |
| Render fails with a timeout | Usually a very large stock clip. Swap the scene and re-render. |
| `spawn ffmpeg ENOENT` | FFmpeg is not on PATH. Reinstall with winget and restart the app. |
| Upload fails with `invalid_grant` | The OAuth token expired (testing mode). Reconnect on the Canal screen. |
| Upload fails with quota error | Daily quota used up. The upload retries; it succeeds after midnight Pacific time. |
| Thumbnail not set | The channel is not phone-verified. |
| The model invents facts | Expected with local LLMs. Always check the red "Checar fato" alerts before approving. |
| The PC slept during the night | The app blocks sleep only while a job runs. Check Windows power settings for hibernation, and enable "Iniciar com o Windows". |

Logs: **Fila e Worker → Logs** for the queue, and the **Tarefas e logs** tab of each video.

## YouTube policy on inauthentic and repetitive content

YouTube's monetization policy on **inauthentic content** (formerly "repetitious content") excludes channels that publish mass-produced or repetitive videos, such as content that looks made from a template with little variation, or that viewers can't tell apart. Read the current policy in the YouTube Partner Program rules before you monetize.

This app exists to **speed up** production, not to publish in bulk without review:

- Both human approvals are mandatory and cannot be turned off.
- Templates, Ken Burns directions, music and thumbnail layouts rotate between videos.
- Fact alerts force you to check claims before approving.
- Add your own value: pick topics carefully, rewrite hooks, check facts, and edit the script. A faceless channel built on unedited AI output risks demonetization.

YouTube also requires you to **disclose realistic altered or synthetic content**. The app sets `status.containsSyntheticMedia` on upload when "Conteúdo alterado ou sintético" is checked (default on, because the voice and images are AI-generated). Review this per video in YouTube Studio.

## Licenses

Check the license of every model and asset you use for commercial use.

| Component | License | Commercial use |
|---|---|---|
| Remotion | Remotion License | Free for individuals and companies with up to 3 employees; larger companies need a company license (remotion.dev/license) |
| Kokoro-82M | Apache 2.0 | Yes |
| faster-whisper / Whisper models | MIT | Yes |
| qwen3:14b | Apache 2.0 | Yes |
| gemma3:12b (alternative) | Gemma Terms of Use | Yes, with use restrictions |
| SDXL base 1.0 | CreativeML Open RAIL++-M | Yes, with use restrictions |
| Flux.1 Dev | Non-commercial license | **Not used** |
| Pixabay videos and photos | Pixabay Content License | Yes, no attribution required; do not sell unaltered copies or use them in a misleading way |
| Wikimedia Commons files | Public domain / CC0 (always), CC BY (optional) | Yes; CC BY files are credited automatically in the description. CC BY-SA, NC and ND are never used |
| Pexels videos and photos | Pexels License | Yes, no attribution required; do not sell unaltered copies |
| YouTube Audio Library | Per track | Check whether attribution is required |

## Development

```powershell
npm install
npm run dev            # app with hot reload
npm test               # unit tests (vitest)
npm run typecheck
npm run lint
npm run build:win      # installer in dist/
```

End-to-end scenarios drive the built app with Playwright. The window opens without taking focus.

```powershell
npm run build
node e2e/run.mjs phase1                      # 3 topics → 3 scripts → batch approval (real Ollama)
$env:CANAL_FAKE_STEPS='1'; node e2e/run.mjs phase2   # queue: night window, hard kill, recovery
node e2e/run.mjs phase3                      # audio + word timings
$env:E2E_MINUTES='8'; node e2e/run.mjs phase4        # full video
node e2e/run.mjs phase5                      # swap a scene, re-render, approve
```

Layout:

```
electron/   main process
  db/       SQLite schema, repositories, settings
  queue/    scheduler, GPU lock, night window, publish slots
  steps/    script, audio, transcribe, scenes, render, thumbnail, metadata, upload
  services/ Ollama, ComfyUI, Python sidecar, Pixabay, Wikimedia, Pexels, FFmpeg, Remotion, YouTube
src/        React UI
shared/     types shared by main, preload, UI and Remotion
remotion/   compositions (video, thumbnail) and render.ts worker
python/     FastAPI sidecar: Kokoro + faster-whisper
scripts/    check-setup.ps1
e2e/        Playwright scenarios
tests/      unit tests
dados/      local data, not in git
```

Every step implements `Step.run(videoId, ctx)` in `electron/steps/`, so one step can be replaced (for example, scripts through a paid API) without touching the rest.

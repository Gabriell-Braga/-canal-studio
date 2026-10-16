# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Canal Studio: Windows Electron app that produces faceless English YouTube documentaries locally (LLM script, Kokoro voice, faster-whisper captions, stock/Wikimedia/ComfyUI images, Remotion render, YouTube upload). UI text is Brazilian Portuguese; code, comments and video content are English. Full spec: `PROMPT_CANAL_STUDIO.md`; user docs: `README.md`.

## Commands

```powershell
npm run dev                  # app with hot reload
npm test                     # unit tests (vitest, tests/**/*.test.ts)
npx vitest run tests/slots.test.ts      # single file
npx vitest run -t "name of test"        # single test by name
npm run test:live            # network tests against real media APIs (tests-live/)
npm run typecheck            # node + web + remotion tsconfigs
npm run lint
npm run build                # typecheck + electron-vite build into out/
npm run deploy:desktop       # build, refresh desktop shortcut, restart running app on the new build
npm run build:win            # installer in dist/
npm run test:intro           # checks the channel intro fade (scripts/check-intro-fade.mjs)
npm run check-setup          # verifies local prerequisites (scripts/check-setup.ps1)
```

E2E (Playwright drives the built app from `out/`): `npm run test:e2e` builds and runs `phase1` only; `node e2e/run.mjs <scenario> [--keep-data]` runs one scenario against an existing build (names are the keys of `scenarios` in `e2e/scenarios.mjs`: phase1..phase6 plus feature scenarios such as `attachAd`, `oneScript`, `shorts`; `phase5` reuses a `phase4` data folder via `CANAL_DATA_DIR`). `E2E_EXE` runs the packaged exe instead of `out/`. The window opens without focus (`CANAL_E2E=1`) so it does not disturb the user's screen. `CANAL_FAKE_STEPS=1` replaces every step with a timed stub to exercise the queue without GPU work. `CANAL_DATA_DIR` points the app at a throwaway data folder (tests and E2E always use one; never touch the real `dados/`).

After any change, run `npm run deploy:desktop` so the desktop app picks it up, then commit and push.

## Architecture

Four TypeScript projects share `shared/` (types and pure logic used by main, preload, UI and Remotion):

- `electron/` — main process. `main/ipc.ts` exposes everything to the UI through `preload/`. `pipeline.ts` (`Pipeline` class) holds the user actions that move a video between statuses; IPC handlers and tests both call it.
- `src/` — React 19 + Tailwind UI, one page per screen in `src/pages/`, IPC wrapper in `src/lib/api.ts`, current channel context in `src/lib/channel.tsx`.
- `remotion/` — compositions (`Video`, `Short`, `Thumbnail`, `ChannelIntro`, `Overlays`) and `render.ts`, which runs as a separate Node process spawned by `electron/services/remotion.ts`.
- `python/server.py` — FastAPI sidecar (Kokoro TTS + faster-whisper), managed by `electron/services/python.ts`.

Video lifecycle: `TOPIC_QUEUED → SCRIPT_GENERATING → SCRIPT_REVIEW (human) → PRODUCTION_QUEUED → AUDIO → SCENES → RENDERING → THUMBNAIL → FINAL_REVIEW (human) → SCHEDULED → PUBLISHED`, with `ERROR` resumable from any step. Both human approvals are mandatory by design.

Queue (`electron/queue/`): SQLite-backed jobs. `scheduler.ts` runs one GPU job at a time plus up to 2 non-GPU jobs, gates night jobs by `window.ts`, retries 3 times with back-off, and requeues jobs interrupted by a crash. `slots.ts` picks publish times. Jobs with `args.keepStatus`/`args.exportDir` are side jobs that never change the video status.

Steps (`electron/steps/`): each implements `Step.run(videoId, ctx)` (see `types.ts`) and is registered in `steps/index.ts` with the status it sets. Steps must be idempotent: skip work whose output already exists in the project folder. Add a step by implementing `Step` and registering it; nothing else in the pipeline needs to change.

LLM (`electron/services/llm.ts`): `generateStructured(prompt, zodSchema, opts)` routes to Ollama, Claude via the user's Claude Code login, or the Anthropic API, depending on settings, and always returns Zod-validated data. For Claude, the system prompt is `.claude/skills/documentary-scriptwriter/SKILL.md`, so editing that skill changes production scripts.

Formats (`shared/formats/`): each channel picks a `FormatPack` (settings key `format`) holding script/title rules, 3 thumbnail models, overlays (each declares Zod fields merged into the script schema by `scriptSchemaFor`), topic source, media providers, voices, shorts and metadata rules. Steps read rules via `formatOf(settings.format)`; the render draws only overlays the format declares, through `remotion/formats/` (overlay components and thumbnail layouts per format). New format = one file in `shared/formats/` + its components in `remotion/formats/`.

Remotion assets (fonts) live in `remotion/public` (bundled via `publicDir`). Shorts have their own script/narration/media (`electron/steps/shortscript.ts`); `shorts.ts` only re-renders old cut-based shorts.

Settings (`electron/db/settings.ts`): per-channel settings plus shared settings (one GPU, one queue). Data folder resolution in `electron/main/paths.ts`: `CANAL_DATA_DIR`, then a pointer file in userData, then `dados/` in dev. Channel 1 keeps pre-multi-channel paths (`dados/musica`); other channels use `dados/canais/<id>/`.

Tests: `tests/helpers.ts` `freshDb()` opens a temp SQLite DB per test; use it instead of mocking the repo.

Ads on Trial (`vintage-ads`): every video needs a real ad (its evidence, `electron/steps/evidence.ts`, stored in state). Every loc.gov request goes through `locFetch` in `electron/services/locgate.ts` (official rate limits, 65-minute lockout on 429/403/challenge, never worked around). Suggested topics carry their ad; for hand-typed topics the script step runs `findVideoEvidence`: LLM search terms (shortest first), then layers loc.gov → Commons Chronicling America mirrors → Commons in the product's categories → Internet Archive, accepting only confirmed public domain dated ≤ 1930, ranking by tolerant OCR matching (`rankAds`) and logging every discard. With no ad the script is not written: the video stops in SCRIPT_REVIEW with an `attachAd` alert and the user attaches one by hand (Commons/Archive link or local image). Ads outside Chronicling America carry `AdPage.origin`, and the Paper Trail shows their source and link instead of a newspaper page.

Ads on Trial media and pacing: the scenes step hands off to `electron/steps/admedia.ts` (no AI images in this format; they could only be paper texture). It gathers 3–6 ads of the product (`gatherAds`), upscales scans to ≥ 900 px (`enhanceScan`, Real-ESRGAN in ComfyUI), checks every candidate photo by eye against its narration line (`visualCheck`, Claude reading the image), and `planShots` fills each scene's cadence (`shared/shots.ts`: ≤ 5 s per image in the first minute, ≤ 7 s after, each file ≤ 3 times, never an empty scene). The period announcer is planned by `planAnnouncer` (no segment before 60 s, max 3, ≥ 90 s apart, Claim Check scenes only, bridge line first) with real timings in the audio step, which writes `periods` to `audio/timings.json`. Before rendering, `shared/coverage.ts` fails any stretch over 2 s without media; after it, `review-report.ts` writes `<dataDir>/revisao/<id>/` (contact sheet + report shown in the final review).

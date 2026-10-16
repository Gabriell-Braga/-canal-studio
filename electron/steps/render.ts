import { createHash } from 'crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import {
  END_SCREEN_SEC,
  OPENING_CAPTIONS_SEC,
  type RenderScene,
  type TemplateId,
  type VideoProps
} from '../../shared/render'
import type { Scene, Video } from '../../shared/types'
import { getVideo, listScenes, updateVideo } from '../db/repo'
import { isAssetFile, isValidFile, masterAudio, probeDuration, probeSize } from '../services/ffmpeg'
import { remotionCodeHash, runRender } from '../services/remotion'
import { readWords } from './transcribe'
import { writeSrt } from '../services/captions'
import { channelIntroProps, renderCompanies, yearCardsFor } from './overlays'
import { readTimings } from './audio'
import { FinalError } from './types'
import { readScan } from '../services/adscan'
import { shotDurations } from '../../shared/shots'
import { scanRegions } from '../../shared/framing'
import { buildReport, mediaGaps, pacingAlerts } from '../../shared/coverage'
import type { ShotCategory, ShotFile, VisualSpec } from '../../shared/visuals'
import { writeReviewReport } from './review-report'
import { sceneFocus } from './focus'
import { musicTurn, planMusic, prepareMusic } from './music'
import { formatOf, hasOverlay } from '../../shared/formats'
import { adOverlays } from './adoverlays'
import { videoEvidence } from './evidence'
import type { Step, StepContext } from './types'

let musicFolderFor: (channelId: number) => string = () => ''
export function configureMusic(resolve: (channelId: number) => string): void {
  musicFolderFor = resolve
}

/** File path inside the project → URL template the render worker resolves. */
function url(projectDir: string, file: string): string {
  return `{{root}}/${relative(projectDir, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

/** Opening, dramatic and closing tracks, placed on the scenes of the script. */
async function musicFor(
  video: Video,
  scenes: Scene[],
  durationSec: number,
  ctx: StepContext
): Promise<Awaited<ReturnType<typeof prepareMusic>>> {
  const folder = musicFolderFor(video.channel_id)
  if (!folder || !existsSync(folder)) return []
  let turn = video.script?.music_turn
  if (video.script && turn === undefined) {
    try {
      turn = await musicTurn(video.script, video.topic, ctx)
      // Fresh copy: the company check may have changed the script since this step began.
      const script = getVideo(video.id).script ?? video.script
      updateVideo(video.id, { script: { ...script, music_turn: turn } })
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.log(
        `Sem ponto de virada da música (${(e as Error).message}); sem trilha dramática`,
        'warn'
      )
    }
  }
  const turnScene = turn ? scenes.find((s) => s.index === turn) : undefined
  const outro = video.script?.outro && scenes.length > 2 ? scenes[scenes.length - 1] : undefined
  const parts = planMusic(turnScene?.start_sec ?? null, outro?.start_sec ?? null, durationSec)
  ctx.log(
    `Música em ${parts.length} parte(s): ${parts.map((p) => `${p.mood} ${Math.round(p.from)}s`).join(', ')}${turn ? ` (virada na cena ${turn})` : ''}`
  )
  return prepareMusic(parts, folder, video.id, ctx)
}

/** An Ads on Trial shot file (scenes/shot_<hash>.json), or null for a picture or clip. */
export function readShotFile(path: string | null): ShotFile | null {
  if (!path?.endsWith('.json') || !isValidFile(path, 2)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ShotFile
  } catch {
    return null
  }
}

/** The spec with its pictures as render URLs. */
function visualUrls(spec: VisualSpec, toUrl: (file: string) => string): VisualSpec {
  if (spec.kind === 'evidence')
    return { ...spec, items: spec.items.map((i) => ({ ...i, src: toUrl(i.src) })) }
  if (spec.kind === 'timeline')
    return { ...spec, events: spec.events.map((e) => (e.src ? { ...e, src: toUrl(e.src) } : e)) }
  return spec
}

/** Distinct pictures in the video's media bank (scenes/bank.json), or undefined. */
function bankSize(projectDir: string): number | undefined {
  try {
    const bank = JSON.parse(readFileSync(join(projectDir, 'scenes', 'bank.json'), 'utf8')) as {
      items: unknown[]
    }
    return bank.items.length
  } catch {
    return undefined
  }
}

/** Width / height of a scan, so its highlight boxes land on the right words. */
async function aspectOf(file: string): Promise<number | undefined> {
  try {
    const { width, height } = await probeSize(file)
    return width / height
  } catch {
    return undefined
  }
}

export const renderStep: Step = {
  type: 'render',
  status: 'RENDERING',
  async run(videoId, ctx) {
    const video = getVideo(videoId)
    const pd = ctx.projectDir
    if (!isValidFile(video.audio_path)) throw new Error('Narração não encontrada; refaça o áudio')
    const scenes = listScenes(videoId)
    const missing = scenes.filter((s) => !isAssetFile(s.asset_path) || s.start_sec === null)
    if (missing.length)
      throw new FinalError(
        `${missing.length} cena(s) sem mídia ou tempo; refaça as cenas`,
        'scenes'
      )

    const pack = formatOf(ctx.settings.format)
    // Public-domain formats turn AI images into paper texture: on screen that is no media.
    const fillerAi = !!pack.maxMediaYear
    const timings = readTimings(pd)
    const periods =
      (timings as { periods?: { sceneId: number; start: number; end: number; quote?: string }[] })
        ?.periods ?? []
    const scanShots = new Map<string, number>()
    const media = async (
      path: string,
      type: Scene['asset_type'],
      motion: number,
      sec: number,
      source: string | null
    ): Promise<NonNullable<RenderScene['shots']>[number]> => {
      // Text cards, AI illustrations and the rest (real media), for the review's time split.
      const category: ShotCategory = source?.startsWith('card:')
        ? 'card'
        : source?.startsWith('ai:') || (fillerAi && type === 'ai_image')
          ? 'ai'
          : 'real'
      // Ads on Trial shot files: an animation, a parallax move or a detail of a picture.
      const shot = readShotFile(path)
      if (shot?.shot === 'visual')
        return {
          src: '',
          type: 'image',
          motion,
          sec,
          visual: visualUrls(shot.spec, (f) => url(pd, f)),
          category: 'animation'
        }
      if (shot)
        return {
          src: url(pd, shot.src),
          type: 'image',
          motion,
          sec,
          focus: await sceneFocus(shot.src, ctx),
          ...(shot.shot === 'parallax' ? { depth: url(pd, shot.depth) } : { crop: shot.crop }),
          category
        }
      const isVideo = type === 'stock_video' || type === 'ai_video'
      // Each new shot of a scan closes in on another part of it. Counted before any await,
      // so the order follows the scenes.
      const scan = readScan(path)
      const regions = scan ? scanRegions(scan.words ?? []) : []
      const nth = scanShots.get(path) ?? 0
      if (scan) scanShots.set(path, nth + 1)
      return {
        src: url(pd, path),
        type: isVideo ? 'video' : 'image',
        motion,
        sec,
        clipDuration: isVideo ? await probeDuration(path) : undefined,
        focus: isVideo ? undefined : await sceneFocus(path, ctx),
        ...(scan
          ? {
              scan: {
                highlights: [],
                aspect: await aspectOf(path),
                regions: regions.map((_, k) => regions[(nth + k) % regions.length])
              }
            }
          : {}),
        // Old paper-texture fillers count as no media; engraving illustrations (ai:) are real shots.
        ...(fillerAi && type === 'ai_image' && !source?.startsWith('ai:') ? { filler: true } : {}),
        category
      }
    }
    const renderScenes: RenderScene[] = await Promise.all(
      scenes.map(async (s, i) => {
        const start = s.start_sec as number
        const end = s.end_sec as number
        const images = [
          { path: s.asset_path as string, type: s.asset_type, source: s.asset_source },
          ...s.extra_assets.filter((x) => isAssetFile(x.path))
        ]
        // The scan stays up while the period announcer reads it, an animation for its own
        // length; the rest follows the cadence.
        const period = periods.find((p) => p.sceneId === s.id)
        const first = readShotFile(images[0].path)
        const hold = period
          ? Math.max(0, period.end - start + 0.3)
          : first?.shot === 'visual'
            ? first.sec
            : 0
        let secs = shotDurations(start, end, hold)
        if (images.length < secs.length) {
          const h = Math.min(hold, end - start)
          secs =
            h && images.length > 1
              ? [h, ...images.slice(1).map(() => (end - start - h) / (images.length - 1))]
              : images.map(() => (end - start) / images.length)
        }
        // A file shown again gets another motion, so the reuse reads as a new framing.
        const [main, ...shots] = await Promise.all(
          images
            .slice(0, secs.length)
            .map((x, k) => media(x.path, x.type, (i * 7 + videoId + k * 3) % 4, secs[k], x.source))
        )
        return { ...main, start, end, shots }
      })
    )
    const words = readWords(pd)
    // Long videos get real YouTube subtitles from this file; burned-in captions are optional.
    writeSrt(words, join(pd, 'captions.srt'))
    // The render draws only the overlays the channel's format declares.
    const companies = await renderCompanies(video, ctx)
    const yearCards = hasOverlay(pack, 'yearCard') ? yearCardsFor(scenes, pd) : []
    // Ads on Trial: price tags, stamps, provenance, label and verdict, plus highlights on scans.
    const ads = hasOverlay(pack, 'claimCheck')
      ? adOverlays(video.script, scenes, !!videoEvidence(videoId))
      : null
    if (ads) {
      scenes.forEach((sc, i) => {
        const scan = ads.scans.get(sc.index)
        if (scan && renderScenes[i].scan)
          renderScenes[i] = { ...renderScenes[i], scan: { ...renderScenes[i].scan, ...scan } }
      })
      ctx.log(
        `Sobreposições: ${ads.overlays.priceTags.length} etiqueta(s) de preço, ${ads.overlays.claims.length} carimbo(s), ${ads.scans.size} scan(s)`
      )
    }
    if (companies.length || yearCards.length)
      ctx.log(
        `Sobreposições: ${companies.map((c) => `${c.name}${c.logo ? '' : ' (sem logo)'}`).join(', ') || 'sem empresas'}; ${yearCards.length} cartão(ões) de ano`
      )
    const firstScene = scenes[0]
    const introSec = companies.length
      ? Math.min(3, Math.max(0, (firstScene.end_sec ?? 3) - (firstScene.start_sec ?? 0) - 0.5))
      : 0
    const channelIntro = timings?.intro
      ? { ...channelIntroProps(video.channel_id, ctx.settings, pd), ...timings.intro }
      : undefined
    if (channelIntro && scenes[1]?.start_sec != null) {
      // Hold the intro until the year card (or the next scene) is fully over it, so the
      // hook's image never flashes between them. The card fades in over 0.3 s, the intro
      // fades out over its last 0.4 s, underneath.
      const card = yearCards.find((c) => c.at === scenes[1].start_sec)
      const until = card ? card.at - card.duration + 0.7 : scenes[1].start_sec + 0.4
      channelIntro.duration = Math.max(channelIntro.duration, until - channelIntro.start)
    }
    const hookEnd = firstScene.end_sec ?? 0
    // Ads on Trial opens on the scan and its highlighted promise: no title card over it.
    const teaserText = ads ? '' : video.script?.teaser?.trim()
    const narrationSec = await probeDuration(video.audio_path as string)
    const durationSec = narrationSec + 0.5 + END_SCREEN_SEC
    const music = await musicFor(video, scenes, durationSec, ctx)
    if (!music.length) ctx.log('Sem música na pasta do canal; vídeo sairá só com narração', 'warn')
    const props: VideoProps = {
      fps: 30,
      // Black screen with only the music at the end, where YouTube shows the end screen.
      durationSec,
      endScreenAt: narrationSec + 0.5,
      narration: url(pd, video.audio_path as string),
      scenes: renderScenes,
      words,
      captions: ctx.settings.captionsEnabled,
      openingCaptionsSec: OPENING_CAPTIONS_SEC,
      music: await Promise.all(
        music.map(async (m) => ({
          src: url(pd, m.file),
          from: m.part.from,
          to: m.part.to,
          duration: await probeDuration(m.file)
        }))
      ),
      musicVolume: ctx.settings.musicVolume,
      template: (video.template as TemplateId) ?? 'documentary',
      format: pack.id,
      overlays: ads ? { ads: ads.overlays } : undefined,
      companies,
      yearCards,
      introSec,
      teaser: teaserText
        ? { text: teaserText, end: Math.max(0, (channelIntro?.start ?? hookEnd) - 0.2) }
        : undefined,
      channelIntro,
      duck: timings?.periods?.map(({ start, end }) => ({ start, end }))
    }

    // Never an empty screen: any stretch over 2 s without real media stops the render.
    const gaps = mediaGaps(props.scenes, narrationSec)
    if (gaps.length) {
      const at = (t: number): string =>
        `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
      throw new FinalError(
        `Trechos sem mídia: ${gaps.map((g) => `${at(g.from)}–${at(g.to)}`).join(', ')}. Refaça as cenas.`,
        'scenes'
      )
    }
    // Ads on Trial: repeats past 3 uses, stills past the cadence and the time split (real
    // media, animations, AI, cards) stop the render too.
    const mix = fillerAi ? { bank: bankSize(pd) } : undefined
    if (mix) {
      const pacing = pacingAlerts(buildReport(props.scenes, narrationSec, periods, [], mix).alerts)
      if (pacing.length)
        throw new FinalError(
          `Ritmo fora da regra (${pacing.length}): ${pacing.slice(0, 3).join('; ')}${pacing.length > 3 ? '…' : ''}. Refaça as cenas.`,
          'scenes'
        )
    }
    const report = async (): Promise<void> => {
      try {
        const r = await writeReviewReport(videoId, pd, props, periods, ctx.signal, mix)
        if (r.alerts.length) ctx.log(`Relatório de revisão: ${r.alerts.length} alerta(s)`, 'warn')
      } catch (error) {
        if (ctx.signal.aborted) throw error
        ctx.log(`Relatório de revisão falhou: ${(error as Error).message}`, 'warn')
      }
    }

    // Skip when the same inputs already produced a valid video.
    const out = join(pd, 'video.mp4')
    // The drawing code counts too, so a fix in remotion/ renders the video again.
    const hash = createHash('sha1')
      .update(JSON.stringify(props))
      .update(remotionCodeHash())
      .digest('hex')
    const hashFile = join(pd, 'render.hash')
    if (
      isValidFile(out, 100_000) &&
      existsSync(hashFile) &&
      readFileSync(hashFile, 'utf8') === hash
    ) {
      ctx.log('Vídeo já renderizado com as mesmas entradas; pulando')
      updateVideo(videoId, { video_path: out })
      await report()
      return
    }

    const tmp = join(pd, 'video.rendering.mp4')
    rmSync(tmp, { force: true })
    ctx.log(
      `Render: ${scenes.length} cenas, template ${props.template}, ${(props.durationSec / 60).toFixed(1)} min`
    )
    const started = Date.now()
    await runRender(
      { mode: 'video', root: pd, out: tmp, video: props },
      join(pd, 'render-job.json'),
      { progress: ctx.progress, log: (m) => ctx.log(m), signal: ctx.signal }
    )
    // Music + narration can peak above the narration alone: -14 LUFS, never over -1 dBTP.
    const level = await masterAudio(tmp, ctx.signal)
    ctx.log(`Áudio final: ${level.input_i} LUFS, pico ${level.input_tp} dBTP antes do limitador`)
    rmSync(out, { force: true })
    renameSync(tmp, out)
    writeFileSync(hashFile, hash)
    updateVideo(videoId, { video_path: out })
    await report()
    ctx.log(`Render concluído em ${Math.round((Date.now() - started) / 60000)} min`)
  }
}

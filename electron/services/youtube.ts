import { safeStorage, shell } from 'electron'
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'
import { youtube, type youtube_v3 } from '@googleapis/youtube'
import { youtubeAnalytics } from '@googleapis/youtubeanalytics'
import { OAuth2Client } from 'google-auth-library'
import type { ChannelStats, StudioImportResult } from '../../shared/types'
import { db, now } from '../db'
import { listVideos, manualMetrics, setManualMetrics, updateChannel } from '../db/repo'
import { anchored, lastDay, stillWatchingAt, viewsAtAge } from '../../shared/performance'
import { matchStudioRows, parseStudioCsv } from '../../shared/studio-csv'
import { getSettings, setSettings } from '../db/settings'
import { brandColorsFromImage } from './brand'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  // Needed by captions.insert (subtitle upload).
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
]

/** Default daily quota of a Google Cloud project, and the cost of each call we make. */
export const QUOTA_LIMIT = 10_000
export const COST = {
  insert: 1600,
  thumbnail: 50,
  list: 1,
  captions: 400,
  delete: 50,
  playlist: 50
}

// ---------------------------------------------------------------- secrets (safeStorage)

function saveSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia do Windows indisponível')
  db()
    .prepare(
      'INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, safeStorage.encryptString(value))
}

function readSecret(key: string): string | null {
  const row = db().prepare('SELECT value FROM secrets WHERE key = ?').get(key) as
    { value: Buffer } | undefined
  if (!row) return null
  try {
    return safeStorage.decryptString(row.value)
  } catch {
    return null
  }
}

function deleteSecret(key: string): void {
  db().prepare('DELETE FROM secrets WHERE key = ?').run(key)
}

// ---------------------------------------------------------------- quota

/** YouTube quota resets at midnight Pacific time. */
function quotaDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

export function addQuota(units: number): void {
  db()
    .prepare(
      'INSERT INTO quota (day, units) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units = units + excluded.units'
    )
    .run(quotaDay(), units)
}

export function quotaUsed(): number {
  const row = db().prepare('SELECT units FROM quota WHERE day = ?').get(quotaDay()) as
    { units: number } | undefined
  return row?.units ?? 0
}

// ---------------------------------------------------------------- auth

function client(redirectUri?: string): OAuth2Client {
  const s = getSettings()
  if (!s.googleClientId || !s.googleClientSecret) {
    throw new Error('Configure o Client ID e o Client secret do Google em Configurações')
  }
  return new OAuth2Client({
    clientId: s.googleClientId,
    clientSecret: s.googleClientSecret,
    redirectUri
  })
}

const tokenKey = (channelId: number): string => `youtube.refresh_token.${channelId}`

export function isConnected(channelId: number): boolean {
  return readSecret(tokenKey(channelId)) !== null
}

/** OAuth with a loopback redirect: open the browser, catch the code on 127.0.0.1. */
/** Each Canal Studio channel connects its own YouTube channel (Google account or brand account). */
export async function connect(channelId: number): Promise<string> {
  const server = createServer()
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  const redirect = `http://127.0.0.1:${port}`
  const oauth = client(redirect)
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Tempo esgotado esperando o login do Google')),
      5 * 60_000
    )
    server.on('request', (req, res) => {
      const params = new URL(req.url ?? '/', redirect).searchParams
      const error = params.get('error')
      const value = params.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:sans-serif;padding:40px"><h2>${
          value ? 'Canal Studio conectado ao YouTube.' : `Erro: ${error ?? 'sem código'}`
        }</h2><p>Pode fechar esta aba.</p></body></html>`
      )
      clearTimeout(timer)
      if (value) resolve(value)
      else reject(new Error(`Login recusado: ${error ?? 'sem código'}`))
    })
    shell.openExternal(url)
  }).finally(() => server.close())

  const { tokens } = await oauth.getToken(code)
  if (!tokens.refresh_token)
    throw new Error(
      'O Google não devolveu refresh token; remova o acesso do app na sua conta e tente de novo'
    )
  saveSecret(tokenKey(channelId), tokens.refresh_token)
  db()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(`state.ch.${channelId}.youtubeScopes`, JSON.stringify(tokens.scope ?? ''))
  oauth.setCredentials(tokens)
  return syncChannelIdentity(channelId, oauth)
}

let channelDirFor: (channelId: number) => string = () => ''

export function configureYoutube(opts: { channelDir: (channelId: number) => string }): void {
  channelDirFor = opts.channelDir
}

/**
 * Copy the YouTube channel's name and picture into the Canal Studio channel, so the
 * picker and sidebar show the real channel. Runs on connect and on every stats refresh.
 */
export async function syncChannelIdentity(channelId: number, auth?: OAuth2Client): Promise<string> {
  const yt = youtube({ version: 'v3', auth: auth ?? authed(channelId) })
  const me = await yt.channels.list({ part: ['snippet'], mine: true })
  addQuota(COST.list)
  const snippet = me.data.items?.[0]?.snippet
  if (!snippet) throw new Error('Esta conta Google não tem canal no YouTube')
  const title = snippet.title ?? 'Canal'
  db()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(`state.ch.${channelId}.youtubeChannel`, JSON.stringify(title))

  let avatar: string | undefined
  const thumbs = snippet.thumbnails
  const url = thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url
  const dir = channelDirFor(channelId)
  if (url && dir) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        mkdirSync(dir, { recursive: true })
        avatar = join(dir, `avatar-${Date.now()}.jpg`)
        writeFileSync(avatar, Buffer.from(await res.arrayBuffer()))
        // Keep only the newest picture.
        for (const f of readdirSync(dir)) {
          if (f.startsWith('avatar-') && join(dir, f) !== avatar)
            rmSync(join(dir, f), { force: true })
        }
      }
    } catch {
      // Without the picture the colored initials stay.
    }
  }
  updateChannel(channelId, { name: title, ...(avatar ? { avatar_path: avatar } : {}) })
  // Follow the channel picture's colors unless the user picked their own.
  if (avatar && getSettings(channelId).brandAuto) {
    const colors = brandColorsFromImage(avatar)
    if (colors)
      setSettings({ brandPrimary: colors.primary, brandSecondary: colors.secondary }, channelId)
  }
  return title
}

export function disconnect(channelId: number): void {
  deleteSecret(tokenKey(channelId))
  updateChannel(channelId, { avatar_path: null })
}

function authed(channelId: number): OAuth2Client {
  const refresh = readSecret(tokenKey(channelId))
  if (!refresh) throw new Error('YouTube não conectado. Conecte na tela Canal.')
  const oauth = client()
  oauth.setCredentials({ refresh_token: refresh })
  return oauth
}

// ---------------------------------------------------------------- upload

export interface UploadInput {
  channelId: number
  file: string
  thumbnail: string | null
  title: string
  description: string
  tags: string[]
  publishAt: string
  synthetic: boolean
  /** YouTube category of the channel format (27 Education) */
  categoryId?: string
}

/** videos.insert as private with publishAt, so YouTube publishes it by itself. */
export async function uploadVideo(
  input: UploadInput,
  onProgress: (p: number) => void
): Promise<string> {
  if (quotaUsed() + COST.insert + COST.thumbnail > QUOTA_LIMIT) {
    throw new Error('Cota diária da API do YouTube esgotada; o upload fica para amanhã')
  }
  const yt = youtube({ version: 'v3', auth: authed(input.channelId) })
  const size = statSync(input.file).size
  const requestBody: youtube_v3.Schema$Video = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 5000),
      tags: input.tags,
      categoryId: input.categoryId ?? '27', // Education
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en'
    },
    status: {
      privacyStatus: 'private',
      publishAt: input.publishAt,
      selfDeclaredMadeForKids: false,
      // Altered or synthetic content disclosure (status.containsSyntheticMedia, Data API v3).
      containsSyntheticMedia: input.synthetic
    }
  }
  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      notifySubscribers: true,
      requestBody,
      media: { body: createReadStream(input.file) }
    },
    { onUploadProgress: (e: { bytesRead: number }) => onProgress(Math.min(1, e.bytesRead / size)) }
  )
  addQuota(COST.insert)
  const id = res.data.id
  if (!id) throw new Error('YouTube não devolveu o ID do vídeo')
  return id
}

/**
 * Put a video in the playlist of its series, creating the playlist (public) the first time.
 * Playlist ids are kept per channel so a rename on YouTube does not create a duplicate.
 */
export async function addToSeries(
  channelId: number,
  series: string,
  videoId: string
): Promise<void> {
  const key = `state.ch.${channelId}.playlists`
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  const ids = row ? (JSON.parse(row.value) as Record<string, string>) : {}
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  let playlistId = ids[series]
  if (!playlistId) {
    const res = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: { snippet: { title: series }, status: { privacyStatus: 'public' } }
    })
    addQuota(COST.playlist)
    playlistId = res.data.id ?? ''
    if (!playlistId) throw new Error('YouTube não devolveu o ID da playlist')
    ids[series] = playlistId
    db()
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, JSON.stringify(ids))
  }
  await yt.playlistItems.insert({
    part: ['snippet'],
    requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }
  })
  addQuota(COST.playlist)
}

/** Privacy of an uploaded video ('private', 'unlisted', 'public'), or null when it is gone. */
export async function youtubePrivacy(channelId: number, videoId: string): Promise<string | null> {
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  const res = await yt.videos.list({ part: ['status'], id: [videoId] })
  addQuota(COST.list)
  return res.data.items?.[0]?.status?.privacyStatus ?? null
}

export async function deleteYoutubeVideo(channelId: number, videoId: string): Promise<void> {
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  await yt.videos.delete({ id: videoId })
  addQuota(COST.delete)
}

export async function setThumbnail(
  channelId: number,
  videoId: string,
  jpeg: string
): Promise<void> {
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  await yt.thumbnails.set({
    videoId,
    media: { mimeType: 'image/jpeg', body: createReadStream(jpeg) }
  })
  addQuota(COST.thumbnail)
}

/** Channels connected before subtitles existed lack the scope and must reconnect once. */
export function canUploadCaptions(channelId: number): boolean {
  return (channelState(channelId, 'youtubeScopes') ?? '').includes('youtube.force-ssl')
}

/** Upload an English SubRip track; YouTube shows it as the video's own captions. */
export async function uploadCaptions(
  channelId: number,
  videoId: string,
  srtFile: string
): Promise<void> {
  if (quotaUsed() + COST.captions > QUOTA_LIMIT)
    throw new Error('Cota diária esgotada para legendas')
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  await yt.captions.insert({
    part: ['snippet'],
    requestBody: { snippet: { videoId, language: 'en', name: 'English', isDraft: false } },
    media: { mimeType: 'application/octet-stream', body: createReadStream(srtFile) }
  })
  addQuota(COST.captions)
}

// ---------------------------------------------------------------- analytics

/**
 * Live counters from the Data API (1 quota unit per 50 videos), kept as snapshots so
 * videos can be compared at the same age. Analytics only has whole days, 2–3 days late.
 */
const DAY_MS = 86_400_000

export async function refreshLive(channelId: number): Promise<void> {
  const videos = listVideos(channelId).filter((x) => x.youtube_id)
  if (!videos.length) return
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  const byYoutubeId = new Map(videos.map((v) => [v.youtube_id as string, v.id]))
  const insert = db().prepare(
    'INSERT INTO snapshots (video_id, at, views, likes, comments, privacy) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const at = now()
  const last = new Map(
    (
      db().prepare('SELECT video_id, MAX(at) AS at FROM snapshots GROUP BY video_id').all() as {
        video_id: number
        at: string
      }[]
    ).map((r) => [r.video_id, Date.parse(r.at)])
  )
  // Hourly while a video is in its first week, daily after that: the curve only matters early on.
  const due = (id: number): boolean => {
    const v = videos.find((x) => x.id === id)
    const release = Date.parse(v?.scheduled_at ?? v?.created_at ?? at)
    const prev = last.get(id) ?? 0
    return Date.now() - release < 8 * DAY_MS || Date.now() - prev > DAY_MS - 3600_000
  }
  for (let i = 0; i < videos.length; i += 50) {
    const ids = videos.slice(i, i + 50).map((v) => v.youtube_id as string)
    const res = await yt.videos.list({ part: ['statistics', 'status'], id: ids, maxResults: 50 })
    addQuota(COST.list)
    for (const item of res.data.items ?? []) {
      const id = byYoutubeId.get(item.id ?? '')
      const st = item.statistics
      if (!id || !st || !due(id)) continue
      insert.run(
        id,
        at,
        Number(st.viewCount ?? 0),
        Number(st.likeCount ?? 0),
        Number(st.commentCount ?? 0),
        item.status?.privacyStatus ?? null
      )
    }
  }
  setChannelState(channelId, 'liveUpdatedAt', at)
}

function setChannelState(channelId: number, key: string, value: string): void {
  db()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(`state.ch.${channelId}.${key}`, JSON.stringify(value))
}

export async function refreshStats(channelId: number): Promise<void> {
  await refreshLive(channelId)
  const oauth = authed(channelId)
  await syncChannelIdentity(channelId, oauth).catch(() => undefined)
  const analytics = youtubeAnalytics({ version: 'v2', auth: oauth })
  const today = new Date().toISOString().slice(0, 10)
  const save = db().prepare(
    'INSERT INTO analytics (video_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  )
  const published = listVideos(channelId).filter((x) => x.youtube_id)
  const durations = await videoDurations(
    channelId,
    published.map((v) => v.youtube_id as string)
  )
  for (const v of published) {
    const start = (v.scheduled_at ?? v.created_at).slice(0, 10)
    const res = await analytics.reports.query({
      ids: 'channel==MINE',
      startDate: start > today ? today : start,
      endDate: today,
      metrics: 'views,estimatedMinutesWatched,subscribersGained,averageViewPercentage',
      dimensions: 'day',
      sort: 'day',
      filters: `video==${v.youtube_id}`
    })
    // One row per day: [date, views, minutes, subscribers, % watched]. Totals are their sums.
    const rows = (res.data.rows ?? []).map((r) => r.map((x, i) => (i ? Number(x) : x)))
    const sum = (i: number): number => rows.reduce((t, r) => t + (r[i] as number), 0)
    const views = sum(1)
    save.run(
      v.id,
      JSON.stringify({
        views,
        watchMinutes: sum(2),
        avgViewDurationSec: views ? (sum(2) * 60) / views : 0,
        subscribersGained: sum(3),
        // Share of the video watched on average, weighted by each day's views.
        avgViewPercentage: views
          ? rows.reduce((t, r) => t + (r[1] as number) * (r[4] as number), 0) / views
          : 0,
        daily: rows.map((r) => [r[0], r[1]]),
        durationSec: durations.get(v.youtube_id as string) ?? null,
        ...(await retentionAndTraffic(
          analytics,
          v.youtube_id as string,
          start > today ? today : start,
          today
        ))
      }),
      now()
    )
  }
  setChannelState(channelId, 'statsUpdatedAt', now())
}

/** ISO 8601 duration (PT1H2M3S) in seconds. */
function isoSeconds(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '')
  if (!m) return null
  const [d, h, min, sec] = m.slice(1).map((x) => Number(x ?? 0))
  return d * 86400 + h * 3600 + min * 60 + sec
}

async function videoDurations(channelId: number, ids: string[]): Promise<Map<string, number>> {
  const yt = youtube({ version: 'v3', auth: authed(channelId) })
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 50) {
    const res = await yt.videos.list({ part: ['contentDetails'], id: ids.slice(i, i + 50) })
    addQuota(COST.list)
    for (const item of res.data.items ?? []) {
      const sec = isoSeconds(item.contentDetails?.duration)
      if (item.id && sec) out.set(item.id, sec)
    }
  }
  return out
}

/**
 * Retention curve and traffic sources of one video. Each part is empty when Analytics has
 * no data yet (new videos, too few views) instead of failing the whole refresh.
 */
async function retentionAndTraffic(
  analytics: ReturnType<typeof youtubeAnalytics>,
  youtubeId: string,
  startDate: string,
  endDate: string
): Promise<{ retention: [number, number, number][]; traffic: [string, number][] }> {
  const base = { ids: 'channel==MINE', startDate, endDate, filters: `video==${youtubeId}` }
  const retention = await analytics.reports
    .query({
      ...base,
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      dimensions: 'elapsedVideoTimeRatio',
      sort: 'elapsedVideoTimeRatio'
    })
    .then((r) => (r.data.rows ?? []).map((row) => row.map(Number) as [number, number, number]))
    .catch(() => [])
  const traffic = await analytics.reports
    .query({ ...base, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' })
    .then((r) =>
      (r.data.rows ?? []).map((row) => [String(row[0]), Number(row[1])] as [string, number])
    )
    .catch(() => [])
  return { retention, traffic }
}

function channelState(channelId: number, key: string): string | null {
  const row = db()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`state.ch.${channelId}.${key}`) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as string) : null
}

export function youtubeChannelTitle(channelId: number): string | null {
  return isConnected(channelId) ? channelState(channelId, 'youtubeChannel') : null
}

export function readStats(channelId: number): ChannelStats {
  const rows = db().prepare('SELECT video_id, data FROM analytics').all() as {
    video_id: number
    data: string
  }[]
  const byId = new Map(rows.map((r) => [r.video_id, JSON.parse(r.data)]))
  const snapRows = db()
    .prepare(
      'SELECT video_id, at, views, likes, comments, privacy FROM snapshots WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?) ORDER BY at'
    )
    .all(channelId) as {
    video_id: number
    at: string
    views: number
    likes: number
    comments: number
    privacy: string | null
  }[]
  const snaps = new Map<number, (typeof snapRows)[number][]>()
  for (const r of snapRows) {
    const list = snaps.get(r.video_id) ?? []
    list.push(r)
    snaps.set(r.video_id, list)
  }
  const manual = manualMetrics(channelId)
  const state = (key: string): string | null => channelState(channelId, key)
  return {
    connected: isConnected(channelId),
    channelTitle: state('youtubeChannel') ?? undefined,
    quotaUsedToday: quotaUsed(),
    quotaLimit: QUOTA_LIMIT,
    updatedAt: state('statsUpdatedAt'),
    liveUpdatedAt: state('liveUpdatedAt'),
    videos: listVideos(channelId)
      .filter((v) => v.youtube_id)
      .map((v) => {
        const a = byId.get(v.id) ?? {}
        return {
          video_id: v.id,
          youtube_id: v.youtube_id as string,
          title: v.title ?? v.topic,
          views: 0,
          watchMinutes: 0,
          avgViewDurationSec: 0,
          subscribersGained: 0,
          avgViewPercentage: 0,
          daily: [],
          retention: [],
          traffic: [],
          durationSec: null,
          ...a,
          retention30: stillWatchingAt(a.retention ?? [], a.durationSec),
          privacy: snaps.get(v.id)?.at(-1)?.privacy ?? null,
          snapshots: (snaps.get(v.id) ?? []).map(({ at, views, likes, comments }) => ({
            at,
            views,
            likes,
            comments
          })),
          // Impressions CTR is only shown in YouTube Studio; the public Analytics API does not expose it.
          impressionsCtr: manual.get(v.id)?.ctr ?? null,
          impressions: manual.get(v.id)?.impressions ?? null
        }
      })
  }
}

/** Store CTR/impressions from a YouTube Studio "Table data.csv" export. */
export function importStudioCsv(channelId: number, text: string): StudioImportResult {
  const { matched, unmatched } = matchStudioRows(parseStudioCsv(text), listVideos(channelId))
  for (const { videoId, row } of matched) {
    setManualMetrics(videoId, {
      ...(row.ctr !== null ? { ctr: row.ctr } : {}),
      ...(row.impressions !== null ? { impressions: row.impressions } : {})
    })
  }
  return {
    matched: matched.length,
    unmatched: unmatched.map((r) => r.title ?? r.youtubeId ?? '?')
  }
}

export interface VideoPerf {
  title: string
  views: number
  ctr: number | null
  retention30: number | null
  avgViewPct: number | null
}

/**
 * Top and bottom `n` long videos of the channel, ranked by views at 7 days so older videos
 * do not win on age alone. Videos younger than 7 days are left out.
 */
export function bestAndWorst(channelId: number, n = 3): { best: VideoPerf[]; worst: VideoPerf[] } {
  const stats = readStats(channelId)
  const end = lastDay(stats.videos.map((s) => s.daily))
  const videos = new Map(listVideos(channelId).map((v) => [v.id, v]))
  const ranked = stats.videos
    .flatMap((s) => {
      const v = videos.get(s.video_id)
      if (!v || v.kind !== 'long') return []
      const release = v.scheduled_at ?? v.created_at
      const week = viewsAtAge(anchored(s.snapshots, s.daily, end), s.daily, release, 168, end)
      if (week === null) return []
      const perf: VideoPerf = {
        title: s.title,
        views: s.snapshots.at(-1)?.views ?? s.views,
        ctr: s.impressionsCtr,
        retention30: s.retention30,
        avgViewPct: s.avgViewPercentage || null
      }
      return [{ week, perf }]
    })
    .sort((a, b) => b.week - a.week)
    .map((r) => r.perf)
  return { best: ranked.slice(0, n), worst: ranked.slice(n).slice(-n).reverse() }
}

/** Short English block for LLM prompts about what works on this channel; '' without data. */
export function perfPromptBlock(channelId: number): string {
  const { best, worst } = bestAndWorst(channelId)
  if (!best.length) return ''
  const line = (p: VideoPerf): string => {
    const parts = [`${p.views} views`]
    if (p.ctr !== null) parts.push(`CTR ${p.ctr.toFixed(1)}%`)
    if (p.retention30 !== null) parts.push(`${Math.round(p.retention30)}% still watching at 0:30`)
    if (p.avgViewPct !== null) parts.push(`${Math.round(p.avgViewPct)}% average viewed`)
    return `- "${p.title}" (${parts.join(', ')})`
  }
  return [
    'Best performing videos on this channel (views at 7 days):',
    ...best.map(line),
    ...(worst.length ? ['Worst:', ...worst.map(line)] : []),
    'Lean toward what the best ones share; avoid what the worst ones share.'
  ].join('\n')
}

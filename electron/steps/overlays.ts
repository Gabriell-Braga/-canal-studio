import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, extname, join, relative } from 'path'
import { z } from 'zod'
import {
  YEAR_CARD_SEC,
  plausibleValue,
  yearChanges,
  type ChannelIntroProps,
  type RenderCompany,
  type YearCard
} from '../../shared/render'
import type { PublishSlot, Scene, ScriptCompany, Settings, Video } from '../../shared/types'
import { edgeColor } from '../services/brand'
import { getChannel, updateVideo } from '../db/repo'
import { generateStructured } from '../services/llm'
import { fetchLogos } from '../services/logos'
import { readTimings } from './audio'
import { polishSettings } from './polish'
import type { StepContext } from './types'

/**
 * The channel's intro card. The channel picture is copied next to the files the render
 * reads (its file server only sees that folder).
 */
export function channelIntroProps(channelId: number, s: Settings, root: string): ChannelIntroProps {
  const channel = getChannel(channelId)
  let avatar: string | null = null
  if (channel.avatar_path && existsSync(channel.avatar_path)) {
    const copy = join(root, 'intro', `avatar${extname(channel.avatar_path)}`)
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(channel.avatar_path, copy)
    avatar = url(root, copy)
  }
  return {
    name: channel.name,
    avatar,
    background: channel.avatar_path ? edgeColor(channel.avatar_path) : null,
    schedule: scheduleLabel(s.publishSlots, s.publishTimezone),
    tagline: s.introTagline.trim(),
    primary: s.brandPrimary,
    secondary: s.brandSecondary,
    font: s.brandFont
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "New video every day · 2 PM ET", "New videos Mon · Wed · Fri · 2 PM ET". */
export function scheduleLabel(slots: PublishSlot[], timezone: string): string {
  const days = [...new Set(slots.map((s) => s.weekday))].sort((a, b) => a - b)
  if (!days.length) return ''
  let when: string
  if (days.length === 7) when = 'New video every day'
  else if (days.join() === '1,2,3,4,5') when = 'New videos every weekday'
  else if (days.length === 1) when = `New video every ${DAY_NAMES[days[0]]}`
  else when = `New videos ${days.map((d) => DAY_NAMES[d]).join(' · ')}`
  const times = [...new Set(slots.map((s) => s.time))]
  if (times.length !== 1) return when
  const [h, m] = times[0].split(':').map(Number)
  const clock = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  return `${when} · ${clock}${zone ? ` ${zone}` : ''}`
}

function url(root: string, file: string): string {
  return `{{root}}/${relative(root, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

const companiesSchema = z.object({
  companies: z
    .array(
      z.object({
        name: z.string().min(1),
        wikipedia_title: z.string(),
        values: z.array(z.object({ year: z.number().int(), usd: z.number().nullable() }))
      })
    )
    .max(2)
})

/**
 * Companies and their value at every year the video shows, checked once by Claude: the
 * script writer often lists the wrong company, too few years or invented figures.
 * Values that no company could have had that year are dropped, so the badge hides instead.
 */
async function companiesOf(video: Video, ctx: StepContext): Promise<ScriptCompany[]> {
  const script = video.script
  if (!script) return []
  if (script.companiesChecked) return script.companies ?? []
  const years = [...new Set(script.scenes.map((s) => s.year).filter((y): y is number => !!y))]
  years.sort((a, b) => a - b)
  let companies: ScriptCompany[]
  try {
    const found = await generateStructured(
      `A YouTube documentary: "${video.title ?? video.topic}" (topic: "${video.topic}").
Opening: "${script.hook}"
Years the video shows: ${years.join(', ') || 'none'}
${
  script.companies?.length
    ? `The writer listed: ${script.companies.map((c) => c.name).join(', ')} (may be wrong).
`
    : ''
}
List the companies the video is about, at most 2, main one first. Companies named in the title come first and must be included (a title "X vs Y" or "X ... Y" lists X and Y). Empty list when it is not about companies.
For each: name (short, as people say it), wikipedia_title (exact English Wikipedia article title, e.g. "Apple Inc."), and values: one entry for EVERY year listed above, with usd = the company's market capitalization in US dollars at the end of that year (plain number, e.g. 2500000000), or, when it was private or not traded, its valuation that year (funding round, IPO or acquisition price, or a parent's purchase price). Use the historical figure for that year, rounded to 2 significant figures, from public records. usd is null only when the company did not exist yet, was already gone, or no figure for it was ever reported; do not invent numbers, but a well-documented approximate figure is better than null.
Return ONLY JSON: {"companies": [...]}`,
      companiesSchema,
      {
        settings: { ...polishSettings(ctx.settings), claudeModel: 'opus' },
        signal: ctx.signal,
        temperature: 0,
        effort: 'medium'
      }
    )
    companies = found.companies.map((c) => ({
      name: c.name,
      wikipedia_title: c.wikipedia_title,
      values: c.values.filter(
        (v): v is { year: number; usd: number } => v.usd !== null && plausibleValue(v.year, v.usd)
      )
    }))
  } catch (error) {
    if (ctx.signal.aborted) throw error
    // Better no badges than wrong ones.
    ctx.log(`Não foi possível conferir as empresas: ${(error as Error).message}`, 'warn')
    return []
  }
  updateVideo(video.id, { script: { ...script, companies, companiesChecked: true } })
  ctx.log(
    `Empresas conferidas: ${companies.map((c) => `${c.name} (${c.values.length} ano(s) com valor)`).join(', ') || 'nenhuma'}`
  )
  return companies
}

/** Companies with their downloaded logos, as the compositions take them. */
export async function renderCompanies(video: Video, ctx: StepContext): Promise<RenderCompany[]> {
  const companies = await companiesOf(video, ctx)
  if (!companies.length) return []
  const logos = await fetchLogos(companies, ctx.projectDir, ctx.signal, (m) => ctx.log(m, 'warn'))
  return companies.map((c, i) => ({
    name: c.name,
    logo: logos[i] ? url(ctx.projectDir, logos[i] as string) : null,
    values: c.values
  }))
}

/**
 * One card per change of year, placed in the silence the audio step left before the scene.
 * Narration made before year cards existed has no such silence, so it gets no cards.
 */
export function yearCardsFor(scenes: Scene[], projectDir: string): YearCard[] {
  const timings = readTimings(projectDir)
  if (!timings?.gaps) return []
  const cards: YearCard[] = []
  for (const [i, change] of yearChanges(scenes.map((s) => s.year))) {
    const gap = timings.gaps[i - 1]
    const at = scenes[i].start_sec
    if (!gap || gap < 1 || at === null) continue
    // The first card can share its silence with the channel intro; it takes the end of it.
    cards.push({ at, year: change.year, from: change.from, duration: Math.min(gap, YEAR_CARD_SEC) })
  }
  return cards
}

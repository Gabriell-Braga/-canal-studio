import { relative } from 'path'
import { z } from 'zod'
import { yearChanges, type RenderCompany, type YearCard } from '../../shared/render'
import type { Scene, ScriptCompany, Video } from '../../shared/types'
import { updateVideo } from '../db/repo'
import { generateStructured } from '../services/llm'
import { fetchLogos } from '../services/logos'
import { readTimings } from './audio'
import type { StepContext } from './types'

function url(root: string, file: string): string {
  return `{{root}}/${relative(root, file).split('\\').join('/').split('/').map(encodeURIComponent).join('/')}`
}

const companiesSchema = z.object({
  companies: z.array(z.object({ name: z.string().min(1), wikipedia_title: z.string() })).max(2)
})

/**
 * Companies of a script written before scripts listed them: asked once from the topic and
 * saved in the script. Without values, so only the logos show.
 */
async function companiesOf(video: Video, ctx: StepContext): Promise<ScriptCompany[]> {
  const script = video.script
  if (!script) return []
  if (script.companies) return script.companies
  let companies: ScriptCompany[] = []
  try {
    const found = await generateStructured(
      `A YouTube documentary is about: "${video.topic}" (title: "${video.title ?? ''}").
Opening: "${script.hook}"
List the companies the video is about, at most 2, main one first; an empty list when it is not about companies. For each give name (short, as people say it) and wikipedia_title (exact English Wikipedia article title, e.g. "Apple Inc.").
Return ONLY JSON: {"companies": [...]}`,
      companiesSchema,
      { settings: ctx.settings, signal: ctx.signal, temperature: 0.1, effort: 'low' }
    )
    companies = found.companies.map((c) => ({ ...c, values: [] }))
  } catch (error) {
    ctx.log(`Não foi possível identificar as empresas: ${(error as Error).message}`, 'warn')
    return []
  }
  updateVideo(video.id, { script: { ...script, companies } })
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
    cards.push({ at, year: change.year, from: change.from, duration: gap })
  }
  return cards
}

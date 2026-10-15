import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildReport, type AnnouncerSpan, type ReviewReport } from '../../shared/coverage'
import type { VideoProps } from '../../shared/render'
import { getState } from '../db/settings'
import { isValidFile, runTool } from '../services/ffmpeg'

/** dados/revisao/<id>: next to dados/projetos/<id>. */
export function reviewDir(projectDir: string, videoId: number): string {
  return join(projectDir, '..', '..', 'revisao', String(videoId))
}

export function readReviewReport(projectDir: string, videoId: number): ReviewReport | null {
  const file = join(reviewDir(projectDir, videoId), 'report.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ReviewReport
  } catch {
    return null
  }
}

const SHEET_EVERY_SEC = 3
const SHEET_COLUMNS = 6

/** One frame every 3 s of the narrated part, with its time, tiled into one image. */
async function contactSheet(
  video: string,
  sec: number,
  out: string,
  signal?: AbortSignal
): Promise<void> {
  const rows = Math.max(1, Math.ceil(Math.ceil(sec / SHEET_EVERY_SEC) / SHEET_COLUMNS))
  await runTool(
    'ffmpeg',
    [
      '-y',
      '-t',
      sec.toFixed(2),
      '-i',
      video,
      '-vf',
      `fps=1/${SHEET_EVERY_SEC},scale=320:-2,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4,tile=${SHEET_COLUMNS}x${rows}:padding=4:color=white`,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      out
    ],
    signal
  )
}

/**
 * The automatic review written after every render: contact sheet plus report.json (media
 * coverage, longest still, repeats, relevance rejections, announcer times).
 */
export async function writeReviewReport(
  videoId: number,
  projectDir: string,
  props: VideoProps,
  announcer: AnnouncerSpan[],
  signal?: AbortSignal
): Promise<ReviewReport> {
  const dir = reviewDir(projectDir, videoId)
  mkdirSync(dir, { recursive: true })
  const until = props.scenes.at(-1)?.end ?? props.durationSec
  const rejected = getState<ReviewReport['rejected']>(`relevance.rejected.video.${videoId}`, [])
  const sheet = join(dir, 'contact-sheet.jpg')
  const video = join(projectDir, 'video.mp4')
  let contact: string | null = null
  if (isValidFile(video, 100_000)) {
    await contactSheet(video, until, sheet, signal)
    if (isValidFile(sheet)) contact = sheet
  }
  const report: ReviewReport = {
    createdAt: new Date().toISOString(),
    ...buildReport(props.scenes, until, announcer, rejected),
    contactSheet: contact
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))
  return report
}

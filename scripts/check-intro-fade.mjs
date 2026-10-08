// Checks that the channel logo fades out together with the rest of the channel intro,
// inside the full Video composition (with the year card that follows it on top).
// Usage: npm run test:intro   (needs ffmpeg on the PATH; leaves a strip in out/intro-fade.png)
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'intro-fade-'))
const fps = 30

// Pure red logo on a pure blue card: the red left at the logo's center and the blue left on
// the card show how much of each is still visible. Black year card right after the intro.
const red = join(tmp, 'red.png')
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=red:s=64x64',
  '-frames:v',
  '1',
  red
])
const avatar = `data:image/png;base64,${readFileSync(red).toString('base64')}`
const silence = join(tmp, 'silence.wav')
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=r=8000:cl=mono',
  '-t',
  '0.1',
  silence
])
const intro = { start: 0.5, duration: 4.7 }
const end = intro.start + intro.duration
const inputProps = {
  fps,
  durationSec: 9,
  narration: `data:audio/wav;base64,${readFileSync(silence).toString('base64')}`,
  scenes: [],
  words: [],
  captions: false,
  music: [],
  musicVolume: 0,
  template: 'documentary',
  channelIntro: {
    ...intro,
    name: '',
    tagline: '',
    avatar,
    background: '#0000ff',
    primary: '#0000ff',
    secondary: '#ffffff',
    font: 'Segoe UI Black'
  },
  yearCards: [{ at: end + 1.5, year: 1968, from: null, duration: 2.2 }]
}

const serveUrl = await bundle({ entryPoint: join(root, 'remotion', 'index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Video', inputProps })

function pixel(file, x, y) {
  const raw = execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-i',
    file,
    '-vf',
    `crop=1:1:${x}:${y}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-'
  ])
  return [...raw]
}

const frames = []
let failed = 0
for (let t = end - 1.2; t < end + 0.05; t += 0.2) {
  const frame = Math.round(t * fps)
  const file = join(tmp, `f${frame}.png`)
  await renderStill({ serveUrl, composition, inputProps, frame, output: file })
  frames.push(file)
  const logo = pixel(file, 950, 540)[0] / 255
  const card = pixel(file, 200, 200)[2] / 255
  const ok = Math.abs(logo - card) < 0.1
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} t=${t.toFixed(2)}s  logo ${logo.toFixed(2)}  card ${card.toFixed(2)}`
  )
}

mkdirSync(join(root, 'out'), { recursive: true })
const strip = join(root, 'out', 'intro-fade.png')
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-y',
  ...frames.flatMap((f) => ['-i', f]),
  '-filter_complex',
  `${frames.map((_, i) => `[${i}]scale=480:-1[s${i}]`).join(';')};${frames.map((_, i) => `[s${i}]`).join('')}vstack=${frames.length}`,
  strip
])
console.log(`Strip: ${strip}`)
if (failed) {
  console.error(`${failed} frame(s) where the logo does not fade with the card`)
  process.exit(1)
}
console.log('Logo fades with the card')

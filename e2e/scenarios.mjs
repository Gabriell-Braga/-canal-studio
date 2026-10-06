function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`)
}

/** Fase 1: add 3 topics, generate 3 scripts with the real Ollama, approve all 3 at once. */
async function phase1({ launch, api, shot, log, waitUntil }) {
  const { app, page } = await launch()
  await page
    .getByTestId('topics-input')
    .fill(
      [
        'The mystery of the Mary Celeste',
        'How the Great Emu War of 1932 was lost',
        'The man who sold the Eiffel Tower twice'
      ].join('\n')
    )
  await page.getByTestId('duration-input').fill('1')
  await page.getByTestId('add-topics').click()
  await page.getByText('3 tema(s) adicionado(s).').waitFor()
  await shot(page, 'topics-added')

  await page.getByTestId('generate-scripts').click()
  log('Gerando 3 roteiros com o Ollama…')
  await waitUntil(
    async () => {
      const videos = await api(page, 'videos.list')
      const errors = videos.filter((v) => v.status === 'ERROR')
      if (errors.length) throw new Error(`Script failed: ${errors[0].error_message}`)
      return videos.filter((v) => v.status === 'SCRIPT_REVIEW').length === 3
    },
    { label: '3 scripts', timeoutMs: 15 * 60_000, everyMs: 5000 }
  )
  await shot(page, 'kanban-review')

  const videos = await api(page, 'videos.list')
  for (const v of videos) {
    const words = [v.script.hook, ...v.script.scenes.map((s) => s.narration), v.script.outro]
      .join(' ')
      .split(/\s+/).length
    log(
      `"${v.title}" · ${v.script.scenes.length} cenas · ${words} palavras · ${v.review_alerts.length} alertas`
    )
    assert(v.script.scenes.length >= 2, 'script has scenes')
    const detail = await api(page, 'videos.get', v.id)
    assert(
      detail.scenes.length === v.script.scenes.length + 2,
      'scenes table = hook + scenes + outro'
    )
  }

  await page.getByTestId('nav-review').click()
  await page.getByTestId('review-item').first().waitFor()
  await page.getByText('Ver roteiro completo').first().click()
  await shot(page, 'review-screen')
  await page.getByTestId('select-all').click()
  await page.getByTestId('approve-selected').click()
  await page.getByText('3 roteiro(s) aprovado(s)').waitFor()
  await shot(page, 'approved')

  const after = await api(page, 'videos.list')
  assert(
    after.every((v) => v.status === 'PRODUCTION_QUEUED'),
    'all 3 in PRODUCTION_QUEUED'
  )
  const state = await api(page, 'queue.state')
  assert(
    state.pending.filter((j) => j.type === 'audio' && j.run_mode === 'night').length === 3,
    '3 night audio jobs'
  )
  await app.close()
}

const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * Fase 2 (run with CANAL_FAKE_STEPS=1): night window opens 2 minutes from now; jobs wait,
 * start on their own, survive a hard kill of the app in the middle, and finish after relaunch.
 */
async function phase2({ launch, api, shot, log, waitUntil }) {
  let { app, page } = await launch()
  await api(page, 'videos.addTopics', ['Queue test A', 'Queue test B'], 1)
  await api(page, 'videos.generateScripts')
  await waitUntil(
    async () => (await api(page, 'videos.list')).every((v) => v.status === 'SCRIPT_REVIEW'),
    {
      label: 'fake scripts',
      timeoutMs: 60_000
    }
  )

  const start = new Date(Date.now() + 2 * 60_000)
  const end = new Date(start.getTime() + 2 * 3600_000)
  await api(page, 'settings.set', { nightStart: hhmm(start), nightEnd: hhmm(end) })
  log(`Janela noturna: ${hhmm(start)}–${hhmm(end)}`)
  const ids = (await api(page, 'videos.list')).map((v) => v.id)
  await api(page, 'videos.approveScripts', ids)

  await page.getByTestId('nav-queue').click()
  await page.getByTestId('queue-status').waitFor()
  await new Promise((r) => setTimeout(r, 30_000))
  const before = await api(page, 'queue.state')
  assert(!before.inNightWindow, 'window still closed')
  assert(before.running.length === 0, 'nothing runs before the window')
  assert(before.pending.filter((j) => j.type === 'audio').length === 2, '2 audio jobs waiting')
  await shot(page, 'waiting-for-window')
  log('Tarefas esperando a janela. Aguardando abrir…')

  await waitUntil(async () => (await api(page, 'queue.state')).running.length > 0, {
    label: 'job to start in the window',
    timeoutMs: 4 * 60_000,
    everyMs: 1000
  })
  log(`Janela abriu às ${new Date().toLocaleTimeString('pt-BR')}; tarefas começaram sozinhas`)
  await shot(page, 'running')

  // Kill the app hard in the middle of the chain (not at the very first step).
  await waitUntil(
    async () => {
      const st = await api(page, 'queue.state')
      return st.running.some((j) => j.type === 'scenes' || j.type === 'transcribe')
    },
    { label: 'mid-chain job', timeoutMs: 120_000, everyMs: 500 }
  )
  const mid = (await api(page, 'queue.state')).running[0]
  log(`Matando o app durante "${mid.type}" do vídeo ${mid.video_id}`)
  app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 2000))

  ;({ app, page } = await launch())
  log('App reaberto')
  const logs = await api(page, 'queue.logs', 0)
  assert(
    logs.some((l) => l.message.includes('voltaram para a fila')),
    'recovery log present'
  )

  await waitUntil(
    async () => (await api(page, 'videos.list')).every((v) => v.status === 'FINAL_REVIEW'),
    {
      label: 'both videos at FINAL_REVIEW',
      timeoutMs: 5 * 60_000
    }
  )
  for (const id of ids) {
    const d = await api(page, 'videos.get', id)
    const done = d.jobs
      .filter((j) => j.status === 'done')
      .map((j) => j.type)
      .sort()
    assert(
      JSON.stringify(done) ===
        JSON.stringify([
          'audio',
          'metadata',
          'render',
          'scenes',
          'script',
          'thumbnail',
          'transcribe'
        ]),
      `video ${id} ran each step once: ${done}`
    )
    assert(!d.jobs.some((j) => j.status === 'failed'), 'no failed jobs')
  }
  await page.getByTestId('nav-queue').click()
  await page.getByTestId('queue-status').waitFor()
  await shot(page, 'after-recovery')
  await app.close()
}

/** Fase 3: an approved script becomes a normalized WAV with word timings and scene times. */
async function phase3({ launch, api, shot, log, waitUntil, dataDir }) {
  const { app, page } = await launch()
  await api(page, 'videos.addTopics', ['Why the Library of Alexandria really disappeared'], 1)
  await api(page, 'videos.generateScripts')
  const [video] = await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list')
      if (vs[0].status === 'ERROR') throw new Error(vs[0].error_message)
      return vs[0].status === 'SCRIPT_REVIEW' && vs
    },
    { label: 'script', timeoutMs: 10 * 60_000, everyMs: 3000 }
  )
  log(`Roteiro: "${video.title}"`)
  await api(page, 'videos.approveScripts', [video.id])
  await api(page, 'queue.runNow')
  const t0 = Date.now()
  await waitUntil(
    async () => {
      const d = await api(page, 'videos.get', video.id)
      if (d.video.status === 'ERROR')
        throw new Error(`${d.video.error_step}: ${d.video.error_message}`)
      return d.jobs.some((j) => j.type === 'transcribe' && j.status === 'done')
    },
    { label: 'audio + transcribe', timeoutMs: 15 * 60_000, everyMs: 3000 }
  )
  log(`Áudio e transcrição em ${Math.round((Date.now() - t0) / 1000)} s`)
  const d = await api(page, 'videos.get', video.id)
  assert(d.video.audio_path?.endsWith('narration.wav'), 'audio_path set')
  assert(
    d.scenes.every((s) => s.start_sec !== null && s.end_sec > s.start_sec),
    'scene times'
  )
  for (const s of d.scenes)
    log(`  cena ${s.index}: ${s.start_sec.toFixed(2)}–${s.end_sec.toFixed(2)} s`)
  await page.getByTestId('nav-queue').click()
  await shot(page, 'queue-after-audio')
  await app.close()
  return {
    audio: d.video.audio_path,
    projectDir: d.video.audio_path.replace(/[\/]narration.wav$/, '')
  }
}

/**
 * Fase 4: full production of one video with real services (Ollama, Kokoro, Whisper, ComfyUI,
 * Remotion). Minutes come from E2E_MINUTES (default 2). Uses "Rodar agora" unless E2E_NIGHT=1.
 */
async function phase4({ launch, api, shot, log, waitUntil, dataDir }) {
  const { execFileSync } = await import('child_process')
  const { mkdirSync, existsSync } = await import('fs')
  const { join } = await import('path')
  const minutes = Number(process.env.E2E_MINUTES) || 2
  const musicDir = join(dataDir, 'musica')
  mkdirSync(musicDir, { recursive: true })
  const track = join(musicDir, 'test-pad.mp3')
  if (!existsSync(track)) {
    // A soft synthetic chord as stand-in background music.
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=f=220:d=60',
        '-f',
        'lavfi',
        '-i',
        'sine=f=277:d=60',
        '-f',
        'lavfi',
        '-i',
        'sine=f=330:d=60',
        '-filter_complex',
        'amix=inputs=3,volume=0.5',
        track
      ],
      { stdio: 'ignore' }
    )
  }

  const { app, page } = await launch()
  const t0 = Date.now()
  const elapsed = () => `${Math.round((Date.now() - t0) / 60000)} min`
  await api(page, 'videos.addTopics', ['The ghost ship Octavius and the frozen crew'], minutes)
  await api(page, 'videos.generateScripts')
  const [video] = await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list')
      if (vs[0].status === 'ERROR') throw new Error(vs[0].error_message)
      return vs[0].status === 'SCRIPT_REVIEW' && vs
    },
    { label: 'script', timeoutMs: 15 * 60_000, everyMs: 5000 }
  )
  log(`Roteiro pronto (${elapsed()}): "${video.title}", ${video.script.scenes.length + 2} cenas`)
  if (process.env.E2E_NIGHT === '1') {
    const d = new Date(Date.now() + 60_000)
    const hh = (x) =>
      `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
    await api(page, 'settings.set', {
      nightStart: hh(d),
      nightEnd: hh(new Date(d.getTime() + 6 * 3600_000))
    })
    log(`Janela noturna às ${hh(d)}`)
  }
  await api(page, 'videos.approveScripts', [video.id])
  if (process.env.E2E_NIGHT !== '1') await api(page, 'queue.runNow')

  let lastStatus = ''
  await waitUntil(
    async () => {
      const d = await api(page, 'videos.get', video.id)
      if (d.video.status !== lastStatus) {
        lastStatus = d.video.status
        log(`  status: ${lastStatus} (${elapsed()})`)
      }
      if (d.video.status === 'ERROR')
        throw new Error(`${d.video.error_step}: ${d.video.error_message}`)
      return d.video.status === 'FINAL_REVIEW'
    },
    { label: 'FINAL_REVIEW', timeoutMs: 180 * 60_000, everyMs: 10_000 }
  )
  const d = await api(page, 'videos.get', video.id)
  log(`Pronto em ${elapsed()}: ${d.video.video_path}`)
  log(`Título: ${d.video.title}`)
  log(`Tags: ${d.video.tags.join(', ')}`)
  log(`Thumbnails: ${d.video.thumbnail_paths.length}`)
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height:format=duration',
      '-of',
      'json',
      d.video.video_path
    ]).toString()
  )
  log(`ffprobe: ${JSON.stringify(probe)}`)
  const vstream = probe.streams.find((x) => x.codec_type === 'video')
  assert(vstream.width === 1920 && vstream.height === 1080, '1920x1080')
  assert(
    probe.streams.some((x) => x.codec_type === 'audio'),
    'has audio'
  )
  assert(d.video.thumbnail_paths.length === 3, '3 thumbnails')
  const kinds = d.scenes.reduce(
    (m, sc) => ((m[sc.asset_type] = (m[sc.asset_type] ?? 0) + 1), m),
    {}
  )
  log(`Cenas por tipo: ${JSON.stringify(kinds)}`)
  await page.getByTestId('nav-queue').click()
  await shot(page, 'queue-done')
  await app.close()
}

export const scenarios = { phase1, phase2, phase3, phase4 }

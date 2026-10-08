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
  await api(page, 'videos.addTopics', 1, ['Queue test A', 'Queue test B'], 1)
  await api(page, 'videos.generateScripts', 1)
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
  await api(page, 'videos.addTopics', 1, ['Why the Library of Alexandria really disappeared'], 1)
  await api(page, 'videos.generateScripts', 1)
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
  // Extra settings for this run, e.g. the model and stock keys: E2E_SETTINGS='{"llmProvider":"claude-code"}'
  if (process.env.E2E_SETTINGS)
    await api(page, 'settings.set', JSON.parse(process.env.E2E_SETTINGS))
  const t0 = Date.now()
  const elapsed = () => `${Math.round((Date.now() - t0) / 60000)} min`
  await api(page, 'videos.addTopics', 1, ['The ghost ship Octavius and the frozen crew'], minutes)
  await api(page, 'videos.generateScripts', 1)
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
  assert(d.video.thumbnail_paths.length >= 3, '3+ thumbnails')
  const kinds = d.scenes.reduce(
    (m, sc) => ((m[sc.asset_type] = (m[sc.asset_type] ?? 0) + 1), m),
    {}
  )
  log(`Cenas por tipo: ${JSON.stringify(kinds)}`)
  await page.getByTestId('nav-queue').click()
  await shot(page, 'queue-done')
  await app.close()
}

/** Queue screen with a running job: percent, elapsed and remaining time (CANAL_FAKE_STEPS=1). */
async function queueEta({ launch, api, shot, waitUntil }) {
  const { page } = await launch()
  await api(page, 'videos.addTopics', 1, ['ETA test A', 'ETA test B'], 1)
  await api(page, 'videos.generateScripts', 1)
  await api(page, 'queue.runNow')
  await page.getByTestId('nav-queue').click()
  await page.getByTestId('queue-status').waitFor()
  await waitUntil(async () => (await api(page, 'queue.state')).running.length > 0, {
    label: 'running job',
    timeoutMs: 60_000,
    everyMs: 300
  })
  await new Promise((r) => setTimeout(r, 1500))
  await shot(page, 'queue-eta')
}

export const scenarios = { phase1, phase2, phase3, phase4, queueEta }

/**
 * Fase 5 (reuse the data folder of a phase4 run, CANAL_DATA_DIR): open the finished video,
 * swap one scene for a new AI image, re-render, check the 3 thumbnails and approve.
 */
async function phase5({ launch, api, shot, log, waitUntil }) {
  const { statSync } = await import('fs')
  const { app, page } = await launch()
  // Keep the upload out of the night window during the test.
  await api(page, 'settings.set', { nightStart: '12:00', nightEnd: '12:01' })
  const video = (await api(page, 'videos.list')).find((v) => v.status === 'FINAL_REVIEW')
  assert(video, 'a video in FINAL_REVIEW (run phase4 first with the same CANAL_DATA_DIR)')
  const before = statSync(video.video_path).mtimeMs

  await page.getByTestId('video-card').filter({ hasText: video.title }).first().click()
  await page.getByTestId('tab-publish').waitFor()
  await shot(page, 'detail-publish')
  await page.getByTestId('tab-scenes').click()
  const card = page.getByTestId('scene-card').nth(2)
  const oldAsset = (await api(page, 'videos.get', video.id)).scenes[2].asset_path
  await card.getByText('Gerar imagem IA').click()
  log('Gerando nova imagem IA para a cena 3…')
  await page.getByText('Imagem IA gerada.').waitFor({ timeout: 5 * 60_000 })
  const newAsset = (await api(page, 'videos.get', video.id)).scenes[2].asset_path
  assert(newAsset !== oldAsset, 'scene asset changed')
  await shot(page, 'scene-swapped')

  await page.getByTestId('rerender').click()
  log('Re-renderizando…')
  await waitUntil(
    async () => {
      const d = await api(page, 'videos.get', video.id)
      if (d.video.status === 'ERROR') throw new Error(d.video.error_message)
      const job = d.jobs.find((j) => j.type === 'render' && !j.chain)
      return job?.status === 'done' && d.video.status === 'FINAL_REVIEW'
    },
    { label: 're-render', timeoutMs: 30 * 60_000, everyMs: 5000 }
  )
  assert(statSync(video.video_path).mtimeMs > before, 'video.mp4 rewritten')
  const after = await api(page, 'videos.get', video.id)
  assert(
    !after.jobs.some(
      (j) => j.type === 'thumbnail' && j.created_at > after.jobs.find((x) => !x.chain).created_at
    ),
    'no new thumbnail job'
  )

  await page.getByTestId('tab-publish').click()
  assert((await page.getByTestId('thumb-option').count()) >= 2, 'thumbnails shown')
  await page.getByTestId('thumb-option').nth(1).click()
  await shot(page, 'publish-tab')
  await page.getByText('Salvar, aprovar e agendar').click()
  await page.getByText('Aprovado e agendado').waitFor()
  const final = await api(page, 'videos.get', video.id)
  assert(final.video.status === 'SCHEDULED', 'SCHEDULED')
  assert(final.video.chosen_thumbnail === 1, 'thumbnail 2 chosen')
  assert(
    final.jobs.some((j) => j.type === 'upload' && j.status === 'pending'),
    'upload queued'
  )
  log(`Agendado para ${new Date(final.video.scheduled_at).toLocaleString('pt-BR')}`)
  await shot(page, 'scheduled')
  await app.close()
}

scenarios.phase5 = phase5

/** Fase 6 without Google credentials: Canal screen, guide, quota, and a clear error on connect. */
async function phase6({ launch, api, shot, log }) {
  const { app, page } = await launch()
  await page.getByTestId('nav-channel').click()
  await page.getByText('Cota da API:').waitFor()
  await page.getByText('Guia: configurar o Google Cloud').click()
  await page.getByText('App para computador').first().waitFor()
  await shot(page, 'channel')
  const result = await api(page, 'youtube.connect', 1)
  log(`Conectar sem credenciais: ${result.message}`)
  assert(!result.ok && /Client ID/.test(result.message), 'asks for client id')
  const stats = await api(page, 'youtube.stats', 1)
  assert(stats.connected === false && stats.quotaLimit === 10000, 'stats shape')
  await app.close()
}

scenarios.phase6 = phase6

/** Script length check: generate one script of E2E_MINUTES (default 8) and report its size. */
async function scriptLength({ launch, api, log, waitUntil }) {
  const minutes = Number(process.env.E2E_MINUTES) || 8
  const { app, page } = await launch()
  await api(page, 'videos.addTopics', 1, ['The ghost ship Octavius and the frozen crew'], minutes)
  await api(page, 'videos.generateScripts', 1)
  const [v] = await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list')
      if (vs[0].status === 'ERROR') throw new Error(vs[0].error_message)
      return vs[0].status === 'SCRIPT_REVIEW' && vs
    },
    { label: 'script', timeoutMs: 30 * 60_000, everyMs: 5000 }
  )
  const words = [v.script.hook, ...v.script.scenes.map((s) => s.narration), v.script.outro]
    .join(' ')
    .split(/\s+/).length
  const logs = await api(page, 'queue.logs', 0)
  logs.forEach((l) => log(`  ${l.message}`))
  log(`${words} palavras (~${(words / 150).toFixed(1)} min) para meta de ${minutes} min`)
  assert(words >= minutes * 150 * 0.75, 'script reaches 75% of the target length')
  await app.close()
}

scenarios.scriptLength = scriptLength

/** Packaged app (E2E_EXE) on a copy of a phase4 data folder: services screen and a real re-render. */
async function packaged({ launch, api, shot, log, waitUntil }) {
  const { app, page } = await launch()
  await page.getByTestId('nav-services').click()
  await page.getByText(/de \d+ prontos/).waitFor({ timeout: 60_000 })
  await shot(page, 'services')
  const services = await api(page, 'services.check')
  services.forEach((s) => log(`  ${s.name}: ${s.state} ${s.detail ?? ''}`))
  const video = (await api(page, 'videos.list')).find((v) => v.video_path)
  assert(video, 'a rendered video in the data folder')
  const lastJob = Math.max(0, ...(await api(page, 'videos.get', video.id)).jobs.map((j) => j.id))
  await api(page, 'videos.rerender', video.id)
  log('Re-render no app empacotado…')
  await waitUntil(
    async () => {
      const d = await api(page, 'videos.get', video.id)
      if (d.video.status === 'ERROR') throw new Error(d.video.error_message)
      return d.jobs.some((j) => j.id > lastJob && j.type === 'render' && j.status === 'done')
    },
    { label: 'packaged render', timeoutMs: 20 * 60_000, everyMs: 5000 }
  )
  log('Render OK no app empacotado')
  await app.close()
}

scenarios.packaged = packaged

/**
 * Multi-channel tour (E2E_STAY_ON_PICKER=1): picker, create a second channel copying the
 * first one's settings, change a channel setting there, check the first channel kept its
 * value, switch back, and screenshot every screen.
 */
async function tour({ launch, api, shot, log }) {
  const { app, page } = await launch()
  await page.getByTestId('channel-card').first().waitFor()
  await shot(page, 'picker')
  const before = await api(page, 'settings.get', 1)

  await page.getByTestId('add-channel').click()
  await page.getByTestId('channel-name').fill('Dark History')
  await shot(page, 'new-channel')
  await page.getByTestId('create-channel').click()
  await page.getByTestId('channel-switcher').waitFor()
  const channels = await api(page, 'channels.list')
  const second = channels.find((c) => c.name === 'Dark History')
  assert(second, 'second channel created')
  const copied = await api(page, 'settings.get', second.id)
  assert(
    copied.voice === before.voice && copied.scriptPrompt === before.scriptPrompt,
    'settings copied'
  )

  await api(page, 'settings.set', { voice: 'bf_emma', defaultNiche: 'dark history' }, second.id)
  const first = await api(page, 'settings.get', 1)
  assert(first.voice === before.voice, 'channel 1 voice unchanged')
  assert(first.defaultNiche === before.defaultNiche, 'channel 1 niche unchanged')
  log('Canal 2 com voz própria; canal 1 manteve a configuração')

  await shot(page, 'second-channel-production')
  await page.getByTestId('channel-switcher').click()
  await shot(page, 'switcher-open')
  await page.getByText('Ver todos os canais').click()
  await page.getByTestId('channel-card').first().waitFor()
  await shot(page, 'picker-two-channels')
  await page.getByTestId('channel-card').first().click()
  await page.getByTestId('channel-switcher').waitFor()

  for (const nav of [
    'production',
    'review',
    'channel',
    'channelSettings',
    'queue',
    'services',
    'settings'
  ]) {
    await page.getByTestId('nav-' + nav).click()
    await page.waitForTimeout(nav === 'services' ? 6000 : 700)
    await shot(page, 'page-' + nav)
  }
  const video = (await api(page, 'videos.list', 1))[0]
  if (video) {
    await page.getByTestId('nav-production').click()
    await page.getByTestId('video-card').first().click()
    await page.waitForTimeout(800)
    await shot(page, 'video-detail')
    await page.getByTestId('tab-scenes').click()
    await page.waitForTimeout(800)
    await shot(page, 'video-scenes')
  }
  await app.close()
}

scenarios.tour = tour

/** Stock providers without keys: "Outro resultado" on a scene pulls a Wikimedia Commons image. */
async function stock({ launch, api, log }) {
  const { app, page } = await launch()
  const video = (await api(page, 'videos.list', 1)).find((v) => v.video_path)
  assert(video, 'a produced video')
  const before = await api(page, 'videos.get', video.id)
  const scene = before.scenes[3]
  log(`Cena 4: "${scene.visual_keywords}"`)
  const after = await api(page, 'scenes.nextStock', scene.id)
  log(
    `Nova mídia: ${after.asset_type} ${after.asset_source} ${after.asset_credit ?? '(domínio público)'}`
  )
  assert(after.asset_source?.startsWith('wikimedia:'), 'came from Wikimedia')
  const again = await api(page, 'scenes.nextStock', scene.id)
  assert(again.asset_source !== after.asset_source, 'second click gives another file')
  log(`Outro resultado: ${again.asset_source}`)
  await app.close()
}

scenarios.stock = stock

/** Shorts: cut 2 vertical shorts from a finished video; approving the video approves them. */
async function shorts({ launch, api, shot, log, waitUntil }) {
  const { execFileSync } = await import('child_process')
  const { app, page } = await launch()
  await api(page, 'settings.set', { nightStart: '12:00', nightEnd: '12:01' })
  const video = (await api(page, 'videos.list', 1)).find((v) => v.kind === 'long' && v.video_path)
  assert(video, 'a rendered long video')
  await page.getByTestId('video-card').filter({ hasText: video.title }).first().click()
  await page.getByTestId('tab-shorts').click()
  await page.getByTestId('generate-shorts').click()
  log('Gerando 2 shorts…')
  const t0 = Date.now()
  const done = await waitUntil(
    async () => {
      const list = await api(page, 'videos.shorts', video.id)
      const failed = list.find((s) => s.status === 'ERROR')
      if (failed) throw new Error(failed.error_message)
      const state = await api(page, 'queue.state')
      const job = [...state.running, ...state.pending].find((j) => j.type === 'short')
      return (
        !job &&
        list.filter((s) => ['FINAL_REVIEW', 'SCHEDULED'].includes(s.status)).length >= 2 &&
        list
      )
    },
    { label: 'shorts', timeoutMs: 30 * 60_000, everyMs: 5000 }
  )
  log(`Shorts prontos em ${Math.round((Date.now() - t0) / 1000)} s`)
  for (const s of done) {
    const probe = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height:format=duration',
        '-of',
        'json',
        s.video_path
      ]).toString()
    )
    const v = probe.streams.find((x) => x.codec_type === 'video')
    log(
      `  "${s.title}" ${v.width}x${v.height} ${Number(probe.format.duration).toFixed(1)} s (${s.short_start.toFixed(0)}–${s.short_end.toFixed(0)} s do original)`
    )
    assert(v.width === 1080 && v.height === 1920, 'vertical 1080x1920')
    assert(Number(probe.format.duration) <= 60, 'at most 60 s')
  }
  await page.waitForTimeout(1500)
  await shot(page, 'shorts-tab')
  if ((await api(page, 'videos.get', video.id)).video.status === 'FINAL_REVIEW') {
    await page.getByTestId('approve-final').click()
    await page.getByText('Aprovado e agendado').waitFor()
  }
  const parent = (await api(page, 'videos.get', video.id)).video
  const approved = (await api(page, 'videos.get', done[0].id)).video
  log(`Short agendado para ${new Date(approved.scheduled_at).toLocaleString('pt-BR')}`)
  assert(approved.status === 'SCHEDULED', 'short approved with the full video')
  assert(
    new Date(approved.scheduled_at) - new Date(parent.scheduled_at) >= 30 * 60_000,
    'short 30 min after the full video'
  )
  await app.close()
  return done
}

scenarios.shorts = shorts

/** Claude through the user's Claude Code login: script, web fact-check, AI fix. */
async function claude({ launch, api, shot, log, waitUntil }) {
  const { app, page } = await launch()
  const test = await api(page, 'settings.testLlm', {
    llmProvider: 'claude-code',
    claudeModel: 'opus'
  })
  log(test)
  await api(page, 'settings.set', {
    llmProvider: 'claude-code',
    claudeModel: 'opus',
    factCheckWeb: true
  })
  await api(
    page,
    'videos.addTopics',
    1,
    ['Blockbuster: the $5 billion giant that laughed at Netflix'],
    3
  )
  await api(page, 'videos.generateScripts', 1)
  const t0 = Date.now()
  const [v] = await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list', 1)
      if (vs[0].status === 'ERROR') throw new Error(vs[0].error_message)
      return vs[0].status === 'SCRIPT_REVIEW' && vs
    },
    { label: 'claude script', timeoutMs: 20 * 60_000, everyMs: 5000 }
  )
  const words = [v.script.hook, ...v.script.scenes.map((s) => s.narration), v.script.outro]
    .join(' ')
    .split(/\s+/).length
  log(
    `Roteiro em ${Math.round((Date.now() - t0) / 1000)} s: "${v.title}" · ${v.script.scenes.length} cenas · ${words} palavras`
  )
  log(`Gancho: ${v.script.hook}`)
  for (const a of v.review_alerts)
    log(
      `  [${a.kind}] ${a.message}${a.correction ? ` → ${a.correction}` : ''}${a.source ? ` (${a.source})` : ''}`
    )
  await page.getByTestId('nav-review').click()
  await page.getByTestId('review-item').first().waitFor()
  await shot(page, 'claude-review')
  if (v.review_alerts.some((a) => a.kind !== 'other')) {
    const t1 = Date.now()
    const fixed = await api(page, 'videos.fixScript', v.id)
    log(`Corrigido em ${Math.round((Date.now() - t1) / 1000)} s; gancho novo: ${fixed.script.hook}`)
  }
  await app.close()
}

scenarios.claude = claude

/** Delete: from the board card (with confirmation), video row and project folder go away. */
async function deleteVideo({ launch, api, shot, log, waitUntil, dataDir }) {
  const { existsSync } = await import('fs')
  const { join } = await import('path')
  const { app, page } = await launch()
  await api(page, 'videos.addTopics', 1, ['Video to delete'], 1)
  await api(page, 'videos.generateScripts', 1)
  const [v] = await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list', 1)
      return vs[0]?.status === 'SCRIPT_REVIEW' && vs
    },
    { label: 'fake script', timeoutMs: 60_000 }
  )
  const dir = join(dataDir, 'projetos', String(v.id))
  assert(existsSync(dir), 'project folder exists before delete')
  await page.getByTestId('nav-production').click()
  const card = page.getByTestId('video-card').first()
  await card.hover()
  await page.getByTestId('delete-video-card').first().click()
  await shot(page, 'delete-confirm')
  await page.getByTestId('confirm-delete').click()
  await waitUntil(async () => (await api(page, 'videos.list', 1)).length === 0, {
    label: 'row deleted',
    timeoutMs: 15_000,
    everyMs: 500
  })
  await waitUntil(async () => !existsSync(dir), {
    label: 'folder to Recycle Bin',
    timeoutMs: 15_000,
    everyMs: 500
  })
  log('Vídeo excluído e pasta enviada para a Lixeira')
  await app.close()
}

scenarios.deleteVideo = deleteVideo

/** Thumbnail look: outline off and the mixed style show both previews on the channel settings. */
async function brand({ launch, api, shot, log }) {
  const { app, page } = await launch()
  await page.getByTestId('nav-channelSettings').click()
  const select = page.locator('select').filter({ hasText: 'Destaque colorido' })
  await select.selectOption('mixed')
  await page.getByText('Contorno preto no texto').click()
  await page.getByText('prévia do destaque').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  await shot(page, 'brand-mixed-no-outline')
  await page.getByTestId('save-settings').click()
  await page.waitForTimeout(800)
  const saved = await api(page, 'settings.get', 1)
  assert(saved.thumbStyle === 'mixed' && saved.brandOutline === false, 'brand settings saved')
  log('Estilo misto e sem contorno salvos')
  await api(page, 'settings.set', { thumbStyle: 'text', brandOutline: true }, 1)
  await app.close()
}

scenarios.brand = brand

/** Review: "Corrigir selecionados com IA" counts the selected scripts that have alerts and runs on each. */
async function fixSelected({ launch, api, shot, log, waitUntil }) {
  const { app, page } = await launch()
  await api(page, 'videos.addTopics', 1, ['First topic', 'Second topic'], 1)
  await api(page, 'videos.generateScripts', 1)
  await waitUntil(
    async () => {
      const vs = await api(page, 'videos.list', 1)
      return vs.length === 2 && vs.every((v) => v.status === 'SCRIPT_REVIEW') && vs
    },
    { label: 'fake scripts', timeoutMs: 90_000 }
  )
  await page.getByTestId('nav-review').click()
  await page.getByTestId('review-item').nth(1).waitFor()
  const button = page.getByTestId('fix-selected')
  assert(await button.isDisabled(), 'disabled with nothing selected')
  await page.getByTestId('select-all').click()
  assert((await button.textContent()).includes('(2)'), 'counts 2 selected scripts')
  await shot(page, 'fix-selected')
  await button.click()
  await page.getByText(/corrigido\(s\)/).waitFor({ timeout: 120_000 })
  await shot(page, 'fix-selected-done')
  log(await page.getByText(/corrigido\(s\)/).textContent())
  await app.close()
}

scenarios.fixSelected = fixSelected

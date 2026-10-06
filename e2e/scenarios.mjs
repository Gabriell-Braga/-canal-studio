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

export const scenarios = { phase1 }

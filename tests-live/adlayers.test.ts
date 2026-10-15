import { expect, it } from 'vitest'
import { searchArchiveAds } from '../electron/services/archives'
import { credit } from '../electron/services/chroniclingamerica'
import { searchCommonsAds, searchCommonsGeneral } from '../electron/services/commonsads'

// Commons and the Internet Archive only: this test never contacts loc.gov.
it('finds Pinkham ads past the Chronicling America mirrors', async () => {
  const log = (layer: string) => (title: string, reason: string) =>
    console.log(`  ${layer} descartado: ${title}: ${reason}`)
  const mirrors = await searchCommonsAds('Pinkham', 6, undefined, log('mirrors'))
  const general = await searchCommonsGeneral(
    'Pinkham',
    ['Lydia E. Pinkham Medicine Company', 'Patent medicines'],
    6,
    undefined,
    log('commons')
  )
  const archive = await searchArchiveAds('Pinkham', 4, undefined, log('archive'))
  for (const p of [...mirrors, ...general, ...archive]) console.log(credit(p))
  expect(mirrors.length + general.length + archive.length).toBeGreaterThan(0)
  for (const p of [...general, ...archive])
    expect(Number(p.date.slice(0, 4))).toBeLessThanOrEqual(1930)
}, 60_000)

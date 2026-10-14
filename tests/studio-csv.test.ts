import { describe, expect, it } from 'vitest'
import { matchStudioRows, parseStudioCsv } from '../shared/studio-csv'

const EN = `${String.fromCharCode(0xfeff)}Content,Video title,Video publish time,Duration,Views,Watch time (hours),Average percentage viewed (%),Impressions,Impressions click-through rate (%)
Total,,,,1500,90.5,41.2,30000,5.0
abcdefghijk,"The Ship That Vanished, Twice",Oct 1 2026,612,1200,80.1,44.5,25000,4.8
zyxwvutsrqp,Lost Empire,Oct 3 2026,590,300,10.4,30.2,5000,6.0
`

const PT = `Conteúdo;Título do vídeo;Visualizações;Porcentagem média visualizada (%);Impressões;Taxa de cliques de impressões (%)
abcdefghijk;The Ship That Vanished, Twice;1200;44,5;25.000;4,8
`

describe('parseStudioCsv', () => {
  it('reads the English export and skips the total row', () => {
    const rows = parseStudioCsv(EN)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      youtubeId: 'abcdefghijk',
      title: 'The Ship That Vanished, Twice',
      impressions: 25000,
      ctr: 4.8,
      views: 1200,
      avgViewPct: 44.5
    })
  })
  it('reads a Portuguese export with semicolons and decimal commas', () => {
    const [row] = parseStudioCsv(PT)
    expect(row).toMatchObject({
      youtubeId: 'abcdefghijk',
      impressions: 25000,
      ctr: 4.8,
      avgViewPct: 44.5
    })
  })
  it('returns nothing for empty input', () => {
    expect(parseStudioCsv('')).toEqual([])
  })
})

describe('matchStudioRows', () => {
  it('matches by YouTube id, then by title', () => {
    const rows = parseStudioCsv(EN)
    rows[1].youtubeId = null
    const { matched, unmatched } = matchStudioRows(
      [
        ...rows,
        { youtubeId: null, title: 'Nope', impressions: 1, ctr: 1, views: 1, avgViewPct: 1 }
      ],
      [
        { id: 1, youtube_id: 'abcdefghijk', title: 'Renamed later' },
        { id: 2, youtube_id: 'other000000', title: 'lost empire' }
      ]
    )
    expect(matched.map((m) => m.videoId)).toEqual([1, 2])
    expect(unmatched.map((r) => r.title)).toEqual(['Nope'])
  })
})

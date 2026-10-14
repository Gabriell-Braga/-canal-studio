/** One video row of the YouTube Studio "Table data.csv" export (Advanced mode → Content). */
export interface StudioRow {
  youtubeId: string | null
  title: string | null
  impressions: number | null
  /** Impressions click-through rate, % */
  ctr: number | null
  views: number | null
  avgViewPct: number | null
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF, comma/semicolon/tab delimiter. */
function parseCsv(text: string): string[][] {
  // Studio writes a UTF-8 byte order mark.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const first = clean.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows.filter((r) => r.some((f) => f.trim()))
}

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null
  let s = raw.replace(/[%\s]/g, '')
  if (!s || s === '-' || s === '—') return null
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Header index of the first column whose name matches, English or Portuguese Studio. */
function column(headers: string[], test: (h: string) => boolean): number {
  return headers.findIndex((h) => test(norm(h)))
}

export function parseStudioCsv(text: string): StudioRow[] {
  const [head, ...body] = parseCsv(text)
  if (!head) return []
  const ctr = column(
    head,
    (h) =>
      (h.includes('impression') || h.includes('impresso')) &&
      (h.includes('rate') || h.includes('taxa') || h.includes('ctr'))
  )
  const impressions = column(head, (h) => h === 'impressions' || h === 'impressoes')
  const avg = column(
    head,
    (h) =>
      (h.includes('average percentage') || h.includes('porcentagem media')) &&
      !h.includes('duration')
  )
  const views = column(head, (h) => h === 'views' || h === 'visualizacoes')
  const title = column(head, (h) => h === 'video title' || h === 'titulo do video' || h === 'title')
  const content = column(head, (h) => h === 'content' || h === 'conteudo' || h === 'video')
  const at = (r: string[], i: number): string | undefined => (i < 0 ? undefined : r[i]?.trim())
  return body
    .map((r) => ({
      youtubeId: /^[\w-]{11}$/.test(at(r, content) ?? '') ? (at(r, content) as string) : null,
      title: at(r, title) || null,
      impressions: num(at(r, impressions)),
      ctr: num(at(r, ctr)),
      views: num(at(r, views)),
      avgViewPct: num(at(r, avg))
    }))
    .filter((r) => r.youtubeId || (r.title && norm(r.title) !== 'total'))
}

/** Pair CSV rows with our videos: by YouTube id, else by exact (normalized) title. */
export function matchStudioRows(
  rows: StudioRow[],
  videos: { id: number; youtube_id: string | null; title: string | null }[]
): { matched: { videoId: number; row: StudioRow }[]; unmatched: StudioRow[] } {
  const byYt = new Map(videos.filter((v) => v.youtube_id).map((v) => [v.youtube_id, v.id]))
  const byTitle = new Map(videos.filter((v) => v.title).map((v) => [norm(v.title as string), v.id]))
  const matched: { videoId: number; row: StudioRow }[] = []
  const unmatched: StudioRow[] = []
  for (const row of rows) {
    const id =
      (row.youtubeId && byYt.get(row.youtubeId)) || (row.title && byTitle.get(norm(row.title)))
    if (id) matched.push({ videoId: id, row })
    else unmatched.push(row)
  }
  return { matched, unmatched }
}

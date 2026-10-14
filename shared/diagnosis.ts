/** Click-through rate below this (%) means the title/thumbnail does not sell the video. */
export const CTR_LOW = 4
export const CTR_CRITICAL = 2
/** Share of viewers still watching at 0:30 (%) below this means the opening loses them. */
export const RETENTION30_LOW = 65
/** Average percentage viewed below this is weak for a long documentary. */
export const AVG_VIEW_LOW = 40

export type DiagnosisKind = 'packaging' | 'hook' | 'topic' | 'ok' | 'unknown'

export interface DiagnosisInput {
  /** Impressions click-through rate, % */
  ctr: number | null
  /** % of viewers still watching at 0:30 */
  retention30: number | null
  /** Average percentage viewed, % */
  avgViewPct: number | null
  channelMedians?: { ctr?: number | null; retention30?: number | null; avgViewPct?: number | null }
}

export interface Diagnosis {
  kind: DiagnosisKind
  label: string
  detail: string
}

const pct = (v: number): string => `${v.toFixed(1).replace('.', ',').replace(/,0$/, '')}%`

/**
 * Which part of the video fails: packaging (title/thumbnail), hook (the opening does not
 * deliver what the click promised) or the topic itself. Retention uses 0:30 when known,
 * else the average percentage viewed.
 */
export function diagnose(input: DiagnosisInput): Diagnosis {
  const { ctr, retention30, avgViewPct, channelMedians: m } = input
  const ret = retention30 ?? null
  const avg = avgViewPct || null
  if (ctr === null && ret === null && avg === null)
    return { kind: 'unknown', label: 'Sem dados', detail: 'Atualize o Analytics e informe o CTR.' }
  if (ctr === null)
    return {
      kind: 'unknown',
      label: 'Falta o CTR',
      detail: 'Informe o CTR (ou importe o CSV do Studio) para separar embalagem de gancho.'
    }
  const retLow = ret !== null ? ret < RETENTION30_LOW : avg !== null ? avg < AVG_VIEW_LOW : null
  if (retLow === null)
    return { kind: 'unknown', label: 'Falta a retenção', detail: 'Atualize o Analytics.' }

  const ctrLow = ctr < CTR_LOW
  const vs = (v: number | null | undefined): string =>
    v === null || v === undefined ? '' : ` (mediana do canal ${pct(v)})`
  const ctrText = `CTR ${pct(ctr)}${vs(m?.ctr)}`
  const retText =
    ret !== null
      ? `${pct(ret)} ainda assistindo em 0:30${vs(m?.retention30)}`
      : `${pct(avg as number)} assistido em média${vs(m?.avgViewPct)}`

  if (ctrLow && retLow)
    return {
      kind: 'topic',
      label: 'Problema de tema',
      detail: `${ctrText} e ${retText}: pouca gente clica e quem clica sai. O assunto não atrai este público.`
    }
  if (ctrLow)
    return {
      kind: 'packaging',
      label: ctr < CTR_CRITICAL ? 'Embalagem (crítico)' : 'Problema de embalagem',
      detail: `${ctrText}, mas ${retText}: o vídeo segura quem entra. Troque título/thumbnail.`
    }
  if (retLow)
    return {
      kind: 'hook',
      label: 'Gancho não entrega',
      detail: `${ctrText}, mas ${retText}: o clique acontece e a abertura não cumpre a promessa.`
    }
  return { kind: 'ok', label: 'Saudável', detail: `${ctrText} e ${retText}.` }
}

import { getState, setState } from '../db/settings'
import type { AdPage } from '../services/chroniclingamerica'

/** The real ad a topic was born from: the page and the phrase that locates it. */
export interface Evidence {
  page: AdPage
  phrase: string
  /** OCR text around the ad, given to the script writer */
  excerpt: string
}

const topicKey = (channelId: number, topic: string): string =>
  `evidence.topic.${channelId}.${topic.trim().toLowerCase().slice(0, 120)}`

/** Remember the evidence of a suggested topic until the user adds it. */
export function rememberTopicEvidence(channelId: number, topic: string, ev: Evidence): void {
  setState(topicKey(channelId, topic), ev)
}

/** Attach a suggested topic's evidence to the video created from it. */
export function attachEvidence(channelId: number, topic: string, videoId: number): void {
  const ev = getState<Evidence | null>(topicKey(channelId, topic), null)
  if (ev) setState(`evidence.video.${videoId}`, ev)
}

export function videoEvidence(videoId: number): Evidence | null {
  return getState<Evidence | null>(`evidence.video.${videoId}`, null)
}

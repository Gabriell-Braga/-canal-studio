import type { ChannelSummary } from '../../shared/types'
import { listChannels, listVideos } from '../db/repo'
import { youtubeChannelTitle } from '../services/youtube'

/** Channel cards on the picker: counts that need the user's attention. */
export function channelSummaries(): ChannelSummary[] {
  return listChannels().map((c) => {
    const videos = listVideos(c.id)
    const count = (statuses: string[]): number =>
      videos.filter((v) => statuses.includes(v.status)).length
    return {
      ...c,
      videos: videos.length,
      scriptReview: count(['SCRIPT_REVIEW']),
      finalReview: count(['FINAL_REVIEW']),
      errors: count(['ERROR']),
      scheduled: count(['SCHEDULED']),
      youtubeTitle: youtubeChannelTitle(c.id)
    }
  })
}

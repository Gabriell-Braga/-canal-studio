import React from 'react'
import { Sequence, useVideoConfig } from 'remotion'
import type { VideoProps } from '../../shared/render'
import { LogoIntro, TopBadges, YearCards } from '../Overlays'

/** Company logo card, value badges and year cards; each draws only when it has data. */
export function BusinessOverlays({
  video,
  accent
}: {
  video: VideoProps
  accent: string
}): React.JSX.Element {
  const { fps } = useVideoConfig()
  return (
    <>
      {!!video.companies?.length && !!video.introSec && (
        <Sequence durationInFrames={Math.round(video.introSec * fps)}>
          <LogoIntro companies={video.companies} seconds={video.introSec} />
        </Sequence>
      )}
      {!!video.yearCards?.length && (
        <>
          <TopBadges
            companies={video.companies ?? []}
            cards={video.yearCards}
            accent={accent}
            hideUntil={video.introSec ?? 0}
          />
          <YearCards cards={video.yearCards} accent={accent} />
        </>
      )}
    </>
  )
}

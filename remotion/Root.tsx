import React from 'react'
import { Composition, Still } from 'remotion'
import type { ThumbnailProps, VideoProps } from '../shared/render'
import { Thumbnail } from './Thumbnail'
import { Video } from './Video'

const defaultVideo: VideoProps = {
  fps: 30,
  durationSec: 5,
  narration: '',
  scenes: [],
  words: [],
  captions: true,
  music: null,
  musicVolume: 0.12,
  template: 'documentary'
}

const defaultThumb: ThumbnailProps = {
  background: '',
  text: 'Sample text',
  template: 'bold',
  variant: 0
}

export const Root: React.FC = () => (
  <>
    <Composition
      id="Video"
      component={Video}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={150}
      defaultProps={defaultVideo}
      calculateMetadata={({ props }) => ({
        fps: props.fps,
        durationInFrames: Math.max(1, Math.ceil(props.durationSec * props.fps))
      })}
    />
    <Still
      id="Thumbnail"
      component={Thumbnail}
      width={1280}
      height={720}
      defaultProps={defaultThumb}
    />
  </>
)

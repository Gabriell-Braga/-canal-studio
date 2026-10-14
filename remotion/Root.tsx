import React from 'react'
import { Composition, Still } from 'remotion'
import {
  shortDuration,
  type ShortProps,
  type ThumbnailProps,
  type VideoProps
} from '../shared/render'
import { ChannelIntro } from './ChannelIntro'
import { Short } from './Short'
import { FormatThumbnail } from './formats'
import { Video } from './Video'

const defaultVideo: VideoProps = {
  fps: 30,
  durationSec: 5,
  narration: '',
  scenes: [],
  words: [],
  captions: true,
  music: [],
  musicVolume: 0.12,
  template: 'documentary'
}

const defaultShort: ShortProps = {
  fps: 30,
  segmentStart: 0,
  segmentDuration: 10,
  narration: '',
  scenes: [],
  words: [],
  captions: true,
  music: null,
  musicVolume: 0.1,
  template: 'bold',
  headline: 'Sample headline',
  cta: { audio: '', duration: 3, text: 'Watch the full video', thumbnail: null, parentTitle: '' }
}

const defaultThumb: ThumbnailProps = {
  approach: 'number',
  background: '',
  text: '$250B → $0'
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
    <Composition
      id="Short"
      component={Short}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={defaultShort}
      calculateMetadata={({ props }) => ({
        fps: props.fps,
        durationInFrames: Math.max(1, Math.ceil(shortDuration(props) * props.fps))
      })}
    />
    <Composition
      id="ChannelIntro"
      component={ChannelIntro}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={120}
      defaultProps={{
        name: 'Channel',
        avatar: null,
        tagline: 'Stories nobody told you',
        primary: '#ffd34d',
        secondary: '#ffffff',
        font: 'Impact'
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round((props.duration ?? 4) * 30)
      })}
    />
    <Still
      id="Thumbnail"
      component={FormatThumbnail}
      width={1280}
      height={720}
      defaultProps={defaultThumb}
    />
  </>
)

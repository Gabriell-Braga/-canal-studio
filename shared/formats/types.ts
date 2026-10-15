import type { ZodRawShape } from 'zod'
import type { StockProvider } from '../types'

/**
 * Everything that makes a channel's videos its own: script and title rules, thumbnail
 * models, signature overlays, where topics and media come from, voices and shorts.
 * A new format is one file in shared/formats plus its overlay components in remotion/formats.
 */
export interface FormatPack {
  id: string
  /** Shown in Configurações do canal (pt-BR) */
  name: string
  description: string
  scriptRules: ScriptRules
  titleRules: TitleRules
  /** Exactly three: every video gets one thumbnail per model, for "Testar e comparar" */
  thumbModels: ThumbModel[]
  overlays: OverlayDef[]
  topicSource: TopicSource
  /** Default media order for a channel that picks this format */
  mediaProviders: StockProvider[]
  voices: Voices
  saturatedTopics: string[]
  shortsRules: ShortsRules
  metadataRules: MetadataRules
  /** Media made after this year is refused (public-domain formats) */
  maxMediaYear?: number
  /** Wikimedia Commons categories searched for this format */
  wikimediaCategories?: string[]
}

export interface ScriptRules {
  /** What the first 5–8 seconds must deliver */
  hook: string
  /** The 15–30 s re-hook */
  rehook: string
  /** Rules that hold for the whole script */
  body: string
  ending: string
  /** Openings and phrases the script must never use */
  banned: string[]
  /** Narrative structures the videos alternate between (3–4) */
  structures: { id: string; name: string; outline: string }[]
}

export interface TitleRules {
  count: number
  maxChars: number
  rules: string
  /** Tone examples, never a template */
  good: string[]
  /** Worn-out shapes this channel must not use */
  banned: string[]
}

export interface ThumbModel {
  id: string
  /** pt-BR label for the review screen */
  label: string
  /** Instruction for the LLM that designs the concept */
  brief: string
  /** Layout the Remotion thumbnail draws for this model (see remotion/formats) */
  layout: string
  /** Wants a real face with an edited expression when one is available */
  face?: boolean
  /** Uses the real ad scan of the video as this image instead of an AI image */
  scan?: 'background' | 'background2'
}

/**
 * A signature overlay. The script step asks the LLM for its fields (validated with Zod);
 * the render draws it only when the channel's format declares it.
 */
export interface OverlayDef {
  id: string
  label: string
  /** Prompt rules for the fields below */
  rules: string
  /** Extra top-level fields of the script JSON */
  scriptFields?: ZodRawShape
  /** Extra fields of every scene */
  sceneFields?: ZodRawShape
}

export interface TopicSource {
  kind: 'llm' | 'api' | 'both'
  /** What a good topic looks like for this channel */
  brief: string
  /** Example working titles (tone only) */
  examples: string[]
  /** Search terms for the API source */
  queries?: string[]
  /** Starting list of topics */
  seeds?: string[]
}

export interface Voices {
  /** Kokoro voice the channel starts with */
  narrator: string
  /** Optional second voice and what it reads */
  secondary?: { voice: string; role: string; filter?: string }
}

export interface ShortsRules {
  minSec: number
  maxSec: number
  hookMaxWords: number
  /** How the short opens, ends and what it shows */
  brief: string
}

export interface MetadataRules {
  /** What the description must contain */
  description: string
  /** YouTube category: 27 Education, 22 People & Blogs */
  categoryId: string
  /** Named series, one playlist each */
  series: string[]
}

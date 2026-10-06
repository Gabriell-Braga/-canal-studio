import type { JobType } from '../../shared/types'
import { scriptStep } from './script'
import type { Step } from './types'

export const steps: Partial<Record<JobType, Step>> = {
  script: scriptStep
}

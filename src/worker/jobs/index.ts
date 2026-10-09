import type { JobDefinition } from '~/worker/queue'
import { heartbeatJob } from './system.heartbeat'

// Un archivo por job (SPEC §7); todos se registran aquí.
export const jobs: JobDefinition[] = [heartbeatJob]

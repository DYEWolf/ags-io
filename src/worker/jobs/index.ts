import type { JobDefinition } from '~/worker/queue'
import { auditRunJob } from '~/worker/jobs/audit.run'
import { auditScheduleJob } from '~/worker/jobs/audit.schedule'
import { authCleanupJob } from '~/worker/jobs/auth.cleanup'
import { emailSendJob } from '~/worker/jobs/email.send'
import { geoExtractJob } from '~/worker/jobs/geo.extract'
import { gscScheduleJob } from '~/worker/jobs/gsc.schedule'
import { gscSyncJob } from '~/worker/jobs/gsc.sync'
import { siteVerifyJob } from '~/worker/jobs/site.verify'
import { heartbeatJob } from '~/worker/jobs/system.heartbeat'

// Registro de jobs del worker: añadir aquí cada archivo nuevo de `jobs/`.
export const jobs: JobDefinition[] = [
  heartbeatJob,
  emailSendJob,
  authCleanupJob,
  auditScheduleJob,
  auditRunJob,
  geoExtractJob,
  siteVerifyJob,
  gscScheduleJob,
  gscSyncJob,
]

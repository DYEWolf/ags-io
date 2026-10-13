import type { JobDefinition } from '~/worker/queue'
import { auditRunJob } from '~/worker/jobs/audit.run'
import { auditScheduleJob } from '~/worker/jobs/audit.schedule'
import { bingScheduleJob } from '~/worker/jobs/bing.schedule'
import { bingSyncJob } from '~/worker/jobs/bing.sync'
import { botsIngestJob } from '~/worker/jobs/bots.ingest'
import { botsRangesJob } from '~/worker/jobs/bots.ranges'
import { botsReclassifyJob } from '~/worker/jobs/bots.reclassify'
import { botsRetentionJob } from '~/worker/jobs/bots.retention'
import { authCleanupJob } from '~/worker/jobs/auth.cleanup'
import { emailSendJob } from '~/worker/jobs/email.send'
import { geoExtractJob } from '~/worker/jobs/geo.extract'
import { gscScheduleJob } from '~/worker/jobs/gsc.schedule'
import { gscSyncJob } from '~/worker/jobs/gsc.sync'
import { siteVerifyJob } from '~/worker/jobs/site.verify'
import { inspectionRunJob } from '~/worker/jobs/inspection.run'
import { inspectionScheduleJob } from '~/worker/jobs/inspection.schedule'
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
  bingScheduleJob,
  bingSyncJob,
  inspectionScheduleJob,
  inspectionRunJob,
  botsIngestJob,
  botsReclassifyJob,
  botsRangesJob,
  botsRetentionJob,
]

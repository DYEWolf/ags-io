import { jobs } from '~/worker/jobs'

// Vista de los crons definidos (UTC salvo `tz`). La fuente es `schedule` de cada job en `jobs/`.
export const schedules = jobs
  .filter((job) => job.schedule)
  .map((job) => ({ name: job.name, cron: job.schedule?.cron, tz: job.schedule?.tz ?? 'UTC' }))

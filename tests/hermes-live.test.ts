import { describe, expect, it } from 'vitest';
import { createHermesService } from '../src/hermes/service.js';

/** Opt-in metadata-only compatibility check. No chat creation, inference or cron execution. */
describe.skipIf(process.env.HERMES_LIVE_SSH_TEST !== '1')('live managed SSH connector', () => {
  it('reads profile-owned cron/session metadata and disposes its private backend', async () => {
    const service = createHermesService({ connections: [{
      id: 'live-ssh', label: 'Live metadata test', kind: 'ssh', ssh: {
        host: process.env.HERMES_LIVE_SSH_HOST ?? 'fnordistan',
        user: process.env.HERMES_LIVE_SSH_USER ?? 'fnord', mode: 'managed',
        repoPath: process.env.HERMES_LIVE_REPO ?? '/srv/fnord/hermes-agent',
        pythonPath: process.env.HERMES_LIVE_PYTHON ?? '/srv/fnord/hermes-agent/venv/bin/python',
        hermesHome: process.env.HERMES_LIVE_HOME ?? '/home/fnord/.hermes',
      },
    }] });
    try {
      const profiles = await service.listProfiles('live-ssh');
      expect(profiles.length > 0).toBe(true);
      const allJobs = await service.listCron('live-ssh', 'all');
      expect(allJobs.every(job => profiles.some(profile => profile.name === job.profile))).toBe(true);
      let sessionCount = 0;
      for (const profile of profiles) {
        const sessions = await service.listSessions('live-ssh', profile.name);
        expect(sessions.every(session => session.profile === profile.name)).toBe(true);
        sessionCount += sessions.length;
        const jobs = await service.listCron('live-ssh', profile.name);
        expect(jobs.every(job => job.profile === profile.name)).toBe(true);
      }
      let runCount = 0;
      if (allJobs[0]) {
        const runs = await service.getCronRuns('live-ssh', allJobs[0].profile, allJobs[0].id, 3);
        expect(runs.every(run => run.profile === allJobs[0]!.profile)).toBe(true);
        runCount = runs.length;
      }
      console.log(JSON.stringify({ profileCount: profiles.length, cronCount: allJobs.length, listedSessionCount: sessionCount, inspectedRunCount: runCount, inference: false, cronTriggered: false }));
    } finally { await service.dispose(); }
  }, 150_000);
});

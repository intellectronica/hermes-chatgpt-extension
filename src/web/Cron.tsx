import { useEffect, useRef } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import type { WorkspaceState, WorkspaceStore } from './store';
import { DISPLAY_TIMEZONE, formatInstant, statusLabel } from './format';
import { Icon } from './icons';

function Status({ value }: { value?: string }) {
  return <span className="status-badge" data-status={value}>{statusLabel(value)}</span>;
}

export function Cron({ state, store }: { state: WorkspaceState; store: WorkspaceStore }) {
  const detail = useRef<HTMLElement>(null);
  useEffect(() => { detail.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [state.selectedJob?.id, state.selectedJob?.profile]);
  const job = state.selectedJob;
  return <section className="cron-area" aria-label="Cron jobs">
    <div className="cron-heading">
      <div><h1>Cron jobs</h1><p>Schedules and run history. Times shown in {DISPLAY_TIMEZONE}.</p></div>
      <div className="cron-controls">
        <label className="cron-filter">Show
          <select value={state.allProfiles ? 'all' : 'selected'} onChange={(event) => store.setAllProfiles(event.target.value === 'all')} aria-label="Cron profile filter">
            <option value="selected">This profile</option><option value="all">All profiles</option>
          </select>
        </label>
        <Button color="secondary" variant="ghost" size="md" disabled={state.cronLoading || !state.profile} onClick={() => void store.loadCron()}><Icon name="refresh" width="15" height="15" />Refresh</Button>
      </div>
    </div>
    {state.cronError && <div className="panel-banner error" role="alert"><p>{state.cronError}</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.loadCron()}>Retry</Button></div>}
    {state.cronLoading ? <div className="empty-loading" role="status">Loading cron jobs…</div>
      : state.cronError && !state.cron.length ? <p className="cron-cell-secondary">Cron jobs are unavailable until the connection recovers.</p>
        : !state.cron.length ? <div className="welcome"><div className="welcome-mark"><Icon name="clock" /></div><h1>No cron jobs to show</h1><p>{state.profile ? `No jobs were returned for ${state.allProfiles ? 'this connection' : `the ${state.profile} profile`}.` : 'Choose a connection and profile to see its jobs.'}</p></div>
        : <div className="cron-table-wrap"><table className="cron-table">
          <thead><tr><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Next run</th><th scope="col">Execution</th><th scope="col">Delivery</th></tr></thead>
          <tbody>{state.cron.map((item) => <tr key={JSON.stringify([item.profile, item.id])}>
            <td><button className="cron-name" onClick={() => void store.openJob(item)} aria-expanded={job?.profile === item.profile && job?.id === item.id}>{item.name || item.id}</button>
              <span className="cron-cell-secondary">{item.profile} · {item.enabled ? 'Enabled' : 'Paused'}</span></td>
            <td>{item.schedule}<span className="cron-cell-secondary">{item.timezone ? `Schedule timezone: ${item.timezone}` : 'Schedule timezone: unknown'}</span></td>
            <td className="cron-time"><time dateTime={item.nextRunAt}>{formatInstant(item.nextRunAt)}</time></td>
            <td><Status value={item.lastStatus} /><span className="cron-cell-secondary"><time dateTime={item.lastRunAt}>{item.lastRunAt ? formatInstant(item.lastRunAt) : 'No recorded time'}</time></span></td>
            <td><Status value={item.deliveryStatus} /></td>
          </tr>)}</tbody>
        </table></div>}
    <p className="cron-cell-secondary" style={{ marginTop: 18 }}>Viewing jobs does not run or change them. Scheduler health: unknown.</p>
    {job && <section className="cron-detail" ref={detail} aria-label={`Details for ${job.name}`}>
      <div className="cron-detail-header"><h2>{job.name || job.id}</h2><button className="icon-button" aria-label="Close job details" onClick={() => store.closeJob()}><Icon name="close" /></button></div>
      <dl>
        <dt>Profile</dt><dd>{job.profile}</dd>
        <dt>Job ID</dt><dd>{job.id}</dd>
        <dt>Schedule</dt><dd>{job.schedule}</dd>
        <dt>Timezone</dt><dd>{job.timezone ?? 'Unknown'}</dd>
        <dt>State</dt><dd>{job.enabled ? 'Enabled' : 'Paused'}</dd>
        <dt>Next run</dt><dd><time dateTime={job.nextRunAt} title={job.nextRunAt}>{formatInstant(job.nextRunAt, true)}</time> ({DISPLAY_TIMEZONE})</dd>
        <dt>Execution</dt><dd>{statusLabel(job.lastStatus)}</dd>
        <dt>Delivery</dt><dd>{statusLabel(job.deliveryStatus)}</dd>
      </dl>
      {job.lastError && <><h3>Latest error</h3><pre>{job.lastError}</pre></>}
      <h3>Recent runs</h3>
      {state.runsError && <div className="panel-banner error" role="alert"><p>{state.runsError}</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.openJob(job)}>Retry</Button></div>}
      {state.runsLoading ? <p className="cron-cell-secondary" role="status">Loading run history…</p>
        : state.runs.length ? <div className="runs-list">{state.runs.map((run) => <article className="run-item" key={run.id}>
          <div className="run-heading"><time dateTime={run.startedAt} title={run.startedAt}>{formatInstant(run.startedAt, true)}</time><Status value={run.status} /></div>
          <p>{run.title || run.id} · Delivery: {statusLabel(run.deliveryStatus)}{run.finishedAt ? ` · Finished ${formatInstant(run.finishedAt)}` : ''}</p>
          {run.output && <details><summary>View output</summary><pre>{run.output}</pre></details>}
        </article>)}</div> : !state.runsError && <p className="cron-cell-secondary">No recorded runs were returned.</p>}
    </section>}
  </section>;
}

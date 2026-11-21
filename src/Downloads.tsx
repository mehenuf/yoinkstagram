import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, ChevronLeft, ChevronRight, CircleAlert, Clock3, Download, FolderOpen,
  History, ListOrdered, Pause, Play, Plus, RefreshCw, Search, Square, Timer, Trash2, X,
} from 'lucide-react';
import type { ArchivistApi, Job, JobStatus, LogEntry, Snapshot, TargetType } from './types';

const sources: Record<TargetType, string> = {
  profile: 'Profile', post: 'Post or reel', saved: 'Saved posts', feed: 'Home feed',
  stories: 'Followed stories', hashtag: 'Hashtag', location: 'Location',
  followees: 'Followed profiles', metadata: 'Metadata',
};
const statusLabels: Record<JobStatus, string> = {
  queued: 'Queued', running: 'Downloading', cooldown: 'Cooling down', completed: 'Completed',
  partial: 'Partial', failed: 'Failed', canceled: 'Canceled', interrupted: 'Interrupted',
};
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const queueStates: JobStatus[] = ['queued', 'running', 'cooldown'];
const resumableStates: JobStatus[] = ['failed', 'partial', 'canceled', 'interrupted'];
const pageSize = 30;
type Perform = (operation: () => Promise<void>, message?: string) => Promise<void>;

export function belongsToQueue(job: Job) {
  return queueStates.includes(job.status);
}

function jobTitle(job: Job) {
  const { targets, targetType } = job.request;
  if (targets.length === 0) return sources[targetType];
  const first = targets[0];
  const name = targetType === 'profile' || targetType === 'followees'
    ? `@${first.replace(/^@/, '')}`
    : targetType === 'hashtag' ? `#${first.replace(/^#/, '')}`
    : targetType === 'metadata' ? first.split(/[/\\]/).at(-1) || first
    : first;
  return targets.length > 1 ? `${name} +${targets.length - 1}` : name;
}

function Status({ status }: { status: JobStatus }) {
  return <span className={`job-badge state-${status}`}><span />{statusLabels[status]}</span>;
}

export function Activity({ jobs, viewJob, openQueue }: {
  jobs: Job[]; viewJob: (id: string) => void; openQueue: () => void;
}) {
  const recent = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  return (
    <section className="panel activity" aria-labelledby="activity-heading">
      <div className="activity-heading">
        <div className="title-with-icon"><span className="panel-icon"><History size={18} /></span><h2 id="activity-heading">Recent activity</h2></div>
        <button type="button" className="icon-button activity-link" title="Open download queue" aria-label="Open download queue" onClick={openQueue}><ArrowRight size={18} /></button>
      </div>
      {recent.length === 0 ? (
        <div className="activity-empty">
          <div className="empty-art"><Download size={24} strokeWidth={1.45} /><span /><i /></div>
          <h3>No downloads yet</h3>
          <p>Your latest downloads will appear here.</p>
        </div>
      ) : (
        <ul className="activity-jobs">
          {recent.map((job) => (
            <li key={job.id}>
              <button type="button" className="activity-job" onClick={() => viewJob(job.id)}>
                <span className="job-icon"><Download size={16} /></span>
                <span className="activity-job-copy"><strong>{jobTitle(job)}</strong><small>{sources[job.request.targetType]}</small></span>
                <Status status={job.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DownloadList({ section, snapshot, api, perform, viewJob, newDownload }: {
  section: 'queue' | 'history'; snapshot: Snapshot; api?: ArchivistApi; perform: Perform;
  viewJob: (id: string) => void; newDownload: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(Date.now);
  const queue = section === 'queue';
  const all = snapshot.jobs.filter((job) => belongsToQueue(job) === queue);
  const query = search.trim().toLowerCase();
  const jobs = all.filter((job) => (!status || status === job.status) && (!query ||
    [jobTitle(job), sources[job.request.targetType], ...job.request.targets].some((value) => value.toLowerCase().includes(query))));
  if (!queue) jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  const pageCount = Math.max(1, Math.ceil(jobs.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleJobs = jobs.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const countdown = snapshot.cooldownUntil ? Math.max(0, Math.ceil((snapshot.cooldownUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (!snapshot.cooldownUntil) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.cooldownUntil]);

  return (
    <div className="list-screen">
      <div className="list-heading">
        <div>
          <h1>{queue ? 'Download queue' : 'Download history'}</h1>
          <p>{queue ? 'Track downloads and manage what runs next.' : 'Reopen saved files or pick up an interrupted download.'}</p>
        </div>
        {queue ? <button type="button" className="soft-button" disabled={!api}
          onClick={() => api && void perform(() => api.pauseQueue(!snapshot.paused), snapshot.paused ? 'Queue resumed.' : 'Queue paused after the current job.')}>
          {snapshot.paused ? <Play size={16} /> : <Pause size={16} />} {snapshot.paused ? 'Resume queue' : 'Pause queue'}
        </button> : <button type="button" className="solid-button" onClick={newDownload}><Plus size={18} /> New download</button>}
      </div>

      {queue && countdown > 0 && <div className="queue-banner" role="status">
        <Timer size={19} /><span>Waiting for Instagram’s rate limit to reset.</span>
        <strong aria-live="off">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</strong>
      </div>}
      {queue && snapshot.paused && <div className="queue-banner"><Pause size={18} />
        <span>The queue is paused. Any active download can finish.</span></div>}

      <section className="panel list-panel" aria-label={queue ? 'Queued downloads' : 'Past downloads'}>
        <div className="list-toolbar">
          <span className="list-count">{all.length} {all.length === 1 ? 'job' : 'jobs'}</span>
          <label className="search-box"><Search size={16} /><input aria-label="Search downloads" value={search}
            placeholder="Search downloads" onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
          <select aria-label="Filter by status" className="status-filter" value={status}
            onChange={(event) => { setStatus(event.target.value as JobStatus | ''); setPage(0); }}>
            <option value="">All statuses</option>
            {(queue ? queueStates : ['completed', ...resumableStates] as JobStatus[]).map((key) =>
              <option value={key} key={key}>{statusLabels[key]}</option>)}
          </select>
        </div>

        {jobs.length === 0 ? (
          <div className="list-empty">
            <div className="empty-art">{queue ? <ListOrdered size={24} /> : <History size={24} />}<span /><i /></div>
            <h2>{all.length ? 'No matching downloads' : queue ? 'The queue is empty' : 'No download history yet'}</h2>
            {all.length
              ? <button type="button" className="soft-button" onClick={() => { setSearch(''); setStatus(''); }}>Clear filters</button>
              : <button type="button" className="solid-button" onClick={newDownload}><Plus size={17} /> New download</button>}
          </div>
        ) : (
          <ul className="job-list">
            {visibleJobs.map((job) => <li key={job.id}>
              <button type="button" className="job-row" onClick={() => viewJob(job.id)} aria-label={`View ${jobTitle(job)} download`}>
                <span className="job-icon"><ArrowDownToLine size={19} /></span>
                <span className="job-row-title"><strong>{jobTitle(job)}</strong><small>{sources[job.request.targetType]} · {dateTime.format(job.createdAt)}</small></span>
                <span className="job-row-files">{job.files.toLocaleString()} {job.files === 1 ? 'file' : 'files'}</span>
                <Status status={job.status} />
                <ChevronRight size={18} className="job-row-arrow" />
              </button>
            </li>)}
          </ul>
        )}
        {pageCount > 1 && <nav className="list-pages" aria-label="Download pages">
          <button type="button" className="icon-button" disabled={currentPage === 0} aria-label="Previous page"
            onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button type="button" className="icon-button" disabled={currentPage === pageCount - 1} aria-label="Next page"
            onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button>
        </nav>}
      </section>
    </div>
  );
}

export function JobDialog({ job, api, onClose, perform }: {
  job: Job; api: ArchivistApi; onClose: () => void; perform: Perform;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logError, setLogError] = useState(false);
  const active = belongsToQueue(job);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let current = true;
    api.getJobLogs(job.id).then((entries) => {
      if (current) { setLogs(entries); setLogError(false); }
    }).catch(() => {
      if (current) setLogError(true);
    });
    return () => { current = false; };
  }, [api, job.id, job.updatedAt]);

  async function act(operation: () => Promise<void>, message?: string) {
    setBusy(true);
    try { await perform(operation, message); }
    finally { setBusy(false); }
  }

  return (
    <dialog className="job-dialog" ref={dialog} onClose={onClose} aria-labelledby="job-dialog-title">
      <header className="job-dialog-heading">
        <span className="panel-icon"><ArrowDownToLine size={20} /></span>
        <div><span className="job-dialog-source">{sources[job.request.targetType]}</span><h2 id="job-dialog-title">{jobTitle(job)}</h2></div>
        <button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="Close job details"><X size={21} /></button>
      </header>

      <div className="job-info">
        <div><span>Status</span><Status status={job.status} /></div>
        <div><span>Items processed</span><strong>{job.items.toLocaleString()}</strong></div>
        <div><span>Files saved</span><strong>{job.files.toLocaleString()}</strong></div>
      </div>
      {(job.phase || job.message) && <div role="status" className={`job-message ${job.status === 'failed' ? 'job-message-error' : ''}`}>
        {job.status === 'failed' ? <CircleAlert size={17} /> : <Clock3 size={16} />}
        <span>{job.message || job.phase}</span>
      </div>}
      <div className="detail-fields">
        {job.request.targets.length > 1 && <div><strong>Targets</strong><p>{job.request.targets.join(', ')}</p></div>}
        <div><strong>Download folder</strong><p>{job.request.destination}</p></div>
      </div>
      <div className="log-wrap">
        <h3>Activity log</h3>
        {logs.length > 0 ? (
          <ol className="logs" aria-label="Activity log" tabIndex={0}>
            {logs.map((entry, index) => <li className={`log-${entry.level}`} key={`${entry.at}-${index}`}>
              <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span>
            </li>)}
          </ol>
        ) : <p className="empty-log">{logError ? 'The activity log is unavailable.' : 'Activity appears here when this download starts.'}</p>}
      </div>

      {confirmRemove ? <div className="job-dialog-actions">
        <span className="remove-prompt">Remove this job from your history?</span>
        <button type="button" className="soft-button" onClick={() => setConfirmRemove(false)}>Keep job</button>
        <button type="button" className="danger-button" disabled={busy} onClick={() => void act(async () => {
          await api.removeJob(job.id);
          onClose();
        }, 'Job removed from history.')}><Trash2 size={16} /> Remove</button>
      </div> : <div className="job-dialog-actions">
        {!active && <button type="button" className="icon-button remove-job" title="Remove from history" aria-label="Remove from history"
          onClick={() => setConfirmRemove(true)} disabled={busy}><Trash2 size={17} /></button>}
        <button type="button" className="soft-button" disabled={busy}
          onClick={() => void act(() => api.openDirectory(job.request.destination))}><FolderOpen size={16} /> Open folder</button>
        {active && <button type="button" className="danger-button" disabled={busy || job.phase === 'Canceling'}
          onClick={() => void act(() => api.cancelJob(job.id))}><Square size={15} /> Cancel download</button>}
        {resumableStates.includes(job.status) && <button type="button" className="solid-button" disabled={busy}
          onClick={() => void act(() => api.retryJob(job.id), 'Download added back to the queue.')}><RefreshCw size={15} /> Retry download</button>}
      </div>}
    </dialog>
  );
}

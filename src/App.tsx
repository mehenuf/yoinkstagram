import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CircleCheck, Clock3,
  Camera, ExternalLink, HardDrive, History, Images, LayoutGrid, ListOrdered, LogIn,
  Moon, Settings2, Sun, X,
} from 'lucide-react';
import { AccountDialog, SettingsPanel, Workbench } from './Workbench';
import { Activity, DownloadList, JobDialog, belongsToQueue } from './Downloads';
import { GithubIcon } from './GithubIcon';
import mark from './assets/mark.png';
import coast from './assets/coast.webp';
import type { Snapshot } from './types';

export type Theme = 'light' | 'dark' | 'system';

const sections = [
  { id: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { id: 'queue', label: 'Download queue', icon: ListOrdered },
  { id: 'history', label: 'Download history', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const;
type Section = (typeof sections)[number]['id'];

const unloaded: Snapshot = {
  jobs: [], paused: false, cooldownUntil: null, account: null,
  settings: { destination: '', reduceMotion: false }, version: '1.1.0',
};

const count = new Intl.NumberFormat();

export function App() {
  const api = window.archivist;
  const [snapshot, setSnapshot] = useState<Snapshot>(unloaded);
  const [section, setSection] = useState<Section>('workspace');
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Theme Management
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('yoinkstagram_theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  const [systemIsDark, setSystemIsDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
  );

  const effectiveTheme = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    if (api?.setThemeOverlay) {
      void api.setThemeOverlay(effectiveTheme === 'dark');
    }
  }, [effectiveTheme, api]);

  const setThemeAndPersist = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    try {
      localStorage.setItem('yoinkstagram_theme', newTheme);
    } catch {
      // storage unavailable
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeAndPersist(effectiveTheme === 'dark' ? 'light' : 'dark');
  }, [effectiveTheme, setThemeAndPersist]);

  const openUrl = useCallback((url: string) => {
    if (api?.openExternal) {
      void api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }, [api]);

  const openGithub = useCallback(() => {
    openUrl('https://github.com/mehenuf/yoinkstagram');
  }, [openUrl]);

  const scroll = useRef<HTMLElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const compact = window.matchMedia('(prefers-reduced-motion: reduce)').matches || snapshot.settings.reduceMotion;
  const selected = snapshot.jobs.find((job) => job.id === selectedJob);
  const queued = snapshot.jobs.filter(belongsToQueue).length;
  const files = snapshot.jobs.reduce((total, job) => total + job.files, 0);
  const completed = snapshot.jobs.filter((job) => job.status === 'completed').length;
  const sectionTitle = sections.find((item) => item.id === section)!.label;

  useEffect(() => {
    if (!api) return;
    let mounted = true;
    let receivedUpdate = false;
    const unsubscribe = api.subscribe((update) => {
      receivedUpdate = true;
      setSnapshot(update);
      setReady(true);
    });
    api.getState().then((initial) => {
      if (mounted && !receivedUpdate) {
        setSnapshot(initial);
        setReady(true);
      }
    }).catch((error: unknown) => {
      if (mounted && !receivedUpdate) setStartupError(String(error));
    });
    return () => { mounted = false; unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), notice.error ? 6500 : 3300);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const navigate = useCallback((next: Section) => {
    setSection(next);
    scroll.current?.scrollTo({ top: 0 });
  }, []);

  const focusComposer = useCallback(() => {
    const panel = composer.current;
    if (!panel) return;
    panel.scrollIntoView({ block: 'nearest', behavior: compact ? 'instant' : 'smooth' });
    (panel.querySelector<HTMLInputElement>('input:not([type="hidden"]), textarea') ??
      panel.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }, [compact]);

  const newDownload = useCallback(() => {
    if (section === 'workspace') focusComposer();
    else {
      pendingFocus.current = true;
      navigate('workspace');
    }
  }, [focusComposer, navigate, section]);

  useEffect(() => {
    if (section !== 'workspace' || !pendingFocus.current) return;
    pendingFocus.current = false;
    const frame = requestAnimationFrame(focusComposer);
    return () => cancelAnimationFrame(frame);
  }, [section, focusComposer]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        newDownload();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [newDownload]);

  const perform = useCallback(async (operation: () => Promise<void>, message?: string) => {
    try {
      await operation();
      if (message) setNotice({ text: message, error: false });
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
      setNotice({ text, error: true });
    }
  }, []);

  return (
    <div className="app-frame" data-theme={effectiveTheme} data-reduced-motion={compact}>
      <aside className="rail" aria-label="Sidebar">
        <button type="button" className="brand" onClick={() => navigate('workspace')} aria-label="Yoinkstagram workspace">
          <img src={mark} alt="" width="40" height="40" />
          <span>Yoinkstagram</span>
        </button>
        <nav className="rail-nav" aria-label="Navigation"
          style={{ '--active-row': sections.findIndex((item) => item.id === section) } as CSSProperties}>
          <span className="rail-highlight" aria-hidden="true" />
          {sections.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} className={`rail-link ${section === id ? 'selected' : ''}`}
              aria-current={section === id ? 'page' : undefined} title={label} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === 'queue' && queued > 0 && <small>{queued}</small>}
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <button type="button" className="storage" title={snapshot.settings.destination || 'Open download folder'}
            disabled={!api || !ready}
            onClick={() => api && void perform(() => api.openDirectory(snapshot.settings.destination))}>
            <span className="storage-icon"><HardDrive size={17} /></span>
            <span><strong>Local storage</strong><small>Open download folder</small></span>
            <ArrowUpRight size={15} />
          </button>

          <button
            type="button"
            className="rail-github-link"
            onClick={openGithub}
            title="View Yoinkstagram source code on GitHub"
            aria-label="GitHub repository"
          >
            <span className="github-icon-badge"><GithubIcon size={15} /></span>
            <div className="github-link-copy">
              <strong>mehenuf/yoinkstagram</strong>
              <small>Source & Releases</small>
            </div>
            <ArrowUpRight size={14} className="github-link-arrow" />
          </button>

          <div className="version-info">
            <div className="version-row">
              <span>Yoinkstagram</span>
              <span className="version-tag">v{snapshot.version}</span>
            </div>
            <div className="credit-row">
              Crafted by <strong>Md. Mehenuf Hossain Bhuiyan</strong>
            </div>
          </div>
        </div>
      </aside>

      <div className="app-body">
        <header className="window-bar">
          <div className="breadcrumbs"><LayoutGrid size={14} /><span>/</span><strong>{sectionTitle}</strong></div>
          <div className="window-bar-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={`Switch to ${effectiveTheme === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label="Toggle theme"
            >
              {effectiveTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{effectiveTheme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            <button
              type="button"
              className="github-pill"
              onClick={openGithub}
              title="Open GitHub repository (mehenuf/yoinkstagram)"
              aria-label="GitHub repository"
            >
              <GithubIcon size={14} />
              <span>GitHub</span>
              <ArrowUpRight size={13} className="ext-icon" />
            </button>

            <button type="button" className="account-pill" onClick={() => setAccountOpen(true)}
              disabled={!api || !ready} title={snapshot.account ? `Signed in as @${snapshot.account}` : 'Sign in to Instagram'}>
              {snapshot.account ? <span className="account-dot" /> : <Camera size={15} />}
              <span>{snapshot.account ? `@${snapshot.account}` : 'Sign in'}</span>
              {!snapshot.account && <LogIn size={13} className="account-arrow" />}
            </button>
          </div>
        </header>

        <main ref={scroll} id="main-content" className="main-content">
          {startupError && <div role="alert" className="startup-error">Yoinkstagram couldn’t open its local workspace. {startupError}</div>}
          {!api && <div className="startup-error" role="status">Open Yoinkstagram in the desktop app to start downloading.</div>}
          <div className="screen" key={section}>
            {section === 'workspace' && (
              <>
                <section className="hero" aria-labelledby="hero-title">
                  <div className="hero-art" aria-hidden="true">
                    <div className="hero-art-ring" />
                    <div className="hero-photo">
                      <img className="hero-image" src={coast} alt="" draggable={false} />
                      <span className="photo-action"><ArrowDownToLine size={23} strokeWidth={2.2} /></span>
                    </div>
                  </div>
                  <div className="hero-copy">
                    <h1 id="hero-title">Your Instagram <em>archive.</em></h1>
                    <p>Save posts, reels, stories, and highlights with granular control and zero cloud tracking.</p>
                    <button type="button" className="hero-action" onClick={newDownload} disabled={!api || !ready}>
                      <ArrowDownToLine size={17} /> New download <ArrowRight size={15} className="hero-action-arrow" />
                    </button>
                  </div>
                </section>
                <section className="statistics" aria-label="Download summary">
                  <Metric icon={Clock3} label="In queue" value={queued} onClick={() => navigate('queue')} />
                  <Metric icon={CircleCheck} label="Completed jobs" value={completed} onClick={() => navigate('history')} />
                  <Metric icon={Images} label="Files saved" value={files} onClick={() => navigate('history')} />
                </section>
                <div className="workspace-grid">
                  <div ref={composer} className="compose-anchor">
                    {api && ready ? <Workbench api={api} settings={snapshot.settings} account={snapshot.account}
                      onSignIn={() => setAccountOpen(true)} onEnqueued={() => setNotice({ text: 'Added to the download queue.', error: false })} />
                      : <div className="panel loading-panel"><ArrowDownToLine size={21} /><h2>New download</h2>
                        <p>{startupError || !api ? 'Launch the desktop app to connect the download engine.' : 'Opening your workspace…'}</p></div>}
                  </div>
                  <Activity jobs={snapshot.jobs} viewJob={setSelectedJob} openQueue={() => navigate('queue')} />
                </div>
              </>
            )}
            {(section === 'queue' || section === 'history') && <DownloadList section={section}
              snapshot={snapshot} api={api} perform={perform} viewJob={setSelectedJob} newDownload={newDownload} />}
            {section === 'settings' && api && ready && (
              <SettingsPanel
                api={api}
                settings={snapshot.settings}
                account={snapshot.account}
                version={snapshot.version}
                onSignIn={() => setAccountOpen(true)}
                theme={theme}
                onSelectTheme={setThemeAndPersist}
                onOpenUrl={openUrl}
              />
            )}
          </div>
        </main>
      </div>

      {api && accountOpen && <AccountDialog api={api} account={snapshot.account} onClose={() => setAccountOpen(false)} />}
      {api && selected && <JobDialog job={selected} api={api} onClose={() => setSelectedJob(null)} perform={perform} />}
      {notice && <div key={notice.text} className={`toast ${notice.error ? 'toast-error' : ''}`}
        role={notice.error ? 'alert' : 'status'}>
        {!notice.error && <Check size={18} />} <span>{notice.text}</span>
        <button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}
    </div>
  );
}

function Metric({ icon: Icon, label, value, onClick }: {
  icon: typeof Clock3; label: string; value: number; onClick: () => void;
}) {
  return <button type="button" className="metric" onClick={onClick}>
    <span className="metric-icon"><Icon size={19} strokeWidth={1.7} /></span>
    <span className="metric-copy"><span>{label}</span><strong>{count.format(value)}</strong></span>
    <ArrowUpRight size={15} className="metric-arrow" />
  </button>;
}

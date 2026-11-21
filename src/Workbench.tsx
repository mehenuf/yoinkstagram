import {
  AtSign, Bookmark, Camera, Check, ChevronDown, CircleHelp, Code2, Download,
  ExternalLink, FileJson, Folder, FolderOpen, Hash, Images, Laptop, Link2, ListPlus,
  LoaderCircle, LockKeyhole, LogOut, MapPin, Moon, Palmtree, Plus, Radio, Settings2, ShieldCheck,
  SlidersHorizontal, Sun, Users, X,
} from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ArchivistApi, AuthResult, DownloadOptions, JobRequest, Settings } from './types';
import { normalizeTargets } from './panels/targets';
import { GithubIcon } from './GithubIcon';
import './workbench.css';

type Source = JobRequest['targetType'];
type ToggleKey = { [K in keyof DownloadOptions]: DownloadOptions[K] extends boolean ? K : never }[keyof DownloadOptions];

const defaultOptions: DownloadOptions = {
  posts: true, profilePicture: true, stories: false, highlights: false, tagged: false,
  reels: false, igtv: false, photos: true, videos: true, thumbnails: true,
  captions: true, metadata: true, compressMetadata: true, comments: false, geotags: false,
  fastUpdate: false, resume: true, maxItems: null, since: '', until: '', captionContains: '',
  carousel: '', folderPattern: '', filePattern: '', postTextPattern: '', storyTextPattern: '',
};

const sourceDetails = {
  profile: { label: 'Profile', fieldLabel: 'Instagram profile', placeholder: 'Username or Instagram profile URL', icon: AtSign },
  post: { label: 'Post or reel', fieldLabel: 'Instagram post or reel', placeholder: 'Post URL or shortcode', icon: Link2 },
  saved: { label: 'Saved posts', fieldLabel: '', placeholder: 'Posts you’ve saved on Instagram', icon: Bookmark },
  feed: { label: 'Home feed', fieldLabel: '', placeholder: 'Posts available in your Instagram feed', icon: Images },
  stories: { label: 'Following stories', fieldLabel: '', placeholder: 'Active stories from people you follow', icon: Radio },
  hashtag: { label: 'Hashtag', fieldLabel: 'Instagram hashtag', placeholder: 'Hashtag or Instagram tag URL', icon: Hash },
  location: { label: 'Location', fieldLabel: 'Instagram location', placeholder: 'Location ID or Instagram location URL', icon: MapPin },
  followees: { label: 'Profiles they follow', fieldLabel: 'Instagram profile', placeholder: 'Username or Instagram profile URL', icon: Users },
  metadata: { label: 'Metadata files', fieldLabel: 'Instaloader metadata', placeholder: 'Choose .json or .json.xz files', icon: FileJson },
};

const sourceGroups: { label: string; items: Source[] }[] = [
  { label: 'Direct downloads', items: ['profile', 'post', 'metadata'] },
  { label: 'Your account', items: ['saved', 'feed', 'stories'] },
  { label: 'Discovery', items: ['hashtag', 'location', 'followees'] },
];

const profileSources = new Set<Source>(['profile', 'followees']);
const accountSources = new Set<Source>(['saved', 'feed', 'stories', 'hashtag', 'location', 'followees']);
const implicitSources = new Set<Source>(['saved', 'feed', 'stories']);

const profileOptions: { key: ToggleKey; label: string; description: string }[] = [
  { key: 'posts', label: 'Posts', description: 'Photos, videos and carousels in the profile grid.' },
  { key: 'profilePicture', label: 'Profile photo', description: 'The current profile picture.' },
  { key: 'reels', label: 'Reels', description: 'Videos in the Reels tab.' },
  { key: 'stories', label: 'Stories', description: 'Active stories. Requires sign-in.' },
  { key: 'highlights', label: 'Highlights', description: 'Saved story collections. Requires sign-in.' },
  { key: 'tagged', label: 'Tagged posts', description: 'Posts where the profile is tagged.' },
  { key: 'igtv', label: 'IGTV', description: 'Legacy IGTV posts, where available.' },
];

const mediaOptions: { key: ToggleKey; label: string; description: string }[] = [
  { key: 'photos', label: 'Photos', description: 'Include photo files and photos in carousels.' },
  { key: 'videos', label: 'Videos', description: 'Include video files and videos in carousels.' },
  { key: 'thumbnails', label: 'Video thumbnails', description: 'Save a still image alongside videos.' },
];

const metadataOptions: { key: ToggleKey; label: string; description: string }[] = [
  { key: 'captions', label: 'Captions', description: 'Save captions as plain text.' },
  { key: 'metadata', label: 'Metadata', description: 'Save the data associated with each item as JSON.' },
  { key: 'compressMetadata', label: 'Compress metadata', description: 'Store the JSON files in XZ format.' },
  { key: 'comments', label: 'Comments', description: 'Save available post comments. Requires sign-in.' },
  { key: 'geotags', label: 'Geotags', description: 'Save available post locations. Requires sign-in.' },
];

const quickProfileOptions = [
  { key: 'posts', label: 'Posts' },
  { key: 'reels', label: 'Reels' },
  { key: 'stories', label: 'Stories' },
  { key: 'profilePicture', label: 'Profile photo' },
] as const;

const quickMediaOptions = [
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'captions', label: 'Captions' },
] as const;

const optionTabs = ['Content', 'Metadata', 'Filters', 'Naming'] as const;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);
}

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function Dialog({ name, description, icon, children, onClose, busy = false, wide = false }: {
  name: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const details = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={wide ? 'wb-dialog wb-dialog-wide' : 'wb-dialog'}
      aria-labelledby={heading}
      aria-describedby={description ? details : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="wb-dialog-header">
        <div className="wb-dialog-title">
          <span className="wb-mark">{icon}</span>
          <div>
            <h2 id={heading}>{name}</h2>
            {description && <p id={details}>{description}</p>}
          </div>
        </div>
        <button type="button" className="wb-icon-button" onClick={onClose} aria-label="Close dialog" disabled={busy}>
          <X size={19} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function Switch({ label, description, checked, disabled = false, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="wb-switch-row">
      <span className="wb-switch-text">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </span>
      <span className="wb-switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

function OptionDialog({ options, source, account, useSession, onApply, onClose }: {
  options: DownloadOptions;
  source: Source;
  account: string | null;
  useSession: boolean;
  onApply(options: DownloadOptions, useSession: boolean): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(options);
  const [session, setSession] = useState(useSession);
  const [tab, setTab] = useState<typeof optionTabs[number]>('Content');
  const [issue, setIssue] = useState('');
  const profile = profileSources.has(source);
  const authRequired = accountSources.has(source);

  function update<K extends keyof DownloadOptions>(key: K, value: DownloadOptions[K]) {
    setDraft((existing) => ({ ...existing, [key]: value }));
    setIssue('');
  }

  function toggle(option: { key: ToggleKey; label: string; description: string }, disabled = false) {
    return (
      <Switch
        key={option.key}
        label={option.label}
        description={option.description}
        checked={!disabled && draft[option.key]}
        disabled={disabled}
        onChange={(checked) => update(option.key, checked)}
      />
    );
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.since && draft.until && draft.since > draft.until) {
      setTab('Filters');
      setIssue('Choose an end date on or after the start date.');
      return;
    }
    if (draft.maxItems !== null && (!Number.isSafeInteger(draft.maxItems) || draft.maxItems < 1)) {
      setTab('Filters');
      setIssue('Enter a positive whole number for the item limit.');
      return;
    }
    const carousel = draft.carousel.trim().toLowerCase();
    const range = /^([1-9]\d{0,2})(?:-([1-9]\d{0,2}|last))?$/.exec(carousel);
    if (carousel && carousel !== 'all' && carousel !== 'last'
        && (!range || (range[2] && range[2] !== 'last' && Number(range[2]) <= Number(range[1])))) {
      setTab('Filters');
      setIssue('Enter a slide number, an ascending range such as 1-3, all, or last.');
      return;
    }
    onApply({
      ...draft,
      carousel,
      captionContains: draft.captionContains.trim(),
      folderPattern: draft.folderPattern.trim(),
      filePattern: draft.filePattern.trim(),
      thumbnails: draft.photos && draft.thumbnails,
      compressMetadata: draft.metadata && draft.compressMetadata,
      fastUpdate: draft.photos && draft.fastUpdate,
    }, authRequired || session);
  }

  return (
    <Dialog name="Download options" description={sourceDetails[source].label} icon={<SlidersHorizontal size={19} />} onClose={onClose} wide>
      <form className="wb-options-form" onSubmit={apply}>
        <div className="wb-option-tabs" aria-label="Option categories">
          {optionTabs.map((item) => (
            <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
        <div className="wb-options-body">
          <div className="wb-option-content" key={tab}>
            {tab === 'Content' && (
              <>
                {profile && (
                  <section className="wb-option-section">
                    <div className="wb-option-section-heading">
                      <h3>Profile content</h3>
                      <button type="button" className="wb-text-button"
                        disabled={profileOptions.every(({ key }) => draft[key])}
                        onClick={() => setDraft((current) => ({
                          ...current,
                          ...Object.fromEntries(profileOptions.map(({ key }) => [key, true])),
                        }))}>
                        Select all profile content
                      </button>
                    </div>
                    <div className="wb-options-grid">{profileOptions.map((option) => toggle(option))}</div>
                  </section>
                )}
                <section className="wb-option-section">
                  <h3>Media files</h3>
                  <div className="wb-options-grid">
                    {mediaOptions.map((option) => toggle(option, option.key === 'thumbnails' && !draft.photos))}
                  </div>
                </section>
                <section className="wb-option-section">
                  <h3>Access</h3>
                  <Switch
                    label="Use Instagram session"
                    description={account ? `Download with access available to @${account}.` : 'Sign in to download from private profiles you can view.'}
                    checked={Boolean(account && (authRequired || session))}
                    disabled={!account || authRequired}
                    onChange={setSession}
                  />
                </section>
              </>
            )}
            {tab === 'Metadata' && (
              <section className="wb-option-section">
                <h3>Companion files</h3>
                <div className="wb-options-grid">
                  {metadataOptions.map((option) => toggle(option, option.key === 'compressMetadata' && !draft.metadata))}
                </div>
              </section>
            )}
            {tab === 'Filters' && (
              <>
                <section className="wb-option-section">
                  <h3>Choose which items to save</h3>
                  <div className="wb-field-grid">
                    <label className="wb-field">
                      <span>From date · UTC</span>
                      <input type="date" value={draft.since} onChange={(event) => update('since', event.currentTarget.value)} />
                    </label>
                    <label className="wb-field">
                      <span>Through date · UTC</span>
                      <input type="date" value={draft.until} onChange={(event) => update('until', event.currentTarget.value)} />
                    </label>
                    <label className="wb-field">
                      <span>Maximum items per category</span>
                      <input type="number" min={1} step={1} placeholder="No application limit" value={draft.maxItems ?? ''} onChange={(event) => update('maxItems', event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)} />
                    </label>
                    <label className="wb-field">
                      <span>Carousel slides</span>
                      <input type="text" placeholder="All slides" value={draft.carousel} onChange={(event) => update('carousel', event.currentTarget.value)} />
                      <small>Use a slide number, a range like 1-3 or 2-last, or last.</small>
                    </label>
                    <label className="wb-field wb-field-full">
                      <span>Caption contains</span>
                      <input type="text" placeholder="Any caption" value={draft.captionContains} onChange={(event) => update('captionContains', event.currentTarget.value)} />
                    </label>
                  </div>
                </section>
                <section className="wb-option-section">
                  <h3>Updates and recovery</h3>
                  <Switch label="Fast update" description="Stop a collection when an already downloaded item is found." checked={draft.photos && draft.fastUpdate} disabled={!draft.photos} onChange={(checked) => update('fastUpdate', checked)} />
                  <Switch label="Resume interrupted collections" description="Reuse a saved position when Instaloader supports it." checked={draft.resume} onChange={(checked) => update('resume', checked)} />
                </section>
              </>
            )}
            {tab === 'Naming' && (
              <section className="wb-option-section">
                <h3>Folders and filenames</h3>
                <div className="wb-field-grid">
                  <label className="wb-field wb-field-full">
                    <span>Folder pattern</span>
                    <input type="text" value={draft.folderPattern} placeholder="{target}" spellCheck={false} onChange={(event) => update('folderPattern', event.currentTarget.value)} />
                    <small>Use {'{target}'} or {'{profile}'}. Separate subfolders with a slash.</small>
                  </label>
                  <label className="wb-field wb-field-full">
                    <span>Filename pattern</span>
                    <input type="text" value={draft.filePattern} placeholder="{date_utc}_UTC_{shortcode}" spellCheck={false} onChange={(event) => update('filePattern', event.currentTarget.value)} />
                    <small>Fields include {'{date_utc}'}, {'{shortcode}'}, {'{mediaid}'}, {'{profile}'} and {'{typename}'}.</small>
                  </label>
                  <label className="wb-field">
                    <span>Post text template</span>
                    <input type="text" value={draft.postTextPattern} placeholder="{caption}" spellCheck={false} onChange={(event) => update('postTextPattern', event.currentTarget.value)} />
                  </label>
                  <label className="wb-field">
                    <span>Story text template</span>
                    <input type="text" value={draft.storyTextPattern} placeholder="None" spellCheck={false} onChange={(event) => update('storyTextPattern', event.currentTarget.value)} />
                  </label>
                </div>
              </section>
            )}
          </div>
        </div>
        {issue && <p className="wb-message wb-dialog-message" role="alert">{issue}</p>}
        <footer className="wb-dialog-footer">
          <button className="wb-text-button" type="button" onClick={() => { setDraft(defaultOptions); setSession(true); setIssue(''); }}>Reset defaults</button>
          <div>
            <button className="wb-button wb-button-light" type="button" onClick={onClose}>Cancel</button>
            <button className="wb-button wb-button-primary" type="submit"><Check size={17} /> Apply options</button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}

export function Workbench({ api, settings, account, onSignIn, onEnqueued }: {
  api: ArchivistApi;
  settings: Settings;
  account: string | null;
  onSignIn(): void;
  onEnqueued(): void;
}) {
  const [source, setSource] = useState<Source>('profile');
  const [input, setInput] = useState('');
  const [batch, setBatch] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [output, setOutput] = useState('');
  const [options, setOptions] = useState(defaultOptions);
  const [showOptions, setShowOptions] = useState(false);
  const [useSession, setUseSession] = useState(true);
  const [issue, setIssue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();
  const titleId = useId();
  const details = sourceDetails[source];
  const Icon = details.icon;
  const profile = profileSources.has(source);
  const destination = output || settings.destination;
  const needsSession = accountSources.has(source) || (profile && (options.stories || options.highlights)) || options.comments || options.geotags;
  const sessionAllowed = Boolean(account && (accountSources.has(source) || useSession));
  const showSignIn = needsSession && !sessionAllowed;
  const targetActions = source !== 'metadata' && !implicitSources.has(source);
  const quickOptions = profile ? quickProfileOptions : quickMediaOptions;

  async function selectDestination() {
    setIssue('');
    try {
      const next = await api.chooseDirectory();
      if (next) setOutput(next);
    } catch (error) {
      setIssue(errorMessage(error));
    }
  }

  async function selectFiles() {
    setIssue('');
    try {
      const next = await api.chooseMetadata();
      if (next) setFiles(next);
    } catch (error) {
      setIssue(errorMessage(error));
    }
  }

  async function enqueue(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setIssue('');

    try {
      if (!destination) throw new Error('Choose a destination folder for your download.');
      if (showSignIn) throw new Error(account ? 'Enable your Instagram session in Download options.' : 'Sign in to download this content.');
      if (profile && !options.metadata && !profileOptions.some(({ key }) => options[key])) {
        throw new Error('Choose at least one kind of profile content.');
      }
      const targets = source === 'metadata' ? files : implicitSources.has(source) ? [] : normalizeTargets(source, input);
      if (source === 'metadata' && !targets.length) throw new Error('Choose at least one Instaloader metadata file.');

      setSubmitting(true);
      await api.enqueue({
        targetType: source,
        targets,
        destination,
        useSession: sessionAllowed,
        options: {
          ...options,
          stories: profile && options.stories,
          highlights: profile && options.highlights,
          thumbnails: options.photos && options.thumbnails,
          fastUpdate: options.photos && options.fastUpdate,
        },
      });
      setInput('');
      setFiles([]);
      onEnqueued();
    } catch (error) {
      setIssue(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="wb-card" aria-labelledby={titleId}>
      <header className="wb-card-header">
        <div className="wb-card-title">
          <span className="wb-mark"><Download size={18} /></span>
          <h2 id={titleId}>New download</h2>
        </div>
        <div className="wb-source">
          <Icon size={15} aria-hidden="true" />
          <select aria-label="Download source" value={source} onChange={(event) => {
            setSource(event.currentTarget.value as Source);
            setInput('');
            setFiles([]);
            setIssue('');
          }}>
            {sourceGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => <option key={item} value={item}>{sourceDetails[item].label}</option>)}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </div>
      </header>
      <form onSubmit={enqueue}>
        <div className="wb-card-content">
          <div className="wb-entry-label">
            {implicitSources.has(source)
              ? <span className="wb-entry-field-label">Source</span>
              : <label htmlFor={fieldId}>{details.fieldLabel}</label>}
            {targetActions && (
              <button type="button" className="wb-text-button" aria-pressed={batch} onClick={() => setBatch(!batch)}>
                <ListPlus size={15} /> {batch ? 'Single target' : 'Add multiple'}
              </button>
            )}
          </div>
          <div className="wb-entry">
            {implicitSources.has(source) ? (
              <div className="wb-entry-field" id={fieldId}><Icon size={17} /><span>{details.placeholder}</span></div>
            ) : source === 'metadata' ? (
              <button type="button" className="wb-entry-field wb-file-field" id={fieldId} onClick={() => void selectFiles()}>
                <FileJson size={17} />
                <span title={files.join('\n')}>{files.length > 1 ? `${files.length} files selected` : files[0] ? baseName(files[0]) : details.placeholder}</span>
              </button>
            ) : (
              <div className={batch ? 'wb-entry-field wb-entry-batch' : 'wb-entry-field'}>
                <Icon size={17} aria-hidden="true" />
                {batch ? (
                  <textarea id={fieldId} placeholder="Separate targets with commas or new lines" rows={3} value={input} onChange={(event) => setInput(event.currentTarget.value)} spellCheck={false} />
                ) : (
                  <input id={fieldId} type="text" placeholder={details.placeholder} value={input} onChange={(event) => setInput(event.currentTarget.value)} spellCheck={false} autoComplete="off" />
                )}
              </div>
            )}
            <button type="submit" className="wb-button wb-button-primary wb-queue-button" disabled={submitting}>
              {submitting ? <LoaderCircle className="wb-spin" size={17} /> : <Download size={17} />}
              Queue download
            </button>
          </div>
          {issue && <p className="wb-message" role="alert">{issue}</p>}
          {showSignIn && !account && (
            <div className="wb-auth-hint">
              <LockKeyhole size={15} />
              <span>This download requires an Instagram session.</span>
              <button type="button" className="wb-text-button" onClick={onSignIn}>Sign in</button>
            </div>
          )}
          <div className="wb-quick-settings">
            <div className="wb-content-chips" aria-label="Quick download options">
              {quickOptions.map(({ key, label }) => (
                <button type="button" key={key} aria-pressed={options[key]} onClick={() => setOptions((current) => ({ ...current, [key]: !current[key] }))}>
                  {options[key] ? <Check size={13} /> : <Plus size={13} />}{label}
                </button>
              ))}
            </div>
            <button type="button" className="wb-text-button wb-options-button" onClick={() => setShowOptions(true)}>
              <SlidersHorizontal size={15} /> Options
            </button>
          </div>
        </div>
        <div className="wb-output">
          <Folder size={16} />
          <span title={destination}>{destination || 'Choose where to save your downloads'}</span>
          <button type="button" className="wb-text-button" onClick={() => void selectDestination()}>Change folder</button>
        </div>
      </form>
      {showOptions && (
        <OptionDialog
          options={options}
          source={source}
          account={account}
          useSession={useSession}
          onClose={() => setShowOptions(false)}
          onApply={(nextOptions, nextSession) => {
            setOptions(nextOptions);
            setUseSession(nextSession);
            setIssue('');
            setShowOptions(false);
          }}
        />
      )}
    </section>
  );
}

export function SettingsPanel({
  api,
  settings,
  account,
  version,
  onSignIn,
  theme = 'system',
  onSelectTheme,
  onOpenUrl,
}: {
  api: ArchivistApi;
  settings: Settings;
  account: string | null;
  version: string;
  onSignIn(): void;
  theme?: 'light' | 'dark' | 'gta6' | 'system';
  onSelectTheme?(theme: 'light' | 'dark' | 'gta6' | 'system'): void;
  onOpenUrl?(url: string): void;
}) {
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<void>) {
    setIssue('');
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setIssue(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function openExternal(url: string) {
    if (onOpenUrl) {
      onOpenUrl(url);
    } else if (api.openExternal) {
      void api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  return (
    <section className="wb-settings" aria-labelledby="wb-settings-title">
      <div className="wb-page-heading">
        <h1 id="wb-settings-title">Settings</h1>
        <p>Manage your Instagram session, storage destination, and workspace appearance.</p>
      </div>
      {issue && <p className="wb-message" role="alert">{issue}</p>}
      <div className="wb-settings-group">
        <div className="wb-settings-row">
          <span className="wb-mark"><Camera size={18} /></span>
          <div className="wb-settings-label">
            <h2>Instagram account</h2>
            <p>{account ? `Connected as @${account}` : 'Sign in to archive content available to your account.'}</p>
          </div>
          <button className="wb-button wb-button-light" type="button" onClick={onSignIn}>{account ? 'Manage session' : 'Sign in'}</button>
        </div>

        <div className="wb-settings-row">
          <span className="wb-mark"><Folder size={18} /></span>
          <div className="wb-settings-label">
            <h2>Default download folder</h2>
            <p title={settings.destination}>{settings.destination || 'Choose a destination for new downloads.'}</p>
          </div>
          <div className="wb-settings-actions">
            {settings.destination && (
              <button className="wb-icon-button wb-folder-button" type="button" aria-label="Open download folder" disabled={busy} onClick={() => void perform(() => api.openDirectory(settings.destination))}><FolderOpen size={19} /></button>
            )}
            <button className="wb-button wb-button-light" type="button" disabled={busy} onClick={() => void perform(async () => {
              const destination = await api.chooseDirectory();
              if (destination) await api.setSettings({ destination });
            })}>Choose folder</button>
          </div>
        </div>

        <div className="wb-settings-row">
          <span className="wb-mark"><Sun size={18} /></span>
          <div className="wb-settings-label">
            <h2>Appearance & Theme</h2>
            <p>Customize the workspace styling for comfortable daytime or low-light viewing.</p>
          </div>
          <div className="wb-theme-picker" role="group" aria-label="Select theme">
            <button
              type="button"
              className={`wb-theme-btn ${theme === 'light' ? 'selected' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={() => onSelectTheme?.('light')}
              title="Light theme"
            >
              <Sun size={15} /> <span>Light</span>
            </button>
            <button
              type="button"
              className={`wb-theme-btn ${theme === 'dark' ? 'selected' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={() => onSelectTheme?.('dark')}
              title="Dark theme"
            >
              <Moon size={15} /> <span>Dark</span>
            </button>
            <button
              type="button"
              className={`wb-theme-btn ${theme === 'gta6' ? 'selected' : ''}`}
              aria-pressed={theme === 'gta6'}
              onClick={() => onSelectTheme?.('gta6')}
              title="GTA VI Vice City theme"
            >
              <Palmtree size={15} /> <span>GTA VI</span>
            </button>
            <button
              type="button"
              className={`wb-theme-btn ${theme === 'system' ? 'selected' : ''}`}
              aria-pressed={theme === 'system'}
              onClick={() => onSelectTheme?.('system')}
              title="Match system theme"
            >
              <Laptop size={15} /> <span>System</span>
            </button>
          </div>
        </div>

        <div className="wb-settings-row">
          <span className="wb-mark"><Settings2 size={18} /></span>
          <Switch label="Reduce motion" description="Tone down transitions and animated movement." checked={settings.reduceMotion} disabled={busy} onChange={(reduceMotion) => void perform(() => api.setSettings({ reduceMotion }))} />
        </div>

        <div className="wb-settings-row wb-about-row">
          <span className="wb-mark"><Code2 size={18} /></span>
          <div className="wb-settings-label">
            <h2>About Yoinkstagram</h2>
            <p>
              Developed by <strong>Md. Mehenuf Hossain Bhuiyan</strong>. Open-source local desktop archival workspace released under the MIT License.
            </p>
          </div>
          <div className="wb-settings-actions">
            <button
              className="wb-button wb-button-light"
              type="button"
              onClick={() => openExternal('https://github.com/mehenuf/yoinkstagram')}
              title="Open GitHub repository in browser"
            >
              <GithubIcon size={15} /> <span>Repository</span>
            </button>
            <button
              className="wb-button wb-button-light"
              type="button"
              onClick={() => openExternal('https://github.com/mehenuf/yoinkstagram/releases')}
              title="View releases & changelog on GitHub"
            >
              <ExternalLink size={15} /> <span>v{version} Releases</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AccountDialog({ api, account, onClose }: {
  api: ArchivistApi;
  account: string | null;
  onClose(): void;
}) {
  const [result, setResult] = useState<AuthResult | null>(null);
  const [mode, setMode] = useState<'choose' | 'manual' | 'two-factor'>('choose');
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const checkpoint = result?.status === 'checkpoint';
  const issue = result?.status === 'failed' ? result.message || 'Instagram sign-in failed. Try again.' : '';
  const title = account
    ? 'Instagram session'
    : mode === 'two-factor'
      ? 'Verify your sign-in'
      : mode === 'manual'
        ? 'Sign in with password'
        : 'Sign in';

  function close() {
    if (mode === 'two-factor') void api.cancelAuth().catch(() => {});
    onClose();
  }

  async function backToChoose() {
    setBusy(true);
    try {
      await api.cancelAuth();
      setMode('choose');
      setResult(null);
    } catch (error) {
      setResult({ status: 'failed', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function perform(action: () => Promise<AuthResult>) {
    setBusy(true);
    try {
      const next = await action();
      setResult(next);
      if (next.status === 'two-factor') setMode('two-factor');
      if (next.status === 'checkpoint') setMode('choose');
      if (next.status === 'authenticated' || next.status === 'canceled') onClose();
    } catch (error) {
      setResult({ status: 'failed', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    form.reset();
    if (mode === 'two-factor') {
      const code = String(values.get('code') || '').replace(/\s/g, '');
      void perform(() => api.twoFactor(code));
    } else {
      const name = username.trim().replace(/^@/, '');
      const password = String(values.get('password') || '');
      void perform(() => api.login(name, password));
    }
  }

  // ── Connected account view ────────────────────────────────────────
  if (account) {
    return (
      <Dialog name={title} icon={<Camera size={20} />} onClose={close} busy={busy}>
        <>
          <div className="wb-account-body">
            <div className="wb-auth-state">
              <ShieldCheck size={22} />
              <div><strong>@{account}</strong><p>This account is connected on this device.</p></div>
            </div>
            {issue && <p className="wb-message" role="alert">{issue}</p>}
          </div>
          <footer className="wb-dialog-footer">
            <button className="wb-text-button" type="button" onClick={close} disabled={busy}>Close</button>
            <button className="wb-button wb-button-light" type="button" disabled={busy} onClick={() => void perform(async () => {
              await api.logout();
              return { status: 'authenticated' };
            })}><LogOut size={16} /> Sign out</button>
          </footer>
        </>
      </Dialog>
    );
  }

  // ── Method chooser view ───────────────────────────────────────────
  if (mode === 'choose') {
    return (
      <Dialog name={title} icon={<Camera size={20} />} onClose={close} busy={busy}>
        <div className="wb-account-body">
          {checkpoint && (
            <div className="wb-checkpoint" role="status">
              <p>{result.message || 'Instagram flagged your sign-in. Complete the check below to continue.'}</p>
              {result.url && (
                <button className="wb-text-button" type="button" onClick={() => {
                  void api.openInstagram(result.url!).catch((error: unknown) => setResult({ status: 'failed', message: errorMessage(error) }));
                }}>Open Instagram <ExternalLink size={14} /></button>
              )}
            </div>
          )}

          {/* Primary: browser-based login */}
          <button
            type="button"
            className="wb-signin-option wb-signin-primary"
            disabled={busy}
            onClick={() => void perform(() => api.loginWithBrowser())}
          >
            <span className="wb-signin-option-icon">
              {busy ? <LoaderCircle className="wb-spin" size={20} /> : <InstagramIcon />}
            </span>
            <span className="wb-signin-option-text">
              <strong>Continue with Instagram</strong>
              <span>Sign in securely in an embedded browser window</span>
            </span>
          </button>

          {/* Google sign-in */}
          <button
            type="button"
            className="wb-signin-option"
            disabled={busy}
            onClick={() => void perform(async () => {
              const r = await api.loginWithGoogle();
              // Google auth is app-level only — doesn't set an Instagram session
              // We close the dialog and show a note
              if (r.status === 'authenticated') {
                return { status: 'failed', message: `Signed in with Google as ${r.email ?? r.name ?? 'your account'}. Note: Google sign-in identifies you in this app but you still need an Instagram session to download private content.` };
              }
              return { status: 'failed', message: 'Google sign-in was cancelled.' };
            })}
          >
            <span className="wb-signin-option-icon">
              <GoogleIcon />
            </span>
            <span className="wb-signin-option-text">
              <strong>Continue with Google</strong>
              <span>Use your Google account for app-level identity</span>
            </span>
          </button>

          <div className="wb-signin-divider"><span>or</span></div>

          {/* Manual fallback */}
          <button
            type="button"
            className="wb-text-button wb-signin-manual-link"
            disabled={busy}
            onClick={() => { setResult(null); setMode('manual'); }}
          >
            Sign in with username &amp; password
          </button>

          {issue && <p className="wb-message" role="alert">{issue}</p>}
        </div>
        <footer className="wb-dialog-footer">
          <button className="wb-text-button" type="button" disabled={busy} onClick={close}>Cancel</button>
        </footer>
      </Dialog>
    );
  }

  // ── Manual / two-factor view ──────────────────────────────────────
  return (
    <Dialog name={title} icon={<Camera size={20} />} onClose={close} busy={busy}>
      <form onSubmit={submitManual}>
        <div className="wb-account-body">
          {checkpoint && (
            <div className="wb-checkpoint" role="status">
              <p>{result.message || 'Confirm your sign-in on Instagram, then try again here.'}</p>
              {result.url && (
                <button className="wb-text-button" type="button" onClick={() => {
                  void api.openInstagram(result.url!).catch((error: unknown) => setResult({ status: 'failed', message: errorMessage(error) }));
                }}>Open Instagram <ExternalLink size={14} /></button>
              )}
            </div>
          )}
          {mode === 'two-factor' ? (
            <label className="wb-field">
              <span>Verification code</span>
              <input name="code" autoComplete="one-time-code" inputMode="numeric" autoFocus required disabled={busy} placeholder="Code from Instagram" />
              <small>{result?.status === 'two-factor' && result.message ? result.message : 'Use the code from your authenticator app or text message.'}</small>
            </label>
          ) : (
            <>
              <label className="wb-field">
                <span>Instagram username</span>
                <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoComplete="username" spellCheck={false} autoFocus required disabled={busy} placeholder="Username" />
              </label>
              <label className="wb-field">
                <span>Password</span>
                <input name="password" type="password" autoComplete="current-password" required disabled={busy} placeholder="Password" />
              </label>
              <p className="wb-auth-note"><ShieldCheck size={16} /> Your password is used to sign in. Yoinkstagram keeps the session local.</p>
            </>
          )}
          {issue && <p className="wb-message" role="alert">{issue}</p>}
        </div>
        <footer className="wb-dialog-footer">
          {mode === 'two-factor' ? (
            <button className="wb-text-button" type="button" disabled={busy} onClick={() => void backToChoose()}>Back</button>
          ) : (
            <button className="wb-text-button" type="button" disabled={busy} onClick={() => { setResult(null); setMode('choose'); }}>Back</button>
          )}
          <button className="wb-button wb-button-primary" type="submit" disabled={busy}>
            {busy && <LoaderCircle className="wb-spin" size={17} />}
            {mode === 'two-factor' ? 'Verify code' : 'Sign in'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function InstagramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f9a825" />
          <stop offset="40%" stopColor="#e91e63" />
          <stop offset="100%" stopColor="#9c27b0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" ry="6" stroke="url(#ig-grad)" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="4.5" stroke="url(#ig-grad)" strokeWidth="2" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="url(#ig-grad)" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export type TargetType =
  | 'profile' | 'post' | 'saved' | 'feed' | 'stories'
  | 'hashtag' | 'location' | 'followees' | 'metadata';

export interface DownloadOptions {
  posts: boolean;
  profilePicture: boolean;
  stories: boolean;
  highlights: boolean;
  tagged: boolean;
  reels: boolean;
  igtv: boolean;
  photos: boolean;
  videos: boolean;
  thumbnails: boolean;
  captions: boolean;
  metadata: boolean;
  compressMetadata: boolean;
  comments: boolean;
  geotags: boolean;
  fastUpdate: boolean;
  resume: boolean;
  maxItems: number | null;
  since: string;
  until: string;
  captionContains: string;
  carousel: string;
  folderPattern: string;
  filePattern: string;
  postTextPattern: string;
  storyTextPattern: string;
}

export interface JobRequest {
  targetType: TargetType;
  targets: string[];
  destination: string;
  useSession: boolean;
  options: DownloadOptions;
}

export type JobStatus =
  | 'queued' | 'running' | 'cooldown' | 'completed' | 'partial'
  | 'failed' | 'canceled' | 'interrupted';

export interface LogEntry {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Job {
  id: string;
  request: JobRequest;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  items: number;
  files: number;
  phase: string;
  message?: string;
}

export interface Settings {
  destination: string;
  reduceMotion: boolean;
}

export interface Snapshot {
  jobs: Job[];
  paused: boolean;
  cooldownUntil: number | null;
  account: string | null;
  settings: Settings;
  version: string;
}

export interface AuthResult {
  status: 'authenticated' | 'two-factor' | 'checkpoint' | 'failed' | 'canceled';
  message?: string;
  username?: string;
  url?: string;
  /** Google sign-in result fields */
  email?: string;
  name?: string;
}

export interface GoogleAuthResult {
  status: 'authenticated' | 'failed' | 'canceled';
  email?: string | null;
  name?: string | null;
}

export interface ArchivistApi {
  getState(): Promise<Snapshot>;
  getJobLogs(id: string): Promise<LogEntry[]>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
  enqueue(request: JobRequest): Promise<void>;
  pauseQueue(paused: boolean): Promise<void>;
  cancelJob(id: string): Promise<void>;
  retryJob(id: string): Promise<void>;
  removeJob(id: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  chooseMetadata(): Promise<string[] | null>;
  openDirectory(path: string): Promise<void>;
  login(username: string, password: string): Promise<AuthResult>;
  loginWithBrowser(): Promise<AuthResult>;
  loginWithGoogle(): Promise<GoogleAuthResult>;
  twoFactor(code: string): Promise<AuthResult>;
  cancelAuth(): Promise<void>;
  logout(): Promise<void>;
  openInstagram(url: string): Promise<void>;
  setSettings(settings: Partial<Settings>): Promise<void>;
}

declare global {
  interface Window {
    archivist?: ArchivistApi;
  }
}

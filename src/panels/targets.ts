import type { JobRequest } from '../types';

type Source = JobRequest['targetType'];

const profileName = /^[a-zA-Z0-9_.]{1,30}$/;
const shortcode = /^[a-zA-Z0-9_-]{1,32}$/;
const instagramHosts = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const mediaPaths = new Set(['p', 'reel', 'reels', 'tv']);

function instagramPath(value: string): string[] | null {
  if (!value.includes('/') && !value.includes(':')) return null;
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!instagramHosts.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Expected an Instagram link.');
  }
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function normalizeTarget(kind: Source, value: string): string | null {
  const segments = instagramPath(value);
  switch (kind) {
    case 'profile':
    case 'followees': {
      const name = segments ? (segments.length === 1 ? segments[0] : '') : value.replace(/^@/, '');
      return profileName.test(name) && /[a-zA-Z0-9_]/.test(name) ? name.toLowerCase() : null;
    }
    case 'post': {
      const code = segments ? (segments.length === 2 && mediaPaths.has(segments[0]) ? segments[1] : '') : value;
      return shortcode.test(code) ? code : null;
    }
    case 'hashtag': {
      const tag = segments
        ? (segments.length === 3 && segments[0] === 'explore' && segments[1] === 'tags' ? segments[2] : '')
        : value.replace(/^#/, '');
      return /^[\p{L}\p{N}_]{1,100}$/u.test(tag) ? tag.toLowerCase() : null;
    }
    case 'location': {
      const id = segments
        ? (segments.length >= 3 && segments[0] === 'explore' && segments[1] === 'locations' ? segments[2] : '')
        : value.replace(/^%/, '');
      return /^\d{1,24}$/.test(id) ? id : null;
    }
    default:
      return null;
  }
}

export function normalizeTargets(kind: Source, input: string): string[] {
  const values = input.split(/[\s,]+/).filter(Boolean);
  if (!values.length) throw new Error('Enter at least one Instagram target.');

  const targets = new Set<string>();
  for (const value of values) {
    let normalized: string | null = null;
    try {
      normalized = normalizeTarget(kind, value);
    } catch {
      // A malformed URL should use the same validation message as a malformed target.
    }
    if (normalized === null) throw new Error(`Check “${value.slice(0, 100)}” and try again.`);
    targets.add(normalized);
  }
  return [...targets];
}

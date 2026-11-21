import { isAbsolute } from 'node:path';

const targetTypes = new Set(['profile', 'post', 'saved', 'feed', 'stories', 'hashtag', 'location', 'followees', 'metadata']);
const accountTargets = new Set(['saved', 'feed', 'stories']);
const booleanOptions = {
  posts: true,
  profilePicture: true,
  stories: false,
  highlights: false,
  tagged: false,
  reels: false,
  igtv: false,
  photos: true,
  videos: true,
  thumbnails: true,
  captions: true,
  metadata: true,
  compressMetadata: true,
  comments: false,
  geotags: false,
  fastUpdate: false,
  resume: true,
};
const textOptions = ['since', 'until', 'captionContains', 'carousel', 'folderPattern', 'filePattern', 'postTextPattern', 'storyTextPattern'];

export function absolutePath(value) {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
    throw new Error('Choose an absolute folder path.');
  }
  return value;
}

export function jobRequest(input) {
  if (!input || !targetTypes.has(input.targetType) || !Array.isArray(input.targets)) {
    throw new Error('Select a source and enter a download target.');
  }
  const { targetType } = input;
  const targets = input.targets.map((target) => {
    if (typeof target !== 'string' || !target.trim() || target.includes('\0')) {
      throw new Error('One of the download targets is invalid.');
    }
    if (targetType === 'metadata' && (!isAbsolute(target) || !/\.json(\.xz)?$/i.test(target))) {
      throw new Error('Choose Instaloader JSON or JSON.XZ metadata files.');
    }
    return target.trim();
  });
  if (!targets.length && !accountTargets.has(targetType)) throw new Error('Enter at least one download target.');

  const requestedOptions = input.options || {};
  const maxItems = requestedOptions.maxItems ?? null;
  if (maxItems !== null && (!Number.isSafeInteger(maxItems) || maxItems < 1)) {
    throw new Error('The item limit must be a positive whole number.');
  }
  const options = { maxItems };
  for (const [key, fallback] of Object.entries(booleanOptions)) {
    options[key] = typeof requestedOptions[key] === 'boolean' ? requestedOptions[key] : fallback;
  }
  for (const key of textOptions) {
    const value = typeof requestedOptions[key] === 'string' ? requestedOptions[key] : '';
    if (value.includes('\0')) throw new Error('A download setting contains an invalid character.');
    options[key] = value;
  }
  return {
    targetType, targets, options,
    destination: absolutePath(input.destination),
    useSession: input.useSession === true,
  };
}

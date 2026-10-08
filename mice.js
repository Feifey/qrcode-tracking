const TAGS = [
  'Playful', 'Energetic', 'Calm', 'Gentle', 'Social', 'Independent', 'Free-spirited',
  'Cozy', 'Curious', 'Sweet', 'Dreamy', 'Bold', 'Sensitive', 'Charming',
];

// Keyed by the text each printed QR code decodes to.
const DEFAULT_MICE = {
  'laptop': {
    name: 'Jerry',
    color: '#f28fad',
    tags: ['Calm', 'Gentle', 'Independent', 'Cozy', 'Sweet'],
  },
  'headphones': {
    name: 'Marshmallow',
    color: '#8ec5ff',
    tags: ['Playful', 'Energetic', 'Social', 'Cozy', 'Curious', 'Bold', 'Charming'],
  },
  'wallet': {
    name: 'Tequila',
    color: '#ffb347',
    tags: ['Energetic', 'Independent', 'Free-spirited', 'Curious', 'Dreamy'],
  },
  'keys': {
    name: 'Sam',
    color: '#b58cff',
    tags: ['Playful', 'Social', 'Free-spirited', 'Curious', 'Bold'],
  },
  'cup': {
    name: 'Ham',
    color: '#5fd4b8',
    tags: ['Gentle', 'Social', 'Cozy', 'Sweet', 'Sensitive', 'Charming'],
  },
  'bottle-full': {
    name: 'GusGus',
    color: '#9bd36a',
    tags: ['Calm', 'Gentle', 'Independent', 'Curious', 'Sweet', 'Dreamy', 'Sensitive'],
  },
  'bottle-half': {
    name: 'Shrek',
    color: '#ffd166',
    tags: ['Playful', 'Energetic', 'Free-spirited', 'Bold'],
  },
  'bottle-empty': {
    name: 'Taro',
    color: '#c9a0dc',
    tags: ['Calm', 'Independent', 'Dreamy', 'Sensitive', 'Charming'],
  },
};

const STORAGE_KEY = 'mouse-haven-profiles';

// Information added through the UI lives in this browser's localStorage, so
// it persists across reloads on this device but isn't shared with others.
function loadProfiles() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    saved = {};
  }

  const mice = {};
  for (const [id, base] of Object.entries(DEFAULT_MICE)) {
    const stored = saved[id] || {};
    mice[id] = {
      id,
      name: base.name,
      color: base.color,
      tags: Array.isArray(stored.tags) ? stored.tags : base.tags,
      description: typeof stored.description === 'string' ? stored.description : '',
      memories: Array.isArray(stored.memories) ? stored.memories : [],
      photo: typeof stored.photo === 'string' ? stored.photo : null,
    };
  }
  return mice;
}

const MICE = loadProfiles();

function saveProfiles() {
  const data = {};
  for (const [id, { tags, description, memories, photo }] of Object.entries(MICE)) {
    data[id] = { tags, description, memories, photo };
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Unable to save mouse profiles:', error);
    return false;
  }
}

// hasOwn guards against QR text like "constructor" resolving to an inherited
// Object property instead of a mouse.
function getMouse(id) {
  return Object.hasOwn(MICE, id) ? MICE[id] : null;
}

const photoCache = {};

// Canvas drawing needs a loaded Image, so decode each photo once and reuse it
// every frame rather than rebuilding it from the data URL.
function getMousePhoto(mouse) {
  if (!mouse.photo) {
    return null;
  }
  if (!photoCache[mouse.id]) {
    const image = new Image();
    image.src = mouse.photo;
    photoCache[mouse.id] = image;
  }
  return photoCache[mouse.id];
}

const changeListeners = [];

function onMiceChange(listener) {
  changeListeners.push(listener);
}

function updateMouse(id, changes) {
  Object.assign(MICE[id], changes);
  delete photoCache[id];
  const saved = saveProfiles();
  changeListeners.forEach((listener) => listener(id));
  return saved;
}

// Ranks mice by how many of the selected tags they share, best first.
function rankMice(selectedTags) {
  return Object.values(MICE)
    .map((mouse) => ({ mouse, matched: mouse.tags.filter((tag) => selectedTags.includes(tag)) }))
    .filter(({ matched }) => matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || a.mouse.name.localeCompare(b.mouse.name));
}

const TAGS = [
  'Playful', 'Energetic', 'Calm', 'Gentle', 'Social', 'Independent', 'Free-spirited',
  'Cozy', 'Curious', 'Sweet', 'Dreamy', 'Bold', 'Sensitive', 'Charming',
];

// Keyed by the text each printed QR code decodes to.
const DEFAULT_MICE = {
  'laptop': {
    name: 'Jerry',
    color: '#f28fad',
    photo: 'images/mice/jerry.jpg',
    tags: ['Calm', 'Gentle', 'Independent', 'Cozy', 'Sweet'],
  },
  'headphones': {
    name: 'Marshmallow',
    color: '#8ec5ff',
    photo: 'images/mice/marshmallow.jpg',
    tags: ['Playful', 'Energetic', 'Social', 'Cozy', 'Curious', 'Bold', 'Charming'],
  },
  'wallet': {
    name: 'Tequila',
    color: '#ffb347',
    photo: 'images/mice/tequila.jpg',
    tags: ['Energetic', 'Independent', 'Free-spirited', 'Curious', 'Dreamy'],
  },
  'keys': {
    name: 'Sam',
    color: '#b58cff',
    photo: 'images/mice/ham-and-sam.jpg',
    tags: ['Playful', 'Social', 'Free-spirited', 'Curious', 'Bold'],
  },
  'cup': {
    name: 'Ham',
    color: '#5fd4b8',
    photo: 'images/mice/ham-and-sam.jpg',
    tags: ['Gentle', 'Social', 'Cozy', 'Sweet', 'Sensitive', 'Charming'],
  },
  'bottle-full': {
    name: 'GusGus',
    color: '#9bd36a',
    photo: 'images/mice/gusgus.jpg',
    tags: ['Calm', 'Gentle', 'Independent', 'Curious', 'Sweet', 'Dreamy', 'Sensitive'],
  },
  'bottle-half': {
    name: 'Shrek',
    color: '#ffd166',
    photo: 'images/mice/shrek.jpg',
    tags: ['Playful', 'Energetic', 'Free-spirited', 'Bold'],
  },
  'bottle-empty': {
    name: 'Taro',
    color: '#c9a0dc',
    photo: 'images/mice/taro.jpg',
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
      photo: typeof stored.photo === 'string' ? stored.photo : base.photo,
    };
  }
  return mice;
}

const MICE = loadProfiles();

function hasCustomPhoto(mouse) {
  return mouse.photo !== DEFAULT_MICE[mouse.id].photo;
}

function saveProfiles() {
  const data = {};
  for (const [id, mouse] of Object.entries(MICE)) {
    const { tags, description, memories, photo } = mouse;
    // Only uploaded photos are stored; the default comes from the image file.
    data[id] = { tags, description, memories, photo: hasCustomPhoto(mouse) ? photo : null };
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

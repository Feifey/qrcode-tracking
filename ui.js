const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');
const scanCards = document.getElementById('scanCards');
const tagPicker = document.getElementById('tagPicker');
const clearTagsButton = document.getElementById('clearTags');
const matchResults = document.getElementById('matchResults');
const miceGrid = document.getElementById('miceGrid');
const profileDialog = document.getElementById('profileDialog');

let currentView = 'scan';
let openProfileId = null;
const selectedTags = new Set();

// QR detection drops out for the odd frame, so a mouse still counts as
// "in view" until it has gone unseen for this long.
const SCAN_LINGER_MS = 1500;
// Photos are stored as data URLs in localStorage (roughly 5MB per site), so
// they're downscaled before saving to leave room for all eight mice.
const PHOTO_MAX_SIZE = 480;

const scanState = {};
// null (not '') so the empty list still renders the first time.
let renderedScanKey = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function showView(name) {
  currentView = name;
  tabs.forEach((tab) => {
    const isActive = tab.dataset.view === name;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  views.forEach((view) => view.classList.toggle('is-active', view.id === `view-${name}`));
  if (name === 'scan') {
    renderedScanKey = null;
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

function renderAvatar(mouse) {
  const avatar = el('div', 'avatar');
  avatar.style.setProperty('--mouse-color', mouse.color);
  if (mouse.photo) {
    const image = el('img');
    image.src = mouse.photo;
    image.alt = `Photo of ${mouse.name}`;
    avatar.append(image);
  } else {
    avatar.textContent = '🐭';
    avatar.setAttribute('aria-hidden', 'true');
  }
  return avatar;
}

function renderTags(tags, matched = []) {
  const list = el('div', 'tag-list');
  for (const tag of tags) {
    list.append(el('span', matched.includes(tag) ? 'tag is-match' : 'tag', tag));
  }
  return list;
}

function renderMouseCard(mouse, { badge, isHighlighted = false, matched } = {}) {
  const card = el('article', 'mouse-card');
  card.addEventListener('click', () => openProfile(mouse.id));

  const titles = el('div');
  const heading = el('h3');
  const link = el('button', 'card-link', mouse.name);
  link.type = 'button';
  heading.append(link);
  titles.append(heading);
  if (badge) {
    titles.append(el('span', isHighlighted ? 'badge is-highlighted' : 'badge', badge));
  }

  const head = el('div', 'mouse-card-head');
  head.append(renderAvatar(mouse), titles);
  card.append(head, renderTags(mouse.tags, matched));
  if (mouse.description) {
    card.append(el('p', 'description', mouse.description));
  }
  return card;
}

function renderEmpty(message) {
  return el('p', 'empty', message);
}

// Called by the scanner every frame with the ids of mice it can see.
function reportScannedMice(ids) {
  const now = performance.now();
  for (const id of ids) {
    const state = scanState[id];
    if (!state || now - state.lastSeen > SCAN_LINGER_MS) {
      scanState[id] = { lastSeen: now, enteredAt: now };
    } else {
      state.lastSeen = now;
    }
  }

  const entries = Object.entries(scanState)
    .sort((a, b) => b[1].enteredAt - a[1].enteredAt)
    .map(([id, state]) => ({ id, inView: now - state.lastSeen < SCAN_LINGER_MS }));

  // Only touch the DOM when the list actually changes, not every frame.
  const key = entries.map(({ id, inView }) => `${id}:${inView}`).join(',');
  if (key === renderedScanKey) {
    return;
  }
  renderedScanKey = key;

  if (entries.length === 0) {
    scanCards.replaceChildren(renderEmpty('No mice scanned yet. Hold a QR code up to the camera.'));
    return;
  }
  scanCards.replaceChildren(...entries.map(({ id, inView }) => renderMouseCard(MICE[id], {
    badge: inView ? 'In view' : 'Recently scanned',
    isHighlighted: inView,
  })));
}

function buildTagPicker() {
  for (const tag of TAGS) {
    const button = el('button', 'tag-toggle', tag);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      button.setAttribute('aria-pressed', String(selectedTags.has(tag)));
      renderMatches();
    });
    tagPicker.append(button);
  }
}

clearTagsButton.addEventListener('click', () => {
  selectedTags.clear();
  tagPicker.querySelectorAll('.tag-toggle').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  renderMatches();
});

function renderMatches() {
  clearTagsButton.disabled = selectedTags.size === 0;

  if (selectedTags.size === 0) {
    matchResults.replaceChildren(renderEmpty('Pick a few traits above to meet the mice you would click with.'));
    return;
  }

  const ranked = rankMice([...selectedTags]);
  if (ranked.length === 0) {
    matchResults.replaceChildren(renderEmpty('No mice share those traits yet. Try picking a few others.'));
    return;
  }

  const bestScore = ranked[0].matched.length;
  matchResults.replaceChildren(...ranked.map(({ mouse, matched }) => {
    const percent = Math.round((matched.length / selectedTags.size) * 100);
    const isBest = matched.length === bestScore;
    return renderMouseCard(mouse, {
      badge: isBest ? `Best match · ${percent}%` : `${percent}% match`,
      isHighlighted: isBest,
      matched,
    });
  }));
}

function renderMiceGrid() {
  miceGrid.replaceChildren(...Object.values(MICE).map((mouse) => renderMouseCard(mouse)));
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read image'));
    };
    image.src = url;
  });
}

function openProfile(id) {
  openProfileId = id;
  renderProfile();
  if (!profileDialog.open) {
    profileDialog.showModal();
  }
}

function renderSection(title) {
  const section = el('section', 'profile-section');
  section.append(el('h3', '', title));
  return section;
}

function renderPhotoSection(mouse) {
  const section = renderSection('Photo');
  const actions = el('div', 'button-row');

  const upload = el('button', 'button', mouse.photo ? 'Change photo' : 'Add photo');
  upload.type = 'button';
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  upload.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) {
      return;
    }
    const previousPhoto = mouse.photo;
    try {
      if (!updateMouse(mouse.id, { photo: await readPhoto(file) })) {
        updateMouse(mouse.id, { photo: previousPhoto });
        alert('That photo could not be saved because this browser is out of storage space.');
      }
    } catch {
      alert('That file could not be read as an image. Try a JPG or PNG.');
    }
    renderProfile();
  });
  actions.append(upload, input);

  if (mouse.photo) {
    const remove = el('button', 'button secondary', 'Remove photo');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      updateMouse(mouse.id, { photo: null });
      renderProfile();
    });
    actions.append(remove);
  }

  section.append(actions);
  return section;
}

function renderAboutSection(mouse) {
  const section = renderSection('About');
  const description = el('textarea');
  description.rows = 3;
  description.value = mouse.description;
  description.placeholder = `What is ${mouse.name} like?`;
  description.setAttribute('aria-label', `About ${mouse.name}`);
  description.addEventListener('input', () => updateMouse(mouse.id, { description: description.value }));
  section.append(description);
  return section;
}

function renderPersonalitySection(mouse) {
  const section = renderSection('Personality');
  const list = el('div', 'tag-list');
  for (const tag of TAGS) {
    const button = el('button', 'tag-toggle', tag);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(mouse.tags.includes(tag)));
    button.addEventListener('click', () => {
      const hasTag = mouse.tags.includes(tag);
      updateMouse(mouse.id, {
        tags: TAGS.filter((t) => (t === tag ? !hasTag : mouse.tags.includes(t))),
      });
      button.setAttribute('aria-pressed', String(!hasTag));
    });
    list.append(button);
  }
  section.append(list);
  return section;
}

function renderMemoriesSection(mouse) {
  const section = renderSection('Memories');

  if (mouse.memories.length === 0) {
    section.append(el('p', 'hint', `No memories with ${mouse.name} yet.`));
  } else {
    const list = el('ul', 'memory-list');
    mouse.memories.forEach((memory, index) => {
      const item = el('li', 'memory');
      const body = el('div', 'memory-body');
      const date = el('time', '', new Date(memory.date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      }));
      date.dateTime = memory.date;
      body.append(el('p', '', memory.text), date);

      const remove = el('button', 'icon-button', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Delete memory');
      remove.addEventListener('click', () => {
        updateMouse(mouse.id, { memories: mouse.memories.filter((_, i) => i !== index) });
        renderProfile();
      });

      item.append(body, remove);
      list.append(item);
    });
    section.append(list);
  }

  const form = el('form', 'memory-form');
  const input = el('textarea');
  input.rows = 2;
  input.placeholder = `Share a moment with ${mouse.name}`;
  input.setAttribute('aria-label', 'New memory');
  const submit = el('button', 'button', 'Add memory');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      return;
    }
    updateMouse(mouse.id, {
      memories: [...mouse.memories, { text, date: new Date().toISOString() }],
    });
    renderProfile();
  });
  section.append(form);

  return section;
}

function renderProfile() {
  const mouse = MICE[openProfileId];
  const profile = el('div', 'profile');

  const head = el('div', 'profile-head');
  const titles = el('div');
  titles.append(el('h2', '', mouse.name), el('p', 'hint', 'Add what makes this mouse special.'));
  const close = el('button', 'close-button', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close profile');
  close.addEventListener('click', () => profileDialog.close());
  head.append(renderAvatar(mouse), titles, close);

  profile.append(
    head,
    renderPhotoSection(mouse),
    renderAboutSection(mouse),
    renderPersonalitySection(mouse),
    renderMemoriesSection(mouse),
  );
  profileDialog.replaceChildren(profile);
}

// Clicks on the dimmed backdrop land on the dialog element itself.
profileDialog.addEventListener('click', (event) => {
  if (event.target === profileDialog) {
    profileDialog.close();
  }
});

onMiceChange(() => {
  renderMiceGrid();
  renderMatches();
  renderedScanKey = null;
});

buildTagPicker();
renderMatches();
renderMiceGrid();
reportScannedMice([]);

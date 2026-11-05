// Floor plan: shared by the House and Workshop tabs.
//
// A printed floor plan (print/map.pdf) has a QR anchor in each corner. Once
// the camera sees all four, every other code can be placed on the plan, so
// the rooms stay put even when the camera moves or tilts. In simulation, the
// cards are dragged around the plan instead.
//
// Everything here works in floor-plan pixels: (0, 0) is the top-left corner
// of the plan image and (HOUSE_MAP.width, HOUSE_MAP.height) its bottom-right.

const HOUSE_MAP = {
  image: 'images/floor-plan.png',
  width: 1326,
  height: 1720,
  anchors: {
    'map-tl': { x: 130, y: 130 },
    'map-tr': { x: 1196, y: 130 },
    'map-br': { x: 1196, y: 1590 },
    'map-bl': { x: 130, y: 1590 },
  },
  // Checked in order; anywhere else inside the house is the hallway.
  rooms: [
    { name: 'kitchen', x: 863, y: 0, width: 463, height: 632 },
    { name: 'mouse hole', x: 93, y: 1127, width: 495, height: 165 },
    { name: 'living room', x: 743, y: 1232, width: 583, height: 488 },
  ],
  defaultRoom: 'hallway',
};

// Short synthesised jingles, as [frequency Hz, seconds] notes.
const SOUNDS = {
  sneak: [[660, 0.08], [880, 0.08], [660, 0.08]],
  home: [[523, 0.15], [659, 0.15], [784, 0.3]],
  scared: [[220, 0.12], [208, 0.12], [196, 0.35]],
  cook: [[440, 0.1], [0, 0.05], [440, 0.1]],
  fix: [[300, 0.07], [0, 0.07], [300, 0.07], [0, 0.07], [300, 0.07]],
  relax: [[392, 0.35], [330, 0.45]],
  gameover: [[392, 0.2], [330, 0.2], [262, 0.6]],
  happy: [[784, 0.1], [988, 0.1], [1175, 0.1], [1568, 0.25]],
  // Rising, like a question.
  pizza: [[523, 0.1], [659, 0.1], [880, 0.2]],
  veg: [[440, 0.1], [494, 0.1], [659, 0.2]],
};

const ROOM_EMPTY_COLOR = 'rgba(140, 140, 140, 0.9)';
const ROOM_FULL_COLOR = '#34c759';

// A printed card's code is about 1.4in, which is roughly 240 plan pixels on
// the printed map, so virtual cards default to the same size.
const SIM_CARD_SIZE = 240;
// Detection drops out for the odd frame, so a card stays on the map until it
// has gone unseen for this long.
const MAP_LINGER_MS = 600;

const scannerBox = document.querySelector('.scanner');

const floorPlan = new Image();
floorPlan.src = HOUSE_MAP.image;

let frameToMap = null;
let anchorsInView = 0;
// Every non-anchor code seen on the map lately, keyed by its text.
const seenOnMap = {};

// --- Camera ------------------------------------------------------------------

// Fits the 3x3 matrix H (with H[8] = 1) mapping four `src` points onto four
// `dst` points, by solving the standard 8x8 linear system.
function solveHomography(src, dst) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) {
        pivot = r;
      }
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) {
      return null;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];

    for (let r = 0; r < 8; r++) {
      if (r !== col) {
        const factor = rows[r][col] / rows[col][col];
        for (let k = col; k < 9; k++) {
          rows[r][k] -= factor * rows[col][k];
        }
      }
    }
  }

  const h = rows.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyHomography(h, { x, y }) {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

// Called with each frame's codes while the camera drives a floor-plan tab.
// The last calibration is kept when an anchor is briefly hidden (e.g. by a
// hand), on the assumption that the map and camera stay put.
function updateMapFromCamera(qrCodes) {
  const now = performance.now();
  const byText = new Map(qrCodes.map((code) => [code.data.trim().toLowerCase(), code]));

  const anchors = Object.entries(HOUSE_MAP.anchors).filter(([text]) => byText.has(text));
  anchorsInView = anchors.length;
  if (anchors.length === 4) {
    frameToMap = solveHomography(
      anchors.map(([text]) => centerOf(byText.get(text).location)),
      anchors.map(([, point]) => point),
    ) ?? frameToMap;
  }

  if (frameToMap) {
    for (const { data, location } of qrCodes) {
      if (Object.hasOwn(HOUSE_MAP.anchors, data.trim().toLowerCase())) {
        continue;
      }
      const corners = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner]
        .map((point) => applyHomography(frameToMap, point));
      const size = corners.reduce((sum, a, i) => {
        const b = corners[(i + 1) % 4];
        return sum + Math.hypot(b.x - a.x, b.y - a.y);
      }, 0) / 4;
      const center = applyHomography(frameToMap, centerOf(location));
      seenOnMap[data] = { x: center.x, y: center.y, size, seenAt: now };
    }
  }

  for (const [data, card] of Object.entries(seenOnMap)) {
    if (now - card.seenAt > MAP_LINGER_MS) {
      delete seenOnMap[data];
    }
  }
}

function roomAt(point) {
  if (point.x < 0 || point.y < 0 || point.x > HOUSE_MAP.width || point.y > HOUSE_MAP.height) {
    return null;
  }
  const room = HOUSE_MAP.rooms.find((r) =>
    point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height);
  return room?.name ?? HOUSE_MAP.defaultRoom;
}

// Center-to-center distance in card widths (the bigger card of the two).
function widthsApart(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) / Math.max(a.size, b.size);
}

// --- Sound -------------------------------------------------------------------

// Browsers only allow audio after the user interacts with the page, so the
// first tap or click anywhere turns sound on.
let audio = null;

function unlockAudio() {
  audio ??= new AudioContext();
  return audio.resume();
}

for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
  window.addEventListener(type, unlockAudio);
}

function playSound(name) {
  if (audio?.state !== 'running' || !SOUNDS[name]) {
    return;
  }
  let at = audio.currentTime;
  for (const [frequency, duration] of SOUNDS[name]) {
    if (frequency > 0) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.08, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + duration);
    }
    at += duration;
  }
}

// --- Drawing helpers ---------------------------------------------------------

// The map is drawn at plan resolution and scaled down to fit, so this turns
// an on-screen size in CSS pixels into plan pixels.
function mapPx(ctx, px) {
  return px * HOUSE_MAP.width / (ctx.canvas.clientWidth || HOUSE_MAP.width);
}

function drawFloorPlan(ctx) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, HOUSE_MAP.width, HOUSE_MAP.height);
  if (floorPlan.complete && floorPlan.naturalWidth > 0) {
    ctx.drawImage(floorPlan, 0, 0, HOUSE_MAP.width, HOUSE_MAP.height);
  }
}

// Rooms are dashed grey while empty, and fill green with a count once a
// card's center is inside.
function drawRooms(ctx, cards) {
  for (const room of HOUSE_MAP.rooms) {
    const count = cards.filter((c) => c.room === room.name).length;
    ctx.lineWidth = mapPx(ctx, count > 0 ? 4 : 3);
    ctx.setLineDash(count > 0 ? [] : [mapPx(ctx, 10), mapPx(ctx, 8)]);
    ctx.strokeStyle = count > 0 ? ROOM_FULL_COLOR : ROOM_EMPTY_COLOR;
    if (count > 0) {
      ctx.fillStyle = 'rgba(52, 199, 89, 0.25)';
      ctx.fillRect(room.x, room.y, room.width, room.height);
    }
    ctx.strokeRect(room.x, room.y, room.width, room.height);
    ctx.setLineDash([]);

    const label = count > 0 ? `${room.name} · ${count} inside` : room.name;
    ctx.font = `700 ${mapPx(ctx, 15)}px Fredoka, Nunito, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = count > 0 ? '#1f7a35' : '#555';
    ctx.fillText(label, room.x + mapPx(ctx, 8), room.y + mapPx(ctx, 6));
  }
}

function drawMapLine(ctx, a, b, color, width, dash = []) {
  ctx.strokeStyle = color;
  ctx.lineWidth = mapPx(ctx, width);
  ctx.lineCap = 'round';
  ctx.setLineDash(dash.map((d) => mapPx(ctx, d)));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMapPill(ctx, text, x, y, background, foreground = '#fff') {
  const size = mapPx(ctx, 14);
  const padding = size * 0.5;
  ctx.font = `700 ${size}px Nunito, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + padding * 2;
  const height = size + padding;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = foreground;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'start';
  return height;
}

// A colored ring around the card, and in simulation the card itself (in the
// camera view the real card is already there on the paper).
function drawMapCard(ctx, card, { color, emoji, label }, simulating) {
  const { x, y, size } = card;
  ctx.strokeStyle = color;
  ctx.lineWidth = mapPx(ctx, 5);
  ctx.beginPath();
  ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
  ctx.stroke();

  if (simulating) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = mapPx(ctx, 2);
    ctx.beginPath();
    ctx.roundRect(x - size / 2, y - size / 2, size, size, size * 0.08);
    ctx.fill();
    ctx.stroke();
    ctx.font = `${size * 0.42}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(emoji, x, y - size * 0.08);
    ctx.textAlign = 'start';
  }

  drawMapPill(ctx, label, x, y + size * 0.36, color);
}

// A white speech bubble whose tail points down at (cx, bottom).
function drawSpeechBubble(ctx, cx, bottom, text) {
  const fontSize = mapPx(ctx, 16);
  const padding = fontSize * 0.5;
  const tail = fontSize * 0.6;
  ctx.font = `700 ${fontSize}px Nunito, sans-serif`;
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + padding * 2;
  const height = fontSize + padding * 2;
  const x = Math.min(Math.max(cx - width / 2, 0), HOUSE_MAP.width - width);
  const y = Math.max(bottom - tail - height, 0);

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = mapPx(ctx, 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, fontSize * 0.4);
  ctx.moveTo(cx - tail * 0.6, y + height);
  ctx.lineTo(cx, y + height + tail);
  ctx.lineTo(cx + tail * 0.6, y + height);
  ctx.fill();
  ctx.stroke();
  // Hide the bubble's bottom edge where the tail joins it.
  ctx.fillRect(cx - tail * 0.6 + ctx.lineWidth, y + height - ctx.lineWidth,
    tail * 1.2 - ctx.lineWidth * 2, ctx.lineWidth * 2);

  ctx.fillStyle = '#000';
  ctx.fillText(text, x + padding, y + height / 2);
}

function drawBanner(ctx, text) {
  const fontSize = HOUSE_MAP.width * 0.1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, HOUSE_MAP.height / 2 - fontSize, HOUSE_MAP.width, fontSize * 2);
  ctx.font = `700 ${fontSize}px Fredoka, Nunito, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff3b30';
  ctx.fillText(text, HOUSE_MAP.width / 2, HOUSE_MAP.height / 2);
  ctx.textAlign = 'start';
}

// --- Boards ------------------------------------------------------------------

// A board is one floor-plan tab: a map canvas, a camera preview, a side panel
// and a Simulate toggle. `cards` describes the codes it cares about, keyed by
// QR text; `simCards` are their starting spots in simulation, drawn
// `simCardSize` wide; `render(ctx, placed, simulating)` draws a frame and
// returns the panel's events.
const boards = {};

function createBoard({ view, cards, simCards, simCardSize = SIM_CARD_SIZE, render }) {
  const root = document.getElementById(`view-${view}`);
  const canvas = root.querySelector('.map-canvas');
  const ctx = canvas.getContext('2d');
  const preview = root.querySelector('.map-preview');
  const status = root.querySelector('.map-status');
  const events = root.querySelector('.map-events');
  const modeButton = root.querySelector('.map-mode');
  canvas.width = HOUSE_MAP.width;
  canvas.height = HOUSE_MAP.height;

  const board = { root, preview, simCards, simulating: null };
  let dragged = null;
  let renderedKey = null;

  function updateMode() {
    root.classList.toggle('is-simulating', board.simulating);
    modeButton.textContent = board.simulating ? 'Use Camera' : 'Simulate';
    modeButton.setAttribute('aria-pressed', String(board.simulating));
  }

  function cameraStatus() {
    if (board.simulating) {
      return 'Simulating: drag the cards around the house.';
    }
    if (!currentStream) {
      return 'No camera. Allow camera access, or press Simulate.';
    }
    if (anchorsInView === 4) {
      return 'All four corner codes in view. Tracking the map.';
    }
    return frameToMap
      ? `Using the last map position (${anchorsInView} of 4 corner codes in view).`
      : `Point the camera at the printed map: ${anchorsInView} of 4 corner codes in view.`;
  }

  board.enter = () => {
    // Start on the camera if one is running, and in simulation otherwise.
    if (board.simulating === null) {
      board.simulating = !currentStream;
      updateMode();
    }
  };

  board.frame = () => {
    const positions = board.simulating
      ? simCards.map((card) => ({ ...card, size: simCardSize }))
      : Object.entries(seenOnMap)
        .filter(([data]) => Object.hasOwn(cards, data))
        .map(([data, card]) => ({ data, ...card }));
    const placed = positions.map((card) => ({ ...card, ...cards[card.data], room: roomAt(card) }));

    const list = render(ctx, placed, board.simulating);

    // Only touch the DOM when the panel actually changes, not every frame.
    const statusText = cameraStatus();
    const key = `${statusText}\n${list.map(({ text }) => text).join('\n')}`;
    if (key === renderedKey) {
      return;
    }
    renderedKey = key;
    status.textContent = statusText;
    if (list.length === 0) {
      events.replaceChildren(el('li', 'empty', 'Nothing on the map yet.'));
      return;
    }
    events.replaceChildren(...list.map(({ icon, text }) => {
      const item = el('li', 'position-event');
      item.append(el('span', 'position-event-icon', icon), el('span', null, text));
      return item;
    }));
  };

  modeButton.addEventListener('click', () => {
    board.simulating = !board.simulating;
    updateMode();
    startTicking();
  });

  function pointerToMap(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * HOUSE_MAP.width / rect.width,
      y: (event.clientY - rect.top) * HOUSE_MAP.height / rect.height,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!board.simulating) {
      return;
    }
    const point = pointerToMap(event);
    // Last drawn is on top, so search from the end.
    const card = [...simCards].reverse().find((c) =>
      Math.abs(point.x - c.x) <= simCardSize / 2 && Math.abs(point.y - c.y) <= simCardSize / 2);
    if (!card) {
      return;
    }
    dragged = { card, dx: card.x - point.x, dy: card.y - point.y };
    simCards.push(...simCards.splice(simCards.indexOf(card), 1));
    canvas.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragged) {
      return;
    }
    const point = pointerToMap(event);
    dragged.card.x = Math.min(HOUSE_MAP.width, Math.max(0, point.x + dragged.dx));
    dragged.card.y = Math.min(HOUSE_MAP.height, Math.max(0, point.y + dragged.dy));
  });

  function endDrag() {
    dragged = null;
    root.classList.remove('is-dragging');
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  boards[view] = board;
  return board;
}

// The camera preview lives in whichever tab is showing, since there's only
// one video element. Moving it pauses it, so it's restarted after the move.
onViewChange((name) => {
  const board = boards[name];
  if (board) {
    board.enter();
    board.preview.append(video);
    startTicking();
  } else if (name === 'scan') {
    scannerBox.prepend(video);
  } else {
    return;
  }
  video.play().catch(() => {});
});

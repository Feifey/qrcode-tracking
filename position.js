// Position: works out how the codes in view are placed relative to each other
// and to fixed zones of the frame, draws indicators for those placements, and
// runs the behaviors they trigger.
//
// Every distance is measured in code-widths ("w") rather than pixels, so a
// placement reads the same whether the codes are near the camera or far away.

// Occupants that aren't mice. Each carries one built-in ability that acts on
// mice placed near it.
const PROPS = {
  cat: { name: 'Cat', emoji: '🐱', color: '#ff5a5a', ability: 'warn', blurb: 'Warns mice nearby' },
  cheese: { name: 'Cheese', emoji: '🧀', color: '#ffd84a', ability: 'feed', blurb: 'Feeds mice next to it' },
};

// Zones are fractions of the visible part of the frame (the scanner crops the
// camera image to fill its box, so the edges of the raw frame may be hidden).
const ZONES = [
  { id: 'nest', name: 'Nest', color: '#8ec5ff', x: 0.03, y: 0.68, w: 0.34, h: 0.29 },
  { id: 'desk', name: 'Adoption desk', color: '#5fd4b8', x: 0.63, y: 0.68, w: 0.34, h: 0.29 },
];

// Centers closer than this count as "next to" each other: less than one
// code-width of empty space between the two codes.
const ADJACENT_WIDTHS = 2;
// A cat's warning reaches a little further than touching distance.
const WARN_WIDTHS = 3;
// Mice that share at least this many personality tags bond when adjacent.
const BOND_SHARED_TAGS = 3;
// A row needs three mice whose centers sit within this distance of one line,
// with no gap along the line bigger than ROW_MAX_GAP_WIDTHS.
const ROW_MIN_MICE = 3;
const ROW_TOLERANCE_WIDTHS = 0.45;
const ROW_MAX_GAP_WIDTHS = 3;
// How long a mouse waits at the adoption desk before it's ready to go home.
const ADOPT_DWELL_MS = 2000;
// Time for cheese to fill a mouse up, and for a full mouse to get hungry again.
const FEED_MS = 4000;
const HUNGER_MS = 30000;

const HEART_COLOR = '#ff7eb6';
const ROW_COLOR = '#ffd166';
const WARN_COLOR = '#ff5a5a';

const positionEvents = document.getElementById('positionEvents');

// Behaviors that build up over time are tracked per mouse across frames.
const deskSince = {};
const fullness = {};
const warnedMice = new Set();
let lastAnalyzedAt = performance.now();
let renderedEventsKey = null;

function getProp(id) {
  return Object.hasOwn(PROPS, id) ? PROPS[id] : null;
}

function toOccupant(qrCode) {
  const mouse = getMouse(qrCode.data);
  const prop = mouse ? null : getProp(qrCode.data);
  return {
    data: qrCode.data,
    location: qrCode.location,
    center: centerOf(qrCode.location),
    width: widthOf(qrCode.location),
    mouse,
    prop,
  };
}

function distanceInWidths(a, b) {
  const unit = (a.width + b.width) / 2;
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) / unit;
}

// The part of the overlay canvas actually shown in the scanner, in canvas
// pixels (see screenPx in script.js for why the two differ).
function visibleFrame() {
  const scale = Math.max(overlay.clientWidth / overlay.width, overlay.clientHeight / overlay.height);
  const w = overlay.clientWidth / scale;
  const h = overlay.clientHeight / scale;
  return { x: (overlay.width - w) / 2, y: (overlay.height - h) / 2, w, h };
}

function zoneRect(zone) {
  const frame = visibleFrame();
  return { x: frame.x + zone.x * frame.w, y: frame.y + zone.y * frame.h, w: zone.w * frame.w, h: zone.h * frame.h };
}

function zoneOf(occupant) {
  return ZONES.find((zone) => {
    const rect = zoneRect(zone);
    const { x, y } = occupant.center;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }) || null;
}

function findPairs(mice) {
  const pairs = [];
  for (let i = 0; i < mice.length; i++) {
    for (let j = i + 1; j < mice.length; j++) {
      const distance = distanceInWidths(mice[i], mice[j]);
      if (distance < ADJACENT_WIDTHS) {
        const shared = mice[i].mouse.tags.filter((tag) => mice[j].mouse.tags.includes(tag));
        pairs.push({ a: mice[i], b: mice[j], distance, shared, bonded: shared.length >= BOND_SHARED_TAGS });
      }
    }
  }
  return pairs;
}

// Tries the line through every pair of mice, collects the mice lying on it,
// and splits them wherever the gap along the line is too big to read as one
// row. Rows contained in a longer row are dropped.
function findRows(mice) {
  const rows = new Map();

  for (let i = 0; i < mice.length; i++) {
    for (let j = i + 1; j < mice.length; j++) {
      const origin = mice[i].center;
      const length = Math.hypot(mice[j].center.x - origin.x, mice[j].center.y - origin.y);
      if (length === 0) {
        continue;
      }
      const dir = { x: (mice[j].center.x - origin.x) / length, y: (mice[j].center.y - origin.y) / length };

      const onLine = mice
        .map((occupant) => {
          const dx = occupant.center.x - origin.x;
          const dy = occupant.center.y - origin.y;
          return { occupant, along: dx * dir.x + dy * dir.y, off: Math.abs(dx * dir.y - dy * dir.x) };
        })
        .filter(({ occupant, off }) => off < ROW_TOLERANCE_WIDTHS * occupant.width)
        .sort((a, b) => a.along - b.along);

      let run = [];
      const flush = () => {
        if (run.length >= ROW_MIN_MICE) {
          const members = run.map(({ occupant }) => occupant);
          rows.set(members.map((m) => m.data).sort().join('|'), members);
        }
      };
      for (const entry of onLine) {
        const previous = run[run.length - 1];
        if (previous && (entry.along - previous.along) / entry.occupant.width > ROW_MAX_GAP_WIDTHS) {
          flush();
          run = [];
        }
        run.push(entry);
      }
      flush();
    }
  }

  const all = [...rows.values()];
  return all
    .filter((row) => !all.some((other) => other.length > row.length && row.every((m) => other.includes(m))))
    .map(orderRowTowardDesk);
}

// An adoption line is read from the end nearest the adoption desk, so the
// mouse at that end is first in line.
function orderRowTowardDesk(members) {
  const desk = zoneRect(ZONES.find((zone) => zone.id === 'desk'));
  const deskCenter = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };
  const distanceToDesk = (m) => Math.hypot(m.center.x - deskCenter.x, m.center.y - deskCenter.y);
  const first = members[0];
  const last = members[members.length - 1];
  return distanceToDesk(first) <= distanceToDesk(last) ? members : [...members].reverse();
}

function findNearby(props, mice, ability, maxWidths) {
  return props
    .filter((occupant) => occupant.prop.ability === ability)
    .map((source) => ({ source, mice: mice.filter((m) => distanceInWidths(source, m) < maxWidths) }));
}

function analyzePositions(occupants) {
  const now = performance.now();
  const dt = now - lastAnalyzedAt;
  lastAnalyzedAt = now;

  const mice = occupants.filter((occupant) => occupant.mouse);
  const props = occupants.filter((occupant) => occupant.prop);

  const zoneById = {};
  for (const occupant of mice) {
    zoneById[occupant.data] = zoneOf(occupant);
  }

  const warnings = findNearby(props, mice, 'warn', WARN_WIDTHS);
  const feedings = findNearby(props, mice, 'feed', ADJACENT_WIDTHS);

  // Desk dwell: the timer restarts whenever a mouse leaves the desk.
  for (const occupant of mice) {
    const id = occupant.data;
    if (zoneById[id]?.id === 'desk') {
      deskSince[id] ??= now;
    } else {
      delete deskSince[id];
    }
  }

  // Feeding fills a mouse up; away from cheese it slowly gets hungry again.
  const fedIds = new Set(feedings.flatMap(({ mice: fed }) => fed.map((m) => m.data)));
  for (const id of new Set([...Object.keys(fullness), ...fedIds])) {
    const change = fedIds.has(id) ? dt / FEED_MS : -dt / HUNGER_MS;
    fullness[id] = Math.min(1, Math.max(0, (fullness[id] || 0) + change));
    if (fullness[id] === 0) {
      delete fullness[id];
    }
  }

  // The cat's warning is spoken once each time a mouse comes into range.
  const warnedNow = new Set(warnings.flatMap(({ mice: warned }) => warned.map((m) => m.data)));
  for (const id of warnedNow) {
    if (!warnedMice.has(id)) {
      speechSynthesis.speak(new SpeechSynthesisUtterance(`Watch out, ${MICE[id].name}!`));
    }
  }
  warnedMice.clear();
  warnedNow.forEach((id) => warnedMice.add(id));

  return {
    mice,
    props,
    zoneById,
    pairs: findPairs(mice),
    rows: findRows(mice),
    warnings,
    feedings,
    warnedIds: warnedNow,
    now,
  };
}

function adoptProgress(id, now) {
  return deskSince[id] === undefined ? null : Math.min(1, (now - deskSince[id]) / ADOPT_DWELL_MS);
}

// --- Drawing -----------------------------------------------------------------

function drawPill(text, x, y, background, foreground = '#ffffff') {
  const size = screenPx(15);
  const padding = size * 0.5;
  overlayCtx.font = `700 ${size}px Nunito, sans-serif`;
  overlayCtx.textBaseline = 'middle';
  overlayCtx.textAlign = 'center';
  const width = overlayCtx.measureText(text).width + padding * 2;
  const height = size + padding;
  overlayCtx.fillStyle = background;
  overlayCtx.beginPath();
  overlayCtx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
  overlayCtx.fill();
  overlayCtx.fillStyle = foreground;
  overlayCtx.fillText(text, x, y);
  overlayCtx.textAlign = 'start';
  return height;
}

function drawEmoji(location, emoji) {
  const center = centerOf(location);
  overlayCtx.font = `${widthOf(location) * 0.75}px sans-serif`;
  overlayCtx.textAlign = 'center';
  overlayCtx.textBaseline = 'middle';
  overlayCtx.fillText(emoji, center.x, center.y);
  overlayCtx.textAlign = 'start';
}

function drawZones(layout) {
  for (const zone of ZONES) {
    const rect = zoneRect(zone);
    const count = layout.mice.filter((m) => layout.zoneById[m.data] === zone).length;

    overlayCtx.globalAlpha = count > 0 ? 0.28 : 0.12;
    overlayCtx.fillStyle = zone.color;
    overlayCtx.beginPath();
    overlayCtx.roundRect(rect.x, rect.y, rect.w, rect.h, screenPx(16));
    overlayCtx.fill();
    overlayCtx.globalAlpha = 1;

    overlayCtx.strokeStyle = zone.color;
    overlayCtx.lineWidth = screenPx(count > 0 ? 3 : 2);
    overlayCtx.setLineDash(count > 0 ? [] : [screenPx(8), screenPx(6)]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);

    const label = count > 0 ? `${zone.name} · ${count} inside` : zone.name;
    overlayCtx.font = `700 ${screenPx(16)}px Fredoka, Nunito, sans-serif`;
    overlayCtx.textBaseline = 'top';
    overlayCtx.fillStyle = zone.color;
    overlayCtx.fillText(label, rect.x + screenPx(10), rect.y + screenPx(8));
  }
}

function drawLine(from, to, color, width, dash = []) {
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = width;
  overlayCtx.lineCap = 'round';
  overlayCtx.setLineDash(dash);
  overlayCtx.beginPath();
  overlayCtx.moveTo(from.x, from.y);
  overlayCtx.lineTo(to.x, to.y);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
}

// Drawn under the codes: zones, rows, and the links between neighbors.
function drawPositionBackground(layout) {
  drawZones(layout);

  for (const row of layout.rows) {
    const first = row[0].center;
    const last = row[row.length - 1].center;
    const length = Math.hypot(last.x - first.x, last.y - first.y);
    const reach = row[0].width * 0.7 / length;
    const dx = (last.x - first.x) * reach;
    const dy = (last.y - first.y) * reach;
    overlayCtx.globalAlpha = 0.55;
    drawLine({ x: first.x - dx, y: first.y - dy }, { x: last.x + dx, y: last.y + dy }, ROW_COLOR, row[0].width * 0.5);
    overlayCtx.globalAlpha = 1;
  }

  for (const { a, b, bonded } of layout.pairs) {
    if (bonded) {
      drawLine(a.center, b.center, HEART_COLOR, screenPx(6));
    } else {
      drawLine(a.center, b.center, '#ffffff', screenPx(3), [screenPx(8), screenPx(8)]);
    }
  }

  for (const { source, mice } of layout.warnings) {
    for (const m of mice) {
      drawLine(source.center, m.center, WARN_COLOR, screenPx(3), [screenPx(4), screenPx(6)]);
    }
  }
}

// Drawn over the codes: distance labels, row numbers, and each mouse's status.
function drawPositionForeground(layout) {
  for (const { a, b, distance, bonded } of layout.pairs) {
    const mid = { x: (a.center.x + b.center.x) / 2, y: (a.center.y + b.center.y) / 2 };
    const text = bonded ? `♥ ${distance.toFixed(1)}w` : `${distance.toFixed(1)}w`;
    drawPill(text, mid.x, mid.y, bonded ? HEART_COLOR : 'rgba(30, 22, 17, 0.8)');
  }

  for (const row of layout.rows) {
    row.forEach((m, index) => {
      const size = screenPx(14);
      const x = m.center.x - m.width / 2;
      const y = m.center.y - m.width / 2;
      overlayCtx.fillStyle = ROW_COLOR;
      overlayCtx.beginPath();
      overlayCtx.arc(x, y, size, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#3b2a20';
      overlayCtx.font = `700 ${size * 1.2}px Fredoka, Nunito, sans-serif`;
      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
      overlayCtx.fillText(String(index + 1), x, y);
      overlayCtx.textAlign = 'start';
    });
  }

  const pulse = 0.5 + 0.5 * Math.sin(layout.now / 150);
  for (const m of layout.mice) {
    const id = m.data;
    const radius = m.width * 0.8;

    if (layout.warnedIds.has(id)) {
      overlayCtx.strokeStyle = WARN_COLOR;
      overlayCtx.lineWidth = screenPx(4 + pulse * 4);
      overlayCtx.beginPath();
      overlayCtx.arc(m.center.x, m.center.y, radius + pulse * screenPx(8), 0, Math.PI * 2);
      overlayCtx.stroke();
    }

    const progress = adoptProgress(id, layout.now);
    if (progress !== null) {
      overlayCtx.strokeStyle = '#5fd4b8';
      overlayCtx.lineWidth = screenPx(6);
      overlayCtx.beginPath();
      overlayCtx.arc(m.center.x, m.center.y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      overlayCtx.stroke();
    }

    // Status pills stack upward from the top edge of the code.
    let y = m.center.y - m.width / 2 - screenPx(14);
    const stack = (text, background, foreground) => {
      y -= drawPill(text, m.center.x, y, background, foreground) + screenPx(4);
    };

    const full = fullness[id];
    if (full !== undefined) {
      const barWidth = m.width;
      const barHeight = screenPx(8);
      overlayCtx.fillStyle = 'rgba(30, 22, 17, 0.8)';
      overlayCtx.beginPath();
      overlayCtx.roundRect(m.center.x - barWidth / 2, y - barHeight / 2, barWidth, barHeight, barHeight / 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#ffd84a';
      overlayCtx.beginPath();
      overlayCtx.roundRect(m.center.x - barWidth / 2, y - barHeight / 2, barWidth * full, barHeight, barHeight / 2);
      overlayCtx.fill();
      y -= barHeight + screenPx(14);
      if (full >= 1) {
        stack('🧀 Full!', '#ffd84a', '#3b2a20');
      }
    }

    if (layout.warnedIds.has(id)) {
      stack('⚠ Watch out!', WARN_COLOR);
    }
    if (progress === 1) {
      stack('✓ Ready to adopt', '#5fd4b8', '#1e1611');
    }
    if (layout.zoneById[id]?.id === 'nest') {
      stack('💤 Napping', '#8ec5ff', '#1e1611');
    }
  }
}

// --- Side panel --------------------------------------------------------------

function describePositions(layout) {
  const name = (occupant) => occupant.mouse.name;
  const events = [];

  // No distances here: they jitter every frame on camera and would make the
  // list re-render constantly. The overlay shows them instead.
  for (const { a, b, shared, bonded } of layout.pairs) {
    events.push(bonded
      ? { icon: '💞', text: `${name(a)} and ${name(b)} are a bonded pair. They share ${shared.join(', ')}. Adopt them together!` }
      : { icon: '↔', text: `${name(a)} is next to ${name(b)}.` });
  }
  for (const row of layout.rows) {
    events.push({ icon: '🐭', text: `Adoption line: ${row.map(name).join(' → ')}. ${name(row[0])} is first.` });
  }
  for (const m of layout.mice) {
    const zone = layout.zoneById[m.data];
    if (zone?.id === 'nest') {
      events.push({ icon: '💤', text: `${name(m)} is napping in the Nest.` });
    } else if (zone?.id === 'desk') {
      events.push(adoptProgress(m.data, layout.now) === 1
        ? { icon: '✅', text: `${name(m)} is ready to adopt!` }
        : { icon: '⏳', text: `${name(m)} is waiting at the Adoption desk.` });
    }
  }
  for (const { mice } of layout.warnings) {
    if (mice.length > 0) {
      events.push({ icon: '🐱', text: `The cat is warning ${mice.map(name).join(', ')}.` });
    }
  }
  for (const { mice } of layout.feedings) {
    if (mice.length > 0) {
      events.push({ icon: '🧀', text: `The cheese is feeding ${mice.map(name).join(', ')}.` });
    }
  }
  for (const m of layout.mice) {
    if (fullness[m.data] === 1) {
      events.push({ icon: '😋', text: `${name(m)} is full.` });
    }
  }
  return events;
}

function reportPositionEvents(layout) {
  const events = describePositions(layout);

  // Only touch the DOM when the list actually changes, not every frame.
  const key = events.map(({ text }) => text).join('\n');
  if (key === renderedEventsKey) {
    return;
  }
  renderedEventsKey = key;

  if (events.length === 0) {
    positionEvents.replaceChildren(el('li', 'empty', 'Nothing yet. Move mice next to each other, line them up, or put them in a zone.'));
    return;
  }
  positionEvents.replaceChildren(...events.map(({ icon, text }) => {
    const item = el('li', 'position-event');
    item.append(el('span', 'position-event-icon', icon), el('span', null, text));
    return item;
  }));
}

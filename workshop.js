// Workshop: the Position workshop, on the floor plan (see floorplan.js), with
// the Spatial Pixel Test cards.
//
// Part 1, four notions of position, each with its own indicator:
//   zone (inside a room), adjacency (next to), alignment (in a row) and
//   cluster (three or more gathered together).
// Part 2a, placements the system responds to:
//   a cluster is circled as a group, a row becomes a numbered line, and two
//   mice in the same room take it over.
// Part 2b, cards with built-in abilities:
//   a resource card delivers to the matching need card next to it, and the
//   human warns any mouse that comes near.

const WORKSHOP_CARDS = {
  'bottle-empty': { name: 'MS-01', kind: 'mouse' },
  'bottle-half': { name: 'MS-02', kind: 'mouse' },
  'bottle-full': { name: 'HM-01', kind: 'human' },
  'object-a': { name: 'Needs water', kind: 'need', supply: 'water' },
  'object-c': { name: 'Needs light', kind: 'need', supply: 'light' },
  'object-b': { name: 'Needs medicine', kind: 'need', supply: 'medicine' },
  'bottle': { name: 'Water', kind: 'resource', supply: 'water' },
  'phone': { name: 'Light', kind: 'resource', supply: 'light' },
  'notebook': { name: 'Medicine', kind: 'resource', supply: 'medicine' },
};

const SUPPLY_EMOJI = { water: '💧', light: '💡', medicine: '💊' };
const WORKSHOP_KIND_STYLE = {
  mouse: { color: '#ff9500', emoji: '🐭' },
  human: { color: '#007aff', emoji: '🧑' },
  need: { color: '#ff3b30' },
  resource: { color: '#34c759' },
};

// Centers closer than this count as "next to" each other. Printed cards
// side by side are about 1.3 code-widths apart, so this allows a small gap.
const NEXT_TO_WIDTHS = 1.8;
// The human's warning reaches a little further than touching distance.
const HUMAN_WARN_WIDTHS = 2.5;
const CLUSTER_MIN = 3;
// Nine cards share one letter-size map, so a row allows smaller gaps than on
// the scanner, or almost any three cards would line up.
const WORKSHOP_ROW_GAP_WIDTHS = 2;

const CLUSTER_COLOR = '#af52de';
const DELIVER_COLOR = '#34c759';
const WARN_LINE_COLOR = '#ff3b30';

// What each card was doing last frame, so sounds play once when it starts.
const workshopLastState = new Map();

function workshopStyle(card) {
  const style = WORKSHOP_KIND_STYLE[card.kind];
  if (card.kind === 'need') {
    return { color: card.delivered ? DELIVER_COLOR : style.color, emoji: `${SUPPLY_EMOJI[card.supply]}?`, label: card.delivered ? `✓ ${card.name}` : card.name };
  }
  if (card.kind === 'resource') {
    return { color: style.color, emoji: SUPPLY_EMOJI[card.supply], label: card.name };
  }
  return { ...style, label: card.name };
}

function findNextTo(cards) {
  const pairs = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const widths = widthsApart(cards[i], cards[j]);
      if (widths < NEXT_TO_WIDTHS) {
        pairs.push({ a: cards[i], b: cards[j], widths });
      }
    }
  }
  return pairs;
}

// Groups of cards connected through "next to" links, three or more strong.
function findClusters(cards, pairs) {
  const groupOf = new Map(cards.map((card) => [card, [card]]));
  for (const { a, b } of pairs) {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (ga !== gb) {
      ga.push(...gb);
      gb.forEach((card) => groupOf.set(card, ga));
    }
  }
  return [...new Set(groupOf.values())].filter((group) => group.length >= CLUSTER_MIN);
}

function analyzeWorkshop(cards) {
  const pairs = findNextTo(cards);
  const clusters = findClusters(cards, pairs);
  // findRows (position.js) works on any occupants with a center and a width.
  const rows = findRows(cards.map((card) => ({ data: card.data, center: card, width: card.size, card })), { maxGapWidths: WORKSHOP_ROW_GAP_WIDTHS })
    .map((row) => row.map(({ card }) => card));

  const deliveries = pairs.filter(({ a, b }) =>
    a.kind !== b.kind && ['need', 'resource'].includes(a.kind) && ['need', 'resource'].includes(b.kind) && a.supply === b.supply);
  for (const { a, b } of deliveries) {
    (a.kind === 'need' ? a : b).delivered = true;
  }

  const humans = cards.filter((card) => card.kind === 'human');
  const warnings = [];
  for (const human of humans) {
    for (const mouse of cards.filter((card) => card.kind === 'mouse')) {
      if (widthsApart(human, mouse) < HUMAN_WARN_WIDTHS) {
        warnings.push({ human, mouse });
        mouse.warned = true;
      }
    }
  }

  // Rooms (not the hallway) with both mice in them, together or apart.
  const takenOver = HOUSE_MAP.rooms
    .map((room) => room.name)
    .filter((room) => cards.filter((card) => card.kind === 'mouse' && card.room === room).length >= 2);

  return { pairs, clusters, rows, deliveries, warnings, takenOver };
}

// Centered on the group's average point, and reaching past its farthest card.
function drawCluster(ctx, group) {
  const cx = group.reduce((sum, card) => sum + card.x, 0) / group.length;
  const cy = group.reduce((sum, card) => sum + card.y, 0) / group.length;
  const radius = Math.max(...group.map((card) => Math.hypot(card.x - cx, card.y - cy) + card.size * 0.9));
  ctx.fillStyle = 'rgba(175, 82, 222, 0.1)';
  ctx.strokeStyle = CLUSTER_COLOR;
  ctx.lineWidth = mapPx(ctx, 4);
  ctx.setLineDash([mapPx(ctx, 12), mapPx(ctx, 8)]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  drawMapPill(ctx, `Group of ${group.length}`, cx, cy - radius, CLUSTER_COLOR);
}

function drawRow(ctx, row) {
  const first = row[0];
  const last = row[row.length - 1];
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  const reach = first.size * 0.7 / length;
  const dx = (last.x - first.x) * reach;
  const dy = (last.y - first.y) * reach;
  ctx.globalAlpha = 0.5;
  drawMapLine(ctx, { x: first.x - dx, y: first.y - dy }, { x: last.x + dx, y: last.y + dy }, ROW_COLOR, 40);
  ctx.globalAlpha = 1;
}

function drawRowNumbers(ctx, row) {
  row.forEach((card, index) => {
    const x = card.x - card.size / 2;
    const y = card.y - card.size / 2;
    const radius = mapPx(ctx, 13);
    ctx.fillStyle = ROW_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a20';
    ctx.font = `700 ${radius * 1.3}px Fredoka, Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x, y);
    ctx.textAlign = 'start';
  });
}

function renderWorkshop(ctx, cards, simulating) {
  const result = analyzeWorkshop(cards);
  const now = performance.now();

  drawFloorPlan(ctx);
  drawRooms(ctx, cards);
  for (const room of result.takenOver) {
    const rect = HOUSE_MAP.rooms.find((r) => r.name === room);
    drawMapPill(ctx, '🐭 taken over!', rect.x + rect.width / 2, rect.y + rect.height / 2, '#ff9500');
  }

  result.clusters.forEach((group) => drawCluster(ctx, group));
  result.rows.forEach((row) => drawRow(ctx, row));

  for (const { a, b } of result.pairs) {
    const delivering = result.deliveries.some((d) => d.a === a && d.b === b);
    drawMapLine(ctx, a, b, delivering ? DELIVER_COLOR : '#555', delivering ? 6 : 3, delivering ? [] : [8, 8]);
  }
  for (const { human, mouse } of result.warnings) {
    drawMapLine(ctx, human, mouse, WARN_LINE_COLOR, 3, [4, 6]);
  }

  const pulse = 0.5 + 0.5 * Math.sin(now / 150);
  for (const card of cards) {
    if (card.warned) {
      ctx.strokeStyle = WARN_LINE_COLOR;
      ctx.lineWidth = mapPx(ctx, 4 + pulse * 4);
      ctx.beginPath();
      ctx.arc(card.x, card.y, card.size * (0.95 + pulse * 0.1), 0, Math.PI * 2);
      ctx.stroke();
    }
    drawMapCard(ctx, card, workshopStyle(card), simulating);
  }

  for (const { a, b, widths } of result.pairs) {
    const delivering = result.deliveries.some((d) => d.a === a && d.b === b);
    drawMapPill(ctx, `${widths.toFixed(1)}w`, (a.x + b.x) / 2, (a.y + b.y) / 2, delivering ? DELIVER_COLOR : 'rgba(30, 22, 17, 0.8)');
  }
  result.rows.forEach((row) => drawRowNumbers(ctx, row));

  // Bubbles and sounds for the abilities, played once when each starts.
  for (const card of cards) {
    const state = card.warned ? 'warned' : card.delivered ? 'delivered' : null;
    if (state === 'warned') {
      drawSpeechBubble(ctx, card.x, card.y - card.size * 0.95, 'Run!');
    } else if (state === 'delivered') {
      drawSpeechBubble(ctx, card.x, card.y - card.size * 0.85, 'Thank you!');
    }
    if (state && state !== workshopLastState.get(card.data)) {
      playSound(state === 'warned' ? 'scared' : 'happy');
    }
    workshopLastState.set(card.data, state);
  }

  return describeWorkshop(cards, result);
}

function describeWorkshop(cards, { pairs, clusters, rows, deliveries, warnings, takenOver }) {
  const events = [];
  for (const { a, b } of deliveries) {
    const need = a.kind === 'need' ? a : b;
    events.push({ icon: '📦', text: `${need.supply[0].toUpperCase()}${need.supply.slice(1)} delivered: “${need.name}” is met.` });
  }
  for (const { human, mouse } of warnings) {
    events.push({ icon: '⚠', text: `${human.name} is warning ${mouse.name}. Run!` });
  }
  for (const group of clusters) {
    events.push({ icon: '⭕', text: `Group of ${group.length}: ${group.map((card) => card.name).join(', ')}.` });
  }
  for (const row of rows) {
    events.push({ icon: '📏', text: `In a row: ${row.map((card) => card.name).join(' → ')}.` });
  }
  for (const { a, b } of pairs) {
    if (!deliveries.some((d) => d.a === a && d.b === b)) {
      events.push({ icon: '↔', text: `${a.name} is next to ${b.name}.` });
    }
  }
  for (const room of takenOver) {
    events.push({ icon: '🐭', text: `Both mice are in the ${room}. They've taken it over!` });
  }
  for (const room of HOUSE_MAP.rooms) {
    const inside = cards.filter((card) => card.room === room.name);
    if (inside.length > 0) {
      events.push({ icon: '🏠', text: `In the ${room.name}: ${inside.map((card) => card.name).join(', ')}.` });
    }
  }
  return events;
}

createBoard({
  view: 'workshop',
  cards: WORKSHOP_CARDS,
  // Spread out so nothing but the rooms reacts until a card is moved.
  simCards: [
    { data: 'bottle-empty', x: 260, y: 560 },
    { data: 'bottle-half', x: 300, y: 1600 },
    { data: 'bottle-full', x: 1080, y: 900 },
    { data: 'object-a', x: 640, y: 300 },
    { data: 'object-c', x: 1150, y: 180 },
    { data: 'object-b', x: 200, y: 960 },
    { data: 'bottle', x: 700, y: 860 },
    { data: 'phone', x: 1150, y: 1450 },
    { data: 'notebook', x: 640, y: 1500 },
  ],
  // Smaller than the House cards (about a 1in code) so all nine fit on the
  // map with room to move.
  simCardSize: 180,
  render: renderWorkshop,
});

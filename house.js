// House: the Spatial Pixel Test game, on the floor plan (see floorplan.js).
//
// Two mouse cards and a human card (print/cards.pdf) react to the room
// they're in and to each other, with a speech bubble and a sound:
//   object + room = status, and mouse + human / mouse + mouse = event.

// Keyed by the text inside the printed codes, which differs from the label
// printed on the card. `reactions` override HOUSE_ROOM_REACTIONS.
const HOUSE_CHARACTERS = {
  'bottle-empty': {
    name: 'MS-01',
    kind: 'mouse',
    reactions: { 'kitchen': { text: 'I want pizza?', sound: 'pizza' } },
  },
  'bottle-half': {
    name: 'MS-02',
    kind: 'mouse',
    reactions: { 'kitchen': { text: 'Are there vegs?', sound: 'veg' } },
  },
  'bottle-full': { name: 'HM-01', kind: 'human' },
};

const HOUSE_ROOM_REACTIONS = {
  mouse: {
    'kitchen': { text: 'Food stolen!', sound: 'sneak' },
    'mouse hole': { text: 'Home sweet home. Safe!', sound: 'home' },
    'living room': { text: 'Scared of being killed!', sound: 'scared' },
  },
  human: {
    'kitchen': { text: 'Preparing Food', sound: 'cook' },
    'mouse hole': { text: 'The wall has a hole. Needs patching!', sound: 'fix' },
    'living room': { text: 'Relaxing...', sound: 'relax' },
  },
};

// Meetings involve two cards but show one bubble.
const CAUGHT = { text: 'Caught! Game over', sound: 'gameover', shared: true };
const MICE_MEET = { text: 'Happy happy!!!', sound: 'happy', shared: true };
// Both mice in the kitchen at once, whether or not they're side by side.
const KITCHEN_RAID = { text: 'Food Stolen!', sound: 'sneak', shared: true };

// Two characters meet when their centers are less than this many card
// widths apart.
const MEET_WIDTHS = 2.5;

const HOUSE_KIND_STYLE = {
  mouse: { color: '#ff9500', emoji: '🐭' },
  human: { color: '#007aff', emoji: '🧑' },
};

const houseLastReactions = new Map();

// Most important first: getting caught, then raiding the kitchen together,
// then meeting, then the room on its own.
function reactionFor(character, characters) {
  const others = characters.filter((c) => c !== character && widthsApart(c, character) < MEET_WIDTHS);
  if (character.kind === 'mouse') {
    if (others.some((c) => c.kind === 'human')) {
      return CAUGHT;
    }
    if (character.room === 'kitchen' && characters.some((c) =>
      c !== character && c.kind === 'mouse' && c.room === 'kitchen')) {
      return KITCHEN_RAID;
    }
    if (others.some((c) => c.kind === 'mouse')) {
      return MICE_MEET;
    }
  } else if (others.some((c) => c.kind === 'mouse')) {
    return CAUGHT;
  }
  return character.reactions?.[character.room] ?? HOUSE_ROOM_REACTIONS[character.kind][character.room] ?? null;
}

function renderHouse(ctx, characters, simulating) {
  const reactions = characters.map((character) => reactionFor(character, characters));

  drawFloorPlan(ctx);
  drawRooms(ctx, characters);

  // A line and distance label between every pair close enough to meet.
  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const a = characters[i];
      const b = characters[j];
      const widths = widthsApart(a, b);
      if (widths < MEET_WIDTHS) {
        const color = a.kind !== b.kind ? '#ff3b30' : '#ff7eb6';
        drawMapLine(ctx, a, b, color, 5);
        drawMapPill(ctx, `${widths.toFixed(1)}w`, (a.x + b.x) / 2, (a.y + b.y) / 2, color);
      }
    }
  }

  for (const character of characters) {
    drawMapCard(ctx, character, { ...HOUSE_KIND_STYLE[character.kind], label: character.name }, simulating);
  }

  // A shared reaction (a meeting) shows one bubble and plays once, on the
  // first of the cards involved.
  const shown = new Set();
  characters.forEach((character, index) => {
    const reaction = reactions[index];
    const previous = houseLastReactions.get(character.data);
    houseLastReactions.set(character.data, reaction?.text);
    if (!reaction || (reaction.shared && shown.has(reaction.text))) {
      return;
    }
    shown.add(reaction.text);
    drawSpeechBubble(ctx, character.x, character.y - character.size * 0.85, reaction.text);
    if (reaction.text !== previous) {
      playSound(reaction.sound);
    }
  });
  for (const data of houseLastReactions.keys()) {
    if (!characters.some((c) => c.data === data)) {
      houseLastReactions.delete(data);
    }
  }

  const gameOver = reactions.includes(CAUGHT);
  if (gameOver) {
    drawBanner(ctx, 'GAME OVER');
  }

  const events = characters.map((character, index) => {
    const reaction = reactions[index];
    const where = character.room ? `in the ${character.room}` : 'off the map';
    return {
      icon: HOUSE_KIND_STYLE[character.kind].emoji,
      text: reaction ? `${character.name} is ${where}: “${reaction.text}”` : `${character.name} is ${where}.`,
    };
  });
  if (gameOver) {
    events.unshift({ icon: '💀', text: 'A mouse met the human. Game over!' });
  }
  return events;
}

createBoard({
  view: 'house',
  cards: HOUSE_CHARACTERS,
  // Spread out so nothing reacts until a card is moved.
  simCards: [
    { data: 'bottle-empty', x: 300, y: 300 },
    { data: 'bottle-half', x: 300, y: 950 },
    { data: 'bottle-full', x: 1000, y: 900 },
  ],
  render: renderHouse,
});

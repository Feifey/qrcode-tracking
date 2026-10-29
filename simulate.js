// Simulation mode: instead of reading printed QR codes from the camera, the
// scanner shows draggable virtual codes. They go through exactly the same
// drawing and position logic, so placements can be tried (and demoed) without
// a camera or printed codes.

const scanner = document.querySelector('.scanner');
const simToggleButton = document.getElementById('simToggle');

let simulating = false;
let draggedToken = null;

// Size of a virtual code, as a fraction of the visible frame's height.
const SIM_CODE_SIZE = 0.09;

// Positions are fractions of the visible frame, so the layout holds up when
// the scanner is resized. Spread out so nothing is triggered to begin with.
const simTokens = [
  { data: 'laptop', u: 0.1, v: 0.12 },
  { data: 'headphones', u: 0.37, v: 0.2 },
  { data: 'wallet', u: 0.64, v: 0.12 },
  { data: 'keys', u: 0.9, v: 0.2 },
  { data: 'cup', u: 0.1, v: 0.4 },
  { data: 'bottle-full', u: 0.37, v: 0.46 },
  { data: 'bottle-half', u: 0.64, v: 0.4 },
  { data: 'bottle-empty', u: 0.9, v: 0.46 },
  { data: 'cheese', u: 0.5, v: 0.66 },
  { data: 'cat', u: 0.5, v: 0.88 },
];

function tokenLocation(token) {
  const frame = visibleFrame();
  const size = SIM_CODE_SIZE * frame.h;
  const x = frame.x + token.u * frame.w - size / 2;
  const y = frame.y + token.v * frame.h - size / 2;
  return {
    topLeftCorner: { x, y },
    topRightCorner: { x: x + size, y },
    bottomRightCorner: { x: x + size, y: y + size },
    bottomLeftCorner: { x, y: y + size },
  };
}

function simulatedQRCodes() {
  return simTokens.map((token) => ({ data: token.data, location: tokenLocation(token) }));
}

// Pointer position as a fraction of the visible frame. The overlay element
// shows exactly the visible frame, so this is just its bounding box.
function pointerToFrame(event) {
  const rect = overlay.getBoundingClientRect();
  return { u: (event.clientX - rect.left) / rect.width, v: (event.clientY - rect.top) / rect.height };
}

function tokenAt(point) {
  const frame = visibleFrame();
  const halfU = (SIM_CODE_SIZE * frame.h) / frame.w / 2;
  const halfV = SIM_CODE_SIZE / 2;
  // Last drawn is on top, so search from the end.
  return [...simTokens].reverse().find((token) =>
    Math.abs(point.u - token.u) <= halfU && Math.abs(point.v - token.v) <= halfV) || null;
}

overlay.addEventListener('pointerdown', (event) => {
  if (!simulating) {
    return;
  }
  const point = pointerToFrame(event);
  const token = tokenAt(point);
  if (!token) {
    return;
  }
  draggedToken = { token, offsetU: token.u - point.u, offsetV: token.v - point.v };
  // Move it to the end so it draws on top of the others.
  simTokens.push(...simTokens.splice(simTokens.indexOf(token), 1));
  overlay.setPointerCapture(event.pointerId);
  scanner.classList.add('is-dragging');
});

overlay.addEventListener('pointermove', (event) => {
  if (!draggedToken) {
    return;
  }
  const point = pointerToFrame(event);
  draggedToken.token.u = Math.min(1, Math.max(0, point.u + draggedToken.offsetU));
  draggedToken.token.v = Math.min(1, Math.max(0, point.v + draggedToken.offsetV));
});

function endDrag() {
  draggedToken = null;
  scanner.classList.remove('is-dragging');
}

overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);

simToggleButton.addEventListener('click', () => {
  simulating = !simulating;
  scanner.classList.toggle('is-simulating', simulating);
  simToggleButton.textContent = simulating ? 'Use Camera' : 'Simulate';
  simToggleButton.setAttribute('aria-pressed', String(simulating));

  // Without a camera the overlay never got sized from the video, so give it a
  // 720p frame to draw into.
  if (overlay.width === 0 || overlay.height === 0 || !video.videoWidth) {
    overlay.width = 1280;
    overlay.height = 720;
  }
  startTicking();
});

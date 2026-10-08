const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

const cameraToggleButton = document.getElementById('cameraToggle');

let sampleCanvas;
let sampleCtx;
let currentStream;
let currentFacingMode = 'environment';
let tickStarted = false;

const UNKNOWN_CODE_COLOR = '#00ff00';

// Hand tracking (MediaPipe HandLandmarker) powers the "point at an object to
// hear its name" feature. It loads its WASM runtime and model from a CDN
// asynchronously, so `handLandmarker` stays null until that finishes — tick()
// just skips pointing detection until then.
let handLandmarker = null;
let pointedObjectData = null;

async function initHandLandmarker() {
  const { HandLandmarker, FilesetResolver } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14'
  );
  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
  });
}

initHandLandmarker().catch((error) => {
  console.error('Unable to load hand tracking:', error);
});

// Landmark 8 is the index fingertip in MediaPipe's 21-point hand model.
// Coordinates come back normalized (0-1) relative to the video frame.
function getIndexFingertip() {
  if (!handLandmarker) {
    return null;
  }

  const result = handLandmarker.detectForVideo(video, performance.now());
  const landmarks = result.landmarks[0];
  if (!landmarks) {
    return null;
  }

  const tip = landmarks[8];
  return { x: tip.x * sampleCanvas.width, y: tip.y * sampleCanvas.height };
}

// Treats the finger as "pointing at" a code when its tip lands within one
// code-width of the code's center — close enough to be unambiguous without
// requiring pixel-perfect aim.
function isPointingAt(fingertip, location) {
  if (!fingertip) {
    return false;
  }

  const center = centerOf(location);
  return Math.hypot(fingertip.x - center.x, fingertip.y - center.y) < widthOf(location);
}

// Speaks `name` only when it's a new target, so holding a finger on the same
// object doesn't repeat the announcement every frame.
function announceObject(data, name) {
  if (data === pointedObjectData) {
    return;
  }

  pointedObjectData = data;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(name));
}

function drawFingertip(point) {
  overlayCtx.fillStyle = '#ffffff';
  overlayCtx.beginPath();
  overlayCtx.arc(point.x, point.y, screenPx(8), 0, Math.PI * 2);
  overlayCtx.fill();
}

// Approximate size of a QR code in the captured frame, in pixels.
const QR_SIZE = 150;
// jsQR only ever returns one decoded symbol per call, so to find multiple
// codes in a frame we scan overlapping crop windows across the image and
// decode each one separately. The window is bigger than a code (with room
// for its quiet zone) and the step is small enough that the overlap between
// adjacent windows is at least one code-width, so no code can fall entirely
// across a window boundary and get missed.
const TILE_SIZE = QR_SIZE * 2;
const TILE_STEP = QR_SIZE;

function startCamera(facingMode) {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }

  const constraints = {
    video: {
      // Lower than the camera's max resolution on purpose: scanning cost
      // scales with frame area (more/bigger tiles to decode), and QR codes
      // don't need full HD detail to read reliably at normal distances.
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: { ideal: facingMode },
    },
    audio: false,
  };

  return navigator.mediaDevices.getUserMedia(constraints)
    .then((stream) => {
      currentStream = stream;
      video.srcObject = stream;
    })
    .catch((error) => {
      console.error('Unable to access webcam:', error);
    });
}

video.addEventListener('loadedmetadata', () => {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = video.videoWidth;
  sampleCanvas.height = video.videoHeight;
  sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  if (!tickStarted) {
    tickStarted = true;
    requestAnimationFrame(tick);
  }
});

cameraToggleButton.addEventListener('click', () => {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  cameraToggleButton.textContent = currentFacingMode === 'environment'
    ? 'Switch to Front Camera'
    : 'Switch to Back Camera';
  startCamera(currentFacingMode);
});

startCamera(currentFacingMode);

function tick() {
  // Scanning and hand tracking are the expensive parts, so skip them while
  // another tab (Find a Match, Meet the Mice) is showing.
  if (currentView === 'scan' && video.readyState === video.HAVE_ENOUGH_DATA) {
    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    const fingertip = getIndexFingertip();
    let pointedAtSomething = false;
    const scannedIds = [];

    for (const qrCode of scanForQRCodes()) {
      const mouse = getMouse(qrCode.data);
      const color = mouse ? mouse.color : UNKNOWN_CODE_COLOR;
      drawBox(qrCode.location, color);

      if (mouse) {
        scannedIds.push(mouse.id);
        const photo = getMousePhoto(mouse);
        if (photo && photo.complete && photo.naturalWidth > 0) {
          drawObjectImage(qrCode.location, photo);
        }
        drawLabel(qrCode.location, mouse.name, mouse.tags, color);
      } else {
        drawLabel(qrCode.location, qrCode.data, [], color);
      }

      if (isPointingAt(fingertip, qrCode.location)) {
        pointedAtSomething = true;
        announceObject(qrCode.data, mouse ? mouse.name : qrCode.data);
      }
    }

    if (!pointedAtSomething) {
      pointedObjectData = null;
    }

    if (fingertip) {
      drawFingertip(fingertip);
    }

    reportScannedMice(scannedIds);
  }

  requestAnimationFrame(tick);
}

function scanForQRCodes() {
  const xs = getTilePositions(sampleCanvas.width);
  const ys = getTilePositions(sampleCanvas.height);
  const detections = [];

  for (const y of ys) {
    for (const x of xs) {
      const tile = sampleCtx.getImageData(x, y, TILE_SIZE, TILE_SIZE);
      // Our codes are printed black-on-white, so skip jsQR's color-inverted
      // decoding pass (its default) — it roughly doubles work per tile for
      // a case we never hit.
      const qrCode = jsQR(tile.data, TILE_SIZE, TILE_SIZE, { inversionAttempts: 'dontInvert' });
      if (qrCode) {
        detections.push(offsetQRCode(qrCode, x, y));
      }
    }
  }

  return dedupeDetections(detections);
}

// Start offsets for tiles of TILE_SIZE covering `dimension`, stepping by
// TILE_STEP and with a final tile flush against the far edge so the whole
// frame is covered even when it doesn't divide evenly by the step.
function getTilePositions(dimension) {
  if (dimension <= TILE_SIZE) {
    return [0];
  }

  const positions = [];
  for (let pos = 0; pos + TILE_SIZE <= dimension; pos += TILE_STEP) {
    positions.push(pos);
  }

  const lastPosition = dimension - TILE_SIZE;
  if (positions[positions.length - 1] !== lastPosition) {
    positions.push(lastPosition);
  }

  return positions;
}

function offsetQRCode(qrCode, offsetX, offsetY) {
  const shift = (point) => ({ x: point.x + offsetX, y: point.y + offsetY });
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = qrCode.location;

  return {
    data: qrCode.data,
    location: {
      topLeftCorner: shift(topLeftCorner),
      topRightCorner: shift(topRightCorner),
      bottomRightCorner: shift(bottomRightCorner),
      bottomLeftCorner: shift(bottomLeftCorner),
    },
  };
}

// The same QR code is often found in more than one overlapping tile, so
// collapse detections whose bounding boxes are centered near each other.
function dedupeDetections(detections) {
  const unique = [];

  for (const detection of detections) {
    const center = centerOf(detection.location);
    const isDuplicate = unique.some((existing) => {
      const existingCenter = centerOf(existing.location);
      return Math.hypot(center.x - existingCenter.x, center.y - existingCenter.y) < QR_SIZE;
    });

    if (!isDuplicate) {
      unique.push(detection);
    }
  }

  return unique;
}

function centerOf(location) {
  const { topLeftCorner, bottomRightCorner } = location;
  return {
    x: (topLeftCorner.x + bottomRightCorner.x) / 2,
    y: (topLeftCorner.y + bottomRightCorner.y) / 2,
  };
}

function widthOf(location) {
  const { topLeftCorner, topRightCorner } = location;
  return Math.hypot(topRightCorner.x - topLeftCorner.x, topRightCorner.y - topLeftCorner.y);
}

// How much bigger than the QR code itself the overlaid image is drawn.
// 1.0 would match the code's footprint exactly; a bit above that keeps the
// image legible without covering much extra screen space.
const OBJECT_IMAGE_SCALE = 1.2;

// Draws `image` centered on the QR code, scaled relative to the code's own
// size in the frame so it stays proportional as the code moves closer/further.
function drawObjectImage(location, image) {
  const center = centerOf(location);
  const drawWidth = widthOf(location) * OBJECT_IMAGE_SCALE;
  const drawHeight = drawWidth * (image.naturalHeight / image.naturalWidth);

  overlayCtx.drawImage(image, center.x - drawWidth / 2, center.y - drawHeight / 2, drawWidth, drawHeight);
}

// The overlay is drawn at the camera's resolution but displayed scaled to fit
// the scanner (object-fit: cover), so this converts an on-screen size in CSS
// pixels to canvas pixels. That keeps text the same readable size on a phone
// as on a laptop, regardless of camera resolution.
function screenPx(px) {
  const displayScale = Math.max(overlay.clientWidth / overlay.width, overlay.clientHeight / overlay.height);
  return px / displayScale;
}

function drawBox(location, color) {
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = location;

  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = screenPx(4);
  overlayCtx.beginPath();
  overlayCtx.moveTo(topLeftCorner.x, topLeftCorner.y);
  overlayCtx.lineTo(topRightCorner.x, topRightCorner.y);
  overlayCtx.lineTo(bottomRightCorner.x, bottomRightCorner.y);
  overlayCtx.lineTo(bottomLeftCorner.x, bottomLeftCorner.y);
  overlayCtx.closePath();
  overlayCtx.stroke();
}

// Splits tags into lines no wider than maxWidth, using the current font.
function wrapTags(tags, maxWidth) {
  const lines = [];
  let line = '';
  for (const tag of tags) {
    const candidate = line ? `${line} · ${tag}` : tag;
    if (line && overlayCtx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = tag;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

// Draws a name (in the code's color) with its tags wrapped underneath, on a
// dark panel just below the code.
function drawLabel(location, title, tags, color) {
  const { bottomLeftCorner, bottomRightCorner } = location;

  const titleSize = screenPx(26);
  const tagSize = screenPx(18);
  const lineHeight = tagSize * 1.4;
  const padding = titleSize * 0.4;
  const x = Math.min(bottomLeftCorner.x, bottomRightCorner.x);
  const y = Math.max(bottomLeftCorner.y, bottomRightCorner.y) + padding * 2;

  overlayCtx.textBaseline = 'top';
  const tagFont = `600 ${tagSize}px Nunito, sans-serif`;
  const titleFont = `700 ${titleSize}px Fredoka, Nunito, sans-serif`;

  overlayCtx.font = tagFont;
  const lines = wrapTags(tags, Math.max(widthOf(location) * 1.5, titleSize * 9));
  let width = Math.max(0, ...lines.map((line) => overlayCtx.measureText(line).width));
  overlayCtx.font = titleFont;
  width = Math.max(width, overlayCtx.measureText(title).width);
  const height = titleSize + lines.length * lineHeight;

  overlayCtx.fillStyle = 'rgba(30, 22, 17, 0.8)';
  overlayCtx.beginPath();
  overlayCtx.roundRect(x - padding, y - padding, width + padding * 2, height + padding * 2, padding);
  overlayCtx.fill();

  overlayCtx.fillStyle = color;
  overlayCtx.fillText(title, x, y);

  overlayCtx.font = tagFont;
  overlayCtx.fillStyle = '#ffffff';
  lines.forEach((line, index) => {
    overlayCtx.fillText(line, x, y + titleSize + (lineHeight - tagSize) + index * lineHeight);
  });
}

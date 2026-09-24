const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

const cameraToggleButton = document.getElementById('cameraToggle');

let sampleCanvas;
let sampleCtx;
let currentStream;
let currentFacingMode = 'environment';
let tickStarted = false;

// Maps each QR code's decoded text to the object it represents. Add or edit
// entries here to change what a code displays as, without touching the
// scanning/rendering logic below. imageSrc is optional; without one, the
// code falls back to a text label in `color`.
const OBJECTS = {
  'phone': { name: 'Phone', color: '#00c8ff', imageSrc: 'images/phone.webp' },
  'bottle': { name: 'Bottle', color: '#ffcc00', imageSrc: 'images/bottle.webp' },
  'notebook': { name: 'Notebook', color: '#ff6699', imageSrc: 'images/notebook.jpg' },
  'object-a': { name: 'Object A', color: '#66ff66', imageSrc: 'images/object-a.jpg' },
  'object-b': { name: 'Object B', color: '#ff6666', imageSrc: 'images/object-b.webp' },
  'object-c': { name: 'Object C', color: '#a366ff', imageSrc: 'images/object-c.gif' },
};

// Preload each object's image once at startup so `image.complete` is ready
// by the time a code is first detected, rather than loading on first scan.
for (const object of Object.values(OBJECTS)) {
  if (object.imageSrc) {
    const image = new Image();
    image.src = object.imageSrc;
    object.image = image;
  }
}

// Falls back to the raw decoded text (in the default green) for any QR code
// that isn't in OBJECTS yet.
function getObject(data) {
  return OBJECTS[data] || { name: data, color: '#00ff00' };
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
      width: { ideal: 1920 },
      height: { ideal: 1080 },
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
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    for (const qrCode of scanForQRCodes()) {
      const object = getObject(qrCode.data);
      drawBox(qrCode.location, object.color);
      if (object.image && object.image.complete && object.image.naturalWidth > 0) {
        drawObjectImage(qrCode.location, object.image);
      } else {
        drawLabel(qrCode.location, object.name, object.color);
      }
    }
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
      const qrCode = jsQR(tile.data, TILE_SIZE, TILE_SIZE);
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
      const dx = center.x - existingCenter.x;
      const dy = center.y - existingCenter.y;
      return Math.sqrt(dx * dx + dy * dy) < QR_SIZE;
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

// How much bigger than the QR code itself the overlaid image is drawn.
// 1.0 would match the code's footprint exactly; a bit above that keeps the
// image legible without covering much extra screen space.
const OBJECT_IMAGE_SCALE = 1.2;

// Draws `image` centered on the QR code, scaled relative to the code's own
// size in the frame so it stays proportional as the code moves closer/further.
function drawObjectImage(location, image) {
  const { topLeftCorner, topRightCorner } = location;
  const center = centerOf(location);
  const qrWidth = Math.hypot(topRightCorner.x - topLeftCorner.x, topRightCorner.y - topLeftCorner.y);

  const drawWidth = qrWidth * OBJECT_IMAGE_SCALE;
  const drawHeight = drawWidth * (image.naturalHeight / image.naturalWidth);

  overlayCtx.drawImage(image, center.x - drawWidth / 2, center.y - drawHeight / 2, drawWidth, drawHeight);
}

function drawBox(location, color = '#00ff00') {
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = location;

  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = Math.max(4, overlay.width * 0.006);
  overlayCtx.beginPath();
  overlayCtx.moveTo(topLeftCorner.x, topLeftCorner.y);
  overlayCtx.lineTo(topRightCorner.x, topRightCorner.y);
  overlayCtx.lineTo(bottomRightCorner.x, bottomRightCorner.y);
  overlayCtx.lineTo(bottomLeftCorner.x, bottomLeftCorner.y);
  overlayCtx.closePath();
  overlayCtx.stroke();
}

function drawLabel(location, text, color = '#00ff00') {
  const { bottomLeftCorner, bottomRightCorner } = location;

  const fontSize = Math.max(16, overlay.width * 0.02);
  const padding = fontSize * 0.25;
  const x = Math.min(bottomLeftCorner.x, bottomRightCorner.x);
  const y = Math.max(bottomLeftCorner.y, bottomRightCorner.y) + padding;

  overlayCtx.font = `${fontSize}px monospace`;
  overlayCtx.textBaseline = 'top';
  const textWidth = overlayCtx.measureText(text).width;

  overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  overlayCtx.fillRect(x - padding, y - padding, textWidth + padding * 2, fontSize + padding * 2);

  overlayCtx.fillStyle = color;
  overlayCtx.fillText(text, x, y);
}

const video = document.getElementById('webcam');

navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then((stream) => {
    video.srcObject = stream;
  })
  .catch((error) => {
    console.error('Unable to access webcam:', error);
  });

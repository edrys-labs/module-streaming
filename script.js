let currentStream = null;
let currentCameraId = null;
let isListingCameras = false;

// Resolve the configured stream name (shared default across server/client).
function getStreamName() {
  return Edrys.module.stationConfig?.streamName || "Camera 1";
}

// Helper function to get unique storage key for camera selection per stream
function getCameraStorageKey() {
  const streamName = getStreamName();
  return `selectedCameraId_${streamName}`;
}

function reloadThisStream() {
  if (Edrys.role === 'station') {
    // Station restarts the source — notify all viewers on this stream.
    Edrys.sendMessage('reload', { targetStream: getStreamName() });
  } else {
    // Viewer asks the station to restart the stream for everyone.
    Edrys.sendMessage('stream-restart-request', { targetStream: getStreamName() });
  }
}

function applyVideoTransform(videoElement, settings) {
  videoElement.style.transform = `scaleX(${
    settings?.mirrorX ? -1 : 1
  }) scaleY(${
    settings?.mirrorY ? -1 : 1
  }) rotate(${
    settings?.rotate ?? 0
  }deg)`;
}

const QUALITY_CONSTRAINTS = {
  low:    { width: { ideal: 640 },  height: { ideal: 480 },  frameRate: { ideal: 15 } },
  medium: { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 24 } },
  high:   { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};

function getVideoConstraints(deviceId, quality) {
  const qualityConstraints = QUALITY_CONSTRAINTS[quality] || {};
  return deviceId
    ? { deviceId: { exact: deviceId }, ...qualityConstraints }
    : { ...qualityConstraints };
}

async function listCameras() {
  if (isListingCameras) return;
  isListingCameras = true;

  try {
    const cameraSelect = document.getElementById("camera-select");
    cameraSelect.innerHTML = '';
    cameraSelect.style.display = 'none';

    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    currentCameraId = sessionStorage.getItem(getCameraStorageKey());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === "videoinput");

    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    if (videoDevices.length > 1) {
      cameraSelect.style.display = 'inline-block';
    }

    if (currentCameraId) {
      const deviceExists = videoDevices.some(device => device.deviceId === currentCameraId);
      if (deviceExists) {
        cameraSelect.value = currentCameraId;
      } else {
        sessionStorage.removeItem(getCameraStorageKey());
        currentCameraId = null;
      }
    }
  } catch (err) {
    console.error("Error listing cameras:", err);
  } finally {
    isListingCameras = false;
  }
}

function startStreamWithCamera(deviceId = null) {
  const videoElement = document.getElementById("video");
  const loaderElement = document.getElementById("loader");
  const streamMethod = Edrys.module.stationConfig?.streamMethod || "webrtc";
  const websocketUrl = Edrys.module.stationConfig?.websocketUrl || "";
  const streamName = Edrys.module.stationConfig?.streamName || "Camera 1";
  const streamQuality = Edrys.module.stationConfig?.streamQuality || "medium";
  
  applyVideoTransform(videoElement, Edrys.module.stationConfig);

  const startNewStream = async () => {
    if (deviceId && currentCameraId !== deviceId) {
      currentCameraId = deviceId;
      sessionStorage.setItem(getCameraStorageKey(), deviceId);
    }

    const videoOff = Edrys.module.stationConfig?.video === false;
    const audioOff = Edrys.module.stationConfig?.audio === false;

    const constraints = {
      video: videoOff ? false : getVideoConstraints(deviceId, streamQuality),
      audio: audioOff ? false : (Edrys.module.stationConfig?.audio ?? true),
    };

    if (!constraints.video && !constraints.audio) {
      loaderElement.querySelector(".loader-text").textContent =
        "Both video and audio are disabled in station config";
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = stream;
      videoElement.autoplay = true;
      loaderElement.classList.add("hidden");

      if (currentStream && typeof currentStream.updateStream === "function") {
        // Update existing stream server with new stream
        currentStream.updateStream(stream);
      } else {
        // Create new stream server
        currentStream = await Edrys.sendStream(stream, {
          method: streamMethod,
          websocketUrl: websocketUrl,
          streamName: streamName,
        });
      }

      // stream-info overlay
      const streamInfo = document.getElementById("stream-info");
      document.getElementById("stream-name").textContent = `Stream: ${streamName}`;
      let qualityEl = streamInfo.querySelector(".stream-quality");
      if (!qualityEl) {
        qualityEl = document.createElement("div");
        qualityEl.className = "stream-quality";
        streamInfo.appendChild(qualityEl);
      }
      qualityEl.textContent = `Quality: ${streamQuality.toUpperCase()}`;
      streamInfo.style.display = 'block';

    } catch (error) {
      console.error(error);
      loaderElement.querySelector(".loader-text").textContent = "Error connecting to camera";
    }
  };

  if (currentStream && deviceId && currentCameraId !== deviceId) {
    // Just switching cameras, don't stop the stream server
    startNewStream();
  } else if (currentStream && (!deviceId || currentCameraId === deviceId)) {
    // Stopping and restarting (e.g., on reload)
    if (typeof currentStream.stop === "function") {
      currentStream.stop();
    }
    currentStream = null;
    setTimeout(startNewStream, 500);
  } else {
    startNewStream();
  }
}

function startServer() {
  if (navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(tempStream => {
        tempStream.getTracks().forEach(track => track.stop());
        
        listCameras().then(() => {
          const cameraSelect = document.getElementById("camera-select");
          const startWithDevice = currentCameraId || 
            (cameraSelect.options.length > 0 ? cameraSelect.options[0].value : null);
          startStreamWithCamera(startWithDevice);
        });
      })
      .catch(err => {
        startStreamWithCamera();
      });
  } else {
    startStreamWithCamera();
  }
  
  const cameraSelect = document.getElementById('camera-select');
  if (!cameraSelect.hasAttribute('data-listener-added')) {
    cameraSelect.addEventListener('change', function() {
      if (this.value) {
        startStreamWithCamera(this.value);
      }
    });
    cameraSelect.setAttribute('data-listener-added', 'true');
  }
}

function startClient() {
  const videoElement = document.getElementById("video");
  const loaderElement = document.getElementById("loader");

  const streamMethod = Edrys.module.stationConfig?.streamMethod || "webrtc";
  const websocketUrl = Edrys.module.stationConfig?.websocketUrl || "";

  // Give-up timer: surface an actionable failure if no stream arrives within a
  // generous window. The API drives connection via its own ready handshake.
  const giveUpTimeout = setTimeout(() => {
    loaderElement.querySelector(".loader-text").textContent =
      "No stream available yet. Press ⟳ to retry.";
  }, 20000);

  Edrys.onStream(
    (stream, settings, metadata) => {
      clearTimeout(giveUpTimeout);
      videoElement.srcObject = stream;
      applyVideoTransform(videoElement, settings);

      videoElement.onloadeddata = () => {
        loaderElement.classList.add("hidden");
      };

      if (metadata?.streamName) {
        document.getElementById("stream-name").textContent = `Stream: ${metadata.streamName}`;
        document.getElementById("stream-info").style.display = 'block';
      }
    },
    {
      method: streamMethod,
      websocketUrl: websocketUrl,
    }
  ).then(streamClient => {
    currentStream = streamClient;
  });
}

Edrys.onReady(() => {
  if (Edrys.role === "station") {
    startServer();
  } else {
    startClient();
  }
});

Edrys.onMessage(({ subject, body }) => {
  const streamName = getStreamName();

  if (subject === "reload") {
    if (body === true || (body?.targetStream && body.targetStream === streamName)) {
      setTimeout(() => {
        window.location.reload();
      }, Edrys.role === "station" ? 100 : 1000);
    }
  }

  if (subject === "stream-restart-request" && Edrys.role === "station") {
    if (body?.targetStream === streamName) {
      startStreamWithCamera(currentCameraId);
    }
  }
});

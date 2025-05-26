let currentStream = null;
let currentCameraId = null;
let isListingCameras = false; // Prevent multiple simultaneous calls

function applyVideoTransform(videoElement, settings) {
  videoElement.style.transform = `scaleX(${
    settings?.mirrorX ? -1 : 1
  }) scaleY(${
    settings?.mirrorY ? -1 : 1
  }) rotate(${
    settings?.rotate ?? 0
  }deg)`;
}

async function listCameras() {
  if (isListingCameras) {
    return;
  }

  isListingCameras = true;

  try {
    const cameraSelect = document.getElementById("camera-select");
    
    // Clear all existing options
    cameraSelect.innerHTML = '';
    cameraSelect.style.display = 'none'; // Hide while updating

    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.log("enumerateDevices() not supported.");
      return;
    }

    currentCameraId = sessionStorage.getItem("selectedCameraId");

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(
      (device) => device.kind === "videoinput"
    );

    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    // Only show if we have multiple cameras
    if (videoDevices.length > 1) {
      cameraSelect.style.display = 'inline-block';
    }

    // Check if saved camera is in the list of available devices
    if (currentCameraId) {
      const deviceExists = videoDevices.some(
        (device) => device.deviceId === currentCameraId
      );
      if (deviceExists) {
        cameraSelect.value = currentCameraId;
      } else {
        sessionStorage.removeItem("selectedCameraId");
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

  applyVideoTransform(videoElement, Edrys.module.stationConfig);

  if (currentStream) {
    if (typeof currentStream.stop === "function") {
      currentStream.stop();
    }
    currentStream = null;
  }

  // If this is a camera change, save the selection
  if (deviceId) {
    // If the camera ID changed, notify clients to reconnect
    if (currentCameraId !== deviceId) {
      Edrys.sendMessage("camera-changed", true);
    }
    currentCameraId = deviceId;
    sessionStorage.setItem("selectedCameraId", deviceId);
  }

  // Constraints based on device ID and config
  const constraints = {
    video:
      Edrys.module.stationConfig?.video === undefined
        ? deviceId
          ? { deviceId: { exact: deviceId } }
          : true
        : deviceId && Edrys.module.stationConfig?.video
        ? { deviceId: { exact: deviceId } }
        : Edrys.module.stationConfig?.video,
    audio:
      Edrys.module.stationConfig?.audio === undefined
        ? true
        : Edrys.module.stationConfig?.audio,
  };

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then(async (stream) => {
      videoElement.srcObject = stream;
      videoElement.autoplay = true;
      loaderElement.classList.add("hidden");

      currentStream = await Edrys.sendStream(stream, {
        method: streamMethod,
        websocketUrl: websocketUrl,
      });
    })
    .catch((error) => {
      console.error(error);
      loaderElement.querySelector(".loader-text").textContent = "Error connecting to camera";
    });
}

function startServer() {
  // Initialize by listing cameras first
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((tempStream) => {
        // Stop temporary stream and list cameras
        tempStream.getTracks().forEach((track) => track.stop());

        listCameras().then(() => {
          const cameraSelect = document.getElementById("camera-select");
          if (currentCameraId) {
            startStreamWithCamera(currentCameraId);
          } else if (cameraSelect.options.length > 0) {
            startStreamWithCamera(cameraSelect.options[0].value);
          } else {
            startStreamWithCamera(); // No specific camera, use default
          }
        });
      })
      .catch((err) => {
        console.log("Initial camera access denied:", err);
        startStreamWithCamera(); // Start with default camera
      });
  } else {
    startStreamWithCamera();
  }
  
  // Handle camera selection change - ensure event listener is only added once
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

  Edrys.onStream(
    (stream, settings) => {
      videoElement.srcObject = stream;
      applyVideoTransform(videoElement, settings);

      videoElement.onloadeddata = function () {
        loaderElement.classList.add("hidden");
      };

      // Timeout in case the stream doesn't load properly
      setTimeout(() => {
        loaderElement.classList.add("hidden");
      }, 10000);
    },
    {
      method: streamMethod,
      websocketUrl: websocketUrl,
    }
  ).then((stream) => {
    currentStream = stream;
  });
}

Edrys.onReady(() => {
  if (Edrys.role === "station") {
    startServer();
  } else {
    startClient();
  }
});

Edrys.onMessage(({ subject }) => {
  if (subject === "reload") {
    setTimeout(
      () => {
        window.location.reload();
      },
      Edrys.role === "station" ? 100 : 1000
    );
  } else if (
    subject === "camera-changed" &&
    Edrys.role !== "station" &&
    currentStream
  ) {
    // Reconnect if the station changed cameras
    setTimeout(() => {
      if (typeof currentStream.stop === "function") {
        currentStream.stop();
      }
      startClient();
    }, 1000);
  }
});

// Same defaults as the settings form (see module-config in index.html).
const DEFAULTS = {
  streamName: "Camera 1",
  streamQuality: "medium",
  video: true,
  audio: false,
  mirrorX: false,
  mirrorY: false,
  rotate: 0,
  streamMethod: "webrtc",
  websocketUrl: "",
};

const QUALITY_CONSTRAINTS = {
  low:    { width: { ideal: 640 },  height: { ideal: 480 },  frameRate: { ideal: 15 } },
  medium: { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 24 } },
  high:   { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};

// How long the station waits before it re-acquires a lost camera.
const CAMERA_RETRY_MS = 3000;
// How long a viewer waits for the first frame before it reconnects.
const CLIENT_GIVE_UP_MS = 20000;

let cfg = DEFAULTS;

// The station config, with the defaults for every value that is not set. The
// form saves '' for an untouched text field; that counts as not set.
function readConfig() {
  const raw = Edrys.module.stationConfig;
  const given = raw && typeof raw === "object" ? raw : {};
  const set = Object.entries(given).filter(([, value]) => value !== "" && value != null);
  return { ...DEFAULTS, ...Object.fromEntries(set) };
}

const $ = (id) => document.getElementById(id);

function setBadge(state, text) {
  const badge = $("status");
  badge.className = `badge ${state}`;
  badge.textContent = text;
}

// One overlay for every state. An error stops the spinner.
function showStatus(text, { error = false } = {}) {
  const loader = $("loader");
  loader.querySelector(".loader-text").textContent = text;
  loader.classList.toggle("error", error);
  loader.classList.remove("hidden");
  setBadge(error ? "off" : "wait", error ? "no stream" : "connecting");
}

function hideStatus() {
  $("loader").classList.add("hidden");
  setBadge("on", "live");
}

function showStreamInfo(name, quality) {
  $("stream-name").textContent = name;
  document.querySelector("#stream-info .stream-quality").textContent = quality || "";
  $("stream-info").hidden = false;
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

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

// ---------------------------------------------------------------------------
// Station

let currentCameraId = null;
let startSeq = 0;            // the latest startStreamWithCamera call wins
let serverPromise = null;    // the station's one stream server
let cameraRetryTimer = null;
let cameraLost = false;      // keep retrying until the capture is back

// The camera choice is remembered per stream for this tab.
function cameraStorageKey() {
  return `selectedCameraId_${cfg.streamName}`;
}

function deviceLabel() {
  if (cfg.video && cfg.audio) return "Camera or microphone";
  return cfg.video ? "Camera" : "Microphone";
}

function captureErrorText(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${deviceLabel()} blocked: allow access for this site in the browser settings`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `${deviceLabel()} not found`;
    case "NotReadableError":
    case "AbortError":
      return `${deviceLabel()} is in use by another program`;
    default:
      return `Error connecting to ${deviceLabel().toLowerCase()}`;
  }
}

function getVideoConstraints(deviceId) {
  const quality = QUALITY_CONSTRAINTS[cfg.streamQuality] || {};
  return deviceId ? { deviceId: { exact: deviceId }, ...quality } : { ...quality };
}

async function listCameras() {
  const cameraSelect = $("camera-select");
  cameraSelect.innerHTML = "";
  cameraSelect.hidden = true;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(device => device.kind === "videoinput");

  cameras.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.text = device.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(option);
  });

  cameraSelect.hidden = cameras.length < 2;

  const stored = sessionStorage.getItem(cameraStorageKey());
  if (stored && cameras.some(device => device.deviceId === stored)) {
    currentCameraId = stored;
    cameraSelect.value = stored;
  } else {
    sessionStorage.removeItem(cameraStorageKey());
  }
}

// After a lost camera: try again until the capture is back.
function retryCameraLater() {
  clearTimeout(cameraRetryTimer);
  cameraRetryTimer = setTimeout(() => startStreamWithCamera(currentCameraId), CAMERA_RETRY_MS);
}

function watchForLostTracks(stream, seq) {
  stream.getTracks().forEach(track => track.addEventListener("ended", () => {
    if (seq !== startSeq) return; // already replaced
    cameraLost = true;
    showStatus(`${deviceLabel()} disconnected, retrying…`, { error: true });
    retryCameraLater();
  }, { once: true }));
}

// Capture the camera and send it. Calls may overlap (camera switch, ⟳, retry):
// only the latest one shows and sends its capture, and there is only ever one
// stream server, because its peer ID can't be reclaimed right away.
async function startStreamWithCamera(deviceId = currentCameraId) {
  const seq = ++startSeq;
  clearTimeout(cameraRetryTimer);

  if (deviceId && deviceId !== currentCameraId) {
    currentCameraId = deviceId;
    sessionStorage.setItem(cameraStorageKey(), deviceId);
  }

  if (!cfg.video && !cfg.audio) {
    showStatus("Both video and audio are disabled in station config", { error: true });
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showStatus("This browser gives no camera access here (HTTPS needed)", { error: true });
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: cfg.video ? getVideoConstraints(deviceId) : false,
      audio: cfg.audio,
    });
  } catch (error) {
    console.error(error);
    if (seq !== startSeq) return;
    showStatus(captureErrorText(error), { error: true });
    if (cameraLost) retryCameraLater();
    return;
  }

  if (seq !== startSeq) {
    stopTracks(stream); // a later call took over
    return;
  }

  const videoElement = $("video");
  stopTracks(videoElement.srcObject); // release the previous capture
  videoElement.muted = true; // station preview: never play our own microphone
  videoElement.srcObject = stream;
  cameraLost = false;
  watchForLostTracks(stream, seq);
  hideStatus();
  if (!serverPromise) setBadge("wait", "starting"); // live once the server is up

  try {
    if (serverPromise) {
      const server = await serverPromise;
      if (seq === startSeq) server.updateStream(stream);
    } else {
      serverPromise = Edrys.sendStream(stream, {
        method: cfg.streamMethod,
        websocketUrl: cfg.websocketUrl,
        streamName: cfg.streamName,
      });
      await serverPromise;
    }
  } catch (error) {
    console.error(error);
    serverPromise = null; // the next start tries again
    if (seq === startSeq) showStatus("Could not start the stream. Press the reconnect button to retry.", { error: true });
    return;
  }

  if (seq === startSeq) setBadge("on", "live");
  showStreamInfo(cfg.streamName, cfg.streamQuality);
}

async function startServer() {
  applyVideoTransform($("video"), cfg);

  const cameraSelect = $("camera-select");
  cameraSelect.addEventListener("change", () => {
    if (cameraSelect.value) startStreamWithCamera(cameraSelect.value);
  });

  // Camera ids and labels are only listed once camera access is granted.
  if (cfg.video && navigator.mediaDevices?.getUserMedia) {
    try {
      stopTracks(await navigator.mediaDevices.getUserMedia({ video: true }));
      await listCameras();
    } catch (error) {
      console.error(error); // startStreamWithCamera reports it
    }
  }

  startStreamWithCamera(currentCameraId || cameraSelect.options[0]?.value || null);
}

// ---------------------------------------------------------------------------
// Viewer (teacher or student)

let clientSeq = 0;           // the latest startClient call wins
let clientPromise = null;    // this viewer's stream client
let clientGiveUpTimer = null;
let clientAutoRetried = false;

// Tear down this viewer's own connection and reconnect. The client peer ID is
// random, so there is nothing to reclaim.
function restartClient() {
  // Detach first: stopping the client ends its tracks, and Chrome then fires
  // loadeddata on the ended stream, which would count as a first frame.
  const videoElement = $("video");
  videoElement.onloadeddata = null;
  videoElement.srcObject = null;

  // The old client may still be connecting: stop it once it is there.
  clientPromise?.then(client => client?.stop());

  showStatus("Reconnecting to stream...");
  startClient();
}

function startClient() {
  const seq = ++clientSeq;
  const videoElement = $("video");

  // Give-up timer: if no frame arrives within a generous window, reconnect once
  // by ourselves, then ask the user. onStream only means the tracks are known;
  // media may still never flow (e.g. ICE fails after signalling).
  clearTimeout(clientGiveUpTimer);
  clientGiveUpTimer = setTimeout(() => {
    if (!clientAutoRetried) {
      clientAutoRetried = true;
      restartClient();
      return;
    }
    showStatus("No stream available yet. Press the reconnect button to retry.", { error: true });
  }, CLIENT_GIVE_UP_MS);

  clientPromise = Edrys.onStream(
    (stream, settings, metadata) => {
      if (seq !== clientSeq) return;
      videoElement.muted = false; // the HTML mutes it for the station's preview
      videoElement.srcObject = stream;
      applyVideoTransform(videoElement, settings);

      videoElement.onloadeddata = () => {
        clearTimeout(clientGiveUpTimer);
        clientAutoRetried = false;
        hideStatus();
      };

      if (metadata?.streamName) showStreamInfo(metadata.streamName);
    },
    {
      method: cfg.streamMethod,
      websocketUrl: cfg.websocketUrl,
    }
  ).catch(error => {
    console.error(error);
    if (seq === clientSeq) {
      clearTimeout(clientGiveUpTimer);
      showStatus("Could not connect to the stream. Press the reconnect button to retry.", { error: true });
    }
    return null;
  });
}

// ---------------------------------------------------------------------------

function reloadThisStream() {
  if (Edrys.role === "station") {
    // Re-acquire the camera; updateStream pushes it to every viewer.
    startStreamWithCamera(currentCameraId);
  } else {
    // Rebuild only this viewer's connection.
    restartClient();
  }
}

let started = false;

Edrys.onReady(() => {
  // Guard against double-init (module may mount more than once).
  if (started) return;
  started = true;

  cfg = readConfig();
  $("reload-button").addEventListener("click", reloadThisStream);

  if (Edrys.role === "station") {
    startServer();
  } else {
    startClient();
  }
});

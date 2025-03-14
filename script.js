function applyVideoTransform(videoElement, settings) {
  videoElement.style.transform = `scaleX(${
    settings?.mirrorX ? -1 : 1
  }) scaleY(${
    settings?.mirrorY ? -1 : 1
  }) rotate(${
    settings?.rotate ?? 0
  }deg)`;
}

function startServer() {
  const videoElement = document.getElementById("video");
  applyVideoTransform(videoElement, Edrys.module.stationConfig);
  
  navigator.mediaDevices.getUserMedia({
    video: Edrys.module.stationConfig?.video ?? true,
    audio: Edrys.module.stationConfig?.audio ?? true,
  }).then(async (stream) => {
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    
    await Edrys.sendStream(stream);
  }).catch(console.error);

  // For screen sharing
  /*navigator.mediaDevices.getDisplayMedia({
      video: {
          cursor: "always"
      },
      audio: false
    }).then(async (stream) => {
      videoElement.srcObject = stream;
      videoElement.autoplay = true;

      await Edrys.sendStream(stream);
    }).catch(console.error);
  */
}

function startClient() {
  const videoElement = document.getElementById("video");
          
  Edrys.onStream((stream, settings) => {
    //console.log("Stream received with settings:", settings);
    videoElement.srcObject = stream;
    applyVideoTransform(videoElement, settings);
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
    setTimeout(() => {
      window.location.reload();
    }, Edrys.role === "station" ? 100 : 1000);
  }
});
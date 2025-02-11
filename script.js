let peerConnection;
const configuration = CONFIG;

// Track connection state
let makingOffer = false;
let ignoreOffer = false;
let signalingQueue = [];
let isProcessingSignal = false;

// Keep track of sent ICE candidates to prevent duplicates
const sentIceCandidates = new Set();

function getIceCandidateKey(candidate) {
  return `${candidate.candidate}-${candidate.sdpMid}-${candidate.sdpMLineIndex}`;
}

function shouldSendIceCandidate(candidate) {
  if (!candidate) return false;

  const key = getIceCandidateKey(candidate);
  if (sentIceCandidates.has(key)) return false;

  sentIceCandidates.add(key);
  return true;
}

function getServerID() {
  return btoa(Edrys.class_id + Edrys.liveUser.room);
}

async function processSignalingQueue() {
  if (isProcessingSignal || signalingQueue.length === 0) return;
  
  isProcessingSignal = true;
  const signal = signalingQueue.shift();
  
  try {
    if (signal.type === "offer") {
      if (peerConnection.signalingState === "stable") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        Edrys.sendMessage("webrtc-signal", {
          type: "answer",
          sdp: answer,
          targetPeerId: signal.fromPeerId,
          fromPeerId: Edrys.username,
        });
      }
    } else if (signal.type === "answer") {
      if (peerConnection.signalingState === "have-local-offer") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      }
    }
  } catch (err) {
    console.error("Error processing signal:", err);
    if (peerConnection.signalingState !== "stable") {
      try {
        await peerConnection.setLocalDescription({type: "rollback"});
      } catch (e) {
        console.log("Rollback failed:", e);
      }
    }
  } finally {
    isProcessingSignal = false;
    // Process next signal if available
    processSignalingQueue();
  }
}

async function connectToPeer({ roomId, peerId, stream }) {
  if (peerConnection) {
    peerConnection.close();
    signalingQueue = []; // Clear queue when connection is reset
  }
  
  peerConnection = new RTCPeerConnection(configuration);
  const videoElement = document.getElementById("video");

  // Add connection state logging and recovery
  peerConnection.onsignalingstatechange = () => {
    console.log(`Signaling state changed to: ${peerConnection.signalingState}`);
    if (peerConnection.signalingState === "stable") {
      processSignalingQueue();
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state changed to: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === "failed") {
      // Try to recover the connection
      peerConnection.restartIce();
      if (signalingQueue.length > 0) {
        processSignalingQueue();
      }
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === "failed") {
      peerConnection.restartIce();
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && shouldSendIceCandidate(event.candidate)) {
      Edrys.sendMessage("webrtc-signal", {
        type: "ice-candidate",
        candidate: event.candidate,
        targetPeerId: peerId,
        fromPeerId: Edrys.username,
      });
    }
  };

  peerConnection.ontrack = (event) => {
    videoElement.srcObject = event.streams[0];
  };

  // Modified signaling handler
  Edrys.onMessage(async ({ subject, body }) => {
    if (subject === "webrtc-signal" && body.targetPeerId === Edrys.username) {
      try {
        if (body.type === "offer" || body.type === "answer") {
          signalingQueue.push(body);
          processSignalingQueue();
        } else if (body.type === "ice-candidate") {
          if (peerConnection.remoteDescription) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(body.candidate));
            } catch (e) {
              console.log("ICE candidate error:", e);
            }
          } else {
            console.log("Waiting for remote description before adding ICE candidate");
          }
        }
      } catch (err) {
        console.error("Error handling signal:", err);
      }
    }
  });

  // Modified initial offer creation
  try {
    makingOffer = true;
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    if (peerConnection.signalingState === "stable") {
      await peerConnection.setLocalDescription(offer);
      Edrys.sendMessage("webrtc-signal", {
        type: "offer",
        sdp: offer,
        targetPeerId: peerId,
        fromPeerId: Edrys.username,
      });
    }
  } catch (err) {
    console.error("Error creating initial offer:", err);
  } finally {
    makingOffer = false;
  }
}

function startServer() {
  const videoElement = document.getElementById("video");

  videoElement.style.transform = `scaleX(${
    Edrys.module.stationConfig?.mirrorX ? -1 : 1
  }) scaleY(${Edrys.module.stationConfig?.mirrorY ? -1 : 1}) rotate(${
    Edrys.module.stationConfig?.rotate ?? 0
  }deg)`;

  navigator.mediaDevices
    .getUserMedia({
      video: Edrys.module.stationConfig?.video ?? true,
      audio: Edrys.module.stationConfig?.audio ?? true,
    })
    .then((stream) => {
      videoElement.srcObject = stream;
      videoElement.autoplay = true;
      window.localStream = stream;

      // Broadcast stream info
      const broadcastStreamInfo = () => {
        Edrys.sendMessage("streamCredentials", {
          roomId: Edrys.class_id,
          peerId: Edrys.username,
          stream: {
            id: stream.id,
            tracks: stream.getTracks().map((track) => ({
              kind: track.kind,
              enabled: track.enabled,
            })),
          },
        });
      };

      // Only broadcast when receiving a 'requestStream' message
      Edrys.onMessage(({ subject, from }) => {
        if (subject === "requestStream") {
          broadcastStreamInfo();
        }
      });

      // Initial broadcast when server starts
      broadcastStreamInfo();

      // Set up server-side peer connection handler
      Edrys.onMessage(async ({ subject, body, from }) => {
        if (
          subject === "webrtc-signal" &&
          body.targetPeerId === Edrys.username
        ) {
          if (!peerConnection || peerConnection.connectionState === "closed") {
            peerConnection = new RTCPeerConnection(configuration);
            sentIceCandidates.clear(); // Clear previous candidates

            // Add local stream tracks to connection
            stream.getTracks().forEach((track) => {
              peerConnection.addTrack(track, stream);
            });

            peerConnection.onicecandidate = (event) => {
              if (event.candidate && shouldSendIceCandidate(event.candidate)) {
                Edrys.sendMessage("webrtc-signal", {
                  type: "ice-candidate",
                  candidate: event.candidate,
                  targetPeerId: from,
                  fromPeerId: Edrys.username,
                });
              }
            };

            peerConnection.oniceconnectionstatechange = () => {
              if (peerConnection.iceConnectionState === "failed") {
                peerConnection.restartIce();
              }
            };

            // Add state logging
            peerConnection.onsignalingstatechange = () => {
              console.log(`Server signaling state changed to: ${peerConnection.signalingState}`);
            };

            peerConnection.onconnectionstatechange = () => {
              console.log(`Server connection state changed to: ${peerConnection.connectionState}`);
            };
          }

          try {
            if (body.type === "offer") {
              if (peerConnection.signalingState !== "stable") {
                console.log("Server ignoring offer in non-stable state");
                return;
              }
              await peerConnection.setRemoteDescription(new RTCSessionDescription(body.sdp));
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);
              Edrys.sendMessage("webrtc-signal", {
                type: "answer",
                sdp: answer,
                targetPeerId: from,
                fromPeerId: Edrys.username,
              });
            } else if (body.type === "ice-candidate") {
              await peerConnection.addIceCandidate(new RTCIceCandidate(body.candidate))
                .catch(e => console.log("Error adding ICE candidate:", e));
            }
          } catch (err) {
            console.error("Error in server signal handling:", err);
            if (peerConnection.signalingState !== "stable") {
              try {
                await peerConnection.setLocalDescription({type: "rollback"});
              } catch (e) {
                console.log("Server rollback failed:", e);
              }
            }
          }
        }
      });

      // Send stream info to peers
      Edrys.sendMessage("streamCredentials", {
        roomId: Edrys.class_id,
        peerId: Edrys.username,
        stream: {
          id: stream.id,
          tracks: stream.getTracks().map((track) => ({
            kind: track.kind,
            enabled: track.enabled,
          })),
        },
      });
    })
    .catch((err) => {
      console.error("Failed to get local stream:", err);
    });
}

function startClient() {
  // Request stream info when starting
  Edrys.sendMessage("requestStream");

  // Listen for stream credentials
  Edrys.onMessage(({ subject, body }) => {
    if (subject === "streamCredentials") {
      connectToPeer(body);
    }
  });
}

Edrys.onReady(() => {
  console.log("Stream Module is loaded!");
  if (Edrys.role === "station") {
    startServer();
  } else {
    startClient();
  }
});

Edrys.onMessage(({ from, subject, body }) => {
  if (subject === "reload") {
    setTimeout(
      function () {
        window.location.reload();
      },
      Edrys.role === "station" ? 100 : 1000
    );
  }
});

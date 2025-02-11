let peerConnection;
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 2,
};

// Track connection state
let isNegotiating = false;
let makingOffer = false;

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

async function connectToPeer({ roomId, peerId, stream }) {
  if (peerConnection) {
    peerConnection.close();
  }
  peerConnection = new RTCPeerConnection(configuration);

  // Track negotiation state
  peerConnection.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await peerConnection.setLocalDescription();
      Edrys.sendMessage("webrtc-signal", {
        type: "offer",
        sdp: peerConnection.localDescription,
        targetPeerId: peerId,
        fromPeerId: Edrys.username,
      });
    } catch (err) {
      console.error("Error during negotiation:", err);
    } finally {
      makingOffer = false;
    }
  };

  peerConnection.onsignalingstatechange = () => {
    console.log("Signaling state:", peerConnection.signalingState);
    isNegotiating = peerConnection.signalingState !== "stable";
  };

  const videoElement = document.getElementById("video");

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

  // Set up signaling before creating offer
  Edrys.onMessage(async ({ subject, body }) => {
    if (subject === "webrtc-signal" && body.targetPeerId === Edrys.username) {
      try {
        const isStable =
          peerConnection.signalingState === "stable" ||
          (peerConnection.signalingState === "have-local-offer" && makingOffer);

        if (body.type === "offer") {
          if (!isStable) {
            console.log("Ignoring offer while negotiating");
            return;
          }
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(body.sdp)
          );
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          Edrys.sendMessage("webrtc-signal", {
            type: "answer",
            sdp: answer,
            targetPeerId: body.fromPeerId,
            fromPeerId: Edrys.username,
          });
        } else if (body.type === "answer") {
          if (makingOffer) {
            console.log("Ignoring answer while making offer");
            return;
          }
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(body.sdp)
          );
        } else if (body.type === "ice-candidate") {
          try {
            if (peerConnection.signalingState !== "closed") {
              await peerConnection.addIceCandidate(
                new RTCIceCandidate(body.candidate)
              );
            }
          } catch (e) {
            if (!makingOffer) {
              console.error("Error adding received ICE candidate:", e);
            }
          }
        }
      } catch (err) {
        console.error("Error handling signal:", err);
      }
    }
  });

  try {
    // Create and send offer
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await peerConnection.setLocalDescription(offer);

    Edrys.sendMessage("webrtc-signal", {
      type: "offer",
      sdp: offer,
      targetPeerId: peerId,
      fromPeerId: Edrys.username,
    });
  } catch (err) {
    console.error("Error creating/sending offer:", err);
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
          }

          try {
            const isStable =
              peerConnection.signalingState === "stable" ||
              (peerConnection.signalingState === "have-local-offer" &&
                makingOffer);

            if (body.type === "offer") {
              if (!isStable) {
                console.log("Ignoring offer while negotiating");
                return;
              }

              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(body.sdp)
              );
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);

              Edrys.sendMessage("webrtc-signal", {
                type: "answer",
                sdp: answer,
                targetPeerId: from,
                fromPeerId: Edrys.username,
              });
            } else if (body.type === "ice-candidate") {
              if (peerConnection.signalingState !== "closed") {
                await peerConnection.addIceCandidate(
                  new RTCIceCandidate(body.candidate)
                );
              }
            }
          } catch (err) {
            console.error("Error in server signal handling:", err);
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

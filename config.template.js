window.CONFIG = {
  iceServers: [
    { urls: "{{STUN_URL_GOLDI}}" },
    { urls: "{{STUN_URL_GOOGLE}}" },
    { urls: "{{STUN_URL_METERED}}" },
    {
      urls: "{{TURN_URL_GOLDI}}",
      username: "{{TURN_USERNAME}}",
      credential: "{{TURN_CREDENTIAL}}"
    }
  ],
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 10
};

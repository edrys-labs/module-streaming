# Edrys Station-Stream Module

This module will allow a station to send a video and or audio stream to all connected users via a direct WebRTC connection or via a WebSocket connection.

Import the module via:

`https://edrys-labs.github.io/module-streaming/index.html`

## Settings

You can modify the module station settings via the configuration form:

<img src="./config-form.png" alt="Module Configuration Form" width="400">

Every setting is optional. Without a value, the module uses these defaults:

| Setting | Default | Values |
|---------|---------|--------|
| `streamName` | `Camera 1` | any text, unique per station |
| `streamQuality` | `medium` | `low` (640×480, 15 fps), `medium` (1280×720, 24 fps), `high` (1920×1080, 30 fps) |
| `video` | `true` | `true` / `false`: stream the camera |
| `audio` | `false` | `true` / `false`: stream the microphone |
| `mirrorX`, `mirrorY` | `false` | `true` / `false` |
| `rotate` | `0` | degrees: `0`, `90`, `180`, `270` |
| `streamMethod` | `webrtc` | `webrtc` or `websocket` |
| `websocketUrl` | (none) | relay URL, needed for `websocket` |
| `peerServerConfig` | PeerJS cloud | PeerJS server settings (YAML/JSON only) |

Or you can set the parameters manually in the station configuration via yaml:

``` yaml
streamName: "Stream 1" # Name of the stream
streamQuality: "medium"  # low, medium, high
video: true
audio: false
mirrorX: false
mirrorY: true
rotate: 90
streamMethod: "webrtc" # or "websocket"
websocketUrl: "wss://your.websocket.url" # only needed if streamMethod is "websocket"
peerServerConfig: # Optional PeerJS server configuration
  host: "your.peer.server" # without https://
  port: 443
  path: "/"
  secure: true
```

or via json:

``` json
{
    "streamName": "Stream 1",
    "streamQuality": "medium",
    "video": true,
    "audio": false,
    "mirrorX": false,
    "mirrorY": true,
    "rotate": 90,
    "streamMethod": "webrtc",
    "websocketUrl": "wss://your.websocket.url",
    "peerServerConfig": {
        "host": "your.peer.server",
        "port": 443,
        "path": "/",
        "secure": true
    }
}
```

The flip parameters (mirrorX, mirrorY) will flip the video stream on the X or Y axis respectively. The rotate parameter will rotate the video stream by the specified degrees (0, 90, 180, 270).

## Known Issues

- If webrtc is selected as the stream method, it is recommended to use Chrome in station mode. Firefox might have some restrictions, but any browser with WebRTC support should support the client-side viewing.
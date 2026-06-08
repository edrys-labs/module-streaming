# Edrys Station-Stream Module

This module will allow a station to send a video and or audio stream to all connected users via a direct WebRTC connection or via a WebSocket connection.

Import the module via:

`https://edrys-labs.github.io/module-streaming/index.html`

## Settings

You can modify the module station settings via the configuration form:

<img src="./config-form.png" alt="Module Configuration Form" width="400">

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
    "websocketUrl": "wss://your.websocket.url" 
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

- When using websocket for streaming, the station window must be open in the foreground, otherwise the stream will not be sent. This is a limitation of the WebSocket API and the browser's handling of background tabs.

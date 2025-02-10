# Edrys Station-Stream Module

This module will allow a station to send a video and or audio stream to all connected users via a direct WebRTC connection.

Import the module via:

`https://edrys-labs.github.io/module-streaming/index.html`

## Settings

By default, the station will share the video and audio signal from a connected webcam.
You can tweak this behavior with the following settings for station-mode:

``` yaml
video: true
audio: false
mirrorX: false
mirrorY: true
rotate: 90
```

or via json:

``` json
{
    "video": true,
    "audio": false
}
```

The flip parameters will flip the video horizontally or vertically.

## Problems

It is recommended to use Chrome in station mode. Firefox might have some restrictions, but any browser with WebRTC support should support the client-side viewing.

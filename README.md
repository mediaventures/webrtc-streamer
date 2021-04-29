
# @mediaventures/webrtc-streamer

This package contains an interface to work with media streams.
The goal of this project is to have a unified interface regardless of webrtc service providers.

Currently, it supports Ant Media Server in P2P and SFU mode, but it is possible to provide any other
signaling service and keep the same API to control stream tracks and parameters.


## Features

- Create audio/video sources
- Create sender with specific encoding parameters
- Switch sources on the fly while broadcasting
- Create receiver with prefered options (experimental)



## Usage/Examples

### create media service
```javascript
import {
  AntMediaSignaling,
  AntMediaSignalingP2P,
  LocalSignaling,
  MediaService,
} from '@mediaventures/webrtc-streamer';

const signalingType = 'local';

const signalingFactory = () => {
  switch (signalingType) {
    case 'ams':
      return new AntMediaSignaling({ url: 'wss://...', debug: console.log });
    case 'ams-p2p':
      return new AntMediaSignalingP2P({ url: 'wss://...', debug: console.log });
    case 'local':
    default:
      // this only works between 2 browser windows on google chrome
      return new LocalSignaling({ debug: console.log });
  }
};

const mediaService = new MediaService({ signalingFactory, debug: console.log });

```

### create sources (from all available devices)
```javascript
// this will ask user permission to use camera and microphone and will cache available devices
await mediaService.initMedia();

const videoSources = await Promise.all(
  mediaService.videoInputs.map(
    device => mediaService.createSource(
      device.deviceId,
      { video: { deviceId: d.deviceId, width: 1920, height: 1080 }, audio: false },
    ),
  ),
);

const audioSources = await Promise.all(
  mediaService.audioInputs.map(
    device => mediaService.createSource(
      device.deviceId,
      { audio: { deviceId: d.deviceId }, video: false },
    ),
  ),
);
```

### create sources (having label)
```javascript
// If you store user prefferences on a server, deviceId might change if a user cleans their cookies.
// Constraints passed to createSource method also supports label property as a fallback

const constraints = {
  video: { deviceId: 'non-existing-id', label: 'FaceTime HD Camera' },
  audio: true,
};

// if we run this code on macbook pro with FaceTime HD Camera, the source will containt both video and audio
const source = mediaService.createSource('mySourceId', constraints);
```

### create sources (screen share)
```javascript
// we can create multiple screen sharing streams, for different screens and different chrome tabs (including audio)
const screen1 = mediaService.createSource('screen-share-screen-1', { video: 'screen'});
const screen2 = mediaService.createSource('screen-share-screen-2', { video: 'screen'});
const youtubeTab = mediaService.createSource('screen-youtube', { video: 'screen', audio: 'screen' });
```

### create sender
```javascript
const main = mediaService.createSender('streamId', { 
  videoCodec: 'vide/H265', // this is prefered codec, which doesn't restrict to fallback to other available codecs
  allowedVideoCodecs: ['vide/H265'], // this would enforce safari for example to use H265, unless it is not enabled in the browser, it would still fall back to H264
  encoding: {
    maxBitrate: 10000000, // 10mbps
    maxFramerate: 30,
    priority: 'high',
    scaleResolutionDownBy: 1,
  },
  rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
});

const preveiw = mediaService.createSender('preview_streamId', {
  encoding: {
    maxBitrate: 500000,
    maxFrameRate: 1,
    priority: 'very-low',
    scaleResolutionDownBy: 4,
  }
})

// source can contain both audio and video, but we can mix them separately
main.addVideoSource(source1);
main.addAudioSource(source1);

// or we can add both video and audio at the same time
main.addSource(source2);

// publish stream
main.publish();

// switch video source on the fly
main.switchVideoSource(source2.id)

main.setOptions(newOptions); // change video codec or encoding options on the fly

// toggle video audio
main.mute();
main.unmute();
main.disableVideo();
main.enableVideo();

const someMuted = main.muted || main.videoDisabled

// detect changes, so we could display them in UI
main.on('changed', handlePropsThatChanged);

videoElement.srcOpbject = main.mediaStream;
```

### create receiver
```javascript
const receiver = mediaService.createReceiver('streamId', { rtcConfig });
await receiver.subscribe();
videoElement.srcOpbject = receiver.mediaStream;

// or wait for event
receiver.on('changed', (props) => {
  if ('mediaStream' in props) {
    videoElement.srcOpbject = props.mediaStream;
  }
});

receiver.on('stream:available', (stream) => {
  videoElement.srcOpbject = stream;
});

```

## Installation

Project is still in alpha stage, so it is not published on npm.
However you can install it by using `npm link`

```bash 
  git clone git@github.com:mediaventures/webrtc-streamer.git
  cd webrtc-streamer
  npm link
  cd ../my-project
  npm link @mediaventures/webrtc-streamer
```
## Demo

[Check this meteor/react app](https://karsi-webrtc.meteorapp.com)

## License

[MIT](https://choosealicense.com/licenses/mit/)

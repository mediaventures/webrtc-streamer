import { EventEmitter } from 'events';

const mediaStreamEvevents = [
  'active',
  'inactive',
];
class Source extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.mediaStream = null;
    this.constraints = null;
  }

  onMediaInactive = () => {
    this.destroy();
  }

  setupMediaStream(mediaStream) {
    this.mediaStream = mediaStream;
    mediaStreamEvevents.forEach(event => {
      this.mediaStream.addEventListener(event, this.proxyEvent);
    });
  }

  async applyConstraints(constraints) {
    const changed = JSON.stringify(constraints) !== JSON.stringify(this.constraints);
    if (changed) {
      this.constraints = constraints;
    }
    if (!this.mediaStream) {
      if (constraints.video === 'screen') {
        this.mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: !!constraints.audio });
      } else {
        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      }
      this.mediaStream.addEventListener('inactive', this.onMediaInactive);
    } else if (changed) {
      await Promise.all(
        this.mediaStream.getVideoTracks().map(t => t.applyConstraints(constraints.video)),
        this.mediaStream.getAudioTracks().map(t => t.applyConstraints(constraints.audio)),
      );
    }
    if (changed) {
      this.emit('changed', { constraints });
    }
    return this.mediaStream;
  }

  destroy() {
    // this should invoke cleanup in Sender
    this.emit('destroying');
    if (this.mediaStream) {
      this.mediaStream.addEventListener('inactive', this.onMediaInactive);
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream.getTracks().forEach(t => this.mediaStream.removeTrack(t));
      this.mediaStream = null;
    }
    this.emit('destroyed');
  }
}

export default Source;

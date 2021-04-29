import getAudioContext from './getAudioContext';

const defaultProps = {
  width: 1920,
  height: 1080,
  fps: 25,
};
class VideoMixer {
  constructor(props) {
    this.width = 1920;
    this.height = 1080;
    this.fps = 25;
    Object.assign(this, defaultProps, props);
    this.mediaStream = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.sources = new Map();
    this.play();
  }

  addSource(stream, options = {
    fill: false, x: 0, y: 0, width: 'auto', height: 'auto',
  }) {
    if (this.sources.has(stream) || stream.getVideoTracks().length === 0) {
      return;
    }
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.play();

    const streamContext = {
      stream,
      video,
      options,
    };
    this.sources.set(stream, streamContext);
  }

  removeSource(stream) {
    const streamContext = this.sources.get(stream);
    if (!streamContext) {
      return;
    }
    const { video } = streamContext;
    video.srcObject = null;
    this.sources.delete(stream);
  }

  setOptions(stream, options) {
    const streamContext = this.sources.get(stream);
    if (!streamContext) {
      return;
    }
    streamContext.options = options;
  }

  draw() {
    Array.from(this.sources.values()).forEach(({ video, options }) => {
      const width = Number.isFinite(options.width) ? options.width : video.videoWidth;
      const height = Number.isFinite(options.height) ? options.height : video.videoHeight;
      this.ctx.drawImage(video, options.x, options.y, width, height);
    });
  }

  play() {
    this.af = requestAnimationFrame(() => this.draw());
    if (!this.mediaStream) {
      this.mediaStream = this.canvas.captureStream(this.fps);
    }
  }

  pause() {
    cancelAnimationFrame(this.af);
  }

  stop() {
    this.pause();
    this.mediaStream.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
  }
}

export default VideoMixer;

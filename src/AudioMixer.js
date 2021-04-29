import getAudioContext from './getAudioContext';

class AudioMixer {
  constructor() {
    this.audioContext = getAudioContext();
    this.mediaStream = new MediaStream();
    this.destination = this.audioContext.createMediaStreamDestination();
    this.destination.stream.getAudioTracks().forEach(track => {
      this.mediaStream.addTrack(track);
    });
    this.sources = new Map();
  }

  destroy() {
    Array.from(this.sources.keys()).forEach(stream => {
      this.removeSource(stream);
    });
    this.mediaStream.getTracks().forEach(track => {
      track.stop();
      this.mediaStream.removeTrack(track);
    });
    this.mediaStream = null;
  }

  addSource(stream) {
    if (this.sources.has(stream) || stream.getAudioTracks().length === 0) {
      return;
    }
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1;
    const audioSource = this.audioContext.createMediaStreamSource(stream);
    audioSource.connect(gainNode);
    gainNode.connect(this.destination);
    const streamContext = {
      stream,
      gainNode,
      audioSource,
    };
    this.sources.set(stream, streamContext);
  }

  removeSource(stream) {
    const streamContext = this.sources.get(stream);
    if (!streamContext) {
      return;
    }
    const { gainNode, audioSource } = streamContext;
    gainNode.disconnect(this.destination);
    audioSource.disconnect(gainNode);
    this.sources.delete(stream);
  }

  setVolume(stream, volume) {
    const streamContext = this.sources.get(stream);
    if (!streamContext) {
      return;
    }
    streamContext.gainNode.gain.value = volume;
  }
}

export default AudioMixer;

import AudioMixer from './AudioMixer';
import { PeerConnection, STATE } from './PeerConnection';
import { cleanEncodingParams, clone } from './utils';

/**
 * @typedef EncodingParams
 * @type {{
 *   maxBitrate?: number|"unlimited",
 *   maxFramerate?: number
 *   priority?: 'very-low'|'low'|'medium'|'high',
 *   scaleResolutionDownBy?: number,
 * }}
 */
const defaultEncodingParams = {
  maxBitrate: 900000,
};

class Sender extends PeerConnection {
  /**
   *
   * @param {string} id
   * @param {EventEmitter} signaling
   * @param {EncodingParams} encoding?
   * @param {string} videoCodec? - preferred video codec
   * @param {string[]} allowedVideoCodecs? - optional list of codecs that will be allowed
   * @param {RTCConfiguration} rtcConfig?
   * @param {RTCOfferAnswerOptions} sdpOptions?
   * @param {array} candidateTypes?
   * @param {function} debug?
   */
  constructor({
    id,
    signaling,
    encoding,
    videoCodec,
    allowedVideoCodecs,
    rtcConfig,
    sdpOptions,
    candidateTypes,
    debug,
  }) {
    super({
      id,
      signaling,
      videoCodec,
      allowedVideoCodecs,
      rtcConfig,
      sdpOptions,
      candidateTypes,
      debug,
    });
    this.options.encoding = cleanEncodingParams({
      ...defaultEncodingParams,
      ...encoding,
    });
    this.isSender = true;
    this.mediaStream = new MediaStream();
    this.videoSources = new Map();
    this.audioSources = new Map();
    this.on('connected', () => this.changeEncodingParams(this.options.encoding));
    this.on('stats', this.handleStats);
  }

  destroy() {
    super.destroy();
    this.debug('destroying publisher');
    this.mediaStream.getTracks().forEach(t => {
      // we leave the track creators to stop their tracks
      this.mediaStream.removeTrack(t);
    });
    if (this.audioMixer) {
      this.audioMixer.destroy();
      delete this.audioMixer;
    }
    this.videoSources.clear();
    this.audioSources.clear();
    this.destroyed = true;
    this.emit('changed', { destroyed: true });
    this.emit('destroyed');
  }

  addSource(source) {
    if (source.mediaStream?.getVideoTracks().length) {
      this.addVideoSource(source);
    }
    if (source.mediaStream?.getAudioTracks().length) {
      this.addAudioSource(source);
    }
  }

  removeSource(id) {
    this.removeVideoSource(id);
    this.removeAudioSource(id);
  }

  addVideoSource(source) {
    if (!source.mediaStream?.getVideoTracks().length) {
      throw new Error('Cannot add video source because mediaStream does not have video track');
    }
    if (!this.videoSources.has(source.id)) {
      this.debug('adding video source');
      this.videoSources.set(source.id, source);
      source.once('destroying', () => this.removeVideoSource(source.id));
      if (this.videoSources.size === 1) {
        this.switchVideoSource(source.id).then(() => {
          this.emit('changed', { videoDisabled: this.videoDisabled });
        });
      }
    }
  }

  removeVideoSource(id) {
    this.debug('removing video source');
    this.videoSources.delete(id);
  }

  addAudioSource(source) {
    if (!source.mediaStream?.getAudioTracks().length) {
      throw new Error('Cannot add audio source because mediaStream does not have audio track');
    }
    if (!this.audioSources.has(source.id)) {
      this.debug('adding audio source');
      if (!this.audioMixer) {
        this.initializeAudio();
      }
      this.audioSources.set(source.id, source);
      this.audioMixer.addSource(source.mediaStream);
      source.once('destroying', () => this.removeAudioSource(source.id));
    }
  }

  removeAudioSource(id) {
    this.debug('removing audio source');
    const source = this.audioSources.get(id);
    if (source) {
      this.audioMixer.removeSource(source.mediaStream);
      this.audioSources.delete(id);
    }
  }

  get muted() {
    return this.mediaStream.getAudioTracks().every(t => !t.enabled);
  }

  get videoDisabled() {
    return this.mediaStream.getVideoTracks().every(t => !t.enabled);
  }

  mute() {
    this.setAudioEnabled(false);
  }

  unmute() {
    this.setAudioEnabled(true);
  }

  disableVideo() {
    this.setVideoEnabled(false);
  }

  enableVideo() {
    this.setVideoEnabled(true);
  }

  setAudioEnabled(enabled) {
    this.mediaStream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
    this.emit('changed', { muted: this.muted });
  }

  setVideoEnabled(enabled) {
    this.mediaStream.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
    this.emit('changed', { videoDisabled: this.videoDisabled });
  }

  async connect() {
    super.connect();
    this.debug('publish called');
    this.desiredState = STATE.OPEN;
    this.emit('changed', { desiredState: this.desiredState });
    if (this.currentState === STATE.OPEN) {
      return;
    }
    this.currentState = STATE.CONNECTING;
    this.emit('changed', { currentState: this.currentState });

    await this.signaling.registerPublisher({
      streamId: this.id,
      video: this.videoSources.size > 0 && this.mediaStream.getVideoTracks().length > 0,
      audio: this.audioSources.size > 0 && this.mediaStream.getAudioTracks().length > 0,
    });
  }

  async publish() {
    return this.connect();
  }

  async switchVideoSource(id) {
    this.debug(`switching video source to ${id}`);
    const source = this.videoSources.get(id);
    if (source) {
      const [newTrack] = source.mediaStream.getVideoTracks();
      const senders = this.peerConnection?.getSenders();
      const videoSender = senders?.find(s => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
      }

      // if track has been disabled, then we will re-enable it and will disable the new one
      let trackDisabled = false;
      this.mediaStream.getVideoTracks().forEach(track => {
        if (!track.enabled) {
          trackDisabled = true;
          track.enabled = true;
        }
        this.mediaStream.removeTrack(track);
      });
      source.mediaStream.getVideoTracks().forEach(track => {
        if (trackDisabled) {
          track.enabled = false;
        }
        this.mediaStream.addTrack(track);
      });
    }
  }

  setComposition() {
    // TODO will need to set composition
    this.debug('setComposition method is not implemented');
  }

  async setOptions(options) {
    if (options.encoding) {
      await this.changeEncodingParams(options.encoding);
    }
    await super.setOptions(options);
  }

  async changeBitrate(maxBitrate) {
    this.debug(`changing bitrate to ${maxBitrate}`);
    this.options.maxBitrate = maxBitrate;
    if (Number.isNaN(maxBitrate)) {
      maxBitrate = undefined;
    }
    await this.changeEncodingParams({
      ...this.options.encoding,
      maxBitrate,
    });
  }

  async changePriority(priority) {
    this.debug(`changing priority to ${priority}`);
    await this.changeEncodingParams({
      ...this.options.encoding,
      priority,
    });
  }

  async changeFramerate(maxFramerate) {
    this.debug(`changing framerate to ${maxFramerate}`);
    await this.changeEncodingParams({
      ...this.options.encoding,
      maxFramerate,
    });
  }

  async changeScaleFactor(scaleResolutionDownBy) {
    this.debug(`changing scaleResolutionDownBy to ${scaleResolutionDownBy}`);
    await this.changeEncodingParams({
      ...this.options.encoding,
      scaleResolutionDownBy,
    });
  }

  /**
   *
   * @param {EncodingParams} params
   * @returns {Promise<void>}
   */
  async changeEncodingParams(params) {
    const senders = this.peerConnection?.getSenders();
    const videoSender = senders?.find(s => s.track?.kind === 'video');
    if (!videoSender) {
      return;
    }
    this.options.encoding = cleanEncodingParams(params);
    this.debug('changing encoding params', this.options.encoding);
    let parameters = videoSender.getParameters();
    parameters = clone(parameters);
    parameters.encodings = parameters.encodings.map(encoding => ({ ...encoding, ...this.options.encoding }));
    await videoSender.setParameters(parameters);
    this.emit('changed', { options: clone(this.options) });
  }

  initializeAudio() {
    if (!this.audioMixer) {
      this.audioMixer = new AudioMixer();
      this.debug('audio mixer created', this.audioMixer);
      this.audioMixer.mediaStream.getAudioTracks().forEach(t => this.mediaStream.addTrack(t));
      this.emit('changed', { muted: this.muted });
    }
  }

  initPeerConnection() {
    super.initPeerConnection();
    this.mediaStream.getTracks().forEach(t => {
      this.peerConnection.addTrack(t, this.mediaStream);
    });
    if (this.peerConnection.createDataChannel) {
      const dataChannel = this.peerConnection.createDataChannel(this.id, { ordered: true });
      this.initDataChannel(dataChannel);
    } else {
      // eslint-disable-next-line no-console
      console.warn('CreateDataChannel is not supported');
    }
  }

  handleStats = (stats) => {
    this.stats = stats;
    this.emit('changed', { stats });
  }
}

export default Sender;
export { Sender };

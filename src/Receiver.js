import { PeerConnection, STATE } from './PeerConnection';

class Receiver extends PeerConnection {
  /**
   *
   * @param {string} id
   * @param {EventEmitter} signaling
   * @param {string} videoCodec? - preferred video codec
   * @param {string[]} allowedVideoCodecs? - optional list of codecs that will be allowed
   * @param {RTCConfiguration} rtcConfig?
   * @param {RTCOfferAnswerOptions} sdpOptions?
   * @param {array} candidateTypes?
   * @param {{maxBitrate:number, minBitrate:number, startBitrate:number}} experimental?
   * @param {function} debug?
   */
  constructor({
    id,
    signaling,
    videoCodec,
    allowedVideoCodecs,
    rtcConfig,
    sdpOptions,
    candidateTypes,
    experimental,
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
      experimental,
      debug,
    });
    this.isReceiver = true;
    this.mediaStream = null;
    this.on('stats', this.handleStats);
  }

  destroy() {
    super.destroy();
    this.debug('destroying subscriber');
    this.destroyed = true;
    this.emit('changed', { destroyed: true });
    this.emit('destroyed');
  }

  async connect() {
    super.connect();
    this.debug('subscribe called');
    this.desiredState = STATE.OPEN;
    this.emit('changed', { desiredState: this.desiredState });
    if (this.currentState === STATE.OPEN) {
      return;
    }
    this.currentState = STATE.CONNECTING;
    this.emit('changed', { currentState: this.currentState });
    await this.signaling.subscribe(this.id);
    await new Promise(resolve => {
      this.once('stream:available', resolve);
    });
  }

  async subscribe() {
    return this.connect();
  }

  async setOptions(options) {
    if ('experimental' in options) {
      this.options.experimental = {
        ...options.experimental,
      };
      // eslint-disable-next-line no-console
      console.warn('Experimental settings has changed. User needs to restart the subscription.');
    }
    await super.setOptions(options);
  }

  initPeerConnection() {
    super.initPeerConnection();
    this.peerConnection.addEventListener('datachannel', this.onDataChannel);
    this.peerConnection.addEventListener('track', this.onTrack);
  }

  onDataChannel = (event) => {
    this.initDataChannel(event.channel);
  }

  onTrack = (event) => {
    this.debug('onTrack', event);
    if (event.streams.length) {
      const [stream] = event.streams;
      this.mediaStream = stream;
    } else {
      const currentTrack = this.mediaStream.getTracks().find(t => t.type === event.track.type);
      if (currentTrack) {
        this.mediaStream.removeTrack(currentTrack);
      }
      this.mediaStream.addTrack(event.track);
    }
    this.emit('stream:available', this.mediaStream);
    this.emit('changed', { mediaStream: this.mediaStream });
  }

  handleStats = (stats) => {
    this.stats = stats;
    this.emit('changed', { stats });
  }
}

export default Receiver;
export { Receiver };

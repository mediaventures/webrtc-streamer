import { EventEmitter } from 'events';
import StatsCollector from './StatsCollector';
import { clone, getTransceiverDirection } from './utils';

const STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

class PeerConnection extends EventEmitter {
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
    candidateTypes = ['udp', 'tcp'],
    experimental,
    debug,
  }) {
    super();
    this.id = id;
    this.options = {
      videoCodec,
      allowedVideoCodecs,
      rtcConfig,
      sdpOptions,
      candidateTypes,
    };
    // do not set the key if not necessary
    if (experimental) {
      this.options.experimental = experimental;
    }
    this.signaling = signaling;
    this.signaling.on(`readyToNegotiate:${this.id}`, this.onReadyToNegotiate);
    this.signaling.on(`offerReceived:${this.id}`, this.onOfferReceived);
    this.signaling.on(`answerReceived:${this.id}`, this.onAnswerReceived);
    this.signaling.on(`candidateReceived:${this.id}`, this.onIceCandidateReceived);
    this.signaling.on(`closePeerConnection:${this.id}`, this.onClosePeerConnection);
    this.signaling.on('error', this.handleSignalingError);

    this.debug = debug ? debug.bind(null, `[${this.constructor.name}]:`) : (() => {});
    this.statsEnabled = false;
    this.restartTimeout = null;
    this.peerConnection = null;
    this.iceCandidateList = [];
    this.currentState = STATE.CLOSED;
    this.desiredState = STATE.CLOSED;
    this.isSender = false;
    this.isReceiver = false;
    this.destroyed = false;
  }

  destroy() {
    this.debug('destroy called');
    if (this.currentState !== STATE.CLOSED || this.desiredState !== STATE.CLOSED) {
      this.stop();
    }
    this.signaling.removeListener(`readyToNegotiate:${this.id}`, this.onReadyToNegotiate);
    this.signaling.removeListener(`offerReceived:${this.id}`, this.onOfferReceived);
    this.signaling.removeListener(`answerReceived:${this.id}`, this.onAnswerReceived);
    this.signaling.removeListener(`candidateReceived:${this.id}`, this.onIceCandidateReceived);
    this.signaling.removeListener(`closePeerConnection:${this.id}`, this.onClosePeerConnection);
    this.signaling.removeListener('error', this.handleSignalingError);
    // we let the child class responsible to emit destroyed event and set destroyed flag
  }

  connect() {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
  }

  stop() {
    this.debug('stop called');
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    this.desiredState = STATE.CLOSED;
    this.emit('changed', { desiredState: this.desiredState });
    this.onClosePeerConnection();
  }

  enableStats() {
    this.disableStats();
    this.statsEnabled = true;
    if (!this.peerConnection) {
      return;
    }
    this.statsCollector = new StatsCollector(this.peerConnection);
    this.statsCollector.on('stats', this.onStatsReceived);
  }

  disableStats() {
    this.statsEnabled = false;
    if (this.statsCollector) {
      this.statsCollector.stop();
      this.statsCollector.removeListener('stats', this.onStatsReceived);
      delete this.statsCollector;
    }
  }

  async changeVideoCodec(mimeType) {
    this.setVideoCodec(mimeType);
    if (this.peerConnection) {
      await this.createOffer();
    }
  }

  getVideoParameters() {
    return this.getParameters('video');
  }

  getAudioParameters() {
    return this.getParameters('audio');
  }

  getParameters(kind) {
    const senderOrReceiver = this.getDirectionalTransceiver(kind);
    if (!senderOrReceiver) {
      return null;
    }
    return senderOrReceiver.getParameters();
  }

  async setOptions(options) {
    if (options.videoCodec !== this.options.videoCodec) {
      this.options.videoCodec = options.videoCodec;
      this.options.allowedVideoCodecs = options.allowedVideoCodecs;
      await this.changeVideoCodec(options.videoCodec);
    }
  }

  /**
   * This method should be called from child class, when data channel is created
   * @param dataChannel
   */
  initDataChannel(dataChannel) {
    this.debug('initializing data channel');
    this.dataChannel = dataChannel;
    const events = ['open', 'message', 'close', 'error'];
    events.forEach(e => {
      this.dataChannel.addEventListener(e, (evt) => {
        this.emit(`data:${e}`, evt);
      });
    });
  }

  initPeerConnection() {
    if (this.peerConnection) {
      throw new Error('Only one peer connection allowed per stream');
    }
    if (this.desiredState !== STATE.OPEN) {
      throw new Error('Peer connection was not initiated, because user does not want to connect');
    }
    this.debug('initializing peer connection');
    this.peerConnection = new RTCPeerConnection(this.options.rtcConfig);

    this.iceCandidateList = [];

    this.peerConnection.addEventListener('icecandidate', this.handleIceCandidateEvent);
    this.peerConnection.addEventListener('iceconnectionstatechange', this.onIceConnectionStateChange);
  }

  async createOffer() {
    this.debug('creating offer');
    if (this.options.videoCodec) {
      this.setVideoCodec(this.options.videoCodec);
    }
    const description = await this.peerConnection.createOffer(this.options.sdpOptions);
    await this.peerConnection.setLocalDescription(description);
    this.debug('local description set', description);

    await this.signaling.sendOffer({
      streamId: this.id,
      description,
    });
  }

  async createAnswer() {
    this.debug('creating answer');
    let description = await this.peerConnection.createAnswer(this.options.sdpOptions);
    const { maxBitrate, minBitrate, startBitrate } = this.options.experimental ?? {};
    // tamper with SDP to enable max/min bitrate on receiver side
    if (this.isReceiver && (maxBitrate || minBitrate || startBitrate)) {
      let flags = '';
      if (maxBitrate) {
        flags += `;x-google-max-bitrate=${maxBitrate}`;
      }
      if (minBitrate) {
        flags += `;x-google-min-bitrate=${minBitrate}`;
      }
      if (startBitrate) {
        flags += `;x-google-start-bitrate=${startBitrate}`;
      }
      let sdpList = description.sdp.split('\r\n');
      sdpList = sdpList.map((str) => {
        if (/^a=fmtp:\d*/.test(str)) {
          return `${str}${flags}`;
        }
        if (maxBitrate && /^a=mid:(1|video)/.test(str)) {
          return `${str}\r\nb=AS:900000`;
        }
        return str;
      });
      description = new RTCSessionDescription({
        type: 'answer',
        sdp: sdpList.join('\r\n'),
      });
    }

    await this.peerConnection.setLocalDescription(description);
    this.debug('local description set', description);
    await this.signaling.sendAnswer({
      streamId: this.id,
      description,
    });
  }

  setVideoCodec(mimeType) {
    this.debug('setting preferred video codec to', mimeType);
    this.options.videoCodec = mimeType;
    const rearrange = (codecs) => {
      const otherCodecs = [];
      const preferredCodecs = [];
      codecs.forEach(codec => {
        if (codec.mimeType === mimeType) {
          preferredCodecs.push(codec);
        } else {
          otherCodecs.push(codec);
        }
      });

      codecs = preferredCodecs.concat(otherCodecs);
      if (this.options.allowedVideoCodecs?.length) {
        const allowedCodecs = codecs.filter(codec => this.options.allowedVideoCodecs.includes(codec.mimeType));
        if (allowedCodecs.length) {
          return allowedCodecs;
        }
        // eslint-disable-next-line no-console
        console.warn('Allowed codecs did not match any available codecs. Falling back to defaults');
      }
      return codecs;
    };

    if (this.peerConnection) {
      const transceivers = this.peerConnection.getTransceivers();
      transceivers.forEach(transceiver => {
        const kind = transceiver.sender.track?.kind || transceiver.receiver.track?.kind;
        if (kind === 'video') {
          let codecs;
          const direction = getTransceiverDirection(transceiver);
          switch (direction) {
            case 'sendonly':
              codecs = [...RTCRtpSender.getCapabilities(kind).codecs];
              break;
            case 'recvonly':
              codecs = [...RTCRtpReceiver.getCapabilities(kind).codecs];
              break;
            default:
              codecs = [
                ...RTCRtpSender.getCapabilities(kind).codecs,
                ...RTCRtpReceiver.getCapabilities(kind).codecs,
              ];
          }
          codecs = rearrange(codecs);
          this.debug('setting codec preferences', codecs);
          transceiver.setCodecPreferences(codecs);
        }
      });
    }
    this.emit('changed', { options: clone(this.options) });
  }

  getDirectionalTransceiver(kind) {
    const transceiver = this.peerConnection?.getTransceivers().find(
      t => t.sender?.track?.kind === kind || t.receiver?.track?.kind === kind,
    );
    if (!transceiver) {
      return null;
    }
    return this.isSender ? transceiver.sender : transceiver.receiver;
  }

  async addIceCandidate(candidate) {
    const protocolSupported = this.isCandidateProtocolSupported(candidate);
    if (protocolSupported) {
      await this.peerConnection.addIceCandidate(candidate);
    }
  }

  isCandidateProtocolSupported(candidate) {
    if (!candidate.candidate) {
      return true;
    }
    if (candidate.protocol) {
      return this.options.candidateTypes.some(
        protocol => candidate.protocol.toLowerCase() === protocol.toLowerCase(),
      );
    }
    return this.options.candidateTypes.some(
      protocol => candidate.candidate.toLowerCase().includes(protocol.toLowerCase()),
    );
  }

  onStatsReceived = (stats) => {
    this.emit('stats', stats);
  };

  handleIceCandidateEvent = (event) => {
    this.debug('handleIceCandidateEvent', event.candidate);
    if (!event.candidate) {
      return;
    }
    const protocolSupported = this.isCandidateProtocolSupported(event.candidate);

    if (protocolSupported) {
      this.signaling.sendCandidate({ streamId: this.id, candidate: event.candidate });
    }
  }

  onIceCandidateReceived = async ({ sdpMLineIndex, candidate }) => {
    this.debug('onIceCandidateReceived', { sdpMLineIndex, candidate });
    const ice = new RTCIceCandidate({
      sdpMLineIndex,
      candidate,
    });
    if (this.peerConnection?.remoteDescription) {
      await this.addIceCandidate(ice);
    } else {
      this.iceCandidateList.push(ice);
    }
  }

  onIceConnectionStateChange = async () => {
    const state = this.peerConnection.iceConnectionState;
    this.debug('onIceConnectionStateChange', state);

    switch (state) {
      case 'connected':
        this.currentState = STATE.OPEN;
        this.backoff = 0;
        this.emit('connected');
        this.emit('changed', { currentState: this.currentState });
        if (this.statsEnabled) {
          this.enableStats();
        }
        break;
      case 'disconnected':
        this.onClosePeerConnection();
        break;
      default:
        break;
    }
  }

  onReadyToNegotiate = async () => {
    this.debug('onReadyToNegotiate', this.id);
    try {
      this.initPeerConnection();
      await this.createOffer();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`create offer error for stream id: ${this.id} error: ${error}`);
      this.onClosePeerConnection();
    }
  }

  onOfferReceived = async (description) => {
    this.debug('onOfferReceived', description);
    if (!this.peerConnection) {
      this.initPeerConnection();
    }
    description = new RTCSessionDescription(description);
    try {
      await this.peerConnection.setRemoteDescription(description);
      this.debug('remote description set', description);
      if (this.options.videoCodec) {
        this.setVideoCodec(this.options.videoCodec);
      }
      this.iceCandidateList.forEach(candidate => {
        this.addIceCandidate(candidate);
      });
      this.iceCandidateList = [];
      await this.createAnswer();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      if (this.currentState !== STATE.OPEN) {
        // this will reschedule connection
        this.onClosePeerConnection();
      }
    }
  }

  onAnswerReceived = async (description) => {
    this.debug('onAnswerReceived', description);
    if (!this.peerConnection) {
      throw new Error('Answer received after peer connection has been destroyed');
    }
    description = new RTCSessionDescription(description);
    try {
      await this.peerConnection.setRemoteDescription(description);
      this.debug('remote description set', description);
      this.iceCandidateList.forEach(candidate => {
        this.addIceCandidate(candidate);
      });
      this.iceCandidateList = [];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      if (this.currentState !== STATE.OPEN) {
        // this will reschedule connection
        this.onClosePeerConnection();
      }
    }
  }

  handleSignalingError = (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    if (this.desiredState === STATE.OPEN && this.currentState !== STATE.OPEN && !this.restartTimeout) {
      // initiate restart
      this.onClosePeerConnection();
    }
  }

  onClosePeerConnection = () => {
    this.debug('onClosePeerConnection');
    this.signaling.sendStop(this.id);
    const { statsEnabled } = this;
    this.disableStats();
    // preserve statsEnabled status in case we will reconnect
    this.statsEnabled = statsEnabled;
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection.removeEventListener('icecandidate', this.handleIceCandidateEvent);
      this.peerConnection.removeEventListener('iceconnectionstatechange', this.onIceConnectionStateChange);
      this.peerConnection = null;
    }
    this.currentState = STATE.CLOSED;
    this.emit('disconnected');
    this.emit('changed', { currentState: this.currentState });
    if (this.desiredState === STATE.OPEN && !this.restartTimeout) {
      // we should not do shorter than 5s because signaling server may cause race conditions
      this.backoff = this.backoff ? this.backoff + 1 : 1;
      this.restartTimeout = setTimeout(() => {
        if (this.desiredState === STATE.OPEN && this.currentState === STATE.CLOSED) {
          this.connect();
        }
      }, this.backoff * 1000);
    }
  }
}

export { PeerConnection, STATE };

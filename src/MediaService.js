import { EventEmitter } from 'events';
import Source from './Source';
import { Sender } from './Sender';
import { Receiver } from './Receiver';

/**
 * MediaService allows to control webRTC flow independent from service provider
 * You should provide a signaling service to the constructor, which could be any service, which is implemented based on
 * supported Signaling interface
 */
class MediaService extends EventEmitter {
  constructor({ signalingFactory, debug }) {
    super();
    this.signalingFactory = signalingFactory;
    this.originalDebug = debug;
    this.debug = debug ? debug.bind(null, `[${this.constructor.name}]:`) : (() => {});

    this.devices = null;
    this.sources = new Map();
    this.senders = new Map();
    this.receivers = new Map();
    this.assertBrowserSupported();
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    this.stopDeviceChangeTracking();
    const maps = [this.sources, this.senders];
    maps.forEach(map => {
      Array.from(map.values()).forEach((item) => {
        item.destroy();
        map.delete(item.id);
      });
    });
  }

  async initMedia() {
    await this.getDevices();
    this.trackDeviceChange();
    this.debug('media initialized');
  }

  trackDeviceChange() {
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
  }

  stopDeviceChangeTracking() {
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
  }

  async getDevices() {
    if (this.devices) {
      return this.devices;
    }
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some(device => device.label === '')) {
      // warm devices to get labels
      const constraints = {
        video: devices.some(device => device.kind === 'videoinput'),
        audio: devices.some(device => device.kind === 'audioinput'),
      };
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        if (err.name) {
          this.emit(err.name);
        }
        throw err;
      }
      mediaStream.getTracks().forEach(track => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    this.devices = devices;
    this.videoInputs = this.devices.filter(device => device.kind === 'videoinput');
    this.audioInputs = this.devices.filter(device => device.kind === 'audioinput');
    this.emit('devices:available', devices);
    return devices;
  }

  async createSource(id, preferences) {
    const getConstraint = (inputs, preference) => {
      if (preference === 'screen') {
        this.assertScreenShareSupported();
        return preference;
      }
      if (!inputs.length || !preference) {
        return false;
      }
      if (typeof preference === 'object') {
        const { label, ...pref } = preference;
        let deviceId = inputs.find(dev => dev.deviceId === pref.deviceId)?.deviceId;
        if (!deviceId) {
          deviceId = inputs.find(dev => dev.label === label)?.deviceId;
        }
        if (deviceId) {
          return { ...pref, deviceId };
        }
      }
      return preference || false;
    };
    let source = this.sources.get(id);
    if (!source) {
      source = new Source(id);
      this.sources.set(id, source);
      source.once('destroyed', () => {
        this.sources.delete(id);
      });
    }
    const constraints = {
      video: getConstraint(this.videoInputs, preferences.video),
      audio: getConstraint(this.audioInputs, preferences.audio),
    };
    await source.applyConstraints(constraints);
    this.debug('source created', source);
    return source;
  }

  /**
   *
   * @param id
   * @param {{
   *   videoCodec?: string,
   *   allowedVideoCodecs?: string[],
   *   encoding?: {
   *     maxBitrate?: number|"unlimited",
   *     maxFramerate?: number
   *     priority?: 'very-low'|'low'|'medium'|'high',
   *     scaleResolutionDownBy?: number,
   *   },
   *   rtcConfig?: RTCConfiguration,
   *   sdpOptions?: RTCOfferAnswerOptions,
   *   candidateTypes?: array,
   * }} options
   * @returns {any}
   */
  createSender(id, options) {
    let sender = this.senders.get(id);
    if (!sender) {
      const signaling = this.signalingFactory();
      sender = new Sender({
        id, signaling, debug: this.originalDebug, ...options,
      });
      this.senders.set(id, sender);
      sender.once('destroyed', () => {
        signaling.destroy();
        this.senders.delete(id);
      });
    }
    this.debug('sender created', sender);
    return sender;
  }

  /**
   *
   * @param id
   * @param {{
   *   videoCodec?: string,
   *   allowedVideoCodecs?: string[],
   *   rtcConfig?: RTCConfiguration,
   *   sdpOptions?: RTCOfferAnswerOptions,
   *   candidateTypes?: array,
   *   experimental: {maxBitrate:number, minBitrate:number, startBitrate:number}
   * }} options
   * @returns {any}
   */
  createReceiver(id, options) {
    let receiver = this.receivers.get(id);
    if (!receiver) {
      const signaling = this.signalingFactory();
      receiver = new Receiver({
        id, signaling, debug: this.originalDebug, ...options,
      });
      this.receivers.set(id, receiver);
      receiver.once('destroyed', () => {
        signaling.destroy();
        this.receivers.delete(id);
      });
    }
    return receiver;
  }

  onDeviceChange = () => this.getDevices();

  assertScreenShareSupported = () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen share is not supported');
    }
  }

  assertBrowserSupported = () => {
    if (!('WebSocket' in window)) {
      throw new Error('WebSocket not supported.');
    }
    if (!navigator.mediaDevices) {
      throw new Error('Cannot open camera and mic because of unsecure context. Please Install SSL(https)');
    }
  }
}

export default MediaService;
export { MediaService };

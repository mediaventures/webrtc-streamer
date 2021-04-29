import { EventEmitter } from 'events';
import PromiseContext from './utils/PromiseContext';

class AntMediaSignaling extends EventEmitter {
  constructor({ url, debug }) {
    super();
    this.url = url;
    this.debug = debug ? debug.bind(null, '[AntMedia Signaling]:') : (() => {});
    this.pingTimerHandle = null;
  }

  destroy() {
    this.disconnect();
  }

  sendPing = () => {
    this.connection.send(JSON.stringify({
      command: 'ping',
    }));
  }

  async registerPublisher({ streamId, audio, video }) {
    await this.connect();
    this.send({
      command: 'publish',
      streamId,
      video,
      audio,
      // token,
      subscriberId: '',
      subscriberCode: '',
    });
  }

  async sendOffer({ streamId, description }) {
    await this.connect();
    const payload = {
      command: 'takeConfiguration',
      streamId,
      type: description.type,
      sdp: description.sdp,
    };
    this.send(payload);
  }

  async sendAnswer({ streamId, description }) {
    await this.connect();
    const payload = {
      command: 'takeConfiguration',
      streamId,
      type: description.type,
      sdp: description.sdp,
    };
    this.send(payload);
  }

  async sendCandidate({ streamId, candidate }) {
    const payload = {
      command: 'takeCandidate',
      streamId,
      label: candidate.sdpMLineIndex,
      id: candidate.sdpMid,
      candidate: candidate.candidate,
    };
    this.send(payload);
  }

  async subscribe(streamId) {
    await this.connect();
    this.send({
      command: 'play',
      streamId,
      subscriberId: '',
      subscriberCode: '',
      viewerInfo: '',
    });
  }

  sendStop(streamId) {
    if (this.isOpen) {
      this.send({
        command: 'stop',
        streamId,
      });
    }
  }

  onMessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.command) {
      case 'start':
        this.emit(`readyToNegotiate:${data.streamId}`);
        break;
      case 'takeCandidate':
        this.emit(`candidateReceived:${data.streamId}`, {
          sdpMLineIndex: data.label,
          candidate: data.candidate,
        });
        break;
      case 'takeConfiguration':
        if (data.type === 'offer') {
          this.emit(`offerReceived:${data.streamId}`, { sdp: data.sdp, type: data.type });
        } else {
          this.emit(`answerReceived:${data.streamId}`, { sdp: data.sdp, type: data.type });
        }
        break;
      case 'stop':
        this.emit(`closePeerConnection:${data.streamId}`);
        break;
      case 'error':
        this.emit(data.definition);
        this.emit('error', new Error(data.definition));
        break;
      case 'notification':
        this.emit(data.notification, data);
        if (data.definition === 'play_finished' || data.definition === 'publish_finished') {
          this.emit(`closePeerConnection:${data.streamId}`);
        }
        break;
      case 'connectWithNewId':
        // TODO: we don't know what to do with it
        // eslint-disable-next-line no-console
        console.error('connectWithNewId received.', data);
        break;
      case 'streamInformation':
      case 'roomInformation':
      case 'pong':
      case 'trackList':
      case 'peerMessageCommand':
        this.emit(data.command, data);
        break;
      default:
        break;
    }
  }

  get isOpen() {
    return this.state === WebSocket.OPEN;
  }

  get state() {
    return this.connection?.readyState ?? WebSocket.CLOSED;
  }

  onConnectionOpened = () => {
    if (this.pingTimerHandle) {
      clearInterval(this.pingTimerHandle);
    }
    this.pingTimerHandle = setInterval(this.sendPing, 3000);
    if (this.connectionPromise) {
      this.connectionPromise.resolve();
    }
    this.emit('open');
  }

  onConnectionClosed = () => {
    clearInterval(this.pingTimerHandle);
    this.pingTimerHandle = null;
    this.connection.removeEventListener('open', this.onConnectionOpened);
    this.connection.removeEventListener('error', this.onConnectionError);
    this.connection.removeEventListener('close', this.onConnectionClosed);
    this.connection.removeEventListener('message', this.onMessage);
    delete this.connection;
    this.emit('close');
  }

  onConnectionError = (err) => {
    // eslint-disable-next-line no-console
    console.error('WS Connection error', err);
    this.emit('error', err);
    if (this.connectionPromise) {
      this.connectionPromise.reject(err);
    }
  }

  _connect() {
    this.connection = new WebSocket(this.url);
    this.connection.addEventListener('open', this.onConnectionOpened);
    this.connection.addEventListener('error', this.onConnectionError);
    this.connection.addEventListener('close', this.onConnectionClosed);
    this.connection.addEventListener('message', this.onMessage);
  }

  async connect() {
    this.debug('connecting');
    if (this.state in [WebSocket.CONNECTING, WebSocket.OPEN]) {
      this.debug('returning connection promise');
      return this.connectionPromise.promise;
    }
    this._connect();
    this.connectionPromise = new PromiseContext();
    return this.connectionPromise.promise;
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
    }
  }

  send(data) {
    if (this.connection?.readyState !== WebSocket.OPEN) {
      const err = new Error('WS not connected');
      this.emit(err);
      throw err;
    }
    if (typeof data !== 'string') {
      data = JSON.stringify(data);
    }
    this.connection.send(data);
    this.debug(`sent message: ${data}`);
  }
}

export default AntMediaSignaling;

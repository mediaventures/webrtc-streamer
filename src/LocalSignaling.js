import { EventEmitter } from 'events';

class LocalSignaling extends EventEmitter {
  constructor({ debug }) {
    super();
    this.debug = debug ? debug.bind(null, '[LocalSignaling]:') : (() => {});
    this.channel = new BroadcastChannel('signaling');
    this.channel.addEventListener('message', this.handleMessage);
  }

  destroy() {
    this.channel.removeEventListener('message', this.handleMessage);
  }

  /**
   *
   * @param {{streamId: string, audio: boolean, video: boolean}} stream
   */
  registerPublisher(stream) {
    this._send('streamAvailable', stream);
  }

  sendOffer({ streamId, description }) {
    this._send(`offerReceived:${streamId}`, {
      type: description.type,
      sdp: description.sdp,
    });
  }

  sendAnswer({ streamId, description }) {
    this._send(`answerReceived:${streamId}`, {
      type: description.type,
      sdp: description.sdp,
    });
  }

  sendCandidate({ streamId, candidate }) {
    this._send(`candidateReceived:${streamId}`, {
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
      candidate: candidate.candidate,
    });
  }

  sendStop(streamId) {
    this._send(`closePeerConnection:${streamId}`);
  }

  subscribe(streamId) {
    this._send(`readyToNegotiate:${streamId}`);
  }

  _send(command, data) {
    this.debug('posting message', { command, data });
    this.channel.postMessage({ command, data });
  }

  handleMessage = (e) => {
    if (e.data.command) {
      this.debug('received message', e.data);
      this.emit(e.data.command, e.data.data);
    }
  }
}

export default LocalSignaling;

import AntMediaSignaling from './AntMediaSignaling';

class AntMediaSignalingP2P extends AntMediaSignaling {
  constructor({ url, debug }) {
    super({ url, debug });
  }

  async registerPublisher({ streamId }) {
    await this.connect();
    this.send({
      command: 'join',
      streamId,
      multiPeer: false,
      mode: 'publish',
    });
  }

  async subscribe(streamId) {
    await this.connect();
    this.send({
      command: 'join',
      streamId,
      multiPeer: false,
      mode: 'play',
    });
  }

  sendStop(streamId) {
    if (this.isOpen) {
      this.send({
        command: 'leave',
        streamId,
      });
    }
  }
}

export default AntMediaSignalingP2P;

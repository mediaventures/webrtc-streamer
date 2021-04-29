import { EventEmitter } from 'events';
import { WebRTCStats } from '@peermetrics/webrtc-stats';

class StatsCollector extends EventEmitter {
  constructor(peerConnection) {
    super();
    this.webrtcStats = new WebRTCStats();
    this.webrtcStats.addPeer({ pc: peerConnection, peerId: 'peerId' });
    this.webrtcStats.on('stats', (e) => {
      this.stats = e.data;
      this.emit('stats', this.stats);
    });
  }

  stop() {
    this.webrtcStats.removePeer('peerId');
  }
}

export default StatsCollector;

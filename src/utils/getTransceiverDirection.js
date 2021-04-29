export default function getTransceiverDirection(transceiver) {
  const { direction, currentDirection } = transceiver;
  if (currentDirection) {
    return currentDirection;
  }

  const senderTrack = transceiver.sender.track;
  const receiverTrack = transceiver.receiver.track;
  const senderActive = senderTrack?.enabled && !senderTrack?.muted;
  const receiverActive = receiverTrack?.enabled && !receiverTrack?.muted;

  if (senderActive && !receiverActive) {
    return 'sendonly';
  }
  if (receiverActive && !senderActive) {
    return 'recvonly';
  }
  return direction;
}

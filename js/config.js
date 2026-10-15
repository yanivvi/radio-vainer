export { joinRoom } from 'https://esm.sh/@trystero-p2p/nostr@0.26.0'

export const roomId = 'live'

export function roomOptions(extra = {}) {
  return {
    appId: 'yanivvi.radio-vainer',
    relayConfig: { redundancy: 2 },
    ...extra
  }
}

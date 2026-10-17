export { joinRoom } from 'https://esm.sh/@trystero-p2p/nostr@0.26.0'

export const roomId = 'live'
export const streamPath = '/stream/radio-vainer'
export const statusPath = '/stream/status-json.xsl'
export const sourceUser = 'source'

export function harborUrl() {
  const url = new URL('/harbor/live', location.href)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

export function roomOptions(extra = {}) {
  return {
    appId: 'yanivvi.radio-vainer',
    relayConfig: { redundancy: 2 },
    ...extra
  }
}

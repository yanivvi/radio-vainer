export const deckActionName = 'deck'

export function readDeckCode(raw) {
  const code = String(raw || '').trim().toLowerCase()
  return /^[0-9a-f]{32}$/.test(code) ? code : ''
}

export function deckRoomId(code) {
  const valid = readDeckCode(code)
  return valid ? `deck-${valid}` : ''
}

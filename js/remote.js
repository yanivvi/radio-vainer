import { deckActionName, deckRoomId } from './deck.js'
import { joinRoom, roomOptions } from './config.js'

const air = document.querySelector('#air')
const listenersEl = document.querySelector('#listeners')
const note = document.querySelector('#note')
const deckPanel = document.querySelector('#deck')
const goLiveBtn = document.querySelector('#go-live')
const micBtn = document.querySelector('#mic')
const micGainInput = document.querySelector('#mic-gain')
const micMeter = document.querySelector('#mic-meter')
const musicNote = document.querySelector('#music-note')
const musicGainInput = document.querySelector('#music-gain')
const musicMeter = document.querySelector('#music-meter')
const musicStopBtn = document.querySelector('#music-stop')
const speakBtn = document.querySelector('#mode-speak')
const playBtn = document.querySelector('#mode-play')
const autoBtn = document.querySelector('#mode-auto')
const guestWho = document.querySelector('#guest-who')
const guestMeter = document.querySelector('#guest-meter')
const guestGainInput = document.querySelector('#guest-gain')
const guestDropBtn = document.querySelector('#guest-drop')
const messageInput = document.querySelector('#message')

let room
let deckAction
let hostId = null
let linked = false
let applying = false
let dragChannel = ''
let helloTimer = 0

showLevel(micGainInput)
showLevel(musicGainInput)
showLevel(guestGainInput)

goLiveBtn.addEventListener('click', () => {
  send({ kind: 'live', on: goLiveBtn.getAttribute('aria-pressed') !== 'true' })
})
micBtn.addEventListener('click', () => {
  send({ kind: 'mic', on: micBtn.getAttribute('aria-pressed') !== 'true' })
})
musicStopBtn.addEventListener('click', () => {
  send({ kind: 'music', on: false })
})
speakBtn.addEventListener('click', () => send({ kind: 'speak' }))
playBtn.addEventListener('click', () => send({ kind: 'play' }))
autoBtn.addEventListener('click', () => {
  send({ kind: 'auto', on: autoBtn.getAttribute('aria-pressed') !== 'true' })
})
guestDropBtn.addEventListener('click', () => send({ kind: 'drop' }))
messageInput.addEventListener('input', () => {
  if (applying) return
  send({ kind: 'message', text: messageInput.value })
})

bindLevel(micGainInput, 'mic')
bindLevel(musicGainInput, 'music')
bindLevel(guestGainInput, 'guest')
window.addEventListener('pointerup', () => { dragChannel = '' })
window.addEventListener('pointercancel', () => { dragChannel = '' })

window.addEventListener('pagehide', () => {
  window.clearInterval(helloTimer)
  if (linked && hostId && deckAction) {
    deckAction.send({ kind: 'bye' }, { target: hostId }).catch(() => {})
  }
  room?.leave()
})

note.textContent = 'Waiting for the studio tab.'
join()

function join() {
  room = joinRoom(roomOptions({ passive: true }), deckRoomId, {
    onJoinError() {
      if (!linked) note.textContent = 'Could not reach the studio. Refresh and try again.'
    }
  })
  deckAction = room.makeAction(deckActionName)

  deckAction.onMessage = (data, { peerId }) => {
    if (!data || typeof data.kind !== 'string') return
    if (data.kind === 'state') {
      if (hostId && peerId !== hostId) return
      hostId = peerId
      if (!linked) {
        linked = true
        deckPanel.hidden = false
      }
      applyState(data)
      return
    }
    if (!hostId || peerId !== hostId) return
    if (data.kind === 'busy') {
      if (!linked) note.textContent = 'This link is open on another phone.'
      return
    }
  }

  room.onPeerJoin = (peerId) => {
    if (!hostId) hostId = peerId
    hello()
  }

  room.onPeerLeave = (peerId) => {
    if (peerId !== hostId) return
    waitForStudio()
  }

  helloTimer = window.setInterval(hello, 1500)
}

function hello() {
  if (!room || !deckAction || linked) return
  try {
    if (!hostId) {
      const peers = room.getPeers()
      const ids = peers instanceof Map ? [...peers.keys()] : Object.keys(peers || {})
      if (ids.length !== 1) return
      hostId = ids[0]
    }
    deckAction.send({ kind: 'hello' }, { target: hostId }).catch(() => {})
  } catch {
    // The room may still be opening.
  }
}

function send(payload) {
  if (!linked || !deckAction || !hostId) return
  deckAction.send(payload, { target: hostId }).catch(() => {})
}

function waitForStudio() {
  linked = false
  hostId = null
  deckPanel.hidden = true
  listenersEl.textContent = ''
  setAir(false)
  note.textContent = 'Waiting for the studio tab.'
}

function applyState(data) {
  if (typeof data.live === 'boolean') {
    setAir(data.live)
    goLiveBtn.textContent = data.live ? 'Stop broadcast' : 'Go live'
    goLiveBtn.setAttribute('aria-pressed', data.live ? 'true' : 'false')
    if (data.live) {
      const count = clampCount(data.listeners)
      listenersEl.textContent = count === 0
        ? 'No listeners yet'
        : count === 1
          ? '1 listening'
          : `${count} listening`
    } else {
      listenersEl.textContent = ''
    }
  }

  if (typeof data.micOn === 'boolean') {
    micBtn.setAttribute('aria-pressed', data.micOn ? 'true' : 'false')
  }
  setSlider(micGainInput, data.micLevel, 'mic')
  paintMeter(micMeter, unit(data.micMeter))

  if (typeof data.musicOn === 'boolean') {
    musicStopBtn.hidden = !data.musicOn
    musicNote.textContent = data.musicOn
      ? 'Playing from the laptop.'
      : 'Start music on the laptop.'
  }
  setSlider(musicGainInput, data.musicLevel, 'music')
  paintMeter(musicMeter, unit(data.musicMeter))

  if (data.mode === 'speak' || data.mode === 'play' || data.mode === '') {
    speakBtn.setAttribute('aria-pressed', data.mode === 'speak' ? 'true' : 'false')
    playBtn.setAttribute('aria-pressed', data.mode === 'play' ? 'true' : 'false')
  }
  if (typeof data.auto === 'boolean') {
    autoBtn.setAttribute('aria-pressed', data.auto ? 'true' : 'false')
  }

  if (typeof data.guestOn === 'boolean') {
    guestDropBtn.hidden = !data.guestOn
    guestWho.textContent = data.guestOn
      ? (clean(data.guestName, 24) || 'Guest')
      : 'No caller'
  }
  setSlider(guestGainInput, data.guestLevel, 'guest')
  paintMeter(guestMeter, unit(data.guestMeter))

  if (typeof data.message === 'string' && document.activeElement !== messageInput) {
    const next = clean(data.message, 140)
    if (messageInput.value !== next) {
      applying = true
      messageInput.value = next
      applying = false
    }
  }

  if (typeof data.status === 'string') {
    note.textContent = clean(data.status, 200)
  }
}

function setSlider(input, value, channel) {
  if (channel === dragChannel) return
  const level = clampLevel(value)
  if (level === null || input.value === String(level)) {
    if (level !== null) showLevel(input)
    return
  }
  applying = true
  input.value = String(level)
  showLevel(input)
  applying = false
}

function bindLevel(input, channel) {
  input.addEventListener('pointerdown', () => { dragChannel = channel })
  input.addEventListener('input', () => {
    if (applying) return
    showLevel(input)
    send({ kind: 'level', channel, value: Number(input.value) })
  })
}

function setAir(on) {
  air.textContent = on ? 'Live' : 'Off air'
  air.classList.toggle('on', on)
  air.classList.toggle('off', !on)
  document.title = on ? '● Remote · Radio Vainer' : 'Remote · Radio Vainer'
}

function showLevel(input) {
  input.setAttribute('aria-valuetext', input.value)
  const level = input.parentElement?.querySelector('.level')
  if (level) level.textContent = input.value
}

function paintMeter(canvas, level) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 280
  const height = canvas.clientHeight || 22
  const pxW = Math.floor(width * dpr)
  const pxH = Math.floor(height * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f0d3b0'
  ctx.fillRect(0, height / 2 - 4, width, 8)
  ctx.fillStyle = level > 0.85 ? '#e23b3b' : '#f07832'
  ctx.fillRect(0, height / 2 - 4, Math.max(0, width * level), 8)
}

function clampLevel(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(150, Math.max(0, n))
}

function clampCount(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(999, Math.max(0, n))
}

function unit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function clean(text, max) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
}

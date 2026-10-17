import { deckActionName, deckRoomId } from './deck.js'
import { joinRoom, roomOptions } from './config.js'

const air = document.querySelector('#air')
const note = document.querySelector('#note')
const deckPanel = document.querySelector('#deck')
const micBtn = document.querySelector('#mic')
const micGainInput = document.querySelector('#mic-gain')
const micMeter = document.querySelector('#mic-meter')
const musicNote = document.querySelector('#music-note')
const musicGainInput = document.querySelector('#music-gain')
const musicMeter = document.querySelector('#music-meter')
const speakBtn = document.querySelector('#mode-speak')
const playBtn = document.querySelector('#mode-play')
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
let micStream = null
let micToken = 0
let micBusy = false
let localNote = ''
let wakeLock = null
let wakeWanted = false

showLevel(micGainInput)
showLevel(musicGainInput)
showLevel(guestGainInput)

micBtn.addEventListener('click', () => {
  if (micStream) {
    stopDeviceMic()
    send({ kind: 'mic', on: false })
    return
  }
  if (micBusy) {
    stopDeviceMic()
    return
  }
  openDeviceMic().then((opened) => {
    if (opened) send({ kind: 'mic', on: true })
  })
})
speakBtn.addEventListener('click', () => {
  openDeviceMic().then((opened) => {
    if (opened) send({ kind: 'speak' })
  })
})
playBtn.addEventListener('click', () => send({ kind: 'play' }))
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && micStream) keepAwake()
})

window.addEventListener('pagehide', () => {
  window.clearInterval(helloTimer)
  stopDeviceMic()
  if (linked && hostId && deckAction) {
    deckAction.send({ kind: 'bye', role: 'remote' }, { target: hostId }).catch(() => {})
  }
  room?.leave()
})

note.textContent = 'Waiting for the studio tab.'
join()

function join() {
  room = joinRoom(roomOptions(), deckRoomId, {
    onJoinError() {
      if (!linked) note.textContent = 'Could not reach the studio. Refresh and try again.'
    }
  })
  deckAction = room.makeAction(deckActionName)

  deckAction.onMessage = (data, { peerId }) => {
    if (!data || typeof data.kind !== 'string' || data.role !== 'studio') return
    if (data.kind === 'busy') {
      if (!linked) note.textContent = 'This link is open on another phone.'
      return
    }
    if (data.kind === 'meters') {
      if (!linked || peerId !== hostId) return
      paintMeter(micMeter, unit(data.mic))
      paintMeter(musicMeter, unit(data.music))
      paintMeter(guestMeter, unit(data.guest))
      return
    }
    if (data.kind !== 'state') return
    if (hostId && peerId !== hostId && linked) return
    hostId = peerId
    if (!linked) {
      linked = true
      deckPanel.hidden = false
    }
    applyState(data)
  }

  room.onPeerJoin = (peerId) => { helloTo(peerId) }

  room.onPeerLeave = (peerId) => {
    if (peerId !== hostId) return
    waitForStudio()
  }

  helloTimer = window.setInterval(hello, 1500)
}

function hello() {
  if (!room || !deckAction || linked) return
  let ids = []
  try {
    const peers = room.getPeers()
    ids = peers instanceof Map ? [...peers.keys()] : Object.keys(peers || {})
  } catch {
    return
  }
  for (const id of ids) helloTo(id)
}

function helloTo(peerId) {
  if (!deckAction || linked || !peerId) return
  deckAction.send({ kind: 'hello', role: 'remote' }, { target: peerId }).catch(() => {})
}

function send(payload) {
  if (!linked || !deckAction || !hostId) return
  deckAction.send({ role: 'remote', ...payload }, { target: hostId }).catch(() => {})
}

async function openDeviceMic() {
  if (micStream) return true
  if (micBusy) return false
  if (!navigator.mediaDevices?.getUserMedia) {
    setLocalNote('Open this page in Chrome or Safari to use the microphone.')
    return false
  }
  if (!room || !hostId) return false
  micBusy = true
  const token = micToken + 1
  micToken = token
  try {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        },
        video: false
      })
    } catch (err) {
      micStream = null
      setLocalNote(err?.name === 'NotAllowedError'
        ? 'Microphone permission was blocked.'
        : 'Could not open the microphone.')
      return false
    }
    if (micToken !== token) {
      micStream?.getTracks().forEach((track) => track.stop())
      micStream = null
      return false
    }
    micStream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (micToken !== token) return
        micStream = null
        micToken += 1
        markMic(false)
        send({ kind: 'mic', on: false })
      })
    })
    try {
      const pending = room.addStream(micStream, {
        target: hostId,
        metadata: { role: 'mic' }
      })
      const tasks = Array.isArray(pending) ? pending : pending ? [pending] : []
      await Promise.all(tasks)
    } catch {
      if (micToken === token) {
        stopDeviceMic()
        setLocalNote('Could not send the microphone to the studio.')
      }
      return false
    }
    if (micToken !== token) return false
    clearLocalNote()
    markMic(true)
    keepAwake()
    return true
  } finally {
    micBusy = false
  }
}

function stopDeviceMic() {
  const stream = micStream
  micStream = null
  micToken += 1
  markMic(false)
  clearLocalNote()
  if (stream && room && hostId) {
    try { room.removeStream(stream, { target: hostId }) } catch { /* already gone */ }
  }
  stream?.getTracks().forEach((track) => track.stop())
  letSleep()
}

async function keepAwake() {
  wakeWanted = true
  try {
    const lock = await navigator.wakeLock?.request('screen')
    if (!wakeWanted) {
      lock?.release().catch(() => {})
      return
    }
    wakeLock = lock
  } catch {
    wakeLock = null
  }
}

function letSleep() {
  wakeWanted = false
  const current = wakeLock
  wakeLock = null
  current?.release().catch(() => {})
}

function markMic(on) {
  micBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
}

function setLocalNote(text) {
  localNote = text
  note.textContent = text
}

function clearLocalNote() {
  localNote = ''
}

function waitForStudio() {
  stopDeviceMic()
  linked = false
  hostId = null
  deckPanel.hidden = true
  setAir(false)
  note.textContent = 'Waiting for the studio tab.'
}

function applyState(data) {
  if (typeof data.live === 'boolean') setAir(data.live)

  if (!micBusy) markMic(!!micStream)
  setSlider(micGainInput, data.micLevel, 'mic')

  if (typeof data.musicOn === 'boolean') {
    musicNote.textContent = data.musicOn
      ? 'Playing from the laptop.'
      : 'Start music on the laptop.'
  }
  setSlider(musicGainInput, data.musicLevel, 'music')

  if (data.mode === 'speak' || data.mode === 'play' || data.mode === '') {
    speakBtn.setAttribute('aria-pressed', data.mode === 'speak' ? 'true' : 'false')
    playBtn.setAttribute('aria-pressed', data.mode === 'play' ? 'true' : 'false')
  }

  if (typeof data.guestOn === 'boolean') {
    guestDropBtn.hidden = !data.guestOn
    guestWho.textContent = data.guestOn
      ? (clean(data.guestName, 24) || 'Guest')
      : 'No caller'
  }
  setSlider(guestGainInput, data.guestLevel, 'guest')

  if (typeof data.message === 'string' && document.activeElement !== messageInput) {
    const next = clean(data.message, 140)
    if (messageInput.value !== next) {
      applying = true
      messageInput.value = next
      applying = false
    }
  }

  if (localNote) note.textContent = localNote
  else if (typeof data.status === 'string' && data.status) note.textContent = clean(data.status, 200)
  else note.textContent = 'Phone is connected.'
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

function unit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function clean(text, max) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
}

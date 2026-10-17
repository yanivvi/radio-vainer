import { mountListenerChat } from './chat.js'
import { joinRoom, roomId, roomOptions, streamPath } from './config.js'
import { readMount } from './stream.js'

const HOST_STALE_MS = 12000

const air = document.querySelector('#air')
const hostMessage = document.querySelector('#host-message')
const listenBtn = document.querySelector('#listen')
const note = document.querySelector('#note')
const canvas = document.querySelector('#scope')

const player = document.querySelector('#player')
player.playsInline = true
player.volume = 1
player.preload = 'none'

let audioCtx
let analyser
let sourceNode
let meterStream
let hostId = null
let lastHostBeat = 0
let armed = false
let ignorePause = false
let streamOn = false
let suppressError = false
let raf = 0

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { startListening() })
  navigator.mediaSession.setActionHandler('pause', () => { stopListening() })
}

const room = joinRoom(roomOptions({ passive: true }), roomId)

const chat = mountListenerChat({
  room,
  getHostId: () => hostId,
  claimHost(peerId) {
    return hostId === peerId && Date.now() - lastHostBeat < HOST_STALE_MS
  }
})

const status = room.makeAction('status')

status.onMessage = (data, { peerId }) => {
  if (!data || data.role !== 'host') return
  if (!data.live) {
    if (peerId === hostId) leaveChat(true)
    return
  }
  if (!acceptHost(peerId, true)) return
  if (data.message) showMessage(data.message)
  chat.hostHere()
}

room.onPeerLeave = (peerId) => {
  if (peerId === hostId) leaveChat(false)
}

window.setInterval(() => {
  if (!hostId) return
  if (Date.now() - lastHostBeat < HOST_STALE_MS) return
  leaveChat(false)
}, 2000)

window.setInterval(watchStream, 3000)
watchStream()

listenBtn.addEventListener('click', () => {
  if (armed) stopListening()
  else startListening()
})

player.addEventListener('pause', () => {
  if (ignorePause || !armed || player.error) return
  stopListening()
})

player.addEventListener('error', () => {
  if (!armed || suppressError) return
  releaseMeter()
  window.setTimeout(() => {
    if (!armed || !player.paused) return
    if (!streamOn) {
      armed = false
      listenBtn.textContent = 'Listen'
      note.textContent = 'The studio is off air.'
      publishSession('paused')
      return
    }
    playMount().catch(() => askToListen())
  }, 1000)
})

function acceptHost(peerId, beat) {
  const fresh = hostId && Date.now() - lastHostBeat < HOST_STALE_MS
  if (hostId && peerId !== hostId && fresh) return false
  const switched = hostId !== peerId
  hostId = peerId
  if (beat || switched) lastHostBeat = Date.now()
  return true
}

function startListening() {
  armed = true
  listenBtn.textContent = 'Pause'
  // play() has to start in this click. Waiting on the status poll loses it.
  playMount().catch(() => {
    if (streamOn) {
      askToListen()
      return
    }
    armed = false
    listenBtn.textContent = 'Listen'
    note.textContent = 'The studio is off air.'
    publishSession('paused')
  })
}

function stopListening() {
  ignorePause = true
  player.pause()
  ignorePause = false
  armed = false
  listenBtn.textContent = 'Listen'
  stopDraw()
  releaseMeter()
  audioCtx?.suspend()
  player.removeAttribute('src')
  player.load()
  note.textContent = ''
}

function ensureAudio() {
  if (audioCtx) return audioCtx
  audioCtx = new AudioContext()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  return audioCtx
}

async function playMount() {
  suppressError = false
  const next = new URL(streamPath, location.href)
  next.searchParams.set('t', String(Date.now()))
  player.muted = false
  player.volume = 1
  player.src = next.href
  await player.play()
  publishSession('playing')
  note.textContent = ''
  try {
    ensureAudio()
    await audioCtx.resume()
    attachMeter()
    if (analyser) draw()
  } catch {
    // The station still plays if the meter cannot attach.
  }
}

function attachMeter() {
  ensureAudio()
  audioCtx.resume().catch(() => {})
  if (sourceNode) return
  if (typeof player.captureStream !== 'function') return
  try {
    // The element keeps playing on its own, including with the screen locked.
    meterStream = player.captureStream()
    sourceNode = audioCtx.createMediaStreamSource(meterStream)
    sourceNode.connect(analyser)
  } catch {
    releaseMeter()
  }
}

function releaseMeter() {
  sourceNode?.disconnect()
  sourceNode = null
  meterStream?.getTracks().forEach((track) => track.stop())
  meterStream = null
}

async function watchStream() {
  let mount = null
  try {
    mount = await readMount()
  } catch {
    mount = null
  }
  const live = Boolean(mount)
  const becameLive = live && !streamOn
  if (live) {
    markLive()
    if (mount.title) showMessage(hostLineFromTitle(mount.title))
    if (!armed && note.textContent === 'The studio is off air.') note.textContent = ''
    if (becameLive && armed && player.paused) playMount().catch(() => askToListen())
  } else if (streamOn) {
    showOff()
  }
  streamOn = live
  return live
}

function publishSession(state) {
  if (!('mediaSession' in navigator)) return
  const message = hostMessage.hidden ? '' : hostMessage.textContent.trim()
  navigator.mediaSession.playbackState = state
  navigator.mediaSession.metadata = new MediaMetadata({
    title: message || 'Radio Vainer',
    artist: 'Radio Vainer',
    artwork: [{
      src: new URL('favicon.png', location.href).href,
      sizes: '192x192',
      type: 'image/png'
    }]
  })
}

function askToListen() {
  armed = false
  listenBtn.textContent = 'Listen'
  publishSession('paused')
  watchHearing(false)
  note.textContent = 'Press listen to hear the station.'
}

function markLive() {
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  document.title = '● Radio Vainer'
}

function hostLineFromTitle(title) {
  const text = String(title || '').trim().replace(/^Radio Vainer\s+--?\s+/, '')
  return text === 'Radio Vainer' ? '' : text
}

function showMessage(text) {
  const message = String(text || '').trim().slice(0, 140)
  hostMessage.textContent = message
  hostMessage.hidden = message.length === 0
  if (!player.paused) publishSession('playing')
}

function showOff() {
  suppressError = true
  ignorePause = true
  player.pause()
  ignorePause = false
  player.removeAttribute('src')
  player.load()
  publishSession('none')
  audioCtx?.suspend()
  releaseMeter()
  stopDraw()
  clearScope()
  air.textContent = 'Off air'
  air.classList.add('off')
  air.classList.remove('on')
  hostMessage.textContent = ''
  hostMessage.hidden = true
  if (armed) note.textContent = 'The studio stopped. This will play again when it returns.'
  document.title = 'Radio Vainer'
}

function leaveChat(immediate) {
  hostId = null
  lastHostBeat = 0
  chat.hostLeft(immediate)
}

function draw() {
  if (!analyser) return
  cancelAnimationFrame(raf)
  const ctx = canvas.getContext('2d')
  const bins = new Uint8Array(analyser.frequencyBinCount)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const frame = () => {
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const pxW = Math.floor(width * dpr)
    const pxH = Math.floor(height * dpr)
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW
      canvas.height = pxH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    analyser.getByteFrequencyData(bins)
    const bars = 42
    const gap = 3
    const barWidth = (width - gap * (bars - 1)) / bars
    for (let i = 0; i < bars; i += 1) {
      const value = bins[i] / 255
      const h = Math.max(2, value * height)
      ctx.globalAlpha = 0.4 + value * 0.6
      ctx.fillStyle = '#f07832'
      ctx.fillRect(i * (barWidth + gap), height - h, barWidth, h)
    }
    ctx.globalAlpha = 1
    if (!reduce) raf = requestAnimationFrame(frame)
  }

  frame()
}

function stopDraw() {
  cancelAnimationFrame(raf)
  raf = 0
}

pinComposer(document.querySelector('#chat-form'))

function pinComposer(form) {
  const viewport = window.visualViewport
  if (!viewport || !form) return
  const update = () => {
    const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    document.documentElement.style.setProperty('--keyboard', `${Math.round(keyboard)}px`)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
}

function clearScope() {
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

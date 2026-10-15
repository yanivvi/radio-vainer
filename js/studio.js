import { mountStudioChat } from './chat.js'
import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const goLiveBtn = document.querySelector('#go-live')
const micBtn = document.querySelector('#mic')
const musicBtn = document.querySelector('#music')
const micGainInput = document.querySelector('#mic-gain')
const musicGainInput = document.querySelector('#music-gain')
const micFadeInBtn = document.querySelector('#mic-fade-in')
const micFadeOutBtn = document.querySelector('#mic-fade-out')
const musicFadeInBtn = document.querySelector('#music-fade-in')
const musicFadeOutBtn = document.querySelector('#music-fade-out')
const speakBtn = document.querySelector('#mode-speak')
const playBtn = document.querySelector('#mode-play')
const autoBtn = document.querySelector('#mode-auto')
const micMeter = document.querySelector('#mic-meter')
const musicMeter = document.querySelector('#music-meter')
const messageInput = document.querySelector('#message')
const guestInviteBtn = document.querySelector('#guest-invite')
const guestShare = document.querySelector('#guest-share')
const guestUrlInput = document.querySelector('#guest-url')
const guestCopyBtn = document.querySelector('#guest-copy')
const guestNote = document.querySelector('#guest-note')
const guestOn = document.querySelector('#guest-on')
const guestWho = document.querySelector('#guest-who')
const guestMeter = document.querySelector('#guest-meter')
const guestPlayer = document.querySelector('#guest-player')
const guestGainInput = document.querySelector('#guest-gain')
const guestDropBtn = document.querySelector('#guest-drop')
const statusEl = document.querySelector('#status')
const listenersEl = document.querySelector('#listeners')

let audioCtx
let destination
let clockSource
let micStream
let micSource
let micGain
let micAnalyser
let voiceAnalyser
let displayStream
let musicSource
let musicGain
let musicAnalyser
let room
let statusAction
let callerAction
let callCode = ''
let guestPeerId = null
let guestStream = null
let heldCaller = null
let guestStreamSource = null
let guestGain = null
let guestAnalyser = null
let monitor = null
let pulse
let wakeLock
let raf = 0
let micBusy = false
let musicBusy = false
let starting = false
let autoOn = false
let talking = false
let loudSince = 0
let quietSince = 0

const studioChat = mountStudioChat()
const micFade = createFade(micGainInput, () => micGain, 3)
const musicFade = createFade(musicGainInput, () => musicGain)

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus('Open the studio in Chrome or Edge on this computer.')
}

micBtn.addEventListener('click', () => {
  if (micStream) stopMic()
  else startMic()
})

musicBtn.addEventListener('click', () => {
  if (displayStream) stopMusic()
  else startMusic()
})

micGainInput.addEventListener('input', () => {
  micFade.hold(Number(micGainInput.value))
  clearMixMode()
})

musicGainInput.addEventListener('input', () => {
  musicFade.hold(Number(musicGainInput.value))
  clearMixMode()
})

speakBtn.addEventListener('click', () => { speak() })
playBtn.addEventListener('click', () => { play() })
autoBtn.addEventListener('click', () => { setAuto(!autoOn) })

micFadeInBtn.addEventListener('click', () => micFade.fadeIn())
micFadeOutBtn.addEventListener('click', () => micFade.fadeOut())
musicFadeInBtn.addEventListener('click', () => musicFade.fadeIn())
musicFadeOutBtn.addEventListener('click', () => musicFade.fadeOut())

messageInput.addEventListener('input', () => {
  if (room) publish()
})

goLiveBtn.addEventListener('click', () => {
  if (room) stopBroadcast()
  else startBroadcast()
})

guestInviteBtn.addEventListener('click', createCallLink)
guestCopyBtn.addEventListener('click', copyCallLink)
guestDropBtn.addEventListener('click', () => releaseGuest(true))
guestGainInput.addEventListener('input', () => {
  showLevel(guestGainInput)
  writeGuestGain()
})
showLevel(guestGainInput)
pinComposer(document.querySelector('#studio-chat-form'))

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && room) keepAwake()
})

window.addEventListener('pagehide', release)

function ensureGraph() {
  if (audioCtx) return
  audioCtx = new AudioContext()
  destination = audioCtx.createMediaStreamDestination()
  // Chrome does not render this destination track until a source is connected,
  // so WebRTC would send a dead track. Silence keeps the track rendering.
  clockSource = audioCtx.createConstantSource()
  clockSource.offset.value = 0
  clockSource.connect(destination)
  // The caller hears this mix, which never includes their own voice.
  monitor = audioCtx.createMediaStreamDestination()
  clockSource.connect(monitor)
  clockSource.start()
  loopMeters()
}

async function startMic() {
  if (micBusy) return
  micBusy = true
  micBtn.disabled = true
  ensureGraph()
  await audioCtx.resume()
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
    setStatus(err?.name === 'NotAllowedError'
      ? 'Microphone permission was blocked.'
      : 'Could not open the microphone.')
    return
  } finally {
    micBusy = false
    micBtn.disabled = false
  }

  micSource = audioCtx.createMediaStreamSource(micStream)
  micGain = audioCtx.createGain()
  micFade.apply(micGain)
  micAnalyser = audioCtx.createAnalyser()
  micAnalyser.fftSize = 1024
  voiceAnalyser = audioCtx.createAnalyser()
  voiceAnalyser.fftSize = 1024
  micSource.connect(voiceAnalyser)
  micSource.connect(micGain)
  micGain.connect(destination)
  micGain.connect(monitor)
  micGain.connect(micAnalyser)
  micStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', stopMic)
  })
  micBtn.setAttribute('aria-pressed', 'true')
  setStatus('')
}

function stopMic() {
  if (autoOn) setAuto(false)
  micStream?.getTracks().forEach((track) => track.stop())
  micSource?.disconnect()
  micGain?.disconnect()
  micStream = null
  micSource = null
  micGain = null
  micAnalyser = null
  voiceAnalyser = null
  talking = false
  loudSince = 0
  quietSince = 0
  micBtn.setAttribute('aria-pressed', 'false')
}

async function startMusic() {
  if (musicBusy) return
  musicBusy = true
  musicBtn.disabled = true
  ensureGraph()
  await audioCtx.resume()
  let captured
  try {
    captured = await captureSystemAudio()
  } catch (err) {
    if (err?.name !== 'NotAllowedError') {
      setStatus('Could not capture music from this computer.')
    }
    return
  } finally {
    musicBusy = false
    musicBtn.disabled = false
  }

  const audioTracks = captured.getAudioTracks()
  if (audioTracks.length === 0) {
    captured.getTracks().forEach((track) => track.stop())
    setStatus('That share had no audio. Try again and turn on Share system audio.')
    return
  }

  displayStream = captured
  // The video track has to stay alive. Stopping it ends the audio capture.
  // It is never played or sent; listeners only receive the mixed audio.
  captured.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', stopMusic)
  })
  audioTracks.forEach((track) => track.addEventListener('ended', stopMusic))

  musicSource = audioCtx.createMediaStreamSource(new MediaStream(audioTracks))
  musicGain = audioCtx.createGain()
  musicFade.apply(musicGain)
  musicAnalyser = audioCtx.createAnalyser()
  musicAnalyser.fftSize = 1024
  musicSource.connect(musicGain)
  musicGain.connect(destination)
  musicGain.connect(monitor)
  musicGain.connect(musicAnalyser)
  musicBtn.setAttribute('aria-pressed', 'true')
  setStatus('Music is in the mix. Listeners do not see the screen.')
}

function stopMusic() {
  displayStream?.getTracks().forEach((track) => track.stop())
  musicSource?.disconnect()
  musicGain?.disconnect()
  displayStream = null
  musicSource = null
  musicGain = null
  musicAnalyser = null
  musicBtn.setAttribute('aria-pressed', 'false')
}

async function captureSystemAudio() {
  const attempts = [
    {
      video: { frameRate: 5, width: 320, height: 180 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false
      },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'include'
    },
    { video: true, audio: true }
  ]

  let lastError
  for (const options of attempts) {
    try {
      return await navigator.mediaDevices.getDisplayMedia(options)
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw err
      lastError = err
    }
  }
  throw lastError
}

async function startBroadcast() {
  if (room || starting) return
  starting = true
  try {
    ensureGraph()
    unlockGuestPlayer()
    await audioCtx.resume()
    if (room) return
    room = joinRoom(roomOptions(), roomId, {
      onJoinError() {
        setStatus('The studio could not connect. Refresh and go live again.')
      }
    })
    statusAction = room.makeAction('status')
    callerAction = room.makeAction('caller')
    callerAction.onMessage = (data, { peerId }) => {
      if (!data) return
      if (data.kind === 'hello') acceptCaller(peerId, data)
      else if (data.kind === 'bye' && peerId === guestPeerId) releaseGuest(false)
    }
    const output = destination.stream

    room.onPeerJoin = (peerId) => {
      if (peerId === guestPeerId) sendCallerReturn(peerId)
      else room.addStream(output, { target: peerId, metadata: { role: 'station' } })
      publish(peerId)
    }
    room.onPeerLeave = (peerId) => {
      if (peerId === guestPeerId) releaseGuest(false)
      studioChat.peerLeft(peerId)
      publish()
    }
    room.onPeerStream = (stream, peerId, metadata) => {
      if (metadata?.role !== 'caller' || metadata.call !== callCode) return
      if (guestPeerId && peerId !== guestPeerId) return
      if (guestPeerId !== peerId) {
        heldCaller = { stream, peerId }
        return
      }
      mixCaller(stream)
    }
    room.addStream(output, { metadata: { role: 'station' } })
    studioChat.attach(room)

    goLiveBtn.textContent = 'Stop broadcast'
    goLiveBtn.setAttribute('aria-pressed', 'true')
    setOnAir(true)
    publish()
    pulse = window.setInterval(() => publish(), 3000)
    keepAwake()
    document.title = '● On air · Radio Vainer'
    if (callCode && !guestPeerId) {
      guestNote.textContent = 'Send this link to one caller.'
    }
    if (!micStream && !displayStream) {
      setStatus('You are live. Turn on the microphone or capture music so there is something to hear.')
    }
  } finally {
    starting = false
  }
}

async function stopBroadcast() {
  window.clearInterval(pulse)
  pulse = null
  try {
    await statusAction?.send({ role: 'host', live: false, title: '', message: '', listeners: 0 })
  } catch {
    // The room may already be empty.
  }
  studioChat.detach()
  releaseGuest(false)
  room?.leave()
  room = null
  statusAction = null
  callerAction = null
  wakeLock?.release?.().catch(() => {})
  wakeLock = null
  goLiveBtn.textContent = 'Go live'
  goLiveBtn.setAttribute('aria-pressed', 'false')
  setOnAir(false)
  listenersEl.textContent = ''
  document.title = 'Studio · Radio Vainer'
  setStatus('Broadcast stopped.')
}

function publish(target) {
  if (!statusAction || !room) return
  const payload = {
    role: 'host',
    live: true,
    title: '',
    message: messageInput.value.trim().slice(0, 140),
    listeners: peerCount()
  }
  const options = target ? { target } : undefined
  statusAction.send(payload, options).catch(() => {})
  listenersEl.textContent = payload.listeners === 0
    ? 'No listeners yet'
    : payload.listeners === 1
      ? '1 listening'
      : `${payload.listeners} listening`
}

function peerCount() {
  const peers = room.getPeers()
  const count = peers instanceof Map ? peers.size : Object.keys(peers).length
  return guestPeerId && count > 0 ? count - 1 : count
}

function setOnAir(on) {
  air.textContent = on ? 'Live' : 'Off air'
  air.classList.toggle('on', on)
  air.classList.toggle('off', !on)
}

function setStatus(message) {
  statusEl.textContent = message
}

const SPEAK_LEVEL = 0.12
const SPEAK_MS = 90
// A breath is about a second of quiet. Wait past that before ending the turn.
const QUIET_MS = 2000

async function speak() {
  setMixMode('speak')
  if (musicGain) musicFade.fadeOut()
  if (!micStream) await startMic()
  if (micGain) micFade.fadeIn()
}

function play() {
  setMixMode('play')
  if (micGain) micFade.fadeOut()
  if (musicGain) musicFade.fadeIn()
}

async function setAuto(on) {
  autoOn = on
  autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  talking = false
  loudSince = 0
  quietSince = 0
  if (!on) return
  if (!micStream) {
    await startMic()
    if (!micStream) {
      autoOn = false
      autoBtn.setAttribute('aria-pressed', 'false')
    }
  }
}

function setMixMode(mode) {
  speakBtn.setAttribute('aria-pressed', mode === 'speak' ? 'true' : 'false')
  playBtn.setAttribute('aria-pressed', mode === 'play' ? 'true' : 'false')
}

function clearMixMode() {
  setMixMode('')
}

function watchVoice(level) {
  if (!autoOn || !voiceAnalyser) return
  const now = performance.now()
  if (level >= SPEAK_LEVEL) {
    quietSince = 0
    if (!loudSince) loudSince = now
    if (!talking && now - loudSince >= SPEAK_MS) {
      talking = true
      speak()
    }
    return
  }
  loudSince = 0
  if (!talking) return
  if (!quietSince) quietSince = now
  if (now - quietSince >= QUIET_MS) {
    talking = false
    quietSince = 0
    play()
  }
}

function signalLevel(analyserNode, sample) {
  if (!analyserNode) return 0
  analyserNode.getByteTimeDomainData(sample)
  let sum = 0
  const count = analyserNode.fftSize
  for (let i = 0; i < count; i += 1) {
    const n = (sample[i] - 128) / 128
    sum += n * n
  }
  return Math.min(1, Math.sqrt(sum / count) * 3.2)
}

function showLevel(input) {
  input.setAttribute('aria-valuetext', input.value)
  const level = input.parentElement?.querySelector('.level')
  if (level) level.textContent = input.value
}

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

// A full travel from 0 to 100 takes this long. Shorter moves finish sooner.
const FADE_MS = 3000

function createFade(input, getGain, boost = 1) {
  let open = Number(input.value)
  let frame = 0
  let running = false
  let from = open
  let to = open
  let started = 0
  let duration = 0

  showLevel(input)

  return { fadeIn, fadeOut, hold, apply }

  function gainFor(value) {
    return (Number(value) / 100) * boost
  }

  function fadeIn() {
    start(open > 0 ? open : 100)
  }

  function fadeOut() {
    if (!running) {
      const current = Number(input.value)
      if (current > 0) open = current
    }
    start(0)
  }

  function hold(value) {
    stop()
    if (value > 0) open = value
    writeGain(getGain(), gainFor(value))
    showLevel(input)
  }

  function apply(gainNode) {
    if (!running) {
      writeGain(gainNode, gainFor(input.value))
      return
    }
    const now = audioCtx.currentTime
    const elapsed = performance.now() - started
    const remaining = Math.max(0.05, (duration - elapsed) / 1000)
    const param = gainNode.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(gainFor(input.value), now)
    param.linearRampToValueAtTime(gainFor(to), now + remaining)
  }

  function start(target) {
    stop()
    from = Number(input.value)
    to = target
    if (from === to) return
    const distance = Math.abs(to - from)
    duration = Math.max(180, FADE_MS * (distance / 100))
    started = performance.now()
    running = true
    const gainNode = getGain()
    if (gainNode && audioCtx) {
      const now = audioCtx.currentTime
      const param = gainNode.gain
      param.cancelScheduledValues(now)
      param.setValueAtTime(param.value, now)
      param.linearRampToValueAtTime(gainFor(to), now + duration / 1000)
    }
    frame = requestAnimationFrame(step)
  }

  function step(now) {
    if (!running) return
    const t = Math.min(1, (now - started) / duration)
    const value = Math.round(from + (to - from) * t)
    input.value = String(t === 1 ? to : value)
    showLevel(input)
    if (t < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    running = false
  }

  function stop() {
    running = false
    cancelAnimationFrame(frame)
  }

  function writeGain(gainNode, value) {
    if (!gainNode || !audioCtx) return
    const param = gainNode.gain
    const now = audioCtx.currentTime
    param.cancelScheduledValues(now)
    param.setValueAtTime(value, now)
  }
}

async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen')
  } catch {
    wakeLock = null
  }
}

function loopMeters() {
  const micCtx = micMeter.getContext('2d')
  const musicCtx = musicMeter.getContext('2d')
  const guestCtx = guestMeter.getContext('2d')
  const sample = new Uint8Array(1024)

  const frame = () => {
    watchVoice(signalLevel(voiceAnalyser, sample))
    paintMeter(micCtx, micMeter, micAnalyser, sample)
    paintMeter(musicCtx, musicMeter, musicAnalyser, sample)
    paintMeter(guestCtx, guestMeter, guestAnalyser, sample)
    raf = requestAnimationFrame(frame)
  }
  frame()
}

function paintMeter(ctx, canvas, analyserNode, sample) {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 280
  const height = canvas.clientHeight || 10
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

  const level = signalLevel(analyserNode, sample)
  ctx.fillStyle = level > 0.85 ? '#e23b3b' : '#f07832'
  ctx.fillRect(0, height / 2 - 4, Math.max(0, width * level), 8)
}

function createCallLink() {
  if (guestPeerId) releaseGuest(true)
  callCode = crypto.randomUUID().replaceAll('-', '')
  const url = new URL('guest.html', location.href)
  url.searchParams.set('call', callCode)
  guestUrlInput.value = url.href
  guestShare.hidden = false
  guestInviteBtn.setAttribute('aria-pressed', 'true')
  guestCopyBtn.textContent = 'Copy'
  guestNote.textContent = room
    ? 'Send this link to one caller.'
    : 'Send this link. They connect once you go live.'
}

async function copyCallLink() {
  const link = guestUrlInput.value
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    guestCopyBtn.textContent = 'Copied'
  } catch {
    guestUrlInput.focus()
    guestUrlInput.select()
    guestCopyBtn.textContent = 'Select the link'
  }
  window.setTimeout(() => {
    if (guestCopyBtn.textContent !== 'Copy') guestCopyBtn.textContent = 'Copy'
  }, 1600)
}

function acceptCaller(peerId, data) {
  if (!callCode || data.call !== callCode) {
    callerAction?.send({ kind: 'deny' }, { target: peerId }).catch(() => {})
    return
  }
  if (guestPeerId && guestPeerId !== peerId) releaseGuest(true)
  guestPeerId = peerId
  const name = String(data.name || 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Guest'
  guestWho.textContent = name
  guestOn.hidden = false
  guestNote.textContent = `${name} is in the mix.`
  sendCallerReturn(peerId)
  callerAction?.send({ kind: 'live' }, { target: peerId }).catch(() => {})
  if (heldCaller?.peerId === peerId) {
    const stream = heldCaller.stream
    heldCaller = null
    mixCaller(stream)
  }
  publish()
}

function sendCallerReturn(peerId) {
  if (!room || !monitor || !destination) return
  try {
    room.removeStream(destination.stream, { target: peerId })
  } catch {
    // The station mix may not be on this caller yet.
  }
  room.addStream(monitor.stream, { target: peerId, metadata: { role: 'return' } })
}

function unlockGuestPlayer() {
  guestPlayer.playsInline = true
  guestPlayer.volume = 0
  if (!guestPlayer.srcObject) guestPlayer.srcObject = new MediaStream()
  guestPlayer.play().catch(() => {})
}

function ensureGuestBus() {
  if (guestGain || !audioCtx) return
  guestGain = audioCtx.createGain()
  guestAnalyser = audioCtx.createAnalyser()
  guestAnalyser.fftSize = 1024
  guestGain.connect(destination)
  guestGain.connect(audioCtx.destination)
  guestGain.connect(guestAnalyser)
}

function attachGuestStream(stream) {
  if (guestStream !== stream || !audioCtx || !guestGain) return
  if (guestStreamSource) guestStreamSource.disconnect()
  // The element has to be playing or Chrome never delivers this remote track.
  // The samples themselves come from the stream, not from the element.
  guestStreamSource = audioCtx.createMediaStreamSource(stream)
  guestStreamSource.connect(guestGain)
}

function mixCaller(stream) {
  if (!audioCtx || guestStream === stream) return
  guestStream = stream
  ensureGuestBus()
  writeGuestGain()
  guestPlayer.volume = 0
  guestPlayer.srcObject = stream
  guestPlayer.play().then(() => attachGuestStream(stream)).catch(() => {})
  stream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (guestStream === stream) releaseGuest(false)
    })
  })
}

function writeGuestGain() {
  if (!guestGain || !audioCtx) return
  const now = audioCtx.currentTime
  guestGain.gain.cancelScheduledValues(now)
  guestGain.gain.setValueAtTime(Number(guestGainInput.value) / 100, now)
}

function unmixCaller() {
  guestPlayer.pause()
  guestPlayer.srcObject = null
  if (guestStreamSource) {
    guestStreamSource.disconnect()
    guestStreamSource = null
  }
  guestStream = null
}

function releaseGuest(tellCaller) {
  const peerId = guestPeerId
  unmixCaller()
  guestPeerId = null
  heldCaller = null
  guestOn.hidden = true
  guestWho.textContent = ''
  if (callCode) {
    guestNote.textContent = room
      ? 'Send this link to one caller.'
      : 'Send this link. They connect once you go live.'
  }
  if (tellCaller && peerId) {
    callerAction?.send({ kind: 'drop' }, { target: peerId }).catch(() => {})
  }
  if (room && statusAction) publish()
}

function release() {
  window.clearInterval(pulse)
  cancelAnimationFrame(raf)
  micFade.hold(Number(micGainInput.value))
  musicFade.hold(Number(musicGainInput.value))
  micStream?.getTracks().forEach((track) => track.stop())
  displayStream?.getTracks().forEach((track) => track.stop())
  releaseGuest(false)
  studioChat.detach()
  room?.leave()
  audioCtx?.close()
}

import { castMime, openCast } from './cast.js'
import { mountStudioChat } from './chat.js'
import { harborUrl, joinRoom, roomId, roomOptions, sourceUser } from './config.js'
import { deckActionName, deckRoomId } from './deck.js'
import { readMount } from './stream.js'

const air = document.querySelector('#air')
const goLiveBtn = document.querySelector('#go-live')
const phonesBtn = document.querySelector('#phones')
const passwordInput = document.querySelector('#password')
const micBtn = document.querySelector('#mic')
const musicBtn = document.querySelector('#music')
const micGainInput = document.querySelector('#mic-gain')
const musicGainInput = document.querySelector('#music-gain')
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
const remoteUrlInput = document.querySelector('#remote-url')
const remoteNote = document.querySelector('#remote-note')
const devicePlayer = document.querySelector('#device-mic')
const micSourceNote = document.querySelector('#mic-source')
const statusEl = document.querySelector('#status')
const listenersEl = document.querySelector('#listeners')

let audioCtx
let destination
let phones
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
let deckOn = false
let deckRoom = null
let deckAction = null
let deckPeerId = null
let deckPulse = 0
let deviceMicStream = null
let deviceMicSource = null
let heldDeviceMic = null
let meterPulse = 0
let cast = null
let onAir = false
let castRetries = 0
let listenerPoll = 0
let quietPolls = 0
const PASSWORD_KEY = 'radio-vainer-password'
const PHONES_KEY = 'radio-vainer-phones'
const deckSample = new Uint8Array(1024)
const deckWaiting = 'Open this page on your phone.'
let monitor = null
let pulse
let wakeLock
let raf = 0
let micBusy = false
let musicBusy = false
let starting = false
let broadcastEpoch = 0
let autoOn = false
let talking = false
let loudSince = 0
let quietSince = 0

if (devicePlayer) devicePlayer.playsInline = true
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
  sendDeckState()
})

musicGainInput.addEventListener('input', () => {
  musicFade.hold(Number(musicGainInput.value))
  clearMixMode()
  sendDeckState()
})

speakBtn.addEventListener('click', () => { speak() })
playBtn.addEventListener('click', () => { play() })
autoBtn.addEventListener('click', () => { setAuto(!autoOn) })

messageInput.addEventListener('input', () => {
  if (onAir) publish()
  sendDeckState()
})

const savedPassword = localStorage.getItem(PASSWORD_KEY)
if (savedPassword) passwordInput.value = savedPassword
if (localStorage.getItem(PHONES_KEY) === '0') {
  phonesBtn.setAttribute('aria-pressed', 'false')
}

phonesBtn.addEventListener('click', () => {
  setPhones(phonesBtn.getAttribute('aria-pressed') !== 'true')
})

goLiveBtn.addEventListener('click', () => {
  unlockAudio()
  if (onAir) stopBroadcast()
  else startBroadcast()
})

guestInviteBtn.addEventListener('click', createCallLink)
guestCopyBtn.addEventListener('click', () => copyLink(guestUrlInput, guestCopyBtn))
window.addEventListener('pointerdown', () => { unlockAudio() })
guestDropBtn.addEventListener('click', () => releaseGuest(true))
guestGainInput.addEventListener('input', () => {
  showLevel(guestGainInput)
  writeGuestGain()
  sendDeckState()
})
showLevel(guestGainInput)
pinComposer(document.querySelector('#studio-chat-form'))

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (onAir || deckOn)) keepAwake()
})

window.addEventListener('pagehide', release)

const deviceMicBlocked = 'Click this studio tab once so the phone mic can come through.'

function unlockAudio() {
  ensureGraph()
  audioCtx.resume().then(() => {
    if (audioCtx.state === 'running') clearDeviceMicBlocked()
  }).catch(() => {})
  resumeDevicePlayer()
  keepAwake()
}

function resumeDevicePlayer() {
  if (!devicePlayer) return
  devicePlayer.playsInline = true
  devicePlayer.volume = 0
  if (deviceMicStream) {
    if (!deviceMicSource) {
      if (devicePlayer.srcObject !== deviceMicStream) devicePlayer.srcObject = deviceMicStream
      devicePlayer.play().then(() => {
        attachDeviceMic(deviceMicStream)
        clearDeviceMicBlocked()
      }).catch(() => {
        showDeviceMicBlocked()
      })
    }
    return
  }
  // A click has to start this element once, or Chrome never delivers the phone track.
  if (!devicePlayer.srcObject) devicePlayer.srcObject = new MediaStream()
  if (devicePlayer.paused) devicePlayer.play().catch(() => {})
}

function showDeviceMicBlocked() {
  if (deckPeerId) remoteNote.textContent = deviceMicBlocked
}

function clearDeviceMicBlocked() {
  if (deckPeerId && remoteNote.textContent === deviceMicBlocked) {
    remoteNote.textContent = 'Phone is connected.'
  }
}

async function runningAudio() {
  ensureGraph()
  let rejected = false
  const resume = audioCtx.resume().catch(() => { rejected = true })
  await Promise.race([resume, wait(1500)])
  if (rejected || audioCtx.state !== 'running') {
    setStatus('Click this tab once so the browser will allow the broadcast.')
    return false
  }
  return true
}

function phonesWanted() {
  return phonesBtn.getAttribute('aria-pressed') === 'true'
}

function setPhones(on) {
  phonesBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  localStorage.setItem(PHONES_KEY, on ? '1' : '0')
  if (phones) phones.gain.value = on ? 1 : 0
}

function ensureGraph() {
  if (audioCtx) return
  audioCtx = new AudioContext()
  destination = audioCtx.createMediaStreamDestination()
  phones = audioCtx.createGain()
  phones.gain.value = phonesWanted() ? 1 : 0
  phones.connect(audioCtx.destination)
  // Chrome does not render this destination track until a source is connected,
  // so the encoder would send a dead track. Silence keeps the track rendering.
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
  try {
    if (!await runningAudio()) return
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

  ensureMicBus()
  micSource = audioCtx.createMediaStreamSource(micStream)
  micSource.connect(voiceAnalyser)
  micSource.connect(micGain)
  micStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', stopMic)
  })
  micBtn.setAttribute('aria-pressed', 'true')
  setStatus('')
  sendDeckState()
}

function ensureMicBus() {
  if (micGain || !audioCtx) return
  micGain = audioCtx.createGain()
  micFade.apply(micGain)
  micAnalyser = audioCtx.createAnalyser()
  micAnalyser.fftSize = 1024
  voiceAnalyser = audioCtx.createAnalyser()
  voiceAnalyser.fftSize = 1024
  micGain.connect(destination)
  micGain.connect(monitor)
  micGain.connect(phones)
  micGain.connect(micAnalyser)
}

function releaseMicBus() {
  micGain?.disconnect()
  micGain = null
  micAnalyser = null
  voiceAnalyser = null
  talking = false
  loudSince = 0
  quietSince = 0
}

function stopMic() {
  micStream?.getTracks().forEach((track) => track.stop())
  micSource?.disconnect()
  micStream = null
  micSource = null
  micBtn.setAttribute('aria-pressed', 'false')
  sendDeckState()
  if (deviceMicSource || deviceMicStream) return
  if (autoOn) setAuto(false)
  releaseMicBus()
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
  musicGain.connect(phones)
  musicGain.connect(musicAnalyser)
  musicBtn.setAttribute('aria-pressed', 'true')
  setStatus('Music is in the mix. Listeners do not see the screen.')
  sendDeckState()
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
  sendDeckState()
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

function hostLine() {
  return messageInput.value.trim().slice(0, 140)
}

function beginCast(epoch) {
  const mime = castMime()
  if (!mime) return null
  const next = openCast({
    url: harborUrl(),
    user: sourceUser,
    password: passwordInput.value,
    stream: destination.stream,
    mime,
    sampleRate: audioCtx.sampleRate,
    onClose() {
      if (epoch !== broadcastEpoch || !onAir) return
      lostCast(epoch)
    }
  })
  return next
}

function lostCast(epoch) {
  if (epoch !== broadcastEpoch || !onAir || starting) return
  castRetries += 1
  if (castRetries > 2) {
    stopBroadcast('The station server dropped the show.')
    return
  }
  setStatus('Reconnecting the show.')
  const previous = cast
  cast = null
  previous?.stop()
  const next = beginCast(epoch)
  if (!next) {
    stopBroadcast('Open the studio in Chrome or Edge to send the show.')
    return
  }
  cast = next
  next.ready.then(() => {
    if (epoch !== broadcastEpoch) return
    castRetries = 0
    next.setTitle(hostLine())
    setStatus('')
  }).catch(() => {
    if (epoch !== broadcastEpoch) return
    lostCast(epoch)
  })
}

async function startBroadcast() {
  if (onAir || starting) return
  const password = passwordInput.value
  if (!password) {
    setStatus('Enter the station password. A new server uses changeme.')
    passwordInput.focus()
    return
  }
  localStorage.setItem(PASSWORD_KEY, password)
  starting = true
  const epoch = broadcastEpoch
  try {
    ensureGraph()
    unlockGuestPlayer()
    if (!await runningAudio()) return
    if (epoch !== broadcastEpoch || onAir) return
    const mime = castMime()
    if (!mime) {
      setStatus('Open the studio in Chrome or Edge to send the show.')
      return
    }
    castRetries = 0
    quietPolls = 0
    cast = beginCast(epoch)
    try {
      await cast.ready
    } catch (err) {
      cast?.stop()
      cast = null
      if (err?.message === 'encode') {
        setStatus('This browser could not encode the show. Open the studio in Chrome or Edge.')
      } else if (err?.message === 'refused') {
        setStatus('The station refused that password.')
      } else {
        setStatus('The station server is not reachable. Start it, then go live again.')
      }
      return
    }
    if (epoch !== broadcastEpoch) {
      cast?.stop()
      cast = null
      return
    }
    onAir = true
    cast.setTitle(hostLine())
    room = joinRoom(roomOptions(), roomId, {
      onJoinError() {
        setStatus('Chat could not connect. The show is still on the stream.')
      }
    })
    statusAction = room.makeAction('status')
    callerAction = room.makeAction('caller')
    callerAction.onMessage = (data, { peerId }) => {
      if (!data) return
      if (data.kind === 'hello') acceptCaller(peerId, data)
      else if (data.kind === 'bye' && peerId === guestPeerId) releaseGuest(false)
    }
    room.onPeerJoin = (peerId) => {
      if (peerId === guestPeerId) sendCallerReturn(peerId)
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
    studioChat.attach(room)

    goLiveBtn.textContent = 'Stop broadcast'
    goLiveBtn.setAttribute('aria-pressed', 'true')
    setOnAir(true)
    publish()
    pulse = window.setInterval(() => publish(), 3000)
    listenerPoll = window.setInterval(pollListeners, 3000)
    pollListeners()
    keepAwake()
    document.title = '● On air · Radio Vainer'
    if (callCode && !guestPeerId) {
      guestNote.textContent = 'Send this link to one caller.'
    }
    if (!micStream && !displayStream && !deviceMicSource) {
      setStatus('You are live. Turn on the microphone or capture music so there is something to hear.')
    }
  } finally {
    starting = false
  }
}

async function stopBroadcast(reason) {
  broadcastEpoch += 1
  onAir = false
  castRetries = 0
  quietPolls = 0
  window.clearInterval(pulse)
  window.clearInterval(listenerPoll)
  pulse = null
  listenerPoll = 0
  const current = cast
  cast = null
  current?.stop()
  try {
    await statusAction?.send({ role: 'host', live: false, title: '', message: '' })
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
  setStatus(typeof reason === 'string' && reason ? reason : 'Broadcast stopped.')
  sendDeckState()
}

async function pollListeners() {
  if (!onAir) return
  let mount = null
  try {
    mount = await readMount()
  } catch {
    return
  }
  if (!mount) {
    quietPolls += 1
    if (quietPolls === 5) {
      setStatus('The show is connected, and the public stream is not up yet.')
    }
    return
  }
  quietPolls = 0
  if (statusEl.textContent === 'The show is connected, and the public stream is not up yet.') {
    setStatus('')
  }
  const count = Number(mount.listeners) || 0
  listenersEl.textContent = count === 0
    ? 'No listeners yet'
    : count === 1
      ? '1 listening'
      : `${count} listening`
}

function publish(target) {
  const message = hostLine()
  cast?.setTitle(message)
  if (!statusAction || !room) return
  const payload = { role: 'host', live: true, title: '', message }
  const options = target ? { target } : undefined
  statusAction.send(payload, options).catch(() => {})
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

async function speak(fromDevice = false) {
  setMixMode('speak')
  if (musicGain) musicFade.fadeOut()
  if (fromDevice) {
    ensureGraph()
    try { await audioCtx.resume() } catch { /* the next click unlocks it */ }
    ensureMicBus()
  } else if (!micStream && !deviceMicSource && !deviceMicStream && !heldDeviceMic) {
    await startMic()
  }
  if (micGain) micFade.fadeIn()
  sendDeckState()
}

function play() {
  setMixMode('play')
  if (micGain) micFade.fadeOut()
  if (musicGain) musicFade.fadeIn()
  sendDeckState()
}

async function setAuto(on) {
  autoOn = on
  autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  talking = false
  loudSince = 0
  quietSince = 0
  sendDeckState()
  if (!on) return
  if (micStream || deviceMicSource || deviceMicStream || heldDeviceMic) return
  await startMic()
  if (!micStream && !deviceMicSource && !deviceMicStream) {
    autoOn = false
    autoBtn.setAttribute('aria-pressed', 'false')
    sendDeckState()
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

function copyLink(input, button) {
  const link = input.value
  if (!link) return
  const finish = (label) => {
    button.textContent = label
    window.setTimeout(() => {
      if (button.textContent === label) button.textContent = 'Copy'
    }, 1600)
  }
  try {
    navigator.clipboard.writeText(link).then(() => {
      finish('Copied')
    }).catch(() => {
      input.focus()
      input.select()
      finish('Select the link')
    })
  } catch {
    input.focus()
    input.select()
    finish('Select the link')
  }
}

function showDeckLink() {
  const url = new URL('remote.html', location.href)
  url.search = ''
  url.hash = ''
  remoteUrlInput.value = url.href
  keepAwake()
}

// The phone talks on its own room. Listeners never join it,
// and the studio answers as soon as this page is open.
function joinDeck() {
  if (deckRoom) return
  deckOn = true
  deckRoom = joinRoom(roomOptions(), deckRoomId, {
    onJoinError() {
      remoteNote.textContent = 'The remote could not connect. Refresh this tab.'
    }
  })
  deckAction = deckRoom.makeAction(deckActionName)
  deckAction.onMessage = (data, { peerId }) => { onDeckMessage(data, peerId) }
  deckRoom.onPeerStream = (stream, peerId, metadata) => {
    if (metadata?.role !== 'mic') return
    if (deckPeerId && peerId !== deckPeerId) return
    heldDeviceMic = { stream, peerId }
    if (deckPeerId === peerId) mixDeviceMic(stream)
  }
  deckRoom.onPeerLeave = (peerId) => {
    if (peerId !== deckPeerId) return
    clearDeckPeer()
  }
  remoteNote.textContent = deckWaiting
  keepAwake()
}

function leaveDeck() {
  unmixDeviceMic()
  stopDeckPulse()
  deckPeerId = null
  const current = deckRoom
  deckRoom = null
  deckAction = null
  try { current?.leave() } catch { /* already gone */ }
}

function clearDeckPeer() {
  unmixDeviceMic()
  deckPeerId = null
  stopDeckPulse()
  if (deckOn) remoteNote.textContent = deckWaiting
}

function onDeckMessage(data, peerId) {
  if (!data || typeof data.kind !== 'string') return
  if (data.role !== 'remote') return
  if (data.kind === 'hello') {
    if (deckPeerId && deckPeerId !== peerId) {
      deckAction?.send({ kind: 'busy', role: 'studio' }, { target: peerId }).catch(() => {})
      return
    }
    const fresh = deckPeerId !== peerId
    deckPeerId = peerId
    if (heldDeviceMic?.peerId && heldDeviceMic.peerId !== peerId) heldDeviceMic = null
    if (heldDeviceMic?.peerId === peerId) mixDeviceMic(heldDeviceMic.stream)
    if (fresh) {
      remoteNote.textContent = 'Phone is connected.'
      startDeckPulse()
    }
    sendDeckState()
    return
  }
  if (peerId !== deckPeerId) return
  if (data.kind === 'bye') {
    clearDeckPeer()
    return
  }
  applyDeckCommand(data).then(() => sendDeckState()).catch(() => {})
}

function mixDeviceMic(stream) {
  if (!stream || !devicePlayer) return
  const audioTracks = stream.getAudioTracks()
  if (!audioTracks.length || audioTracks.every((track) => track.readyState === 'ended')) return
  if (deviceMicStream === stream) {
    if (deviceMicSource) return
    devicePlayer.play().then(() => {
      attachDeviceMic(stream)
      clearDeviceMicBlocked()
      sendDeckState()
    }).catch(() => {
      if (deviceMicStream === stream) showDeviceMicBlocked()
    })
    return
  }
  ensureGraph()
  audioCtx.resume().then(() => {
    if (audioCtx.state !== 'running' && deviceMicStream === stream) showDeviceMicBlocked()
  }).catch(() => {})
  if (deviceMicStream && deviceMicStream !== stream) {
    deviceMicSource?.disconnect()
    deviceMicSource = null
  }
  deviceMicStream = stream
  ensureMicBus()
  if (micSourceNote) micSourceNote.hidden = false
  devicePlayer.volume = 0
  if (devicePlayer.srcObject !== stream) devicePlayer.srcObject = stream
  // The element has to be playing or Chrome never delivers this remote track.
  devicePlayer.play().then(() => {
    attachDeviceMic(stream)
    clearDeviceMicBlocked()
    sendDeckState()
  }).catch(() => {
    if (deviceMicStream === stream) showDeviceMicBlocked()
  })
  audioTracks.forEach((track) => {
    track.addEventListener('ended', () => {
      if (deviceMicStream !== stream) return
      unmixDeviceMic()
      sendDeckState()
    })
  })
}

function attachDeviceMic(stream) {
  if (deviceMicStream !== stream || !audioCtx || !micGain || !voiceAnalyser) return
  deviceMicSource?.disconnect()
  deviceMicSource = audioCtx.createMediaStreamSource(stream)
  deviceMicSource.connect(voiceAnalyser)
  deviceMicSource.connect(micGain)
}

function unmixDeviceMic() {
  heldDeviceMic = null
  deviceMicStream = null
  if (devicePlayer) {
    devicePlayer.pause()
    devicePlayer.srcObject = null
  }
  deviceMicSource?.disconnect()
  deviceMicSource = null
  if (micSourceNote) micSourceNote.hidden = true
  if (micStream) return
  if (autoOn) setAuto(false)
  releaseMicBus()
}

async function applyDeckCommand(data) {
  if (data.kind === 'mic') {
    if (data.on === true && heldDeviceMic?.peerId === deckPeerId) mixDeviceMic(heldDeviceMic.stream)
    else if (data.on === false) unmixDeviceMic()
    return
  }
  if (data.kind === 'level') {
    const value = clampLevel(data.value)
    if (value === null) return
    if (data.channel === 'mic') {
      micGainInput.value = String(value)
      micFade.hold(value)
      clearMixMode()
    } else if (data.channel === 'music') {
      musicGainInput.value = String(value)
      musicFade.hold(value)
      clearMixMode()
    } else if (data.channel === 'guest') {
      guestGainInput.value = String(value)
      showLevel(guestGainInput)
      writeGuestGain()
    }
    return
  }
  if (data.kind === 'speak') {
    if (heldDeviceMic?.peerId === deckPeerId) mixDeviceMic(heldDeviceMic.stream)
    await speak(true)
    return
  }
  if (data.kind === 'play') {
    play()
    return
  }
  if (data.kind === 'message') {
    if (typeof data.text !== 'string') return
    messageInput.value = data.text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 140)
    if (room) publish()
    return
  }
  if (data.kind === 'drop' && guestPeerId) releaseGuest(true)
}

function sendDeckState() {
  if (!deckAction || !deckPeerId) return
  deckAction.send(deckSnapshot(), { target: deckPeerId }).catch(() => {})
}

function startDeckPulse() {
  if (!deckPulse) deckPulse = window.setInterval(sendDeckState, 2000)
  if (!meterPulse) meterPulse = window.setInterval(sendDeckMeters, 200)
}

function stopDeckPulse() {
  window.clearInterval(deckPulse)
  window.clearInterval(meterPulse)
  deckPulse = 0
  meterPulse = 0
}

function sendDeckMeters() {
  if (!deckAction || !deckPeerId) return
  deckAction.send({
    kind: 'meters',
    role: 'studio',
    mic: meterOf(micAnalyser),
    music: meterOf(musicAnalyser),
    guest: meterOf(guestAnalyser)
  }, { target: deckPeerId }).catch(() => {})
}

function deckSnapshot() {
  return {
    kind: 'state',
    role: 'studio',
    live: !!room,
    musicOn: !!displayStream,
    guestOn: !!guestPeerId,
    guestName: guestPeerId ? guestWho.textContent : '',
    micLevel: Number(micGainInput.value),
    musicLevel: Number(musicGainInput.value),
    guestLevel: Number(guestGainInput.value),
    mode: mixMode(),
    message: messageInput.value,
    status: statusEl.textContent
  }
}

function meterOf(analyserNode) {
  if (!analyserNode) return 0
  return Math.round(signalLevel(analyserNode, deckSample) * 100) / 100
}

function mixMode() {
  if (speakBtn.getAttribute('aria-pressed') === 'true') return 'speak'
  if (playBtn.getAttribute('aria-pressed') === 'true') return 'play'
  return ''
}

function clampLevel(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(150, Math.max(0, n))
}

function wait(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms) })
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
  sendDeckState()
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
  guestGain.connect(phones)
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
  sendDeckState()
}

function release() {
  broadcastEpoch += 1
  onAir = false
  const current = cast
  cast = null
  current?.stop()
  leaveDeck()
  window.clearInterval(pulse)
  window.clearInterval(listenerPoll)
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

showDeckLink()
joinDeck()

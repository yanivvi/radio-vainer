import { suggestName } from './names.js'
import { cleanPicture, pictureElement, pictures, suggestPicture } from './pictures.js'

const MAX_LOG = 40
const STUDIO_NAME = 'Studio'

// Listeners join passively, so they only connect to the studio.
// The studio relays every message and is the only peer who can moderate.

export function mountListenerChat({ room, getHostId, claimHost }) {
  const gate = document.querySelector('#chat-gate')
  const live = document.querySelector('#chat-live')
  const nameInput = document.querySelector('#chat-name')
  const pictureRow = document.querySelector('#chat-pictures')
  const suggestBtn = document.querySelector('#chat-suggest')
  const you = document.querySelector('#chat-you')
  const youPicture = document.querySelector('#chat-you-picture')
  const empty = document.querySelector('#chat-empty')
  const log = document.querySelector('#chat-log')
  const scroll = document.querySelector('#chat-scroll')
  const form = document.querySelector('#chat-form')
  const textInput = document.querySelector('#chat-text')
  const leaveBtn = document.querySelector('#chat-leave')
  const note = document.querySelector('#chat-note')

  const action = room.makeAction('chat')
  const messages = []
  const seen = new Set()
  const dropped = new Set()
  let name = ''
  let picture = suggestPicture()
  let started = false
  let announced = false
  let booted = false

  nameInput.value = suggestName()
  const pictureChoices = new Map()
  for (const item of pictures) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'picture-choice'
    button.setAttribute('aria-label', item.label)
    button.setAttribute('aria-pressed', item.id === picture ? 'true' : 'false')
    button.append(pictureElement(item.id))
    button.addEventListener('click', () => {
      picture = item.id
      for (const [id, choice] of pictureChoices) {
        choice.setAttribute('aria-pressed', id === picture ? 'true' : 'false')
      }
    })
    pictureChoices.set(item.id, button)
    pictureRow.append(button)
  }

  suggestBtn.addEventListener('click', () => {
    nameInput.value = suggestName()
    nameInput.focus()
  })

  gate.addEventListener('submit', (event) => {
    event.preventDefault()
    if (booted) return
    const chosen = cleanName(nameInput.value)
    if (!chosen) {
      setNote(nameInput.value.trim().toLowerCase() === 'studio'
        ? 'That name is reserved for the studio.'
        : 'Choose a name.')
      nameInput.focus()
      return
    }
    name = chosen
    picture = cleanPicture(picture)
    started = true
    announced = false
    gate.hidden = true
    live.hidden = false
    you.textContent = name
    youPicture.replaceChildren(pictureElement(picture))
    setNote(getHostId() ? '' : 'Waiting for the studio.')
    paintAll()
    sendJoin()
    textInput.focus()
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!started || booted) return
    const text = cleanText(textInput.value)
    if (!text) return
    if (!getHostId()) {
      setNote('The studio is not here yet.')
      return
    }
    const message = { id: makeId(), name, text, admin: false, picture }
    addMessage(message)
    action.send({ kind: 'say', id: message.id, name, text, picture }).catch(() => {
      setNote('Could not send. Try again.')
    })
    textInput.value = ''
  })

  leaveBtn.addEventListener('click', () => {
    if (getHostId()) action.send({ kind: 'leave' }).catch(() => {})
    started = false
    announced = false
    clearMessages()
    live.hidden = true
    gate.hidden = false
    setNote('')
    nameInput.focus()
  })

  action.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    if (!claimHost(peerId)) return
    if (data.kind === 'log' && Array.isArray(data.messages)) {
      mergeLog(data.messages)
      return
    }
    if (data.kind === 'said') {
      addMessage(data)
      return
    }
    if (data.kind === 'drop') {
      forget(cleanId(data.id))
      return
    }
    if (data.kind === 'boot') {
      booted = true
      started = false
      announced = false
      clearMessages()
      live.hidden = true
      gate.hidden = false
      nameInput.disabled = true
      suggestBtn.hidden = true
      setPicturesDisabled(true)
      gate.querySelector('button[type="submit"]').hidden = true
      setNote('The studio removed you from the chat.')
    }
  }

  return {
    hostHere() {
      if (!started || booted || announced) return
      setNote('')
      sendJoin()
    },
    hostLeft() {
      announced = false
      booted = false
      dropped.clear()
      nameInput.disabled = false
      suggestBtn.hidden = false
      setPicturesDisabled(false)
      gate.querySelector('button[type="submit"]').hidden = false
      clearMessages()
      setNote(started ? 'The studio left. The chat returns when it is back.' : '')
    }
  }

  function sendJoin() {
    if (!started || booted || !getHostId()) return
    announced = true
    action.send({ kind: 'join', name, picture }).catch(() => {
      announced = false
    })
  }

  function mergeLog(incoming) {
    const history = []
    const historyIds = new Set()
    for (const raw of incoming.slice(-MAX_LOG)) {
      const message = normalize(raw)
      if (!message || historyIds.has(message.id) || dropped.has(message.id)) continue
      historyIds.add(message.id)
      history.push(message)
    }
    const extras = messages.filter((message) => !historyIds.has(message.id))
    messages.length = 0
    seen.clear()
    for (const message of history.concat(extras)) {
      seen.add(message.id)
      messages.push(message)
    }
    trim()
    if (started) paintAll()
  }

  function addMessage(raw) {
    const message = normalize(raw)
    if (!message || dropped.has(message.id) || seen.has(message.id)) return
    seen.add(message.id)
    messages.push(message)
    trim()
    if (started) paint(message)
  }

  function paintAll() {
    log.replaceChildren()
    messages.forEach(paint)
    syncEmpty()
  }

  function paint(message) {
    log.append(renderMessage(message))
    syncEmpty()
    scroll.scrollTop = scroll.scrollHeight
  }

  function forget(id) {
    if (!id) return
    dropped.add(id)
    if (!seen.has(id)) return
    seen.delete(id)
    const index = messages.findIndex((message) => message.id === id)
    if (index !== -1) messages.splice(index, 1)
    log.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
    syncEmpty()
  }

  function trim() {
    while (messages.length > MAX_LOG) {
      const old = messages.shift()
      seen.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
  }

  function clearMessages() {
    messages.length = 0
    seen.clear()
    log.replaceChildren()
    syncEmpty()
  }

  function syncEmpty() {
    empty.hidden = log.childElementCount > 0
  }

  function setNote(message) {
    note.textContent = message
  }

  function setPicturesDisabled(disabled) {
    for (const choice of pictureChoices.values()) choice.disabled = disabled
  }
}

export function mountStudioChat() {
  const live = document.querySelector('#studio-chat-live')
  const empty = document.querySelector('#studio-chat-empty')
  const log = document.querySelector('#studio-chat-log')
  const scroll = document.querySelector('#studio-chat-scroll')
  const form = document.querySelector('#studio-chat-form')
  const textInput = document.querySelector('#studio-chat-text')
  const peopleEl = document.querySelector('#studio-chat-people')
  const note = document.querySelector('#studio-chat-note')

  const messages = []
  const seen = new Set()
  const people = new Map()
  const booted = new Set()
  let action = null

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!action) return
    const text = cleanText(textInput.value)
    if (!text) return
    const message = { id: makeId(), name: STUDIO_NAME, text, admin: true, picture: 'studio' }
    remember(message)
    relay(message)
    textInput.value = ''
    textInput.focus()
  })

  return {
    attach(room) {
      action = room.makeAction('chat')
      live.hidden = false
      note.textContent = ''
      renderPeople()
      action.onMessage = (data, { peerId }) => {
        if (!data || typeof data !== 'object') return
        if (data.kind === 'join') {
          if (welcome(peerId, data.name, data.picture)) sendLog(peerId)
          return
        }
        if (data.kind === 'leave') {
          people.delete(peerId)
          renderPeople()
          return
        }
        if (data.kind === 'say') acceptSay(peerId, data)
      }
    },
    detach() {
      action = null
      messages.length = 0
      seen.clear()
      people.clear()
      booted.clear()
      log.replaceChildren()
      peopleEl.replaceChildren()
      textInput.value = ''
      empty.hidden = false
      live.hidden = true
      note.textContent = 'Go live to open the chat.'
    },
    peerLeft(peerId) {
      if (!people.has(peerId)) return
      people.delete(peerId)
      renderPeople()
    }
  }

  function welcome(peerId, rawName, rawPicture) {
    if (booted.has(peerId)) {
      action.send({ kind: 'boot' }, { target: peerId }).catch(() => {})
      return false
    }
    const name = cleanName(rawName)
    if (!name) return false
    people.set(peerId, { name, picture: cleanPicture(rawPicture) })
    renderPeople()
    return true
  }

  function acceptSay(peerId, data) {
    const name = cleanName(data.name)
    const text = cleanText(data.text)
    const id = cleanId(data.id)
    if (!name || !text || !id) return
    const isNew = !people.has(peerId)
    const picture = cleanPicture(data.picture)
    if (!welcome(peerId, name, picture)) return
    if (seen.has(id)) return
    remember({ id, name, text, admin: false, picture })
    relay({ id, name, text, admin: false, picture })
    if (isNew) sendLog(peerId)
  }

  function remember(message) {
    seen.add(message.id)
    messages.push(message)
    while (messages.length > MAX_LOG) {
      const old = messages.shift()
      seen.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
    log.append(renderMessage(message, drop))
    empty.hidden = true
    scroll.scrollTop = scroll.scrollHeight
  }

  function relay(message) {
    action?.send({
      kind: 'said',
      id: message.id,
      name: message.name,
      text: message.text,
      admin: message.admin,
      picture: message.picture
    }).catch(() => {})
  }

  function sendLog(peerId) {
    action?.send({
      kind: 'log',
      messages: messages.map(({ id, name, text, admin, picture }) => ({ id, name, text, admin, picture }))
    }, { target: peerId }).catch(() => {})
  }

  function drop(id) {
    if (!seen.has(id)) return
    seen.delete(id)
    const index = messages.findIndex((message) => message.id === id)
    if (index !== -1) messages.splice(index, 1)
    log.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
    empty.hidden = log.childElementCount > 0
    action?.send({ kind: 'drop', id }).catch(() => {})
  }

  function boot(peerId) {
    booted.add(peerId)
    people.delete(peerId)
    renderPeople()
    action?.send({ kind: 'boot' }, { target: peerId }).catch(() => {})
  }

  function renderPeople() {
    peopleEl.replaceChildren()
    if (people.size === 0) {
      const emptyPeople = document.createElement('p')
      emptyPeople.className = 'chat-empty'
      emptyPeople.textContent = 'Nobody has joined yet.'
      peopleEl.append(emptyPeople)
      return
    }
    for (const [peerId, person] of people) {
      const row = document.createElement('div')
      row.className = 'chat-person'
      const who = document.createElement('span')
      who.className = 'chat-person-id'
      const face = document.createElement('span')
      face.className = 'chat-picture'
      face.append(pictureElement(person.picture))
      const label = document.createElement('span')
      label.className = 'chat-person-label'
      label.textContent = person.name
      who.append(face, label)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'chat-mini'
      remove.textContent = 'Remove'
      remove.setAttribute('aria-label', `Remove ${person.name} from the chat`)
      remove.addEventListener('click', () => boot(peerId))
      row.append(who, remove)
      peopleEl.append(row)
    }
  }
}

function renderMessage(message, onRemove) {
  const item = document.createElement('li')
  item.className = message.admin ? 'chat-msg admin' : 'chat-msg'
  item.dataset.id = message.id

  const who = document.createElement('span')
  who.className = 'chat-name'
  const face = document.createElement('span')
  face.className = 'chat-picture'
  face.append(pictureElement(message.admin ? 'studio' : message.picture))
  who.append(face, document.createTextNode(message.admin ? STUDIO_NAME : message.name))
  if (message.admin) {
    const badge = document.createElement('span')
    badge.className = 'chat-badge'
    badge.textContent = 'Admin'
    who.append(badge)
  }

  const body = document.createElement('p')
  body.className = 'chat-text'
  body.textContent = message.text
  item.append(who, body)

  if (onRemove) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'chat-mini'
    remove.textContent = 'Remove'
    const speaker = message.admin ? STUDIO_NAME : message.name
    remove.setAttribute('aria-label', `Remove message from ${speaker}`)
    remove.addEventListener('click', () => onRemove(message.id))
    item.append(remove)
  }

  return item
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  const text = cleanText(raw.text)
  const admin = Boolean(raw.admin)
  const name = admin ? STUDIO_NAME : cleanName(raw.name)
  if (!id || !text || !name) return null
  return { id, name, text, admin, picture: admin ? 'studio' : cleanPicture(raw.picture) }
}

function cleanName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
  if (!name || name.toLowerCase() === 'studio') return ''
  return name
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 280)
}

function cleanId(value) {
  const id = String(value ?? '')
  return /^[\w-]{8,40}$/.test(id) ? id : ''
}

function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

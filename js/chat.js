import { suggestName } from './names.js'
import { cleanPicture, pictureElement, pictures, suggestPicture } from './pictures.js'

const MAX_LOG = 40
const CHAT_HOLD_MS = 20000
const STUDIO_NAME = 'Studio'
const REACTIONS = ['♥', '👍', '😂']

// Listeners join passively, so they only connect to the studio.
// The studio relays every message.

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
  const peopleEl = document.querySelector('#chat-people')

  const action = room.makeAction('chat')
  const messages = []
  const seen = new Set()
  const dropped = new Set()
  const mine = new Map()
  let name = ''
  let picture = suggestPicture()
  let started = false
  let announced = false
  let holdTimer = 0

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
    if (!started) return
    const text = cleanText(textInput.value)
    if (!text) return
    if (!getHostId()) {
      setNote('The studio is not here yet.')
      return
    }
    const message = { id: makeId(), name, text, admin: false, picture, at: Date.now(), reactions: {} }
    addMessage(message)
    action.send({ kind: 'say', id: message.id, name, text, picture, at: message.at }).catch(() => {
      setNote('Could not send. Try again.')
    })
    textInput.value = ''
  })

  leaveBtn.addEventListener('click', () => {
    if (getHostId()) action.send({ kind: 'leave' }).catch(() => {})
    started = false
    announced = false
    window.clearTimeout(holdTimer)
    holdTimer = 0
    clearMessages()
    renderPeopleList(peopleEl, [])
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
    if (data.kind === 'reacted') {
      applyReactions(cleanId(data.id), data.reactions)
      return
    }
    if (data.kind === 'people' && Array.isArray(data.people)) {
      renderPeopleList(peopleEl, data.people)
      return
    }
    if (data.kind === 'drop') forget(cleanId(data.id))
  }

  return {
    hostHere() {
      window.clearTimeout(holdTimer)
      holdTimer = 0
      if (!started || announced) return
      setNote('')
      sendJoin()
    },
    hostLeft(immediate) {
      announced = false
      renderPeopleList(peopleEl, [])
      window.clearTimeout(holdTimer)
      holdTimer = 0
      setNote(started ? 'The studio left. The chat returns when it is back.' : '')
      if (immediate) wipe()
      else holdTimer = window.setTimeout(wipe, CHAT_HOLD_MS)
    }
  }

  function wipe() {
    holdTimer = 0
    dropped.clear()
    mine.clear()
    clearMessages()
    renderPeopleList(peopleEl, [])
  }

  function sendJoin() {
    if (!started || !getHostId()) return
    announced = true
    action.send({ kind: 'join', name, picture }).catch(() => {
      announced = false
    })
  }

  function listenerHooks() {
    return {
      mine,
      onReact(id, emoji) {
        if (!started) return
        if (!getHostId()) {
          setNote('The studio is not here yet.')
          return
        }
        if (!REACTIONS.includes(emoji) || !seen.has(id)) return
        if (mine.get(id) === emoji) mine.delete(id)
        else mine.set(id, emoji)
        refresh(messages.find((item) => item.id === id))
        action.send({ kind: 'react', id, emoji }).catch(() => {
          setNote('Could not send. Try again.')
        })
      }
    }
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

  function applyReactions(id, counts) {
    if (!id) return
    const message = messages.find((item) => item.id === id)
    if (!message) return
    message.reactions = cleanReactions(counts)
    if (started) refresh(message)
  }

  function paintAll() {
    log.replaceChildren()
    messages.forEach(paint)
    syncEmpty()
  }

  function paint(message) {
    log.append(renderMessage(message, listenerHooks()))
    syncEmpty()
    scroll.scrollTop = scroll.scrollHeight
  }

  function refresh(message) {
    if (!message) return
    const next = renderMessage(message, listenerHooks())
    const existing = log.querySelector(`[data-id="${CSS.escape(message.id)}"]`)
    if (existing) existing.replaceWith(next)
    else paint(message)
  }

  function forget(id) {
    if (!id) return
    dropped.add(id)
    mine.delete(id)
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
      mine.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
  }

  function clearMessages() {
    messages.length = 0
    seen.clear()
    mine.clear()
    log.replaceChildren()
    syncEmpty()
  }

  function syncEmpty() {
    empty.hidden = log.childElementCount > 0
  }

  function setNote(message) {
    note.textContent = message
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
  const reactionByMessage = new Map()
  let action = null

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!action) return
    const text = cleanText(textInput.value)
    if (!text) return
    const message = {
      id: makeId(),
      name: STUDIO_NAME,
      text,
      admin: true,
      picture: 'studio',
      at: Date.now(),
      reactions: {}
    }
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
      announcePeople()
      action.onMessage = (data, { peerId }) => {
        if (!data || typeof data !== 'object') return
        if (data.kind === 'join') {
          if (welcome(peerId, data.name, data.picture)) sendLog(peerId)
          return
        }
        if (data.kind === 'leave') {
          const person = people.get(peerId)
          people.delete(peerId)
          dropPeerVotes(peerId)
          announcePeople()
          if (person) addNotice(`${person.name} left`)
          return
        }
        if (data.kind === 'say') acceptSay(peerId, data)
        else if (data.kind === 'react') toggleReaction(peerId, cleanId(data.id), data.emoji)
      }
    },
    detach() {
      action = null
      messages.length = 0
      seen.clear()
      people.clear()
      reactionByMessage.clear()
      log.replaceChildren()
      peopleEl.replaceChildren()
      textInput.value = ''
      empty.hidden = false
      live.hidden = true
      note.textContent = 'Go live to open the chat.'
    },
    peerLeft(peerId) {
      const person = people.get(peerId)
      if (!person) return
      people.delete(peerId)
      dropPeerVotes(peerId)
      announcePeople()
      addNotice(`${person.name} left`)
    }
  }

  function studioHooks() {
    return {
      mine: studioVotes(),
      onReact(id, emoji) { toggleReaction('studio', id, emoji) },
      onDrop(id) { removeMessage(id) }
    }
  }

  function studioVotes() {
    const mine = new Map()
    for (const [id, votes] of reactionByMessage) {
      const emoji = votes.get('studio')
      if (emoji) mine.set(id, emoji)
    }
    return mine
  }

  function welcome(peerId, rawName, rawPicture) {
    const name = cleanName(rawName)
    if (!name) return false
    const picture = cleanPicture(rawPicture)
    const previous = people.get(peerId)
    const arrived = !previous
    if (!arrived && previous.name === name && previous.picture === picture) return true
    people.set(peerId, { name, picture })
    announcePeople()
    if (arrived) addNotice(`${name} joined`)
    return true
  }

  function dropPeerVotes(peerId) {
    for (const [id, votes] of reactionByMessage) {
      if (!votes.delete(peerId)) continue
      const message = messages.find((item) => item.id === id)
      if (!message) continue
      message.reactions = countVotes(votes)
      refresh(message)
      action?.send({ kind: 'reacted', id, reactions: message.reactions }).catch(() => {})
    }
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
    const message = { id, name, text, admin: false, picture, at: cleanAt(data.at), reactions: {} }
    remember(message)
    relay(message)
    if (isNew) sendLog(peerId)
  }

  function toggleReaction(peerId, id, emoji) {
    if (!action || !REACTIONS.includes(emoji) || !seen.has(id)) return
    let votes = reactionByMessage.get(id)
    if (!votes) {
      votes = new Map()
      reactionByMessage.set(id, votes)
    }
    if (votes.get(peerId) === emoji) votes.delete(peerId)
    else votes.set(peerId, emoji)
    const counts = countVotes(votes)
    const message = messages.find((item) => item.id === id)
    if (!message) return
    message.reactions = counts
    refresh(message)
    action.send({ kind: 'reacted', id, reactions: counts }).catch(() => {})
  }

  function removeMessage(id) {
    if (!action || !cleanId(id)) return
    reactionByMessage.delete(id)
    const index = messages.findIndex((message) => message.id === id)
    if (index !== -1) {
      messages.splice(index, 1)
      seen.delete(id)
    }
    log.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
    empty.hidden = log.childElementCount > 0
    action.send({ kind: 'drop', id }).catch(() => {})
  }

  function remember(message) {
    seen.add(message.id)
    messages.push(message)
    while (messages.length > MAX_LOG) {
      const old = messages.shift()
      seen.delete(old.id)
      reactionByMessage.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
    refresh(message)
    scroll.scrollTop = scroll.scrollHeight
  }

  function refresh(message) {
    const next = renderMessage(message, studioHooks())
    const existing = log.querySelector(`[data-id="${CSS.escape(message.id)}"]`)
    if (existing) existing.replaceWith(next)
    else {
      log.append(next)
      empty.hidden = true
    }
  }

  function addNotice(text) {
    const item = document.createElement('li')
    item.className = 'chat-notice'
    item.textContent = text
    log.append(item)
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
      picture: message.picture,
      at: message.at,
      reactions: message.reactions || {}
    }).catch(() => {})
  }

  function sendLog(peerId) {
    action?.send({
      kind: 'log',
      messages: messages.map(({ id, name, text, admin, picture, at, reactions }) => (
        { id, name, text, admin, picture, at, reactions: reactions || {} }
      ))
    }, { target: peerId }).catch(() => {})
  }

  function announcePeople() {
    renderPeopleList(peopleEl, [...people.values()])
    action?.send({ kind: 'people', people: [...people.values()] }).catch(() => {})
  }
}

function renderPeopleList(container, list) {
  container.replaceChildren()
  const items = []
  for (const person of list) {
    const name = cleanName(person?.name)
    if (!name) continue
    items.push({ name, picture: cleanPicture(person?.picture) })
  }
  if (items.length === 0) {
    const emptyPeople = document.createElement('p')
    emptyPeople.className = 'chat-empty'
    emptyPeople.textContent = 'Nobody has joined yet.'
    container.append(emptyPeople)
    return
  }
  for (const person of items) {
    const row = document.createElement('div')
    row.className = 'chat-person'
    const face = document.createElement('span')
    face.className = 'chat-picture'
    face.append(pictureElement(person.picture))
    const label = document.createElement('span')
    label.className = 'chat-person-label'
    label.textContent = person.name
    row.append(face, label)
    container.append(row)
  }
}

function renderMessage(message, hooks) {
  const item = document.createElement('li')
  item.className = message.admin ? 'chat-msg admin' : 'chat-msg'
  item.dataset.id = message.id

  const face = document.createElement('span')
  face.className = 'chat-picture'
  face.append(pictureElement(message.admin ? 'studio' : message.picture))

  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble'

  const who = document.createElement('span')
  who.className = 'chat-name'
  who.append(document.createTextNode(message.admin ? STUDIO_NAME : message.name))
  if (message.admin) {
    const badge = document.createElement('span')
    badge.className = 'chat-badge'
    badge.textContent = 'Admin'
    who.append(badge)
  }

  const time = document.createElement('time')
  time.className = 'chat-time'
  time.dateTime = new Date(message.at).toISOString()
  time.textContent = formatTime(message.at)

  const head = document.createElement('span')
  head.className = 'chat-head'
  head.append(who, time)

  const body = document.createElement('p')
  body.className = 'chat-text'
  body.textContent = message.text

  const reacts = document.createElement('div')
  reacts.className = 'chat-reacts'
  const counts = message.reactions || {}
  const selected = hooks?.mine?.get(message.id) || ''
  for (const emoji of REACTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chat-react'
    const count = counts[emoji] || 0
    button.textContent = count > 0 ? `${emoji} ${count}` : emoji
    button.setAttribute('aria-label', `React ${emoji}`)
    button.setAttribute('aria-pressed', selected === emoji ? 'true' : 'false')
    button.addEventListener('click', () => { hooks?.onReact?.(message.id, emoji) })
    reacts.append(button)
  }

  bubble.append(head, body, reacts)
  if (hooks?.onDrop) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'text-btn chat-remove'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => { hooks.onDrop(message.id) })
    bubble.append(remove)
  }
  item.append(face, bubble)
  return item
}

function countVotes(votes) {
  const counts = {}
  for (const emoji of votes.values()) {
    if (!REACTIONS.includes(emoji)) continue
    counts[emoji] = (counts[emoji] || 0) + 1
  }
  return counts
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  const text = cleanText(raw.text)
  const admin = Boolean(raw.admin)
  const name = admin ? STUDIO_NAME : cleanName(raw.name)
  if (!id || !text || !name) return null
  return {
    id,
    name,
    text,
    admin,
    picture: admin ? 'studio' : cleanPicture(raw.picture),
    at: cleanAt(raw.at),
    reactions: cleanReactions(raw.reactions)
  }
}

function cleanReactions(value) {
  const counts = {}
  if (!value || typeof value !== 'object') return counts
  for (const emoji of REACTIONS) {
    const n = Math.round(Number(value[emoji]))
    if (n > 0) counts[emoji] = Math.min(99, n)
  }
  return counts
}

function cleanAt(value) {
  const at = Number(value)
  if (!Number.isFinite(at) || at < 1577836800000 || at > Date.now() + 60000) return Date.now()
  return Math.round(at)
}

function formatTime(at) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
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

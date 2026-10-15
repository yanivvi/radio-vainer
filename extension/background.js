import { cleanTabTitle } from './title.js'

let musicTabId = null

function isStudio(tab) {
  const url = tab?.url || tab?.pendingUrl || ''
  try {
    return new URL(url).pathname.endsWith('/studio.html')
  } catch {
    return false
  }
}

async function studios() {
  const tabs = await chrome.tabs.query({})
  return tabs.filter((tab) => tab.id != null && isStudio(tab))
}

async function publish(tab) {
  const title = cleanTabTitle(tab?.title)
  if (!title) return
  for (const studio of await studios()) {
    chrome.tabs.sendMessage(studio.id, { type: 'now-playing', title }).catch(() => {})
  }
}

function watch(tab) {
  if (!tab || tab.id == null || isStudio(tab)) return
  if (tab.audible) musicTabId = tab.id
  if (tab.id !== musicTabId) return
  publish(tab)
}

async function followAudible() {
  const tabs = await chrome.tabs.query({ audible: true })
  const music = tabs
    .filter((tab) => !isStudio(tab))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
  if (!music) return
  musicTabId = music.id
  publish(music)
}

chrome.tabs.onUpdated.addListener((_id, _info, tab) => watch(tab))

chrome.tabs.onRemoved.addListener((id) => {
  if (id === musicTabId) musicTabId = null
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ready') followAudible()
})

followAudible()

import { statusPath } from './config.js'

export async function readMount() {
  const response = await fetch(statusPath, { cache: 'no-store' })
  if (!response.ok) return null
  const stats = JSON.parse(await response.text())
  const source = stats?.icestats?.source
  const list = Array.isArray(source) ? source : source && typeof source === 'object' ? [source] : []
  return list.find((item) => String(item.listenurl || '').includes('/radio-vainer')) || null
}

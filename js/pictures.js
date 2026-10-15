const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`

const studio = svg(`
  <circle cx="32" cy="32" r="28" fill="#f07832"/>
  <rect x="27" y="16" width="10" height="20" rx="5" fill="#fffaf3"/>
  <path d="M22 30a10 10 0 0 0 20 0" fill="none" stroke="#fffaf3" stroke-width="3" stroke-linecap="round"/>
  <path d="M32 40v8M26 48h12" fill="none" stroke="#fffaf3" stroke-width="3" stroke-linecap="round"/>
`)

export const pictures = [
  {
    id: 'shrimp',
    label: 'Shrimp',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#ffe3cc"/>
      <path d="M18 40c2 10 26 12 32-2 2-6-6-8-8-2" fill="none" stroke="#f07832" stroke-width="7" stroke-linecap="round"/>
      <circle cx="24" cy="28" r="7" fill="#f07832"/>
      <circle cx="27" cy="27" r="2" fill="#3a2418"/>
      <path d="M16 22c6-8 14-6 14 0" fill="none" stroke="#3a2418" stroke-width="2" stroke-linecap="round"/>
    `)
  },
  {
    id: 'fish',
    label: 'Fish',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#e5f6f6"/>
      <path d="M46 32l12-11v22z" fill="#f07832"/>
      <ellipse cx="30" cy="33" rx="16" ry="11" fill="#7ec8cb"/>
      <circle cx="22" cy="31" r="2.2" fill="#3a2418"/>
    `)
  },
  {
    id: 'crab',
    label: 'Crab',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#ffe8e4"/>
      <circle cx="32" cy="36" r="12" fill="#e23b3b"/>
      <circle cx="27" cy="34" r="2" fill="#fffaf3"/>
      <circle cx="37" cy="34" r="2" fill="#fffaf3"/>
      <path d="M18 28c-6-8-2-14 4-8M46 28c6-8 2-14-4-8" fill="none" stroke="#e23b3b" stroke-width="4" stroke-linecap="round"/>
    `)
  },
  {
    id: 'shell',
    label: 'Shell',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#fff6ea"/>
      <path d="M14 42c6-20 30-20 36 0" fill="#f3d2ae"/>
      <path d="M32 42V20M22 40c2-12 6-16 10-18M42 40c-2-12-6-16-10-18" fill="none" stroke="#d25a22" stroke-width="2" stroke-linecap="round"/>
    `)
  },
  {
    id: 'coral',
    label: 'Coral',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#ffe8e0"/>
      <path d="M32 46V28M32 34c-8-2-12-10-8-16M32 30c8-2 14-8 10-16M24 40c-8 0-12-6-8-12M40 40c8 0 12-6 8-12" fill="none" stroke="#f07832" stroke-width="4" stroke-linecap="round"/>
    `)
  },
  {
    id: 'mic',
    label: 'Microphone',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#f6efe4"/>
      <rect x="26" y="14" width="12" height="22" rx="6" fill="#3a2418"/>
      <path d="M20 30a12 12 0 0 0 24 0" fill="none" stroke="#f07832" stroke-width="3" stroke-linecap="round"/>
      <path d="M32 42v8M25 50h14" fill="none" stroke="#3a2418" stroke-width="3" stroke-linecap="round"/>
    `)
  },
  {
    id: 'phones',
    label: 'Headphones',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#e7f4f4"/>
      <path d="M16 34a16 16 0 0 1 32 0" fill="none" stroke="#3a2418" stroke-width="4" stroke-linecap="round"/>
      <rect x="12" y="32" width="10" height="16" rx="4" fill="#f07832"/>
      <rect x="42" y="32" width="10" height="16" rx="4" fill="#f07832"/>
    `)
  },
  {
    id: 'bubble',
    label: 'Bubble',
    svg: svg(`
      <circle cx="32" cy="32" r="28" fill="#e5f6f6"/>
      <circle cx="32" cy="34" r="14" fill="#b7e0e2" stroke="#3a2418" stroke-width="2"/>
      <circle cx="27" cy="29" r="3" fill="#fffaf3"/>
      <circle cx="46" cy="18" r="4" fill="#b7e0e2"/>
      <circle cx="18" cy="20" r="2.5" fill="#b7e0e2"/>
    `)
  }
]

const byId = new Map(pictures.map((picture) => [picture.id, picture]))

export function cleanPicture(value) {
  const id = String(value ?? '')
  return byId.has(id) ? id : pictures[0].id
}

export function suggestPicture() {
  return pictures[Math.floor(Math.random() * pictures.length)].id
}

export function pictureElement(id) {
  const known = id === 'studio' ? studio : byId.get(cleanPicture(id)).svg
  const holder = document.createElement('span')
  holder.innerHTML = known
  return holder.firstElementChild
}

/* 머메이드(Mermaid) 도표 그리기 — 처음 쓸 때만 불러온다 */
let ready: Promise<typeof import('mermaid').default> | null = null
let currentTheme = ''
let seq = 0

async function load(dark: boolean) {
  if (!ready) ready = import('mermaid').then((m) => m.default)
  const mermaid = await ready
  const theme = dark ? 'dark' : 'default'
  if (theme !== currentTheme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' })
    currentTheme = theme
  }
  return mermaid
}

/** 머메이드 코드를 SVG 문자열로. 문법 오류면 예외 */
export async function renderMermaid(code: string, dark = false): Promise<string> {
  const mermaid = await load(dark)
  const id = `mmd-${Date.now().toString(36)}-${seq++}`
  try {
    const { svg } = await mermaid.render(id, code)
    return svg
  } finally {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}

/** SVG 문자열 → PNG (Word 내보내기용) */
export async function svgToPng(svg: string, maxWidth = 600): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    const vb = box.getAttribute('viewBox')?.split(/\s+/).map(Number)
    const w0 = vb?.[2] || Number.parseFloat(box.getAttribute('width') || '600') || 600
    const h0 = vb?.[3] || Number.parseFloat(box.getAttribute('height') || '400') || 400
    const scale = Math.min(1, maxWidth / w0)
    const w = Math.round(w0 * scale)
    const h = Math.round(h0 * scale)
    box.setAttribute('width', String(w0))
    box.setAttribute('height', String(h0))
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(box))}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = w * 2
    canvas.height = h * 2
    const g = canvas.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), width: w, height: h } : null
  } catch {
    return null
  }
}

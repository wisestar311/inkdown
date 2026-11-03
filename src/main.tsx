import { createRoot } from 'react-dom/client'
import App from './App'
import { loadDocs, loadTombstones } from './lib/storage'
import { isDesktop } from './lib/desktop'
import './styles.css'

const [docs, tombstones] = await Promise.all([loadDocs(), loadTombstones()])

createRoot(document.getElementById('root')!).render(<App initialDocs={docs} initialTombstones={tombstones} />)

// 웹: 오프라인에서도 열리도록 서비스 워커 등록 (데스크톱 앱과 개발 서버에서는 사용하지 않음)
if (!isDesktop && import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined)
}

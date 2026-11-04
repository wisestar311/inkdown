import { createRoot } from 'react-dom/client'
import App from './App'
import { LockScreen } from './components/LockScreen'
import { loadDocs, loadSecrets, loadSettings, loadTombstones } from './lib/storage'
import { isLockEnabled, isUnlocked } from './lib/vault'
import { isDesktop } from './lib/desktop'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
document.documentElement.dataset.theme = loadSettings().theme

/** 문서 불러오기 → 편집기 표시. 잠금이 켜져 있으면 PIN 확인 뒤에만 호출됨 */
async function start() {
  await loadSecrets()
  const [docs, tombstones] = await Promise.all([loadDocs(), loadTombstones()])
  root.render(<App initialDocs={docs} initialTombstones={tombstones} />)
}

if (isLockEnabled() && !isUnlocked()) root.render(<LockScreen onUnlock={start} />)
else await start()

// 웹: 오프라인에서도 열리도록 서비스 워커 등록 (데스크톱 앱과 개발 서버에서는 사용하지 않음)
if (!isDesktop && import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined)
}

import { Modal } from './Dialog'
import { markdownToHtml } from '../lib/export'
import { desktop } from '../lib/desktop'
import changelog from '../../CHANGELOG.md?raw'

const platform = desktop ? (desktop.platform === 'darwin' ? 'Mac 앱' : desktop.platform === 'win32' ? 'Windows 앱' : '데스크톱 앱') : '웹 앱'

/** 버전 정보 + 버전별 바뀐 내용 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const built = new Date(__APP_BUILD__).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <Modal title="Inkdown 정보" onClose={onClose} width={520}>
      <div className="about-head">
        <img src="./icon-192.png" alt="" width={48} height={48} />
        <div>
          <div className="about-version">버전 {__APP_VERSION__}</div>
          <div className="hint" style={{ margin: 0 }}>
            {platform} · {built} 빌드
          </div>
        </div>
      </div>
      <p className="hint">Windows·Mac·웹의 버전이 같은지 여기서 비교할 수 있습니다. 웹 앱은 새로고침하면 최신 버전으로 바뀝니다.</p>
      <div className="about-log" dangerouslySetInnerHTML={{ __html: markdownToHtml(changelog.replace(/^# .*\n/, '')) }} />
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}

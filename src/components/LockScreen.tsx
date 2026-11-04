import { useCallback, useEffect, useState } from 'react'
import { failCount, lockoutSeconds, removeLock, unlock } from '../lib/vault'
import { idbSet } from '../lib/db'
import { desktop } from '../lib/desktop'

const MAX = 8

/** 앱 시작 시 / 자동 잠금 후 표시. PIN이 맞기 전에는 문서를 불러오지 않는다. */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(lockoutSeconds())

  // 데스크톱: 잠금 화면에서 창을 닫으면 바로 닫히게
  useEffect(() => desktop?.onBeforeClose(async () => undefined), [])

  useEffect(() => {
    if (wait <= 0) return
    const t = setInterval(() => setWait(lockoutSeconds()), 500)
    return () => clearInterval(t)
  }, [wait])

  const submit = useCallback(
    async (value: string) => {
      if (busy || value.length < 4 || lockoutSeconds() > 0) return
      setBusy(true)
      setError('')
      const ok = await unlock(value)
      setBusy(false)
      if (ok) return onUnlock()
      setPin('')
      const w = lockoutSeconds()
      setWait(w)
      setError(w > 0 ? '' : `PIN이 맞지 않습니다 (${failCount()}회 틀림, 5회부터 잠시 기다려야 합니다)`)
    },
    [busy, onUnlock],
  )

  const press = useCallback(
    (d: string) => {
      if (busy || wait > 0) return
      setError('')
      setPin((p) => (p.length >= MAX ? p : p + d))
    },
    [busy, wait],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') submit(pin)
      else if (e.key === 'Escape') setPin('')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pin, press, submit])

  const forgot = async () => {
    if (
      !confirm(
        'PIN을 잊으셨나요?\n\n이 기기에 저장된 문서와 동기화 토큰을 모두 지우고 잠금을 해제합니다.\n' +
          '• GitHub에 동기화된 문서는 남아 있어, 동기화를 다시 연결하면 그대로 받아집니다.\n' +
          '• 동기화되지 않은 문서(🔒 이 기기에만 보관, 업로드 대기 중인 내용)는 되살릴 수 없습니다.\n\n계속할까요?',
      )
    )
      return
    await Promise.all([idbSet('docs', []), idbSet('tombstones', []), idbSet('syncToken', '')])
    try {
      const sync = JSON.parse(localStorage.getItem('inkdown:sync') ?? '{}')
      localStorage.setItem('inkdown:sync', JSON.stringify({ ...sync, token: '', enabled: false }))
    } catch {
      /* 무시 */
    }
    removeLock()
    location.reload()
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">🔒</div>
        <h2>Inkdown 잠금</h2>
        <p className="lock-sub">{wait > 0 ? `${wait}초 뒤에 다시 입력할 수 있습니다` : busy ? '확인 중…' : 'PIN을 입력하세요'}</p>
        <div className={`pin-dots ${error ? 'shake' : ''}`} aria-label={`${pin.length}자리 입력됨`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        {error && <p className="lock-error">{error}</p>}
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={wait > 0}>
              {d}
            </button>
          ))}
          <button className="pin-sub" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="지우기">
            ⌫
          </button>
          <button onClick={() => press('0')} disabled={wait > 0}>
            0
          </button>
          <button className="pin-ok" onClick={() => submit(pin)} disabled={pin.length < 4 || wait > 0 || busy}>
            확인
          </button>
        </div>
        <button className="lock-forgot" onClick={forgot}>
          PIN을 잊으셨나요?
        </button>
      </div>
    </div>
  )
}

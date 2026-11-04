import { useState } from 'react'
import { Modal } from './Dialog'
import { getLockConfig, removeLock, setAutoLock, setPin, unlock, validPin } from '../lib/vault'

interface Props {
  /** 잠금을 켜거나 끄거나 PIN을 바꾼 뒤, 기기 안 데이터를 새 방식으로 다시 저장 */
  onResave: () => Promise<void>
  onClose: () => void
  onToast: (msg: string) => void
}

const AUTO = [
  { v: 1, label: '1분' },
  { v: 5, label: '5분' },
  { v: 15, label: '15분' },
  { v: 30, label: '30분' },
  { v: 0, label: '사용 안 함' },
]

function PinInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <>
      <label className="field-label">{label}</label>
      <input
        className="field pin-field"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        placeholder="숫자 4~8자리"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </>
  )
}

export function LockDialog({ onResave, onClose, onToast }: Props) {
  const cfg = getLockConfig()
  const [current, setCurrent] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [auto, setAuto] = useState(cfg?.autoLockMin ?? 5)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'main' | 'change' | 'off'>('main')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkNew = () => {
    if (!validPin(pin1)) throw new Error('PIN은 숫자 4~8자리로 정해 주세요 (6자리 이상 권장)')
    if (pin1 !== pin2) throw new Error('두 번 입력한 PIN이 서로 다릅니다')
  }
  const checkCurrent = async () => {
    if (!(await unlock(current))) throw new Error('지금 PIN이 맞지 않습니다')
  }

  const enable = () =>
    run(async () => {
      checkNew()
      await setPin(pin1, auto)
      await onResave()
      onToast('잠금을 켰습니다. 이 기기의 문서를 PIN으로 암호화했습니다')
      onClose()
    })

  const change = () =>
    run(async () => {
      await checkCurrent()
      checkNew()
      await setPin(pin1, auto)
      await onResave()
      onToast('PIN을 바꿨습니다')
      onClose()
    })

  const disable = () =>
    run(async () => {
      await checkCurrent()
      removeLock()
      await onResave()
      onToast('잠금을 껐습니다')
      onClose()
    })

  return (
    <Modal title="잠금 (PIN)" onClose={onClose} width={440}>
      {!cfg ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            잠금을 켜면 앱을 열 때와 정해진 시간 동안 사용하지 않았을 때 PIN을 묻습니다. 이 기기에 저장된 문서·필기·동기화 토큰도 PIN으로 암호화됩니다.
          </p>
          <PinInput label="새 PIN" value={pin1} onChange={setPin1} autoFocus />
          <PinInput label="새 PIN 한 번 더" value={pin2} onChange={setPin2} />
        </>
      ) : mode === 'main' ? (
        <p className="hint" style={{ marginTop: 0 }}>
          잠금이 켜져 있습니다. 이 기기의 문서는 PIN으로 암호화되어 저장됩니다.
        </p>
      ) : (
        <>
          <PinInput label="지금 PIN" value={current} onChange={setCurrent} autoFocus />
          {mode === 'change' && (
            <>
              <PinInput label="새 PIN" value={pin1} onChange={setPin1} />
              <PinInput label="새 PIN 한 번 더" value={pin2} onChange={setPin2} />
            </>
          )}
        </>
      )}

      {(mode === 'main' || mode === 'change') && (
        <>
          <label className="field-label">사용하지 않으면 자동 잠금</label>
          <div className="seg">
            {AUTO.map((a) => (
              <button
                key={a.v}
                className={auto === a.v ? 'on' : ''}
                onClick={() => {
                  setAuto(a.v)
                  if (cfg) setAutoLock(a.v)
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="status err">{error}</p>}
      <p className="hint">PIN을 잊으면 이 기기의 문서를 되살릴 수 없습니다. 동기화된 문서는 GitHub에 남아 있어 다시 받을 수 있습니다.</p>

      <div className="modal-actions">
        {cfg && mode === 'main' && (
          <>
            <button className="btn danger" onClick={() => setMode('off')}>잠금 끄기</button>
            <button className="btn" onClick={() => setMode('change')}>PIN 바꾸기</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={mode === 'main' ? onClose : () => setMode('main')}>
          {mode === 'main' ? '닫기' : '뒤로'}
        </button>
        {!cfg && (
          <button className="btn primary" disabled={busy} onClick={enable}>
            잠금 켜기
          </button>
        )}
        {cfg && mode === 'change' && (
          <button className="btn primary" disabled={busy} onClick={change}>
            PIN 바꾸기
          </button>
        )}
        {cfg && mode === 'off' && (
          <button className="btn primary danger-bg" disabled={busy} onClick={disable}>
            잠금 끄기
          </button>
        )}
      </div>
    </Modal>
  )
}

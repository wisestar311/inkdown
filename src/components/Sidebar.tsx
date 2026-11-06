import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { type Doc, hashText } from '../lib/storage'
import { isSyncable } from '../lib/sync/engine'
import type { Heading } from '../lib/markdown'
import type { TreeNode } from '../lib/fileio'

interface Props {
  tab: 'files' | 'outline'
  onTab: (t: 'files' | 'outline') => void
  docs: Doc[]
  activeId: string
  onSelect: (id: string) => void
  onNew: (folder?: string) => void
  onDelete: (id: string) => void
  headings: Heading[]
  onHeading: (h: Heading) => void
  folder: { name: string; tree: TreeNode[] } | null
  activePath?: string
  onOpenTreeFile: (node: TreeNode) => void
  onOpenFolder?: () => void
  syncEnabled: boolean
  /** 문서 폴더 */
  folders: string[]
  collapsed: string[]
  onToggleFolder: (path: string) => void
  onNewFolder: (parent?: string) => void
  onRenameFolder: (path: string) => void
  onDeleteFolder: (path: string) => void
  onMoveDoc: (id: string, folder: string) => void
  /** 여러 문서·폴더 옮기기 */
  onMoveItems: (docIds: string[], folders: string[], target: string) => void
  /** 여러 문서·폴더 삭제 (확인 창 포함, 삭제했으면 true) */
  onDeleteItems: (docIds: string[], folders: string[]) => boolean
  onCollapseSidebar: () => void
  onToggleSync: (id: string, include: boolean) => void
  onTemplate: () => void
}

// ---------- 동기화 표시 ----------
const hashCache = new Map<string, { content: string; hash: string }>()
function cachedHash(d: Doc) {
  const c = hashCache.get(d.id)
  if (c && c.content === d.content) return c.hash
  const hash = hashText(d.content)
  hashCache.set(d.id, { content: d.content, hash })
  return hash
}

function syncBadge(d: Doc, enabled: boolean): { icon: string; title: string } | null {
  if (d.localOnly) return { icon: '🔒', title: '이 기기에만 보관 (동기화 안 함) — ⋯ 메뉴에서 동기화에 포함할 수 있습니다' }
  if ((d.fileName || d.localPath) && !d.syncLocal) return { icon: '💾', title: '내 컴퓨터의 파일 (동기화 안 함) — ⋯ 메뉴에서 동기화에 포함할 수 있습니다' }
  if (!enabled) return null
  if (!d.remotePath) return d.content.trim() ? { icon: '↑', title: '업로드 대기' } : null
  if (cachedHash(d) !== d.syncedHash || d.moved) return { icon: '↑', title: '변경 내용 업로드 대기' }
  return { icon: '☁', title: `동기화됨 · ${d.remotePath}` }
}

// ---------- 폴더 트리 ----------
interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  docs: Doc[]
}

function buildTree(folders: string[], docs: Doc[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], docs: [] }
  const map = new Map<string, FolderNode>([['', root]])
  const ensure = (path: string): FolderNode => {
    if (map.has(path)) return map.get(path)!
    const i = path.lastIndexOf('/')
    const parent = ensure(i < 0 ? '' : path.slice(0, i))
    const node: FolderNode = { path, name: path.slice(i + 1), children: [], docs: [] }
    parent.children.push(node)
    map.set(path, node)
    return node
  }
  folders.forEach((f) => f && ensure(f))
  for (const d of docs) ensure(d.folder ?? '').docs.push(d)
  const sort = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    n.docs.sort((a, b) => b.updatedAt - a.updatedAt)
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

const countDocs = (n: FolderNode): number => n.docs.length + n.children.reduce((s, c) => s + countDocs(c), 0)

/** 작은 팝업 메뉴 */
function Popover({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => window.addEventListener('mousedown', close))
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div className="popover" ref={ref} role="menu">
      {children}
    </div>
  )
}

const DRAG_TYPE = 'application/x-inkdown-doc'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** 선택 항목 열쇠: 문서 d:id, 폴더 f:경로 */
type Key = string
const splitKeys = (keys: Iterable<Key>) => {
  const docIds: string[] = []
  const folders: string[] = []
  for (const k of keys) (k.startsWith('d:') ? docIds : folders).push(k.slice(2))
  return { docIds, folders }
}

function LocalTree({ nodes, activePath, onOpen }: { nodes: TreeNode[]; activePath?: string; onOpen: (n: TreeNode) => void }) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <LocalTreeItem key={n.path} node={n} activePath={activePath} onOpen={onOpen} />
      ))}
    </ul>
  )
}

function LocalTreeItem({ node, activePath, onOpen }: { node: TreeNode; activePath?: string; onOpen: (n: TreeNode) => void }) {
  const [open, setOpen] = useState(true)
  if (node.kind === 'directory') {
    return (
      <li>
        <button className="tree-row dir" onClick={() => setOpen(!open)}>
          <span className="caret">{open ? '▾' : '▸'}</span> {node.name}
        </button>
        {open && node.children && <LocalTree nodes={node.children} activePath={activePath} onOpen={onOpen} />}
      </li>
    )
  }
  return (
    <li>
      <button className={`tree-row file ${activePath === node.path ? 'active' : ''}`} onClick={() => onOpen(node)} title={node.path}>
        {node.name.replace(/\.(md|markdown|mdown|txt)$/i, '')}
      </button>
    </li>
  )
}

export function Sidebar(p: Props) {
  const tree = useMemo(() => buildTree(p.folders, p.docs), [p.folders, p.docs])
  const allFolders = useMemo(() => {
    const out: string[] = []
    const walk = (n: FolderNode) => n.children.forEach((c) => (out.push(c.path), walk(c)))
    walk(tree)
    return out
  }, [tree])
  const [menu, setMenu] = useState<{ kind: 'doc' | 'folder' | 'sel'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<Key>>(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const anchor = useRef<Key | null>(null)
  const selecting = selectMode || sel.size > 0

  // 화면에 보이는 순서 (Shift+클릭 범위 선택용)
  const order = useMemo(() => {
    const out: Key[] = []
    const walk = (n: FolderNode) => {
      for (const c of n.children) {
        out.push(`f:${c.path}`)
        if (!p.collapsed.includes(c.path)) walk(c)
      }
      for (const d of n.docs) out.push(`d:${d.id}`)
    }
    walk(tree)
    return out
  }, [tree, p.collapsed])

  // 사라진 항목은 선택에서 뺌
  useEffect(() => {
    setSel((cur) => {
      const valid = new Set(order)
      const next = new Set([...cur].filter((k) => valid.has(k) || (k.startsWith('f:') && allFolders.includes(k.slice(2)))))
      return next.size === cur.size ? cur : next
    })
  }, [order, allFolders])

  const clearSel = () => {
    setSel(new Set())
    setSelectMode(false)
    anchor.current = null
  }

  /** 클릭 처리: 선택 동작이면 true */
  const handleSelectClick = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, key: Key) => {
    const toggle = isMac ? e.metaKey : e.ctrlKey
    if (e.shiftKey && (anchor.current || sel.size)) {
      const a = order.indexOf(anchor.current ?? [...sel][0]!)
      const b = order.indexOf(key)
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
        setSel((cur) => new Set([...(toggle ? cur : []), ...range]))
        return true
      }
    }
    if (toggle || e.shiftKey || selecting) {
      setSel((cur) => {
        const next = new Set(cur)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      anchor.current = key
      return true
    }
    anchor.current = key
    return false
  }

  const deleteSelected = () => {
    const { docIds, folders } = splitKeys(sel)
    if (p.onDeleteItems(docIds, folders)) clearSel()
  }
  const moveSelected = (target: string) => {
    const { docIds, folders } = splitKeys(sel)
    p.onMoveItems(docIds, folders, target)
    clearSel()
  }

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(folder)
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(null)
      let keys: Key[]
      try {
        keys = JSON.parse(raw) as Key[]
      } catch {
        keys = [`d:${raw}`]
      }
      const { docIds, folders } = splitKeys(keys)
      if (docIds.length === 1 && !folders.length) p.onMoveDoc(docIds[0]!, folder)
      else p.onMoveItems(docIds, folders, folder)
      if (keys.length > 1) clearSel()
    },
  })

  /** 끌기 시작: 선택된 항목을 끌면 선택 전체를, 아니면 그 항목만 */
  const dragStart = (e: DragEvent, key: Key) => {
    const keys = sel.has(key) ? [...sel] : [key]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys))
    e.dataTransfer.effectAllowed = 'move'
    if (keys.length > 1) {
      const ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = `${keys.length}개 옮기기`
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 10, 10)
      setTimeout(() => ghost.remove())
    }
  }

  const checkbox = (key: Key) =>
    selecting && (
      <input
        type="checkbox"
        className="sel-check"
        checked={sel.has(key)}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation()
          handleSelectClick({ ctrlKey: !isMac, metaKey: isMac, shiftKey: e.shiftKey }, key)
        }}
        aria-label="선택"
      />
    )

  const renderDoc = (d: Doc, depth: number) => {
    const b = syncBadge(d, p.syncEnabled)
    return (
      <li key={d.id} className={`doc-item ${d.id === p.activeId ? 'active' : ''} ${sel.has(`d:${d.id}`) ? 'selected' : ''}`} style={{ paddingLeft: depth * 14 }}>
        {checkbox(`d:${d.id}`)}
        <button
          className="doc-row"
          draggable
          onDragStart={(e) => dragStart(e, `d:${d.id}`)}
          onClick={(e) => {
            if (handleSelectClick(e, `d:${d.id}`)) return
            if (sel.size) setSel(new Set())
            p.onSelect(d.id)
          }}
        >
          <span className="doc-title">
            {d.dirty ? '• ' : ''}
            {d.title || '제목 없음'}
          </span>
          <span className="doc-meta">
            {b && <span className="sync-badge" title={b.title}>{b.icon}</span>}
            {d.fileName ? `${d.fileName} · ` : ''}
            {new Date(d.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        </button>
        <button className="icon-btn more" title="이동·삭제" onClick={() => setMenu({ kind: 'doc', id: d.id })}>⋯</button>
        {menu?.kind === 'doc' && menu.id === d.id && (
          <Popover onClose={() => setMenu(null)}>
            <div className="popover-label">폴더로 이동</div>
            <button className={`popover-item ${!d.folder ? 'current' : ''}`} onClick={() => (p.onMoveDoc(d.id, ''), setMenu(null))}>
              📄 최상위
            </button>
            {allFolders.map((f) => (
              <button key={f} className={`popover-item ${d.folder === f ? 'current' : ''}`} style={{ paddingLeft: 10 + f.split('/').length * 10 }} onClick={() => (p.onMoveDoc(d.id, f), setMenu(null))}>
                📁 {f.split('/').pop()}
              </button>
            ))}
            {p.syncEnabled && (
              <>
                <div className="popover-sep" />
                {isSyncable(d) ? (
                  <button className="popover-item" onClick={() => (setMenu(null), p.onToggleSync(d.id, false))}>🔒 이 기기에만 보관</button>
                ) : (
                  <button className="popover-item" onClick={() => (setMenu(null), p.onToggleSync(d.id, true))}>☁ 동기화에 포함하기</button>
                )}
              </>
            )}
            <div className="popover-sep" />
            <button
              className="popover-item danger"
              onClick={() => {
                setMenu(null)
                const where = d.fileName || d.localPath ? '\n(내 컴퓨터의 원본 파일은 삭제되지 않습니다)' : d.remotePath && p.syncEnabled ? '\n(동기화된 모든 기기에서 삭제됩니다. GitHub 기록에서는 복구할 수 있습니다)' : ''
                if (confirm(`"${d.title}" 문서를 삭제할까요?${where}`)) p.onDelete(d.id)
              }}
            >
              🗑 삭제
            </button>
          </Popover>
        )}
      </li>
    )
  }

  const renderFolder = (n: FolderNode, depth: number): ReactNode => {
    const open = !p.collapsed.includes(n.path)
    return (
      <li key={`f:${n.path}`} className="folder-item">
        <div className={`folder-row ${dropTarget === n.path ? 'drop' : ''} ${sel.has(`f:${n.path}`) ? 'selected' : ''}`} style={{ paddingLeft: depth * 14 }} {...dropProps(n.path)}>
          {checkbox(`f:${n.path}`)}
          <button
            className="folder-toggle"
            draggable
            onDragStart={(e) => dragStart(e, `f:${n.path}`)}
            onClick={(e) => {
              if (handleSelectClick(e, `f:${n.path}`)) return
              p.onToggleFolder(n.path)
            }}
            title={open ? '접기' : '펼치기'}
          >
            <span className="caret">{open ? '▾' : '▸'}</span>
            <span className="folder-icon">{open ? '📂' : '📁'}</span>
            <span className="folder-name">{n.name}</span>
            <span className="folder-count">{countDocs(n)}</span>
          </button>
          <button className="icon-btn" title="이 폴더에 새 문서" onClick={() => p.onNew(n.path)}>＋</button>
          <button className="icon-btn more" title="폴더 메뉴" onClick={() => setMenu({ kind: 'folder', id: n.path })}>⋯</button>
          {menu?.kind === 'folder' && menu.id === n.path && (
            <Popover onClose={() => setMenu(null)}>
              <button className="popover-item" onClick={() => (setMenu(null), p.onNew(n.path))}>📄 새 문서</button>
              <button className="popover-item" onClick={() => (setMenu(null), p.onNewFolder(n.path))}>📁 하위 폴더 만들기</button>
              <button className="popover-item" onClick={() => (setMenu(null), p.onRenameFolder(n.path))}>✏️ 이름 바꾸기</button>
              <div className="popover-label">폴더째 옮기기</div>
              {n.path.includes('/') && (
                <button className="popover-item" onClick={() => (setMenu(null), p.onMoveItems([], [n.path], ''))}>
                  📄 최상위
                </button>
              )}
              {allFolders
                .filter((f) => f !== n.path && !f.startsWith(`${n.path}/`) && f !== n.path.slice(0, Math.max(0, n.path.lastIndexOf('/'))))
                .map((f) => (
                  <button key={f} className="popover-item" style={{ paddingLeft: 10 + f.split('/').length * 10 }} onClick={() => (setMenu(null), p.onMoveItems([], [n.path], f))}>
                    📁 {f.split('/').pop()}
                  </button>
                ))}
              <div className="popover-sep" />
              <button className="popover-item danger" onClick={() => (setMenu(null), p.onDeleteFolder(n.path))}>🗑 폴더만 삭제 (문서는 위 폴더로)</button>
              <button className="popover-item danger" onClick={() => (setMenu(null), p.onDeleteItems([], [n.path]))}>🗑 폴더와 안의 문서 모두 삭제</button>
            </Popover>
          )}
        </div>
        {open && (
          <ul className="doc-list">
            {n.children.map((c) => renderFolder(c, depth + 1))}
            {n.docs.map((d) => renderDoc(d, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-tabs">
          <button className={p.tab === 'files' ? 'active' : ''} onClick={() => p.onTab('files')}>문서</button>
          <button className={p.tab === 'outline' ? 'active' : ''} onClick={() => p.onTab('outline')}>개요</button>
        </div>
        <button className="icon-btn collapse" title="메뉴판 숨기기 (Ctrl+Shift+L)" onClick={p.onCollapseSidebar}>«</button>
      </div>

      {p.tab === 'outline' ? (
        <div className="sidebar-body outline">
          {p.headings.length === 0 && <p className="empty">제목(#)을 추가하면 여기에 개요가 표시됩니다.</p>}
          {p.headings.map((h) => (
            <button key={h.index} className={`outline-item l${h.level}`} onClick={() => p.onHeading(h)} title={h.text}>
              {h.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="sidebar-body files">
          <div className="files-actions">
            <button className="files-btn" onClick={() => p.onNew()}>＋ 새 문서</button>
            <button className="files-btn" onClick={p.onTemplate} title="유튜브 대본 등 템플릿으로 새 문서">📋 템플릿</button>
            <button className="files-btn" onClick={() => p.onNewFolder()}>📁 새 폴더</button>
            <button className={`files-btn sel-toggle ${selecting ? 'on' : ''}`} onClick={() => (selecting ? clearSel() : setSelectMode(true))} title={`여러 개 선택 (${isMac ? '⌘' : 'Ctrl'}+클릭, Shift+클릭으로도 가능)`}>
              ☑
            </button>
          </div>
          {selecting && (
            <div className="sel-bar" role="toolbar">
              <span className="sel-count">{sel.size ? `${sel.size}개 선택` : '항목을 눌러 선택'}</span>
              <button className="sel-btn" onClick={() => setSel(new Set(order))} title="보이는 항목 모두 선택">
                전체
              </button>
              <span className="sel-move">
                <button className="sel-btn" disabled={!sel.size} onClick={() => setMenu({ kind: 'sel', id: '' })}>
                  📁 이동
                </button>
                {menu?.kind === 'sel' && (
                  <Popover onClose={() => setMenu(null)}>
                    <div className="popover-label">{sel.size}개를 옮길 폴더</div>
                    <button className="popover-item" onClick={() => (setMenu(null), moveSelected(''))}>
                      📄 최상위
                    </button>
                    {allFolders
                      .filter((f) => !splitKeys(sel).folders.some((s2) => f === s2 || f.startsWith(`${s2}/`)))
                      .map((f) => (
                        <button key={f} className="popover-item" style={{ paddingLeft: 10 + f.split('/').length * 10 }} onClick={() => (setMenu(null), moveSelected(f))}>
                          📁 {f.split('/').pop()}
                        </button>
                      ))}
                  </Popover>
                )}
              </span>
              <button className="sel-btn danger" disabled={!sel.size} onClick={deleteSelected}>
                🗑 삭제
              </button>
              <button className="sel-btn" onClick={clearSel} title="선택 끝내기 (Esc)">
                ✕
              </button>
            </div>
          )}

          <ul
            className={`doc-list root ${dropTarget === '' ? 'drop' : ''}`}
            {...dropProps('')}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && selecting) clearSel()
              else if ((e.key === 'Delete' || (isMac && e.key === 'Backspace' && e.metaKey)) && sel.size) {
                e.preventDefault()
                deleteSelected()
              } else if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault()
                setSel(new Set(order))
              }
            }}
          >
            {tree.children.map((c) => renderFolder(c, 0))}
            {tree.docs.map((d) => renderDoc(d, 0))}
          </ul>
          {tree.children.length > 0 && (
            <p className="hint-small">
              문서·폴더를 끌어서 폴더에 넣거나 ⋯ 로 옮깁니다. 여러 개는 {isMac ? '⌘' : 'Ctrl'}+클릭·Shift+클릭 또는 ☑ 로 고릅니다.
            </p>
          )}

          {p.folder && (
            <section className="local-folder">
              <h4>💻 {p.folder.name} (내 컴퓨터)</h4>
              {p.folder.tree.length ? <LocalTree nodes={p.folder.tree} activePath={p.activePath} onOpen={p.onOpenTreeFile} /> : <p className="empty">마크다운 파일이 없습니다.</p>}
            </section>
          )}
          {!p.folder && p.onOpenFolder && (
            <button className="open-folder" onClick={p.onOpenFolder}>
              내 컴퓨터 폴더 열기…
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

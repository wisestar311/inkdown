import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { type Doc, hashText } from '../lib/storage'
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
  onCollapseSidebar: () => void
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
  if (d.fileName || d.localPath) return { icon: '💾', title: '내 컴퓨터의 파일 (동기화 안 함)' }
  if (d.localOnly) return { icon: '🔒', title: '이 기기에만 보관 (동기화 안 함)' }
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
  const [menu, setMenu] = useState<{ kind: 'doc' | 'folder'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

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
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(null)
      p.onMoveDoc(id, folder)
    },
  })

  const renderDoc = (d: Doc, depth: number) => {
    const b = syncBadge(d, p.syncEnabled)
    return (
      <li key={d.id} className={`doc-item ${d.id === p.activeId ? 'active' : ''}`} style={{ paddingLeft: depth * 14 }}>
        <button
          className="doc-row"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, d.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => p.onSelect(d.id)}
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
        <div className={`folder-row ${dropTarget === n.path ? 'drop' : ''}`} style={{ paddingLeft: depth * 14 }} {...dropProps(n.path)}>
          <button className="folder-toggle" onClick={() => p.onToggleFolder(n.path)} title={open ? '접기' : '펼치기'}>
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
              <div className="popover-sep" />
              <button className="popover-item danger" onClick={() => (setMenu(null), p.onDeleteFolder(n.path))}>🗑 폴더 삭제 (문서는 위 폴더로)</button>
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
          </div>

          <ul className={`doc-list root ${dropTarget === '' ? 'drop' : ''}`} {...dropProps('')}>
            {tree.children.map((c) => renderFolder(c, 0))}
            {tree.docs.map((d) => renderDoc(d, 0))}
          </ul>
          {tree.children.length > 0 && <p className="hint-small">문서를 끌어서 폴더에 넣거나, ⋯ 를 눌러 옮길 수 있습니다.</p>}

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

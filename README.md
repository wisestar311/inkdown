# Inkdown — 실시간 미리보기 마크다운 에디터

마크다운 기호를 입력하는 즉시 서식이 적용되는 WYSIWYG 에디터입니다. **웹 · Windows · macOS**에서 같은 코드로 동작하고, **GitHub 비공개 저장소**를 통해 모든 기기의 문서가 동기화됩니다.

```
 ┌──────────┐   ┌──────────┐   ┌──────────┐
 │ Windows 앱│   │  Mac 앱  │   │  웹 앱   │   각 기기: IndexedDB에 먼저 저장(오프라인 가능)
 └────┬─────┘   └────┬─────┘   └────┬─────┘
      └──────────────┼──────────────┘        입력을 멈추고 8초 뒤 · 1분마다 · 창으로 돌아올 때 · Ctrl+S
                     ▼
        GitHub 비공개 저장소  notes/*.md          문서 1개 = .md 파일 1개, 저장할 때마다 커밋(버전 기록)
```

## 1. 동기화 설정 (기기마다 1회)

1. <https://github.com/new> → 이름 `inkdown-notes`, **Private** 선택 → Create repository
2. <https://github.com/settings/personal-access-tokens/new> (Fine-grained token)
   - Token name: `inkdown` / Expiration: 원하는 기간(최대 1년, 만료되면 새로 발급)
   - Repository access: **Only select repositories** → `inkdown-notes`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Generate token → `github_pat_…` 복사
3. Inkdown 오른쪽 아래 **● 동기화 꺼짐** 클릭(또는 파일 → 기기 간 동기화 설정…)
   → 저장소 `내아이디/inkdown-notes`, 토큰 붙여넣기 → **연결**
4. 다른 기기에서도 같은 저장소·토큰으로 연결합니다. (토큰은 기기마다 따로 만들어도 됩니다)

| 상황 | 동작 |
| --- | --- |
| 한 기기에서만 수정 | 다른 기기로 자동 전달 |
| 두 기기에서 같은 문서를 동시에 수정 | 내 기기 내용 유지 + 상대 내용은 `제목 (충돌 사본 날짜).md`로 보존 — 어느 쪽도 사라지지 않음 |
| 삭제 | 모든 기기에서 삭제. 단, 그 사이 다른 기기가 고쳤다면 삭제하지 않고 살림 |
| 오프라인 | 기기에 저장해 두었다가 연결되면 동기화 |
| 실수로 지움/덮어씀 | GitHub 저장소의 커밋 기록(History)에서 이전 버전 복구 |

폴더 구조도 동기화됩니다(GitHub에 `notes/유튜브/대본/문서.md` 처럼 저장). 필기와 글상자는 문서 맨 끝의 숨은 주석 한 줄로 저장되어 함께 동기화됩니다.

빈 폴더도 동기화됩니다(동기화 폴더의 `.inkdown.json`에 폴더 목록 저장).

기본으로 동기화하지 않는 문서(⋯ 메뉴 → **동기화에 포함하기**, 또는 동기화 상태 화면의 **모두 동기화에 포함**으로 넣을 수 있음): 환영 문서, **파일 → 이 문서는 이 기기에만 보관**을 켠 문서, 내 컴퓨터의 `.md` 파일을 직접 연 문서(💾 표시).

## 2. 설치

### Windows / macOS 앱

GitHub 저장소 → **Actions** → **Inkdown desktop** → 최근 실행 → 맨 아래 **Artifacts**에서 내려받습니다.
(`inkdown-v0.2.0` 같은 태그를 푸시하면 **Releases**에도 첨부됩니다.)

| OS | 파일 | 처음 실행할 때 |
| --- | --- | --- |
| Windows 10/11 | `Inkdown-Setup-x.y.z.exe` | 코드서명 인증서가 없어 "Windows의 PC 보호" 창이 뜹니다 → **추가 정보 → 실행** |
| macOS 12+ (Intel·Apple Silicon 공용) | `Inkdown-x.y.z-mac.dmg` | 열고 Applications로 끌어 넣기 → 처음 실행 시 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 맨 아래 "그래도 열기"** |

`.md` 파일 연결 프로그램으로 등록되어, 파일을 더블클릭하면 Inkdown으로 열립니다.

### 웹 앱

`npm run build` 결과물(`dist/`)은 정적 파일이라 어느 호스팅에나 올릴 수 있습니다.

| 호스팅 | 비용 | 방법 |
| --- | --- | --- |
| GitHub Pages | 공개 저장소 무료 / 비공개 저장소는 Pro 필요 | 저장소 Settings → Pages → Source: GitHub Actions → Actions → **Inkdown web** → Run workflow |
| Cloudflare Pages · Netlify · Vercel | 무료 | 저장소 연결 → Root directory `markdown-editor`, Build command `npm run build`, Output `dist` |

웹 앱은 HTTPS로 열면 **설치형 앱(PWA)** 으로도 쓸 수 있습니다. Chrome·Edge 주소창 오른쪽 설치 아이콘, iPhone Safari는 공유 → 홈 화면에 추가.

## 3. 개발

```bash
cd markdown-editor
npm install
npm run dev            # 웹:      http://localhost:5173
npm run electron:dev   # 데스크톱: Vite 개발 서버 + Electron 창
npm test               # 동기화 엔진 테스트 (가짜 GitHub 서버, 두 기기 시나리오)
npm run dist:win       # Windows 설치 파일 (Windows에서 실행)
npm run dist:mac       # macOS DMG (Mac에서 실행)
```

## 4. 기능

| 구분 | 내용 |
| --- | --- |
| 실시간 미리보기 | 제목, 굵게/기울임/취소선, 목록, 할 일 목록, 인용, 구분선, 링크, 이미지 |
| 블록 | 표, 코드 블록(문법 강조), 수식(KaTeX) — 빈 줄에서 `/` 로 블록 메뉴 |
| 원문 모드 | `Ctrl+/` 로 CodeMirror 마크다운 원문 편집 |
| 사이드바(메뉴판) | 문서 폴더(하위 폴더, 끌어서 이동, 접기) · 개요(목차) · 동기화 상태(☁ ↑ 🔒 💾) — `«` 로 숨기기, `»` 로 다시 보이기 |
| 글꼴 | 테마 → 글꼴 및 문단: 본문·제목·코드 글꼴, 글자 크기, 줄 간격. 내장: 프리텐다드, 고운돋움, 고운바탕, 나눔명조, 나눔손글씨 펜, JetBrains Mono + 내 PC 글꼴 이름 직접 입력 |
| 글자 마킹 | 형광펜 5색(`Ctrl+Shift+H` = 노랑), 밑줄(`Ctrl+U`) — 글자를 선택하면 뜨는 도구 모음에도 있음. 파일에는 `<mark>`, `<u>` 로 저장 |
| 필기 모드 | `Ctrl+Shift+D` 또는 상태 표시줄 ✎ : 펜(손글씨, 필압 지원), 형광펜, 직선(줄긋기, 수평·수직 자동 맞춤), 글상자(끌어서 이동·너비 조절), 지우개, 실행 취소 |
| 다른 형식으로 저장 | `Ctrl+Shift+S`: 마크다운(.md), Obsidian용 마크다운, Word(.docx), PDF, 웹 페이지(.html), 텍스트(.txt), 전체 문서 백업(.zip). PDF(`Ctrl+P`)만 손글씨 포함 가능, 나머지는 글상자를 문서 끝 메모로 붙임 |
| Obsidian으로 보내기 | 파일 → Obsidian으로 보내기: ① 지금 문서를 Obsidian 앱에 새 노트로 바로 열기(`obsidian://`) ② 모든 문서를 보관함(vault) 폴더에 폴더 구조 그대로 저장(데스크톱·Chrome·Edge, 그 외 브라우저는 ZIP). 형광펜은 `==글자==`, 글상자는 `> [!note]` 콜아웃 |
| 보기 | 집중 모드(F8), 타자기 모드(F9), 글자 크기, 본문 폭, 테마 4종 |
| 템플릿 | 메뉴판 📋 템플릿 / 파일 → 템플릿으로 새 문서: 유튜브 대본(AIPASO, 10분·2,000~2,500자, 구간별 시간·분량, 점검표), 간단 메모. 지금 문서를 템플릿으로 저장하면 `템플릿` 폴더에 들어가 모든 기기에 동기화 |
| 이미지 | 붙여넣기·끌어놓기 → 최대 1600px로 줄여 문서에 포함(동기화 용량 절약) |

## 5. 단축키

| 동작 | 단축키 (macOS는 Ctrl → ⌘) |
| --- | --- |
| 새 문서 / 열기 / 저장(동기화) / 다른 형식으로 저장 / 끝내기(데스크톱) | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+Q` |
| 제목 1~6 / 본문 | `Ctrl+1`~`6` / `Ctrl+0` |
| 굵게 / 기울임 / 취소선 / 인라인 코드 | `Ctrl+B` / `Ctrl+I` / `Alt+Shift+5` / ``Ctrl+Shift+` `` |
| 링크 / 이미지 | `Ctrl+K` / `Ctrl+Shift+I` |
| 코드 블록 / 인용 / 표 | `Ctrl+Shift+K` / `Ctrl+Shift+Q` / `Ctrl+Alt+T` |
| 번호 / 글머리 목록 | `Ctrl+Shift+[` / `Ctrl+Shift+]` |
| 원문 모드 / 메뉴판 숨기기·보이기 / 개요 / 문서 목록 | `Ctrl+/` / `Ctrl+Shift+L` / `Ctrl+Shift+1` / `Ctrl+Shift+3` |
| 형광펜 / 밑줄 / 필기 모드 | `Ctrl+Shift+H` / `Ctrl+U` / `Ctrl+Shift+D` (필기 중 `Ctrl+Z` 실행 취소, `Esc` 끝내기) |
| 집중 / 타자기 모드 | `F8` / `F9` |
| 글자 크게 / 작게 / 초기화 | `Ctrl+=` / `Ctrl+-` / `Ctrl+Shift+0` |

웹 브라우저 탭에서는 `Ctrl+N`, `Ctrl+1`~`8` 등을 브라우저가 먼저 가로챕니다(새 문서는 `Ctrl+Alt+N`). 데스크톱 앱과 설치형 웹 앱(PWA)에서는 모두 동작합니다.

## 6. 보안

### PIN 잠금 (기기마다 설정)

파일 → **잠금(PIN) 켜기…** → 숫자 4~8자리(6자리 이상 권장) 두 번 입력 → 자동 잠금 시간 선택(1·5·15·30분/사용 안 함).

- 앱을 열 때와 정해진 시간 동안 조작이 없을 때 PIN을 묻습니다. 바로 잠그기: 상태 표시줄 🔒 또는 `Ctrl+Alt+L`.
- 이 기기에 저장된 문서·필기·동기화 토큰을 PIN에서 만든 키(PBKDF2 60만 회 → AES-256-GCM)로 암호화합니다. PIN 자체는 저장하지 않습니다.
- 5번 틀리면 30초, 그 뒤 틀릴 때마다 대기 시간이 두 배로 늘어납니다(최대 1시간).
- PIN을 잊으면 잠금 화면의 "PIN을 잊으셨나요?"로 이 기기의 데이터를 지우고 다시 시작합니다. GitHub에 동기화된 문서는 다시 받을 수 있지만, 동기화되지 않은 문서는 되살릴 수 없습니다.
- 한계: 가족·동료가 앱을 여는 것을 막는 용도입니다. 숫자 PIN은 경우의 수가 적어, 전문가가 기기 파일을 통째로 빼내 오랜 시간 대입하면 뚫릴 수 있습니다.

### 그 밖에

- 토큰은 각 기기에만 저장되며 `api.github.com` 외에는 전송되지 않습니다. 콘텐츠 보안 정책(CSP)으로 GitHub 외 외부 통신을 차단합니다.
- 토큰 권한은 **문서 저장소 하나의 Contents**로만 제한하세요. 유출되어도 그 저장소 외에는 접근할 수 없습니다.
- 공용 PC에서는 사용 후 **동기화 설정 → 동기화 끄기**(토큰 삭제)를 누르세요.
- 데스크톱 앱: 렌더러 샌드박스·contextIsolation 적용, 외부 링크는 기본 브라우저로 열림, 파일 쓰기는 사용자가 직접 연/저장한 경로로 제한.

## 7. 구조

```
electron/
  main.cts            창, 파일 연결(.md 더블클릭), 저장/내보내기 대화상자, PDF, 닫기 전 동기화
  preload.cts         렌더러에 노출하는 최소 API
src/
  App.tsx             상태, 메뉴, 단축키, 동기화 스케줄링
  lib/sync/engine.ts  양방향 동기화 규칙 (충돌 사본, 삭제 보호, 이름 변경)
  lib/sync/github.ts  GitHub REST API 클라이언트
  lib/storage.ts      IndexedDB 문서 저장, 설정
  components/         WysiwygEditor(Milkdown), SourceEditor(CodeMirror), Sidebar, MenuBar, SyncDialog
tests/sync.test.ts    동기화 시나리오 테스트
.github/workflows/    inkdown-desktop.yml(설치 파일), inkdown-web.yml(웹 배포)  ← 저장소 루트
```

import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 배포 빌드에만 콘텐츠 보안 정책(CSP)을 넣는다. 외부 통신은 GitHub API로만 제한.
const csp: Plugin = {
  name: 'inkdown-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" />`,
    ),
}

// 내장 글꼴: woff2만 사용(모든 지원 브라우저·Electron이 읽음) → 앱 용량 절반으로
const woff2Only: Plugin = {
  name: 'inkdown-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/](@fontsource|pretendard)[\\/].*\.css$/.test(id)) return
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, '')
  },
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react(), csp, woff2Only],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
})

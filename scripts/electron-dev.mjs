/* 개발 모드: Vite 개발 서버를 띄우고 Electron이 그 주소를 열게 한다 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const server = await createServer({ server: { port: 5174, strictPort: false } })
await server.listen()
const url = server.resolvedUrls.local[0]
console.log(`Vite 개발 서버: ${url}`)

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } })
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})

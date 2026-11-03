/* macOS: 유료 Apple 개발자 인증서 없이 배포할 때 ad-hoc 서명을 해 둔다.
   (Apple Silicon Mac은 서명이 없는 앱을 "손상됨"으로 표시해 실행을 막음) */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return // 정식 인증서가 있으면 electron-builder가 서명
  // universal 빌드는 arm64/x64 임시 앱을 먼저 만든 뒤 합친다. 합치기 전에 서명하면 두 앱이 달라져 실패하므로 최종본에만 서명
  if (/-temp$/.test(context.appOutDir)) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc 서명: ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}

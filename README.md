# 온결 · 나의 건강 수첩

소스와 기능 안내는 [ongle/README.md](ongle/README.md)에 있습니다. 개인정보는 브라우저에 저장되며 프로젝트에 포함되지 않습니다.

처음 실행할 때는 Node.js 22.12 이상에서 `npm --prefix ongle ci`를 실행하세요. 이후 이 폴더에서 `npm run dev`, `npm test`, `npm run build` 또는 `npm run preview`를 사용할 수 있습니다.

## GitHub Pages 배포

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택하세요. 이후 `main`에 푸시하면 `.github/workflows/deploy-pages.yml`이 테스트, 빌드, 배포를 실행합니다. 처음 설정한 경우 **Actions → Deploy GitHub Pages → Run workflow**로 다시 실행할 수 있습니다.

배포 주소는 https://jng-u.github.io/ongle/ 입니다. 로컬에서 같은 정적 파일을 만들려면 `npm --prefix ongle run build:pages`를 실행하세요. 배포 대상은 `ongle/dist/client`이며, `/ongle/` 아래에서 서비스 워커와 오프라인 기능을 지원합니다. APK는 배포 주소 뒤에 `android.apk`를 붙여 내려받을 수 있습니다.

GitHub Pages에서는 서버 API를 실행하지 않으므로 검사 참고범위의 실시간 원문 조회는 제공되지 않습니다. 개인 기록·국내 약 검색·백업·오프라인 참고자료는 사용할 수 있습니다. [Vite 배포 문서](https://vite.dev/guide/static-deploy.html#github-pages)와 [GitHub Pages 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)를 참고하세요.

안드로이드에서는 휴대폰에서 접속하던 온결 주소의 `/android.apk`를 열어 설치하세요. 이 컴퓨터의 APK는 `releases/ongyeol-android.apk`입니다. 설치 후에는 PC 서버가 꺼져도 수첩을 쓸 수 있습니다.

## 1.3 설치 및 변경점

- [Android 설치 파일](releases/ongyeol-android.apk) · [SHA-256 체크섬](releases/ongyeol-android.apk.sha256) · [PC용 포터블 ZIP](releases/ongyeol-portable.zip)
- 1.2 사용자는 기존 앱을 삭제하지 않고 같은 서명의 1.3 APK를 설치하면 기록을 유지할 수 있습니다. 웹과 Android 앱 간 이전은 암호화 백업을 사용하세요.
- 복용 당시에 기록한 약·용량·시간대와 현재 일정을 따로 확인할 수 있습니다. 매일·요일별·격일·필요시 복용을 지원합니다.
- 설정에서 백업 파일을 교체 전에 검증하고 바뀐 기록 수를 볼 수 있습니다. 진료 요약은 지난 진료일부터 또는 직접 고른 기간으로 인쇄할 수 있습니다.

"""Package the compiled local app without user data, source credentials or dependencies."""
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]).resolve()
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in ['dist/server/index.js', 'scripts/serve.mjs', 'public/credits.txt', 'README.md']:
        z.write(root / name, arcname='ongyeol/'+name)
    z.writestr('ongyeol/package.json', json.dumps({'name':'ongyeol-portable','private':True,'type':'module','scripts':{'start':'node scripts/serve.mjs'}}))
    z.writestr('ongyeol/시작하기.txt', '''온결 · 나의 건강 수첩

Node.js 22.12 이상이 설치된 컴퓨터에서 압축을 풉니다.
ongyeol 폴더에서 터미널을 열고 npm start 또는 node scripts/serve.mjs 를 실행합니다.
브라우저에서 http://127.0.0.1:4173 을 엽니다. 별도 패키지 설치는 필요하지 않습니다.

이 파일에는 앱과 공개 의약품 목록만 들어 있습니다. 내 기록을 다른 기기로 옮기려면
이전 브라우저의 설정·백업에서 암호화 백업을 만든 뒤, 새 환경에서 복원하세요.
다른 기기에서 웹으로 접속하려면 HTTPS 호스팅을 사용하세요. 자세한 안내는 README.md에 있습니다.
''')
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
print(out, out.stat().st_size)

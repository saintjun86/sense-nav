#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22.13 이상을 먼저 설치해주세요: https://nodejs.org/'
  read '?종료하려면 Enter를 누르세요.'
  exit 1
fi
if [ ! -x node_modules/.bin/vinext ]; then
  npm run install:ci || exit 1
fi
open http://127.0.0.1:5188
npm run dev -- --host 127.0.0.1 --port 5188

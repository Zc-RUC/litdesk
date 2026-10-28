#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install || exit 1
fi
if [ ! -d dist ]; then
  npm run build || exit 1
fi
(sleep 2; open "http://127.0.0.1:8765") &
exec npm start

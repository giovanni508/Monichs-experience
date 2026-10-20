#!/bin/bash
# INSIDE MONICHS - avvio per la fiera su macOS (offline).
# Prima volta: nel Terminale, chmod +x fiera-avvia.command
cd "$(dirname "$0")"
if [ ! -f dist/index.html ]; then echo "Build mancante: eseguire npm install e npm run build"; read -r; exit 1; fi
node scripts/serve-dist.mjs 8080 &
sleep 2
open -na "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required --no-first-run --user-data-dir="$HOME/Library/Application Support/InsideMonichsKiosk" http://localhost:8080/ || open http://localhost:8080/
wait

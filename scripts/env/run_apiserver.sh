#!/bin/bash
# Node api-server launcher (port 8055, proxied by the FastAPI shim on 8001).
set -e
set -a
source /app/backend/.env
set +a
export PORT=8055

cd /app/artifacts/api-server

# Wait for postgres (max 120s) so boot ordering is safe after pod recycle.
for i in $(seq 1 60); do
  node -e "const net=require('net');const s=net.connect(5432,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" && break
  echo "[run_apiserver] waiting for postgres ($i)"; sleep 2
done

echo "[run_apiserver] building..."
node ./build.mjs
echo "[run_apiserver] starting node api-server on :$PORT"
exec node --enable-source-maps ./dist/index.mjs

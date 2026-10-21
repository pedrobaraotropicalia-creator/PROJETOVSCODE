#!/bin/sh
# Partida do container (Dockerfile). Com LITESTREAM_BUCKET, restaura o banco do Cloud Storage e sobe o app debaixo do Litestream,
# que copia cada escrita para o bucket (deploy/litestream.yml). Sem ele, o banco fica só no disco do container.
set -e
if [ -z "$LITESTREAM_BUCKET" ]; then
  echo "LITESTREAM_BUCKET não definido: o banco $DATABASE_FILE se perde quando o container desligar."
  exec node server/dist/server.js
fi
export LITESTREAM_SOCKET=/tmp/litestream.sock
mkdir -p "$(dirname "$DATABASE_FILE")"
# sem cópia no bucket (primeira partida), o app cria o banco vazio. Uma falha de permissão ou de rede derruba a partida: a revisão
# nova não sobe, a anterior continua atendendo e o banco do bucket fica intacto
litestream restore -if-db-not-exists -if-replica-exists -integrity-check quick "$DATABASE_FILE"
exec litestream replicate -exec "node server/dist/server.js"

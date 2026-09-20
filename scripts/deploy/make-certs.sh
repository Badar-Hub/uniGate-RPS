#!/usr/bin/env bash
# Private CA + server certificate for a deployment without a public domain (docs/deployment.md §TLS).
#
#   scripts/deploy/make-certs.sh                 host from DEPLOY_HOST in .env.deploy
#   scripts/deploy/make-certs.sh 10.0.0.5 unigate.local   explicit IPs / names (all become SANs)
#
# Writes ./certs/{ca.key,ca.crt,server.key,server.crt}. Install ca.crt on every device that should
# trust the stack (browser, Android, iOS); the private keys never leave this host. Once a real domain
# and certificate exist, drop them in as certs/server.{crt,key} and restart the proxy — nothing else
# changes. The leaf is valid 397 days (Apple rejects longer), the CA 10 years.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=certs
mkdir -p "$OUT" && chmod 700 "$OUT"

if [[ $# -gt 0 ]]; then HOSTS=("$@"); else
  [[ -f .env.deploy ]] || { echo "no hosts given and no .env.deploy" >&2; exit 1; }
  HOSTS=("$(grep -E '^DEPLOY_HOST=' .env.deploy | cut -d= -f2-)")
fi
[[ -n "${HOSTS[0]}" ]] || { echo "DEPLOY_HOST is empty" >&2; exit 1; }

san=""
for h in "${HOSTS[@]}" localhost; do
  if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then san+="IP:$h,"; else san+="DNS:$h,"; fi
done
san+="IP:127.0.0.1"

if [[ ! -f "$OUT/ca.key" ]]; then
  echo "== new private CA"
  openssl genrsa -out "$OUT/ca.key" 4096 2>/dev/null
  openssl req -x509 -new -key "$OUT/ca.key" -sha256 -days 3650 -subj "/CN=UniGate Private CA/O=UniGate" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$OUT/ca.crt"
fi

echo "== server certificate for ${HOSTS[*]} (SAN: $san)"
openssl genrsa -out "$OUT/server.key" 2048 2>/dev/null
openssl req -new -key "$OUT/server.key" -subj "/CN=${HOSTS[0]}/O=UniGate" -out "$OUT/server.csr"
cat > "$OUT/server.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
  -out "$OUT/server.crt" -days 397 -sha256 -extfile "$OUT/server.ext" 2>/dev/null
rm -f "$OUT/server.csr" "$OUT/server.ext"
chmod 600 "$OUT"/*.key
openssl x509 -in "$OUT/server.crt" -noout -subject -ext subjectAltName -enddate | sed 's/^/   /'
echo "== install $OUT/ca.crt on your devices; keys stay in $OUT (chmod 600)"

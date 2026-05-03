#!/bin/sh
set -e

START_BLOCK="${FIREHOSE_START_BLOCK:-0}"

cat > /tmp/firehose.yaml << EOF
start:
  args:
    - substreams-tier1
    - substreams-tier2
  flags:
    advertise-chain-name: xrpl
    advertise-block-id-encoding: hex
    common-merged-blocks-store-url: /data/merged-blocks
    common-one-block-store-url: /data/one-blocks
    common-forked-blocks-store-url: /data/forked-blocks
    common-first-streamable-block: ${START_BLOCK}
    substreams-tier1-grpc-listen-addr: ":9001"
    substreams-tier1-subrequests-endpoint: "localhost:9002"
    substreams-tier1-subrequests-insecure: true
    substreams-tier1-subrequests-plaintext: true
    substreams-tier2-grpc-listen-addr: ":9002"
    substreams-state-bundle-size: 100
    substreams-state-store-url: /data/states
EOF

cd /tmp && exec /app/firecore start

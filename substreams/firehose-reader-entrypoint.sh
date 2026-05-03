#!/bin/sh
set -e

START_BLOCK="${FIREHOSE_START_BLOCK:-0}"
ENDPOINT="${XRPL_RPC_ENDPOINT:-https://s.altnet.rippletest.net:51234/}"

cat > /tmp/firehose.yaml << EOF
start:
  args:
    - reader-node
    - merger
  flags:
    reader-node-path: /app/firexrpl
    reader-node-arguments: "fetch rpc ${START_BLOCK} --state-dir /data/poller --endpoints ${ENDPOINT} --latest-block-retry-interval 2s"
    common-merged-blocks-store-url: /data/merged-blocks
    common-one-block-store-url: /data/one-blocks
    common-first-streamable-block: ${START_BLOCK}
EOF

cd /tmp && exec /app/firecore start

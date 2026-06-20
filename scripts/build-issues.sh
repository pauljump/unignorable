#!/bin/bash
# Back-compat wrapper. The real builder is build.js (Node: TCC-safe under launchd + atomic writes).
exec node "$(cd "$(dirname "$0")" && pwd)/build.js"

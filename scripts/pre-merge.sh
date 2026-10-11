#!/bin/sh
set -eu
node scripts/review-gate.mjs check security
node scripts/review-gate.mjs check reviewer
node scripts/review-gate.mjs check pr-checker
timeout 180 npm run check

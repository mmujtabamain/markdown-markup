#!/usr/bin/env bash
# Compile a trial and print its diagnostics as JSON lines.
#   check.sh doc.mkp.md [--pack folder …]     a document (with any packs)
#   check.sh --pack folder                    a pack on its own
export PATH=$HOME/.local/node24/bin:$PATH
exec timeout 60 node /home/coder/project/markdown-markup/packages/cli/dist/mkp.cjs check "$@" --format json

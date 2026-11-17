#!/bin/sh
# Prints the path of the omnicui binary that omnicui.lock names, fetching it the first time.
#
#   external/omnicui/fetch.sh            the binary for this machine, from the release
#   external/omnicui/fetch.sh --source   built from the release's source tarball instead (needs Go)
#   OMNICUI_BINARY=/path/to/omnicui      used as it is, unchecked: for trying an unreleased build
#
# Every file is checked against its hash in omnicui.lock before it is used. The fetched files are
# kept in bin/ and src/ beside this script, which git ignores. Messages go to stderr, so
# `"$(external/omnicui/fetch.sh)" check web` runs it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
lock="$here/omnicui.lock"

if [ -n "${OMNICUI_BINARY:-}" ]; then
  [ -x "$OMNICUI_BINARY" ] || { echo "omnicui: OMNICUI_BINARY is $OMNICUI_BINARY, which isn't an executable file" >&2; exit 1; }
  echo "$OMNICUI_BINARY"
  exit 0
fi

field() { awk -v k="$1" '$1 == k { print $2; exit }' "$lock"; }
hash_of() { awk -v f="$1" '$1 == "sha256" && $3 == f { print $2; exit }' "$lock"; }
version=$(field version)
release=$(field release)
[ -n "$version" ] && [ -n "$release" ] || { echo "omnicui: $lock has no version or release line" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Downloads a release file into $2, and fails unless its hash is the one the lock gives it.
fetch() {
  want=$(hash_of "$1")
  [ -n "$want" ] || { echo "omnicui: omnicui.lock has no hash for $1" >&2; return 1; }
  echo "omnicui: fetching $1 ($version)" >&2
  if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$release/$1"
  else wget -q -O "$2" "$release/$1"; fi
  got=$(sha256 "$2")
  if [ "$got" != "$want" ]; then
    rm -f "$2"
    echo "omnicui: $1's hash is $got, and omnicui.lock says $want: not used" >&2
    return 1
  fi
}

case "$(uname -s)" in
  Linux) os=linux ;; Darwin) os=darwin ;; MINGW*|MSYS*|CYGWIN*) os=windows ;; *) os=unknown ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) arch=unknown ;;
esac
ext=; [ "$os" = windows ] && ext=.exe
binary="$here/bin/omnicui-$version$ext"
asset="omnicui_${version}_${os}_${arch}$ext"

# already here, and still the file the lock names
if [ -x "$binary" ] && [ "${1:-}" != "--source" ]; then
  if [ -f "$binary.sha256" ] && [ "$(cat "$binary.sha256")" = "$(sha256 "$binary")" ]; then
    echo "$binary"
    exit 0
  fi
fi

mkdir -p "$here/bin"
tmp=$(mktemp "$here/bin/.download.XXXXXX")
trap 'rm -f "$tmp"' EXIT

if [ "${1:-}" != "--source" ] && [ -n "$(hash_of "$asset")" ]; then
  # a download that fails or doesn't match the lock stops here, rather than building around it
  fetch "$asset" "$tmp" || exit 1
  chmod +x "$tmp"
  mv "$tmp" "$binary"
else
  # no release binary for this machine, or --source: build the release's source with Go
  command -v go >/dev/null 2>&1 || { echo "omnicui: no release binary for $os/$arch, and no Go to build $version's source with" >&2; exit 1; }
  tarball="omnicui-src-$version.tar.gz"
  fetch "$tarball" "$tmp"
  rm -rf "$here/src/$version"
  mkdir -p "$here/src/$version"
  tar -xzf "$tmp" -C "$here/src/$version"
  echo "omnicui: building $version from its source" >&2
  (cd "$here/src/$version/omnicui" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.Version=$version" -o "$binary" ./cmd/omnicui)
fi
sha256 "$binary" > "$binary.sha256"
echo "$binary"

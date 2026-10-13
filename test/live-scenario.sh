#!/bin/bash
# Drive a scratch copy of the fixture through edits and builds, and print what the live server
# pushed after each step. Manual check for M2: `test/live-scenario.sh` (needs lake, ~1 min).
set -u
V=$(cd "$(dirname "$0")/.." && pwd)
# its scratch folder, its server's site and caches: a temporary folder, never the repository
S=$(mktemp -d "${TMPDIR:-/tmp}/vp-live-XXXXXX")
echo "scratch: $S"
PORT=${PORT:-4180}
mkdir -p "$S/live"
cp -r "$V/test/fixture/." "$S/live/"
rm -rf "$S/live/.lake"
# the toolchain under test, as in the suite (test/fixturecopy.ts)
if [ -n "${VP_TOOLCHAIN:-}" ]; then
  case "$VP_TOOLCHAIN" in *:*) echo "$VP_TOOLCHAIN" ;; *) echo "leanprover/lean4:$VP_TOOLCHAIN" ;; esac > "$S/live/lean-toolchain"
fi
(cd "$S/live" && lake build >/dev/null 2>&1)

node "$V/src/server/main.ts" serve "$S/live" --port "$PORT" --site "$S/live-site" --cache "$S/live-cache" > "$S/live-server.log" 2>&1 &
SRV=$!
sleep 1
curl -sN "localhost:$PORT/api/events" > "$S/live-events.log" &
CURL=$!
trap 'kill $CURL $SRV 2>/dev/null' EXIT

show() {
  sleep "$1"
  python3 - "$2" "$S/live-events.log" <<'PY'
import json, sys
events = open(sys.argv[2]).read().split("\n\n")
data = lambda kind: [json.loads(e.split("data: ", 1)[1]) for e in events if e.startswith(f"event: {kind}\n")]
b, g = data("build"), data("graph")
st = {f["module"].replace("Fixture.", ""): f["state"] for f in b[-1]["files"]} if b else {}
last = (g[-1]["version"], g[-1]["missing"]) if g else None
print(f"{sys.argv[1]:<24} active={str(b[-1]['active']) if b else '-':<5} {st}  graph={last}")
PY
}

cd "$S/live"
show 6 "start"
sed -i 's/def helper (n : Nat) : Nat := n + 0/def helper (n : Nat) : Nat := n + 0 + 0/' Fixture/Use.lean
show 2 "edit Use, no build"
lake build >/dev/null 2>&1
show 7 "built"
sed -i 's/(bounded p).val = p.size := rfl/(bounded p).val = p.size := nonsense/' Fixture/Leaf.lean
lake build >/dev/null 2>&1
show 7 "Leaf broken, built"
sed -i 's/p.x + p.y/p.x + undefinedThing/' Fixture/Basic.lean
lake build >/dev/null 2>&1
show 5 "Basic broken, built"
sed -i 's/p.x + undefinedThing/p.x + p.y/' Fixture/Basic.lean
sed -i 's/:= nonsense/:= rfl/' Fixture/Leaf.lean
lake build >/dev/null 2>&1
show 7 "all fixed, built"

#!/bin/sh
# The checkouts of flt-regular the showcase reads, built, outside this repository:
#
#   showcase/flt-regular/setup.sh <dir>          the build the site serves (project.json, served)
#   showcase/flt-regular/setup.sh <dir> --all    every build of the story, for generate.ts
#
# <dir>/repo is a clone of flt-regular; each build is a worktree of it, <dir>/<short commit>, built
# with Mathlib's cache (`lake exe cache get`, then `lake build`; elan installs the toolchain). Its
# `.olean` files are then dated at the build's time in project.json, which the site's history knows
# it by. What is there already is kept: a second run builds what is missing and dates it again.
set -eu

dir=${1:?usage: setup.sh <dir> [--all]}
all=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
json="$here/project.json"

# the repository, then "<commit> <builtAt>" for each build wanted
read_project() {
  node -e '
    const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const all = process.argv[2] === "--all";
    console.log(p.repository);
    for (const b of p.builds) if (all || b.commit === p.served) console.log(b.commit + " " + b.builtAt);
  ' "$json" "$all"
}
repo=$(read_project | head -n 1)
builds=$(read_project | tail -n +2)

mkdir -p "$dir"
[ -d "$dir/repo/.git" ] || git clone "$repo" "$dir/repo"
echo "$builds" | while read -r commit builtAt; do
  short=$(echo "$commit" | cut -c1-7)
  tree="$dir/$short"
  if [ ! -d "$tree" ]; then
    git -C "$dir/repo" fetch --quiet origin "$commit" 2>/dev/null || true
    git -C "$dir/repo" worktree add --detach "$tree" "$commit"
  fi
  echo "== $short: building"
  (cd "$tree" && lake exe cache get && lake build)
  find "$tree/.lake/build/lib/lean" -name '*.olean' -exec touch -d "$builtAt" {} +
  echo "== $short: built, dated $builtAt"
done

#!/usr/bin/env bash
# Diagnose a dirty deploy target before `git merge --ff-only` refuses to run.
#
# `git merge` only says "your local changes would be overwritten" and lists the
# paths. That leaves whoever is on call unable to tell the safe case (someone
# hand-patched the server with the very commit that is now arriving, so the
# edits are redundant) from the dangerous one (the server carries a hotfix that
# exists nowhere in git, and discarding it loses work). Both look identical in
# git's error, so the habit it encourages is a reflexive `git checkout --`.
#
# So compare every dirty path against the incoming commit and say which case
# this is. Always exits non-zero when the tree is dirty: this reports, it never
# repairs. Fixing it stays a deliberate human step.
#
# Piped in over SSH (`ssh host 'bash -s' -- <ref>`) rather than executed from
# the checkout, so it works even when the server is behind the commit that
# introduced it.
set -euo pipefail

ROOT="${DEPLOY_ROOT:-/opt/starai}"
TARGET="${1:-origin/main}"

cd "$ROOT"

if ! git rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null 2>&1; then
  echo "preflight: cannot resolve '$TARGET' in $ROOT (fetch first)" >&2
  exit 1
fi

if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  echo "preflight: $ROOT is clean, proceeding to merge $TARGET"
  exit 0
fi

echo "preflight: $ROOT has uncommitted changes; comparing each against $TARGET"
echo

same=0
diff=0
only=0
gone=0
# Kept apart because the two need different commands: `git checkout --` errors
# out on an untracked pathspec, which would break a chained one-liner.
restore_paths=()
clean_paths=()
risky_paths=()

# -z keeps non-ASCII paths unquoted; renames emit the new path then the old one.
while IFS= read -r -d '' entry; do
  code="${entry:0:2}"
  path="${entry:3}"
  case "$code" in
    R*|C*) IFS= read -r -d '' _origin || true ;;
  esac
  untracked=0
  [ "$code" = "??" ] && untracked=1

  # Locally deleted: the merge will restore it, nothing can be lost.
  if [ ! -e "$path" ]; then
    printf '  %-10s %s\n' "DELETED" "$path"
    gone=$((gone + 1))
    restore_paths+=("$path")
    continue
  fi

  if ! git cat-file -e "$TARGET:$path" 2>/dev/null; then
    printf '  %-10s %s\n' "ONLY-LOCAL" "$path"
    only=$((only + 1))
    risky_paths+=("$path")
    continue
  fi

  if git show "$TARGET:$path" 2>/dev/null | diff -q - "$path" >/dev/null 2>&1; then
    printf '  %-10s %s\n' "SAME" "$path"
    same=$((same + 1))
    if [ "$untracked" = 1 ]; then clean_paths+=("$path"); else restore_paths+=("$path"); fi
  else
    printf '  %-10s %s\n' "DIFF" "$path"
    diff=$((diff + 1))
    risky_paths+=("$path")
  fi
done < <(git status --porcelain -z)

echo
echo "preflight: SAME=$same DIFF=$diff ONLY-LOCAL=$only DELETED=$gone"
echo

if [ "$diff" -eq 0 ] && [ "$only" -eq 0 ]; then
  {
    echo "Nothing here is missing from $TARGET: every modified path is byte-identical"
    echo "to it, and deletions are restored by the merge. The server was hand-patched"
    echo "with what is now arriving, so discarding the local copies loses nothing:"
    echo
    echo "  cd $ROOT"
    [ "${#restore_paths[@]}" -gt 0 ] && echo "  git checkout -- ${restore_paths[*]}"
    [ "${#clean_paths[@]}" -gt 0 ] && echo "  rm -f -- ${clean_paths[*]}"
    echo
    echo "Then re-run the deploy. Prefer merging through a pull request next time so"
    echo "the server never diverges in the first place."
  } >&2
  exit 1
fi

cat >&2 <<EOF
STOP: $((diff + only)) path(s) hold content that is NOT in $TARGET. Discarding
them would destroy work that exists nowhere else. Inspect before deciding:
EOF
for p in "${risky_paths[@]}"; do
  echo "  git -C $ROOT diff -- $p         # or: git -C $ROOT status -- $p" >&2
done
cat >&2 <<EOF

Commit whatever is worth keeping onto a branch and merge it via pull request,
then re-run the deploy.
EOF
exit 1

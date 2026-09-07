#!/usr/bin/env bash
# Every commit in this repository's history is authored by zealous1 and signed with the zealous1 SSH key
# in .github/allowed_signers, or is a merge-button commit GitHub signed itself. CI runs this on every push
# and pull request; run it before pushing with `pnpm identity:check`. The repository rulesets refuse the
# same things at push time; this is the copy a clone can run without GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
AUTHOR='zealous1@users.noreply.github.com'
GITHUB_MERGE='noreply@github.com'
SIGNERS="$PWD/.github/allowed_signers"
range="${1:-HEAD}"
failed=0
while IFS=$'\t' read -r sha author committer; do
  problems=()
  [[ "$author" == "$AUTHOR" ]] || problems+=("author $author")
  if [[ "$committer" == "$GITHUB_MERGE" ]]; then
    :
  elif [[ "$committer" != "$AUTHOR" ]]; then
    problems+=("committer $committer")
  elif ! git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-commit "$sha" >/dev/null 2>&1; then
    problems+=("not signed by a key in .github/allowed_signers")
  fi
  if ((${#problems[@]})); then
    printf '%s %s: %s\n' "$(git rev-parse --short "$sha")" "$(git log -1 --format=%s "$sha" | cut -c1-60)" "$(printf '%s; ' "${problems[@]}" | sed 's/; $//')"
    failed=1
  fi
done < <(git log --format='%H%x09%ae%x09%ce' "$range")
if ((failed)); then
  echo "commit identity check failed: only zealous1 commits, signed with the key in .github/allowed_signers, may exist here" >&2
  exit 1
fi
echo "commit identity check: $(git rev-list --count "$range") commits, every one zealous1 and signed"

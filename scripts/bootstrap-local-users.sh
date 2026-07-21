#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

terminal_hidden=false
restore_terminal() {
  if [ "$terminal_hidden" = "true" ]; then stty echo; printf '\n' >&2; fi
}
trap restore_terminal EXIT INT TERM

selection=${LOCAL_USER_LABEL:-ALL}
case "$selection" in A|B|ALL) ;; *) echo "LOCAL_USER_LABEL debe ser A, B o ALL" >&2; exit 2 ;; esac

if { [ "$selection" = "A" ] || [ "$selection" = "ALL" ]; } && [ -z "${MEMBER_A_BOOTSTRAP_PASSWORD:-}" ]; then
  printf 'Contraseña temporal para el miembro A (mínimo 12 caracteres): ' >&2
  terminal_hidden=true
  stty -echo
  IFS= read -r MEMBER_A_BOOTSTRAP_PASSWORD
  stty echo
  terminal_hidden=false
  printf '\n' >&2
fi
if { [ "$selection" = "B" ] || [ "$selection" = "ALL" ]; } && [ -z "${MEMBER_B_BOOTSTRAP_PASSWORD:-}" ]; then
  printf 'Contraseña temporal para el miembro B (mínimo 12 caracteres): ' >&2
  terminal_hidden=true
  stty -echo
  IFS= read -r MEMBER_B_BOOTSTRAP_PASSWORD
  stty echo
  terminal_hidden=false
  printf '\n' >&2
fi
export MEMBER_A_BOOTSTRAP_PASSWORD MEMBER_B_BOOTSTRAP_PASSWORD LOCAL_USER_LABEL

scripts/compose.sh run --rm --no-deps \
  -e MEMBER_A_BOOTSTRAP_PASSWORD -e MEMBER_B_BOOTSTRAP_PASSWORD -e LOCAL_USER_LABEL api \
  pnpm --filter @finanzas/api exec tsx scripts/bootstrap-local-users.ts

unset MEMBER_A_BOOTSTRAP_PASSWORD MEMBER_B_BOOTSTRAP_PASSWORD
echo "Variables temporales eliminadas del proceso del script."

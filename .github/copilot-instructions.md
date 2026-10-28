# Reglas para Copilot (Capri-Desktop)

## Git: prohibido
- NUNCA ejecutes `git pull`, `git fetch upstream`, `git rebase`, `git merge`, `git reset`, `git clean`, `git stash pop/drop` ni `git checkout` de otra rama.
- El remoto `upstream` (mochiiwuff/capri-desktop) es solo referencia. Nunca lo integres.
- Nunca hagas push.
- Si ves conflictos, marcadores `<<<<<<<` o un rebase/merge en curso, DETENTE y avisame. No intentes resolverlos.

## Git: permitido
- `git status`, `git diff` y `git log` para leer.
- Commits pequeños en inglés, solo cuando te lo pida.

## Archivos
- No borres ni muevas AGENTS.md, docs/roadmap.md ni nada en `voice/` (venv, modelos y audio de referencia no van a git).
- Seguí el plan de AGENTS.md y docs/roadmap.md.
- Antes de terminar, corré `pnpm test`.

# Push to Apps Script with clasp (one command)

This repo is already linked to the Apps Script project
`1KqqXTuQonXJoaaNxRdO9vgL0N10U8QfFqAJnw87kKwiwXQejjq-tdTK-` (see `.clasp.json`).

```bash
npm install -g @google/clasp      # once
clasp login                       # opens browser — log in with the Google account that owns the project
cd Bot-Assign
clasp push                        # uploads RosterReader/MasterReader/LLReader/RosterBot.gs + manifest
```

Notes
- `.claspignore` pushes only the 4 module `.gs` files + `appsscript.json`.
  The combined `Code.gs` is intentionally NOT pushed (it would duplicate every
  function). Use `Code.gs` only for manual copy-paste; use clasp for the modules.
- `appsscript.json` already enables the **Drive** advanced service (needed to
  convert `.xlsx` rosters), so you don't have to add it by hand.
- `clasp login` requires YOUR Google auth in YOUR terminal — it cannot be done
  from this environment, which is why the push itself must be run by you.

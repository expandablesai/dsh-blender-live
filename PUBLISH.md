# Releasing & publishing

**Status:** published at <https://github.com/expandablesai/dsh-blender-live>
(`main` = `00979ff`, annotated tag `v1.3.0`).
Git Credential Manager stores the push credentials on this machine, so pushes
work without re-authenticating.

## Cutting a release

1. Make the change; keep this repo the single source of truth.
2. Bump `version` in `package.json` (SemVer) and add a section to `CHANGELOG.md`.
3. Verify before pushing:

   ```powershell
   node --check index.js
   node --check client.js
   python -m py_compile blender\dsh_blender_live\__init__.py
   node -e "for (const f of ['package.json','locale/en.json','locale/zh.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))"
   ```

4. Commit, tag, push:

   ```powershell
   git add -A
   git commit -m "feat: …"
   git tag -a v1.4.0 -m "v1.4.0 — summary"
   git push origin main --tags
   ```

5. Optional: GitHub → **Releases → Draft a new release**, pick the tag, and paste
   the new `CHANGELOG.md` section as the notes. Users can then download a zip
   without cloning.

## Repository settings worth setting once

- **About** (gear icon): description *"Full Blender access for the DeepSeek
  Harness, with a reference | live viewport in the Web GUI"*, topics
  `blender`, `deepseek-harness`, `dsh`, `bpy`, `viewport`, `plugin`.
- **Releases**: attach `dsh_blender_live.zip` (the connector, see
  `docs/INSTALL.md` §1) so users can install it without cloning.
- **Screenshots**: `docs/screenshots/` is empty on purpose — the previews used
  during development showed a real client aircraft. Add your own before linking
  them from the README.

## Installing from the published repo

```powershell
git clone https://github.com/expandablesai/dsh-blender-live.git
```

then follow `docs/INSTALL.md` (English) or `docs/INSTALL.zh-CN.md` (简体中文):
install the connector in Blender, ask DSH to install the bundle from the cloned
directory, restart the Harness.

## A note on `package.json`

`"private": true` is deliberate: it prevents an accidental `npm publish` while
still allowing local/bundle installation. The package is distributed through git,
not npm.

It must stay **valid JSON without a byte-order mark** — a BOM makes
`JSON.parse` throw and the plugin fails to load. If you ever rewrite it from
PowerShell, use `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))`
rather than `Set-Content -Encoding UTF8`.

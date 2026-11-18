# Publishing this repository

`gh` (the GitHub CLI) is not installed on this machine, so the remote has to be
created once in a browser. Everything else is already done: the directory is a
git repository with a first commit.

## 1. Create the empty repository

On GitHub → **New repository**:

- **Name:** `dsh-blender-live`
- **Visibility:** Public
- **Initialise with:** *nothing* (no README, no .gitignore, no licence — they already exist here)

## 2. Point this checkout at it and push

Replace `<your-account>` with your GitHub username:

```powershell
cd "D:\DSH-PROJECTS\EXPANDABLES JET V2\plugins\dsh-blender-live"

git remote add origin https://github.com/<your-account>/dsh-blender-live.git
git push -u origin main
```

If git asks for credentials, use a **personal access token** as the password
(GitHub → Settings → Developer settings → Personal access tokens → Fine-grained,
scope: *Contents: read and write* on this one repository).

## 3. Fill in the placeholders

Two files carry `CHANGE-ME`:

```powershell
# package.json → repository.url and bugs.url
(Get-Content package.json -Raw).Replace('CHANGE-ME', '<your-account>') |
  Set-Content package.json -NoNewline
git commit -am "Point repository metadata at the real GitHub URL"
git push
```

Then edit `LICENSE` if you want your own name instead of
"the dsh-blender-live authors", and commit that too.

## 4. Optional, recommended

- **Settings → About:** add the description and topics
  `blender`, `deepseek-harness`, `plugin`, `viewport`, `bpy`.
- **Add screenshots:** put images under `docs/screenshots/` and link them from
  the README. None are committed by default, because the first previews showed a
  real client aircraft.
- **Releases:** GitHub → *Releases* → *Draft a new release*, tag `v1.2.0`, and
  paste the top section of `CHANGELOG.md`. Users can then download a zip without
  cloning.

## 5. After publishing

Anyone can install it by cloning and pointing DSH at the directory:

> "install the bundle at `<path to the clone>`"

then restarting the Harness. No npm account, registry or build step is involved.

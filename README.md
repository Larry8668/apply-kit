# Apply Kit

A personal Firefox extension that fills job applications from a profile you keep. It runs on Firefox for desktop and Android and syncs through Firefox Sync.

## What it does

- **Fill button.** On pages that look like job applications (Greenhouse, Lever, Workday, Ashby, company career pages, and similar), a "Fill N fields" button appears in the bottom-right corner. Tapping it fills every empty field it recognises and highlights them in yellow. It never overwrites anything you've already typed, and it never submits the form.
- **Suggestions as you go.** When you tap into a field, a small box offers the matching profile value, plus up to three saved answers if the field is a longer question.
- **Saved answers.** After writing an answer to a question like "Why do you want to work here?", tap "Save as answer". Questions with similar wording on later forms get it as a suggestion.
- **Extra fields.** For anything the profile doesn't cover, such as EEO questions or referral codes, add a name, some label keywords, and a value in settings.
- **Toolbar menu.** "Fill this page" forces filling on a page the extension didn't recognise as an application. "Edit profile" opens settings.

## Try it on desktop (temporary)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on…" and pick `extension/manifest.json`.

   Or, from the repo root: `npm install`, then `npm start`. That launches a fresh Firefox profile with the extension loaded and reloads it when files change.
3. Click the toolbar icon, choose "Edit profile", and fill in your details.

A temporary add-on is removed when Firefox restarts. To keep it, and to get it onto your phone, it needs to be signed.

## Install permanently (desktop and Android)

Release versions of Firefox only install signed add-ons. Mozilla signs "unlisted" add-ons for free, and they stay private, not published on the add-on store.

1. Make an account at addons.mozilla.org, then create API keys under Tools → Manage API Keys.
2. Sign it, either on GitHub or locally:
   - **GitHub:** add the keys as repo secrets `AMO_API_KEY` and `AMO_API_SECRET` (Settings → Secrets and variables → Actions). Then run the "Sign and release" workflow from the Actions tab, or push a version tag such as `v0.1.0`. The signed `.xpi` is attached to a GitHub release.
   - **Locally:** see [Signing locally](#signing-locally) below.

   Mozilla only signs each version number once, so bump `version` in `extension/manifest.json` before signing again. See [Releasing a new version](#releasing-a-new-version).
3. **Desktop:** download the `.xpi` from the latest GitHub release (Firefox may ask to allow the download), then open `about:addons`, click the gear icon, and choose "Install Add-on From File…".
4. **Android:** copy the `.xpi` to your phone. In Firefox, go to Settings → About Firefox and tap the Firefox logo five times to unlock the debug menu. Go back to Settings, choose "Install extension from file", and pick the `.xpi`. These menu names have moved between Firefox versions, so search Mozilla's support pages if yours differs.

## Syncing between devices

Sign in to the same Firefox account on both devices, and make sure Add-ons is checked under Settings → Sync. Changes usually arrive within a few minutes. If sync ever lags or fails, use "Export backup" on one device and "Import backup" on the other.

Sync storage is about 100 KB total, with 8 KB per saved answer (roughly 7,000 characters). That's plenty for a profile and dozens of answers. Settings shows how much you're using.

## Files

The extension lives in `extension/`. The repo root holds tooling only.

| File | Purpose |
| --- | --- |
| `extension/manifest.json` | Extension config. Uses Manifest V2, which Firefox fully supports and which grants site access at install, so there's no extra permission step on Android. |
| `extension/rules.js` | Profile fields and the patterns used to recognise them on forms. Edit this to add fields or tune matching. |
| `extension/storage.js` | Read and write to `storage.sync`. |
| `extension/content.js` | Finds fields, fills them, and shows the suggestion box and the fill button. |
| `extension/options.*` | Settings page. |
| `extension/popup.*` | Toolbar menu. |
| `package.json` | Dev scripts (see below). |
| `.github/workflows/` | Lint on every push and PR; sign and release on demand. |

## Development

Run `npm install` once, then from the repo root:

| Command | What it does |
| --- | --- |
| `npm run lint` | Checks the extension with Mozilla's linter. |
| `npm start` | Opens desktop Firefox with the extension loaded. |
| `npm run start:android -- --android-device=DEVICE_ID` | Runs it in Firefox on a USB-connected Android phone. Needs `adb` installed, USB debugging on in the phone's developer options, and "Remote debugging via USB" on in Firefox's settings. `adb devices` lists the device ID. If more than one Firefox build is installed, add `--firefox-apk=org.mozilla.firefox`. |
| `npm run sign` | Signs an unlisted `.xpi` into `web-ext-artifacts/`. Reads `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from the environment. |

## Signing locally

The keys can live in a `.env` file at the repo root. It's gitignored, so it never gets committed:

```
AMO_API_USER=user:12345:67
AMO_API_SECRET=your-64-character-secret
```

`npm run sign` doesn't read `.env` by itself. web-ext expects `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`, so export them from the file first:

```
export WEB_EXT_API_KEY=$(grep ^AMO_API_USER= .env | cut -d= -f2-) WEB_EXT_API_SECRET=$(grep ^AMO_API_SECRET= .env | cut -d= -f2-)
npm run sign
```

The signed `.xpi` file appears in `web-ext-artifacts/`. The same two values are stored on GitHub as the repo secrets `AMO_API_KEY` and `AMO_API_SECRET`; if you rotate the keys, update both places.

## Releasing a new version

Mozilla signs each version number exactly once. Trying to sign a version that's already signed fails, so every release needs a new number.

1. Bump `version` in `extension/manifest.json` (for example `0.1.0` → `0.1.1`). Keep `version` in `package.json` matching, for tidiness.
2. Commit and push.
3. Tag and push the tag: `git tag v0.1.1 && git push origin v0.1.1`. The tag has to match the manifest version or the workflow stops. You can also run "Sign and release" from the Actions tab, which uses the manifest version as the tag.
4. The signed `.xpi` is attached to the new GitHub release. Install it the same way as the first time. Firefox treats it as an update and keeps your data.

## Known limits and next steps

- **Resume upload isn't automatic.** Browsers don't let extensions put files into upload fields without your action, and sync storage is too small for a PDF anyway.
- **Custom dropdowns** (searchable comboboxes on Workday and some Ashby forms) aren't real `<select>` elements, so they often need a manual tap. Adding per-site adapters in `extension/content.js` is the fix, and Workday is the one most worth doing.
- **English labels only.** Matching is pattern-based and English-only. Adding patterns in other languages to `extension/rules.js` works.
- **Good next feature:** draft answers to new questions with an AI model, using your saved answers and the job description as context. This needs an API key and a small settings field for it.

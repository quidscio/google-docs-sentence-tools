# Installation and updates

Sentence Tools is a personal Google Workspace add-on. It appears in the right-hand side panel of Google Docs after installation for your Google account. Use a standalone Apps Script project for this version.

## Already installed

Open a Doc with the same Google account, open **Sentence Tools** in the right-hand side panel, and follow the [usage guide](USAGE.md). The account installation works across your Docs; you do not add a script to each document.

For code updates, run `npm run upload` from this repository, refresh Docs, and reopen the panel. Keep the existing `.clasp.json` so updates target the same Apps Script project. The steps below are for initial setup or a new local checkout.

## 1. Prepare the local tools

Use Node.js 22 or newer. Open a terminal in this repository and install its pinned dependencies if they are absent:

```powershell
Set-Location 'C:\q\arc\projects\extensions\google-docs-sentence-tools'
npm ci
```

The repository uses `@google/clasp` 3.4.1 through its npm scripts. It does not need a global clasp install.

Open [Apps Script user settings](https://script.google.com/home/usersettings) using the Google account you use for Docs, then enable **Google Apps Script API**. This lets clasp create and upload Apps Script projects. [Google's clasp guide](https://developers.google.com/apps-script/guides/clasp) explains the command-line authorization flow.

## 2. Sign in

```powershell
npm run clasp:login
```

Complete the browser sign-in and authorization. Use the same Google account for clasp, the Apps Script editor, and the documents where you want the add-on. The command must finish before setup can upload.

Confirm the upload account with `npm run clasp:account`. This clasp authorization lets the local tools upload code; the add-on may separately ask for authorization when you first use it inside Docs.

Clasp stores its login credentials in `.clasprc.json` in your user profile, normally `%USERPROFILE%\.clasprc.json` on Windows. This is separate from the repository's `.clasp.json` project mapping.

## 3. Create and upload the standalone project

```powershell
npm run setup
```

On first use, the setup helper creates a private standalone Apps Script project and records its Script ID in the local `.clasp.json`. It runs the checks, builds `dist/`, uploads the code, then opens the Apps Script editor. On later runs it reuses that configured project instead of creating another one.

The local `.clasp.json` points `rootDir` to `dist`. It is excluded from Git. The helper reports missing authentication or an unavailable Apps Script API with instructions; complete that prerequisite and rerun setup.

Setup creates the project and uploads code. It does not publish a Marketplace listing, share the project, or install the add-on into your account.

If you already have a **dedicated standalone** Apps Script project for Sentence Tools, you can use its Script ID on the first setup:

```powershell
npm run setup -- --script-id YOUR_STANDALONE_SCRIPT_ID
```

Find the ID in that project's **Project Settings → IDs → Script ID**. Use a project intended for this add-on; uploaded code becomes that project's source. Do not supply a document ID or the earlier document-bound script's ID. The helper refuses to switch an existing local configuration to a different Script ID.

On a new checkout or another computer, `.clasp.json` will be absent because it is ignored by Git. Sign in and use the existing project's Script ID as shown above to continue updating the installed add-on instead of creating another project.

If initial project creation is interrupted, setup leaves an ignored local `.clasp-create-pending.json` marker and prevents another automatic creation. Check your [Apps Script dashboard](https://script.google.com/home). If **Sentence Tools** exists, recover with `npm run setup -- --script-id YOUR_SCRIPT_ID`. If no project was created, retry with `npm run setup -- --retry-create`. Recovery rebuilds the generated files and clears the marker once the project is linked.

You can preview setup without signing in or changing your account with `npm run setup -- --dry-run`.

## 4. Install for personal use

In the uploaded Apps Script project:

1. Choose **Deploy → Test deployments**.
2. Use **Test latest code** for this personal installation, select **Install**, then **Done**. If the dialog already shows **Uninstall**, it is installed for the current account.
3. Refresh an open Google Doc and open **Sentence Tools** in its right-hand side panel.
4. Authorize the add-on when prompted, select text in the document, and use its buttons.

Google supports installing an unpublished Workspace add-on for personal use this way. It becomes available in the host applications declared by its manifest; this project declares Google Docs. See [Google's test and personal-use installation guide](https://developers.google.com/workspace/add-ons/how-tos/testing-workspace-addons).

You install once for the account. Open a second, unrelated Google Doc to confirm that the side-panel entry appears there too. Each button reads the current document's selection at the time of the click. Use the buttons inside Docs to test formatting; running callbacks from the Apps Script editor does not provide a document selection.

Start with the [usage guide](USAGE.md). For a quick check, expand `First sentence. Next sentence?` into two lines, then collapse it again. Repeat with two groups separated by a blank line: collapse should join each group while keeping that blank line. The [manual checklist](MANUAL-TESTS.md) covers additional selection and formatting cases.

## Update the installed add-on

After changing source files:

```powershell
npm run upload
```

Upload runs the automated tests and rebuilds the project before pushing to the configured Script ID. The **Test latest code** installation uses that uploaded code. Refresh Docs and reopen the add-on panel to load the update; ordinary code updates do not require reinstalling or copying scripts into documents. Documentation-only changes do not require an upload.

If a manifest or permission change does not appear after refreshing, open **Deploy → Test deployments**, uninstall, and install again; complete any new authorization prompt.

Other useful commands:

```powershell
npm run clasp:open
npm run clasp:status
npm run check
npm run clasp:logout
```

The upload status should include only the generated `Code.gs` and `appsscript.json`. Local tests, source modules, and login credentials are not upload artifacts.

## Migrate from the document-bound version

Run setup with a new standalone project, then install it as described above. Existing documents can use the account-installed side-panel add-on immediately after refresh.

The old custom **Sentence Tools** menu can remain until you remove it. To remove it, open the old document's **Extensions → Apps Script** and delete only the old Sentence Tools `onOpen` function. If that function also builds unrelated menus, remove only its Sentence Tools menu-creation statements. Preserve other scripts and reload the document. Copies of that document may still carry their own old bound script and can be cleaned up the same way when needed.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Setup says authentication is missing | Run `npm run clasp:login` and finish browser authorization. |
| Apps Script API error | Enable the API in the signed-in account's Apps Script user settings, then retry. |
| Side-panel entry is missing | Complete Install in the standalone project's Test deployments dialog; refresh Docs and confirm the same account is active. |
| Old behavior remains after an update | Confirm `npm run upload` succeeds for the expected account and project, then refresh Docs and reopen Sentence Tools. Check that the test deployment uses the latest code. |
| `nothing selected` | Select actual text in the document after opening the panel, then click a button. A cursor or isolated paragraph ending is not enough. |
| Selection still fails on real text | Confirm installation from the current standalone build, note the browser/account, and run the two-document and active-tab checks. The command never falls back to editing the whole document. |
| Old menu is still visible | It belongs to the earlier bound script; follow the migration steps above. |
| Organization blocks installation | Check the Workspace administrator's Apps Script and add-on policies. |

To remove the personal installation, open its Apps Script project, choose **Deploy → Test deployments → Uninstall → Done**, and refresh Docs. This does not delete your documents or the local repository.

# Google Docs Sentence Tools

A personal Google Workspace add-on with two buttons in the Google Docs side panel:

- **Expand** puts each selected sentence on a separate soft line, recognizing periods, question marks, and exclamation points. Each bullet remains a single bullet.
- **Collapse** joins consecutive selected soft lines and adjacent ordinary paragraphs with spaces. Blank lines separate runs and remain intact. List items, table cells, and headings keep their boundaries.

With no text selected, either button displays **nothing selected** and leaves the document unchanged. The selection is read when you press the button.

## Use the installed add-on

1. Open a Google Doc using the account where Sentence Tools is installed.
2. Open **Sentence Tools** in the right-hand side panel.
3. Select the text to change, then click **Expand** or **Collapse**.

Collapse joins each uninterrupted group of selected sentences separately. Leave a blank line between groups to keep them apart. See the [usage guide](docs/USAGE.md) for examples, selection behavior, bullets, and formatting limits.

## Install once for your Google account

Node.js 22 or newer is required for the local setup tools. This project includes a pinned local version of `clasp`; a global installation is unnecessary.

1. From this repository, run `npm ci` if dependencies have not been installed.
2. Enable the **Google Apps Script API** in [Apps Script user settings](https://script.google.com/home/usersettings).
3. Run `npm run clasp:login` and complete the Google sign-in in your browser.
4. Run `npm run setup`. It creates a standalone Apps Script project, checks and uploads the code, and opens that project in the browser.
5. In the Apps Script editor, choose **Deploy → Test deployments → Install → Done**.
6. Refresh Google Docs, open **Sentence Tools** from the right-hand side panel, and authorize it when prompted. Select text and press **Expand** or **Collapse**.

This is a personal, unpublished Workspace add-on. The installation applies to your account so you can open it in different Google Docs without adding scripts to each document. Google describes this [personal installation workflow](https://developers.google.com/workspace/add-ons/how-tos/testing-workspace-addons). Installation and Google authorization remain browser steps; local setup does not publish to the Marketplace or install the add-on automatically.

See [installation and updates](docs/INSTALL.md) for detailed instructions, use of an existing dedicated standalone Script ID, and migration from the earlier document-bound version. If it is already installed, use `npm run upload` for code updates, then refresh Docs and reopen Sentence Tools; routine updates do not require another installation.

## Examples

Expand:

```text
Dr. Smith arrived at 3 p.m. We discussed options, etc. Then we left! Any questions?
```

Result:

```text
Dr. Smith arrived at 3 p.m.
We discussed options, etc.
Then we left!
Any questions?
```

Decimals and URLs stay intact:

```text
The value is 3.14.
Visit https://example.com/help.
Ready?
```

For a bullet containing `First sentence. Second sentence!`, expansion produces:

```text
• First sentence.
  Second sentence!
```

The second line remains inside the original list item. Collapse returns that item to one line while keeping neighboring bullets separate.

## Behavior and limits

- Only selected text is reformatted, including partial paragraph selections. Expansion preserves existing paragraph boundaries; collapse can join consecutive selected ordinary paragraphs. Empty or whitespace-only paragraphs and blank soft lines stop collapse from joining separate runs.
- Bold, italic, links, and other text formatting are retained by editing separators and transferring existing text elements. A merged paragraph keeps the first paragraph's paragraph style.
- Affected paragraphs and list items must contain text only. Images, drawings, equations, chips, or other embedded objects cause validation to reject the operation before editing.
- Text within a heading or table cell can be reformatted. Collapsing never joins different cells, list items, or heading boundaries.
- English contextual heuristics distinguish abbreviation periods, initials, decimal numbers, and addresses from ordinary sentence endings. Ambiguous prose can require a manual correction. No external AI service is used.
- Single line breaks inside selected text are normalized by the chosen command; blank lines are preserved. Review manually arranged verse, code, and other special layouts before applying it.
- Validation happens before edits, but Apps Script document changes are not transactional. A service failure during editing can leave a partial result; use Docs Undo or version history to recover and check the document.

The automated suite contains 75 tests. The owner confirmed the installed collapse fix preserves the blank line in the reported two-group example. The [manual checklist](docs/MANUAL-TESTS.md) records that confirmation and the remaining checks for selections, active tabs, and formatting.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install pinned local development tools |
| `npm run clasp:login` | Sign in to Google for script uploads |
| `npm run clasp:account` | Show the account used for uploads |
| `npm run setup` | Create or reuse this project's standalone script, check, upload, and open it |
| `npm run upload` | Check, rebuild, and upload an update |
| `npm run clasp:open` | Open the configured Apps Script project |
| `npm run clasp:status` | Show files selected for upload |
| `npm run clasp:logout` | Sign out of clasp |
| `npm run check` | Run automated tests and build the Apps Script bundle |

Edit `src/` and rebuild; `dist/Code.gs` and `dist/appsscript.json` are generated upload artifacts. `src/Code.js` supplies the Workspace card and Docs adapter, and `src/SentenceEngine.js` handles sentence boundaries.

The runtime requests only current-document access. Deployment credentials remain in clasp's user-profile configuration, outside this repository. See [privacy and permissions](docs/PRIVACY.md).

# Manual Google Docs checks

Automated tests exercise the sentence engine and a modeled Docs adapter. These checks validate the installed Google Workspace add-on in real Docs. Use the [installation guide](INSTALL.md) for setup and the [usage guide](USAGE.md) for everyday operation.

## Recorded verification

- 2026-11-06: The personal installation was completed in Apps Script; the Test deployments dialog showed **Uninstall** afterward.
- 2026-11-06: All 75 automated tests passed before the blank-line fix was uploaded. Regression cases cover empty and whitespace-only paragraphs, blank soft lines, mixed soft/paragraph breaks, bullets, partial selections, formatting, and repeated collapse.
- 2026-11-06: The owner confirmed the installed collapse fix works on the reported two-group example. The blank line between the groups remains intact.

This records the checks actually observed or reported. The remaining checklist cases below are not all confirmed as live-tested.

Install the current build for your account using **Deploy → Test deployments → Install → Done**. Use disposable documents, open Sentence Tools from the right-hand side panel, and invoke both buttons there.

## Installation and selection context

| Check | Action | Expected result |
| --- | --- | --- |
| One account installation | Open two unrelated Google Docs after installing. | Sentence Tools appears in the right-hand side panel of both; neither document needs a bound script. |
| Opening the panel | Open Sentence Tools without selecting text. | The panel loads without editing the document. |
| No selection | Place the cursor in text and press each button. | Error displays exactly `nothing selected`; content stays unchanged. |
| Empty ending selection | Select only a paragraph ending if the editor allows it. | No content changes and no document-wide fallback. |
| Selection at click time | Select text A, open the panel, then select different text B and press Expand. | Only the current selection B changes. |
| Switch documents | Select distinct text in each of two documents; invoke a command in the second. | Only the second document's selection changes. |
| Active Docs tab | Add a second tab within one document, select its text, and use each command. | Only the active tab's selection changes; the first tab stays untouched. |
| After authorization | Complete the first-use authorization, reselect text, and try a button. | The command uses the live selection and reports any error without processing the whole document. |
| After upload | Run `npm run upload`, refresh Docs or reopen the panel, and repeat a simple case. | The current build loads and the buttons still work. |

## Text and formatting

For each case, check neighboring unselected content as well as the selected range.

| Check | Action | Expected result |
| --- | --- | --- |
| Basic endings | Expand `First. Second? Third! Fourth.` | Four soft lines; punctuation stays intact. |
| Abbreviation within sentence | Expand `Dr. Smith visited Mr. Jones. They talked.` | No break after `Dr.` or `Mr.`; break after `Jones.`. |
| Abbreviation at ending | Expand `We packed tools, etc. Then we left.` | Break after `etc.`. |
| Time contexts | Expand `We met at 3 p.m. on Tuesday. We left at 4 p.m. We returned later.` | Keep `p.m. on` together; break before `We returned`. |
| Decimals and URL | Expand `The value is 3.14. Visit https://example.com/help. Ready?` | Three lines; number and URL stay intact. |
| Closing punctuation | Expand `She asked, "Ready?" He nodded!` | Closing quote stays on the first line. |
| Bullets | Put two sentences in each of two bullet items; select both and expand. | Two bullets remain; second sentences move to soft lines inside their items. |
| Numbered and nested lists | Repeat in numbered and nested items. | Numbering, nesting, and item boundaries stay intact. |
| Collapse bullet lines | Select the expanded list and collapse. | Each item becomes one line; separate items remain separate. |
| Collapse paragraphs | Create three ordinary paragraphs, one sentence each; select all and collapse. | One paragraph with spaces between sentences, using the first paragraph's paragraph style. |
| Blank paragraph separator | Create two runs of sentence paragraphs separated by an empty paragraph; select both runs and collapse. Repeat with spaces or tabs in the separator. | Each run collapses separately; the separator and its whitespace remain intact. |
| Blank soft line separator | Put two runs of sentences in one paragraph or bullet using Shift+Enter, with two soft breaks between runs; select and collapse. | Single soft breaks become spaces, while the blank line and bullet boundary remain intact. |
| Mixed separator | Put a soft break at the end of a paragraph or the start of the next; select both and collapse. | The soft break and paragraph boundary remain as a blank line; each run collapses independently. |
| Partial paragraph | Select middle sentences, leaving a prefix and suffix unselected; expand and collapse. | Only selected separators change; outside characters and formatting stay intact. |
| Partial multiple paragraphs | Start selection midway through one paragraph and end midway through the next; collapse. | The selected paragraph boundary joins; the unselected prefix and suffix remain intact. |
| Formatting | Include bold, italic, colored, and linked words around sentence boundaries. | Expansion and collapse retain each word's formatting and links. |
| Headings | Include a heading between selected ordinary paragraphs; collapse. | Heading boundaries remain. |
| Tables | Select text in one cell, then test a selection spanning cells. | Text can be reformatted within cells; cells and text across cells are never merged. |
| Embedded objects | Include an image, drawing, chip, or equation in an affected paragraph. | The entire operation is rejected before making changes. |
| Positioned images | Anchor a positioned image to an affected paragraph and select text there. | The entire operation is rejected without removing or moving the image. |
| Repeated commands | Expand twice, then collapse twice on the same fully selected content. | Second execution does not add repeated breaks or spaces. |
| Larger selection | Select several pages of ordinary paragraphs and lists. | No truncation, lost formatting, or changes outside the selection. |
| Undo | Apply a command and use Docs Undo. | Inspect restoration in the actual editor; do not assume a single undo step without checking. |

Sentence recognition uses English heuristics. Inspect ambiguous prose and correct individual boundaries where needed. Apps Script changes are not transactional; after an unexpected service failure, inspect the result and use Undo or version history as appropriate.

Record the date, browser, account type, build revision, and any failing example. Add a focused automated regression test when a concrete parser or adapter defect is reproduced.

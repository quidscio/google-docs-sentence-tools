# Using Sentence Tools

Sentence Tools reformats the text you select in Google Docs. Install it once for your Google account using the [installation guide](INSTALL.md); then use the same side-panel add-on in your other Docs.

The subtitle under **Sentence Tools** shows the build date and time as `Build yyyyMMdd-HHmmss`, for example `Build 20261106-143025`. It uses 24-hour time in `America/New_York` and stays fixed for that build.

## Choose text and an action

1. Open a Google Doc with the account where the add-on is installed.
2. Open **Sentence Tools** in the right-hand side panel.
3. Select the text you want to change. You can select part of a paragraph, several paragraphs, or list items.
4. Click **Expand** or **Collapse** in the panel.

Each click uses the current selection. If authorization interrupts the first use, finish it, reselect the text, and click the button again. With only a cursor and no selected text, either action displays exactly **nothing selected** and changes nothing.

## Expand: one sentence per line

Before:

```text
Dr. Smith arrived. Are we ready? Yes! We packed tools, etc. Then we left.
```

After:

```text
Dr. Smith arrived.
Are we ready?
Yes!
We packed tools, etc.
Then we left.
```

Periods, question marks, and exclamation points can end sentences. English heuristics keep common titles, initials, decimals, and abbreviations together while allowing an abbreviation to end a sentence when the surrounding text supports it. Ambiguous abbreviations may need manual correction.

Expansion inserts soft line breaks, like **Shift+Enter**, inside each paragraph or list item. Existing paragraph boundaries and blank lines stay in place. A line break in the middle of a sentence becomes a space.

## Collapse: join consecutive sentences

Collapse replaces single selected line breaks with spaces and joins adjacent selected ordinary paragraphs. A blank line ends a group: sentences on opposite sides of it remain separate.

Before:

```text
This is a test of question marks?
And this is a test of exclamation points!
And this is just the final sentence.

And, what if I skip a line?
What then, huh?
```

After:

```text
This is a test of question marks? And this is a test of exclamation points! And this is just the final sentence.

And, what if I skip a line? What then, huh?
```

The separator can be an empty paragraph, a paragraph containing only spaces or tabs, or repeated soft line breaks inside one paragraph. A soft break next to a paragraph boundary also preserves the blank line. Separator whitespace remains intact.

Paragraph spacing added through Docs formatting is not an empty line. Insert an actual blank line when you want it to stop collapse from joining adjacent ordinary paragraphs. Text may still wrap visually at the page margin after collapsing.

## Bullets and numbered lists

Expand keeps each list item intact:

```text
• First task. Continue it!
• Second task? Finish it.
```

becomes:

```text
• First task.
  Continue it!
• Second task?
  Finish it.
```

Collapse joins the consecutive lines within each item. It does not merge neighboring bullets, change numbering or nesting, or remove blank lines inside an item.

## Selection and formatting

- Only selected separators change. Partially selected whitespace and unselected text remain intact.
- A selection spanning the end of one ordinary paragraph and the start of the next can join that boundary, even when the first and last paragraphs are only partly selected.
- Bold, italic, links, and other text attributes are retained. Joined paragraphs use the first paragraph's paragraph formatting.
- Headings, list items, and different table cells retain their boundaries. Selected text inside them can still be reformatted.
- Affected paragraphs must contain text only. Images, drawings, equations, chips, and other embedded objects cause the operation to be rejected before editing.
- If the selection already has the requested layout, the panel reports **No changes needed.**

Review prose with unusual abbreviations or deliberate layouts such as verse and code. If a result needs reversing, use Docs **Undo** and inspect the restored text; document edits are not guaranteed to form a single undo step. If an error occurs during editing, inspect the document because Apps Script changes are not transactional.

## After an update

Refresh Google Docs and reopen Sentence Tools after a code upload, then check the build stamp under the title to confirm the new build loaded. Your existing personal installation stays in place. See [updates and troubleshooting](INSTALL.md#update-the-installed-add-on) if the panel still behaves like an older version.

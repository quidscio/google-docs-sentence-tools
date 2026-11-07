'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// This model deliberately keeps paragraphs and list items distinct. Newlines
// inserted into a paragraph become soft breaks, as in DocumentApp. Text styles
// are tracked per character so a test can detect destructive text replacement.
class Element {
  constructor(type) {
    this.type = type;
    this.parent = null;
  }
  getType() { return this.type; }
  getParent() { return this.parent; }
  asText() { return this; }
  asParagraph() { return this; }
  asListItem() { return this; }
  asTable() { return this; }
  asTableRow() { return this; }
  asTableCell() { return this; }
}

class Container extends Element {
  constructor(type, children = []) {
    super(type);
    this.children = children;
    children.forEach(child => { child.parent = this; });
  }
  getNumChildren() { return this.children.length; }
  getChild(index) { return this.children[index]; }
  getChildIndex(child) { return this.children.indexOf(child); }
  getText() { return this.children.map(child => child.getText()).join('\n'); }
}

class Text extends Element {
  constructor(text, style = {}) {
    super('TEXT');
    this.text = text;
    this.styles = Array.from({ length: text.length }, () => ({ ...style }));
  }
  getText() { return this.text; }
  insertText(offset, value) {
    assert.ok(offset >= 0 && offset <= this.text.length, 'valid insertion offset');
    value = value.replace(/\n/g, '\r');
    const style = this.styles[Math.max(0, offset - 1)] || {};
    this.text = this.text.slice(0, offset) + value + this.text.slice(offset);
    this.styles.splice(offset, 0, ...Array.from({ length: value.length }, () => ({ ...style })));
    return this;
  }
  deleteText(start, end) {
    assert.ok(start >= 0 && end >= start && end < this.text.length, 'valid inclusive deletion range');
    this.text = this.text.slice(0, start) + this.text.slice(end + 1);
    this.styles.splice(start, end - start + 1);
    return this;
  }
  getAttributes(offset = 0) { return { ...(this.styles[offset] || {}) }; }
  setAttributes(start, end, attributes) {
    if (arguments.length === 1) {
      attributes = start;
      start = 0;
      end = this.text.length - 1;
    }
    for (let i = start; i <= end; i += 1) this.styles[i] = { ...this.styles[i], ...attributes };
    return this;
  }
  getTextAttributeIndices() {
    const indices = [];
    for (let i = 0; i < this.styles.length; i += 1) {
      if (i === 0 || JSON.stringify(this.styles[i]) !== JSON.stringify(this.styles[i - 1])) indices.push(i);
    }
    return indices;
  }
}

class Paragraph extends Container {
  constructor(text, type = 'PARAGRAPH', heading = 'NORMAL') {
    super(type, Array.isArray(text) ? text : [new Text(text)]);
    this.heading = heading;
  }
  getHeading() { return this.heading; }
  getPositionedImages() { return this.positionedImages || []; }
  getAttributes() { return { HEADING: this.heading }; }
  getText() { return this.children.filter(child => child.type === 'TEXT').map(child => child.getText()).join(''); }
  editAsText() {
    const paragraph = this;
    return {
      getText() { return paragraph.getText(); },
      insertText(offset, value) {
        const texts = paragraph.children.filter(child => child.type === 'TEXT');
        let remaining = offset;
        for (const text of texts) {
          if (remaining <= text.getText().length) {
            text.insertText(remaining, value);
            return this;
          }
          remaining -= text.getText().length;
        }
        throw new Error('Insertion outside paragraph');
      },
      deleteText(start, end) {
        let offset = 0;
        const deletions = [];
        for (const text of paragraph.children.filter(child => child.type === 'TEXT')) {
          const localStart = Math.max(0, start - offset);
          const localEnd = Math.min(text.getText().length - 1, end - offset);
          if (localStart <= localEnd) deletions.push([text, localStart, localEnd]);
          offset += text.getText().length;
        }
        assert.ok(start >= 0 && end < offset && start <= end, 'valid flattened deletion');
        for (const [text, localStart, localEnd] of deletions.reverse()) text.deleteText(localStart, localEnd);
        return this;
      },
      getAttributes(index = 0) {
        for (const text of paragraph.children.filter(child => child.type === 'TEXT')) {
          if (index < text.getText().length) return text.getAttributes(index);
          index -= text.getText().length;
        }
        return {};
      },
      setAttributes(start, end, attributes) {
        let offset = 0;
        for (const text of paragraph.children.filter(child => child.type === 'TEXT')) {
          const localStart = Math.max(0, start - offset);
          const localEnd = Math.min(text.getText().length - 1, end - offset);
          if (localStart <= localEnd) text.setAttributes(localStart, localEnd, attributes);
          offset += text.getText().length;
        }
        return this;
      }
    };
  }
  merge() {
    const parent = this.parent;
    const index = parent.getChildIndex(this);
    assert.ok(index > 0, 'merge requires preceding sibling');
    const previous = parent.getChild(index - 1);
    assert.equal(previous.getType(), this.getType(), 'merge requires matching element types');
    this.children.forEach(child => { child.parent = previous; });
    previous.children.push(...this.children);
    parent.children.splice(index, 1);
    this.parent = null;
    return previous;
  }
}

function range(element, start, end) {
  return {
    getElement: () => element,
    isPartial: () => start !== undefined,
    getStartOffset: () => start === undefined ? -1 : start,
    getEndOffsetInclusive: () => end === undefined ? -1 : end
  };
}

function createDocument(paragraphs, selected) {
  const body = new Container('BODY_SECTION', paragraphs);
  const notifications = [];
  const responses = [];
  let releaseCount = 0;
  let selectionReadCount = 0;
  function cardObject(type) {
    return {
      type, widgets: [], sections: [],
      setText(text) { this.text = text; return this; },
      setTitle(title) { this.title = title; return this; },
      setTextButtonStyle(style) { this.style = style; return this; },
      setOnClickAction(action) { this.action = action; return this; },
      setFunctionName(functionName) { this.functionName = functionName; return this; },
      setHeader(header) { this.header = header; return this; },
      addWidget(widget) { this.widgets.push(widget); return this; },
      addSection(section) { this.sections.push(section); return this; },
      build() { return this; }
    };
  }
  const doc = {
    getSelection: () => {
      selectionReadCount += 1;
      return selected === null ? null : { getRangeElements: () => selected };
    },
    getBody: () => body,
    getActiveTab: () => ({ asDocumentTab: () => ({ getBody: () => body }) })
  };
  const context = vm.createContext({
    console,
    DocumentApp: {
      ElementType: Object.fromEntries(['TEXT', 'PARAGRAPH', 'LIST_ITEM', 'BODY_SECTION', 'HEADER_SECTION', 'FOOTER_SECTION', 'TABLE', 'TABLE_ROW', 'TABLE_CELL', 'INLINE_IMAGE', 'FOOTNOTE_SECTION'].map(type => [type, type])),
      ParagraphHeading: { NORMAL: 'NORMAL', HEADING1: 'HEADING1' },
      getActiveDocument: () => doc,
      getUi: () => { throw new Error('Workspace add-ons must use CardService, not document UI'); }
    },
    CardService: {
      TextButtonStyle: { FILLED: 'FILLED' },
      newCardBuilder: () => cardObject('card'),
      newCardHeader: () => cardObject('header'),
      newCardSection: () => cardObject('section'),
      newTextParagraph: () => cardObject('paragraph'),
      newTextButton: () => cardObject('button'),
      newAction: () => cardObject('action'),
      newNotification: () => cardObject('notification'),
      newActionResponseBuilder: () => ({
        setNotification(notification) { this.notification = notification; return this; },
        setStateChanged(changed) { this.changed = changed; return this; },
        build() {
          const response = { notification: { text: this.notification.text }, stateChanged: this.changed };
          notifications.push(response.notification.text);
          responses.push(response);
          return response;
        }
      })
    },
    LockService: {
      getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => { releaseCount += 1; } }),
      getUserLock: () => ({ tryLock: () => true, releaseLock: () => { releaseCount += 1; } })
    }
  });
  for (const filename of ['SentenceEngine.js', 'Code.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', filename), 'utf8'), context, { filename });
  }
  return {
    body, notifications, responses, context,
    setSelection: next => { selected = next; },
    selectionReadCount: () => selectionReadCount,
    releaseCount: () => releaseCount
  };
}

function assertSuccess(state) {
  assert.equal(state.responses.length, 1);
  assert.equal(state.responses[0].stateChanged, true);
  assert.match(state.responses[0].notification.text, /^(Expanded|Collapsed) selected text\.$/);
}

function styledText(paragraph) {
  return paragraph.children.filter(child => child.type === 'TEXT').flatMap(child =>
    child.text.split('').map((character, index) => ({ character, style: child.styles[index] }))
  );
}

for (const command of ['expandSelection', 'collapseSelection']) {
  test(`${command}: no selection displays exact error and makes no edits`, () => {
    const paragraph = new Paragraph('First sentence. Second sentence.');
    const state = createDocument([paragraph], null);
    state.context.LockService.getDocumentLock = () => { throw new Error('No selection must not acquire a lock'); };
    const response = state.context[command]();
    assert.deepEqual(state.notifications, ['nothing selected']);
    assert.equal(response.notification.text, 'nothing selected');
    assert.equal(response.stateChanged, false);
    assert.equal(paragraph.getText(), 'First sentence. Second sentence.');
    assert.equal(state.body.getNumChildren(), 1);
  });
}

test('expansion edits only selected text and keeps surrounding content and formatting', () => {
  const text = new Text('Keep before. First sentence. Second sentence! Keep after.', { BOLD: true });
  const paragraph = new Paragraph([text]);
  const start = text.text.indexOf('First');
  const end = text.text.indexOf(' Keep after.');
  const state = createDocument([paragraph], [range(text, start, end - 1)]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'Keep before. First sentence.\rSecond sentence! Keep after.');
  assert.ok(styledText(paragraph).every(character => character.style.BOLD));
  assert.equal(state.body.getNumChildren(), 1);
});

test('selection beginning inside an abbreviation uses surrounding paragraph context', () => {
  const paragraph = new Paragraph('Ask Dr. Smith. Then leave.');
  const text = paragraph.getChild(0);
  const state = createDocument([paragraph], [range(text, 6, text.text.length - 1)]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'Ask Dr. Smith.\rThen leave.');
});

test('expanding several bullets adds soft breaks without creating or joining list items', () => {
  const first = new Paragraph('First task. Continue it!', 'LIST_ITEM');
  const second = new Paragraph('Second task? Finish it.', 'LIST_ITEM');
  const state = createDocument([first, second], [range(first), range(second)]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(first.getText(), 'First task.\rContinue it!');
  assert.equal(second.getText(), 'Second task?\rFinish it.');
  assert.equal(first.getType(), 'LIST_ITEM');
  assert.equal(second.getType(), 'LIST_ITEM');
});

test('collapse changes selected soft breaks while preserving unselected breaks', () => {
  const paragraph = new Paragraph('Before.\rKeep. First.\r Second. After.\rKeep.');
  const text = paragraph.getChild(0);
  const start = text.text.indexOf('First.');
  const end = text.text.indexOf(' After.');
  const state = createDocument([paragraph], [range(text, start, end - 1)]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'Before.\rKeep. First. Second. After.\rKeep.');
});

test('collapse joins selected adjacent paragraphs and preserves partial endpoints and text styles', () => {
  const leftText = new Text('Unselected prefix. First sentence. ', { BOLD: true });
  const rightText = new Text(' Second sentence. Unselected suffix.', { ITALIC: true, LINK_URL: 'https://example.com' });
  const first = new Paragraph([leftText]);
  const second = new Paragraph([rightText]);
  const untouched = new Paragraph('Untouched paragraph.');
  const state = createDocument([first, second, untouched], [
    range(leftText, leftText.text.indexOf('First'), leftText.text.length - 1),
    range(rightText, 0, rightText.text.indexOf(' Unselected suffix.') - 1)
  ]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(first.getText(), 'Unselected prefix. First sentence. Second sentence. Unselected suffix.');
  assert.equal(untouched.getText(), 'Untouched paragraph.');
  const styled = styledText(first);
  assert.equal(styled[0].style.BOLD, true);
  assert.equal(styled.at(-1).style.ITALIC, true);
  assert.equal(styled.at(-1).style.LINK_URL, 'https://example.com');
});

test('collapse keeps separate bullets while collapsing their internal lines', () => {
  const first = new Paragraph('First task.\rContinue it!', 'LIST_ITEM');
  const second = new Paragraph('Second task?\rFinish it.', 'LIST_ITEM');
  const state = createDocument([first, second], [range(first), range(second)]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(first.getText(), 'First task. Continue it!');
  assert.equal(second.getText(), 'Second task? Finish it.');
});

test('collapse never joins headings to body paragraphs', () => {
  const heading = new Paragraph('Section title.', 'PARAGRAPH', 'HEADING1');
  const paragraph = new Paragraph('Body sentence.\rNext sentence.');
  const state = createDocument([heading, paragraph], [range(heading), range(paragraph)]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(heading.getText(), 'Section title.');
  assert.equal(paragraph.getText(), 'Body sentence. Next sentence.');
});

test('collapse across table cells preserves each cell and does not join their paragraphs', () => {
  const first = new Paragraph('First cell.\rOne more.');
  const second = new Paragraph('Second cell.\rOne more.');
  const leftCell = new Container('TABLE_CELL', [first]);
  const rightCell = new Container('TABLE_CELL', [second]);
  const row = new Container('TABLE_ROW', [leftCell, rightCell]);
  const table = new Container('TABLE', [row]);
  const state = createDocument([table], [range(first), range(second)]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(leftCell.getNumChildren(), 1);
  assert.equal(rightCell.getNumChildren(), 1);
  assert.equal(first.getText(), 'First cell. One more.');
  assert.equal(second.getText(), 'Second cell. One more.');
});

test('unsupported inline content rejects the entire selection before editing any paragraph', () => {
  const good = new Paragraph('Would change. Would split.');
  const mixed = new Paragraph([new Text('Image caption. More caption.'), new Element('INLINE_IMAGE')]);
  const state = createDocument([good, mixed], [range(good), range(mixed)]);
  state.context.expandSelection();
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0], /text|unsupported|image/i);
  assert.equal(good.getText(), 'Would change. Would split.');
  assert.equal(mixed.getText(), 'Image caption. More caption.');
  assert.equal(mixed.getNumChildren(), 2);
});

test('overlapping range elements do not apply expansion twice', () => {
  const paragraph = new Paragraph('One sentence. Two sentences.');
  const text = paragraph.getChild(0);
  const state = createDocument([paragraph], [range(paragraph), range(text, 0, text.text.length - 1)]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'One sentence.\rTwo sentences.');
});

test('positioned image anchors reject collapse before paragraphs are removed', () => {
  const first = new Paragraph('First.');
  const second = new Paragraph('Caption.');
  second.positionedImages = [{ id: 'image-anchor' }];
  const state = createDocument([first, second], [range(first), range(second)]);
  state.context.collapseSelection();
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0], /images/i);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(second.getText(), 'Caption.');
  assert.equal(second.getPositionedImages().length, 1);
});

test('homepage exposes both commands without reading or editing the document', () => {
  const paragraph = new Paragraph('Keep this. Keep that.');
  const state = createDocument([paragraph], null);
  state.context.DocumentApp.getActiveDocument = () => { throw new Error('Homepage must not read the document'); };
  const card = state.context.onHomepage({});
  assert.equal(card.header.title, 'Sentence Tools');
  const buttons = card.sections.flatMap(section => section.widgets).filter(widget => widget.type === 'button');
  assert.deepEqual(buttons.map(button => button.text), ['Expand', 'Collapse']);
  assert.deepEqual(buttons.map(button => button.action.functionName), ['expandSelection', 'collapseSelection']);
  assert.equal(state.selectionReadCount(), 0);
  assert.deepEqual(state.notifications, []);
  assert.equal(paragraph.getText(), 'Keep this. Keep that.');
});

test('collapse stops at selected empty and whitespace-only paragraphs', () => {
  for (const blank of [[], '', ' \t  ', ' \r  ']) {
    const paragraphs = [
      new Paragraph('First sentence.'),
      new Paragraph('Second sentence.  '),
      new Paragraph(blank),
      new Paragraph(' Third sentence.'),
      new Paragraph('Fourth sentence.')
    ];
    const separator = paragraphs[2];
    const state = createDocument(paragraphs, paragraphs.map(paragraph => range(paragraph)));
    state.context.collapseSelection();
    assertSuccess(state);
    assert.deepEqual(state.body.children.map(paragraph => paragraph.getText()), [
      'First sentence. Second sentence.  ',
      Array.isArray(blank) ? '' : blank,
      ' Third sentence. Fourth sentence.'
    ]);
    assert.equal(state.body.getChild(1), separator, 'the separator paragraph itself is retained');
  }
});

test('collapse keeps the two sentence groups from the reported draft separate', () => {
  const firstGroup = [
    'Congrats on promotion into new role.',
    'Filling the former role is a challenge.',
    'A typical byproduct of my leadership are qualified candidates to take over the role (hard to say this without dissing him).',
    'This is test sentence to ignore with an abbreviation etc. in the middle.',
    'This is a test of question marks?',
    'And this is a test of exclamation points!',
    'And this is just the final sentence.'
  ];
  const secondGroup = ['And, what if I skip a line?', 'What then, huh?'];
  const paragraphs = [...firstGroup, '', ...secondGroup].map(text => new Paragraph(text));
  const state = createDocument(paragraphs, paragraphs.map(paragraph => range(paragraph)));
  const expected = [firstGroup.join(' '), '', secondGroup.join(' ')];
  state.context.collapseSelection();
  assertSuccess(state);
  assert.deepEqual(state.body.children.map(paragraph => paragraph.getText()), expected);
  state.setSelection(state.body.children.map(paragraph => range(paragraph)));
  const response = state.context.collapseSelection();
  assert.equal(response.stateChanged, false);
  assert.deepEqual(state.body.children.map(paragraph => paragraph.getText()), expected);
});

test('collapse preserves a blank line formed by soft breaks next to a paragraph boundary', () => {
  for (const [leftEdge, rightEdge] of [
    ['\r', ''], ['', '\r'], [' \r\t', '  '], [' ', '\n '],
    ['\r\n', ''], ['', '\u000b'], ['\u2028', ''], ['', '\u2029']
  ]) {
    const first = new Paragraph(`First.\rSecond.${leftEdge}`);
    const second = new Paragraph(`${rightEdge}Third.\rFourth.`);
    const state = createDocument([first, second], [range(first), range(second)]);
    state.context.collapseSelection();
    assertSuccess(state);
    assert.deepEqual(state.body.children.map(paragraph => paragraph.getText()), [
      `First. Second.${leftEdge}`, `${rightEdge}Third. Fourth.`
    ]);
  }
});

test('collapse preserves internal blank lines in paragraphs and bullets with selection and styles intact', () => {
  for (const type of ['PARAGRAPH', 'LIST_ITEM']) {
    const first = new Text('Before.\rFirst.\rSecond.\r ', { BOLD: true });
    const second = new Text('\rThird.\rFourth.\rAfter.', { ITALIC: true, LINK_URL: 'https://example.com' });
    const paragraph = new Paragraph([first, second], type);
    const state = createDocument([paragraph], [
      range(first, first.text.indexOf('First.'), first.text.length - 1),
      range(second, 0, second.text.indexOf('\rAfter.') - 1)
    ]);
    state.context.collapseSelection();
    assertSuccess(state);
    assert.equal(paragraph.getText(), 'Before.\rFirst. Second.\r \rThird. Fourth.\rAfter.');
    assert.equal(state.body.getNumChildren(), 1);
    assert.equal(paragraph.getType(), type);
    assert.equal(styledText(paragraph).find(({ character }) => character === 'S').style.BOLD, true);
    const thirdOffset = paragraph.getText().indexOf('Third.');
    assert.deepEqual(styledText(paragraph)[thirdOffset].style, { ITALIC: true, LINK_URL: 'https://example.com' });
  }
});

test('sentence detection spans differently styled text runs without changing their styles', () => {
  const title = new Text('Ask Dr.', { BOLD: true });
  const continuation = new Text(' Smith. Then leave.', { ITALIC: true });
  const paragraph = new Paragraph([title, continuation]);
  const state = createDocument([paragraph], [range(title), range(continuation)]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'Ask Dr. Smith.\rThen leave.');
  assert.equal(title.getText(), 'Ask Dr.');
  assert.ok(title.styles.every(style => style.BOLD));
  assert.ok(continuation.styles.every(style => style.ITALIC));
});

test('disconnected selections leave the gap between selected spans unchanged', () => {
  const text = new Text('First. Second. Middle. Untouched. Before. After.');
  const paragraph = new Paragraph([text]);
  const secondStart = text.text.indexOf('Before.');
  const state = createDocument([paragraph], [
    range(text, 0, text.text.indexOf(' Middle.') - 1),
    range(text, secondStart, text.text.length - 1)
  ]);
  state.context.expandSelection();
  assertSuccess(state);
  assert.equal(paragraph.getText(), 'First.\rSecond. Middle. Untouched. Before.\rAfter.');
});

test('collapse does not bridge an unselected paragraph', () => {
  const first = new Paragraph('First.\rSecond.');
  const middle = new Paragraph('Untouched.');
  const last = new Paragraph('Before.\rAfter.');
  const state = createDocument([first, middle, last], [range(first), range(last)]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 3);
  assert.equal(first.getText(), 'First. Second.');
  assert.equal(middle.getText(), 'Untouched.');
  assert.equal(last.getText(), 'Before. After.');
});

test('collapse does not join paragraphs when their boundary is outside the selection', () => {
  const first = new Paragraph('First.\rSecond. Unselected tail.');
  const second = new Paragraph('Third.\rFourth.');
  const state = createDocument([first, second], [
    range(first.getChild(0), 0, first.getText().indexOf(' Unselected tail.') - 1),
    range(second)
  ]);
  state.context.collapseSelection();
  assertSuccess(state);
  assert.equal(state.body.getNumChildren(), 2);
  assert.equal(first.getText(), 'First. Second. Unselected tail.');
  assert.equal(second.getText(), 'Third. Fourth.');
});

test('a runtime failure reports the failure without falsely claiming no changes', () => {
  const fails = new Paragraph('First. Second.');
  const succeeds = new Paragraph('Third. Fourth.');
  const state = createDocument([fails, succeeds], [range(fails), range(succeeds)]);
  fails.editAsText = () => ({ insertText() { throw new Error('Simulated Docs edit failure'); } });
  const response = state.context.expandSelection();
  assert.deepEqual(state.notifications, ['Simulated Docs edit failure']);
  assert.equal(succeeds.getText(), 'Third.\rFourth.');
  assert.equal(fails.getText(), 'First. Second.');
  assert.equal(state.releaseCount(), 1);
  assert.equal(response.stateChanged, true);
});

test('a selection containing only an empty paragraph reports nothing selected', () => {
  const paragraph = new Paragraph([]);
  const state = createDocument([paragraph], [range(paragraph)]);
  state.context.collapseSelection();
  assert.deepEqual(state.notifications, ['nothing selected']);
  assert.equal(state.body.getNumChildren(), 1);
  assert.equal(state.releaseCount(), 1);
});

test('another running instance prevents editing and displays a useful error', () => {
  const paragraph = new Paragraph('First. Second.');
  const state = createDocument([paragraph], [range(paragraph)]);
  state.context.LockService.getDocumentLock = () => ({
    tryLock: () => false,
    releaseLock: () => { throw new Error('An unacquired lock must not be released'); }
  });
  state.context.expandSelection();
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0], /already running/i);
  assert.equal(paragraph.getText(), 'First. Second.');
});

test('standalone add-ons use a user lock when a document lock is unavailable', () => {
  const paragraph = new Paragraph('First. Second.');
  const state = createDocument([paragraph], [range(paragraph)]);
  let userLockAttempts = 0;
  let userLockReleases = 0;
  state.context.LockService.getDocumentLock = () => null;
  state.context.LockService.getUserLock = () => ({
    tryLock: () => { userLockAttempts += 1; return true; },
    releaseLock: () => { userLockReleases += 1; }
  });
  const response = state.context.expandSelection();
  assert.equal(response.notification.text, 'Expanded selected text.');
  assert.equal(response.stateChanged, true);
  assert.equal(paragraph.getText(), 'First.\rSecond.');
  assert.equal(userLockAttempts, 1);
  assert.equal(userLockReleases, 1);
});

test('standalone user-lock contention makes no edits', () => {
  const paragraph = new Paragraph('First. Second.');
  const state = createDocument([paragraph], [range(paragraph)]);
  state.context.LockService.getDocumentLock = () => null;
  state.context.LockService.getUserLock = () => ({
    tryLock: () => false,
    releaseLock: () => { throw new Error('An unacquired lock must not be released'); }
  });
  const response = state.context.expandSelection();
  assert.equal(response.stateChanged, false);
  assert.match(response.notification.text, /already running/);
  assert.equal(paragraph.getText(), 'First. Second.');
});

test('each button click reads the current selection instead of the previous selection', () => {
  const first = new Paragraph('First. Second.');
  const next = new Paragraph('Third. Fourth.');
  const state = createDocument([first, next], [range(first)]);
  state.context.onHomepage();
  state.setSelection([range(next)]);
  state.context.expandSelection();
  assert.equal(first.getText(), 'First. Second.');
  assert.equal(next.getText(), 'Third.\rFourth.');
  state.setSelection(null);
  const response = state.context.collapseSelection();
  assert.equal(response.notification.text, 'nothing selected');
  assert.equal(response.stateChanged, false);
  assert.equal(next.getText(), 'Third.\rFourth.');
  assert.equal(state.selectionReadCount(), 2);
});

test('already expanded native soft breaks produce a no-change response without edits', () => {
  const paragraph = new Paragraph('First.\rSecond.');
  const state = createDocument([paragraph], [range(paragraph)]);
  paragraph.editAsText = () => { throw new Error('No-op must not mutate the document'); };
  const response = state.context.expandSelection();
  assert.equal(response.notification.text, 'No changes needed.');
  assert.equal(response.stateChanged, false);
  assert.equal(paragraph.getText(), 'First.\rSecond.');
  assert.equal(state.releaseCount(), 1);
});

test('missing active document gives a side-panel response instead of throwing', () => {
  const state = createDocument([], null);
  state.context.DocumentApp.getActiveDocument = () => null;
  const response = state.context.expandSelection();
  assert.match(response.notification.text, /Open a Google Doc/);
  assert.equal(response.stateChanged, false);
  assert.equal(state.selectionReadCount(), 0);
});

test('unknown operations fail before document access', () => {
  const state = createDocument([], null);
  state.context.DocumentApp.getActiveDocument = () => { throw new Error('Unknown action must not access document'); };
  const response = state.context.runSentenceTool_('delete');
  assert.equal(response.notification.text, 'Unknown action.');
  assert.equal(response.stateChanged, false);
});

test('Workspace manifest installs only in Docs and references the working homepage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/documents.currentonly']);
  assert.deepEqual(Object.keys(manifest.addOns).sort(), ['common', 'docs']);
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.addOns.common.name, 'Sentence Tools');
  assert.match(manifest.addOns.common.logoUrl, /^https:\/\/.+\.png$/);
  const state = createDocument([], null);
  const handler = state.context[manifest.addOns.common.homepageTrigger.runFunction];
  assert.equal(typeof handler, 'function');
  assert.equal(handler().header.title, 'Sentence Tools');
  assert.equal(typeof state.context.onOpen, 'undefined');
  assert.equal(typeof state.context.onInstall, 'undefined');
});

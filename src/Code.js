/**
 * Sentence Tools for Google Docs.
 * @OnlyCurrentDoc
 */

/** Builds the side panel without reading the document or its selection. */
function onHomepage() {
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph()
      .setText('Select text in your document, then choose an action.'))
    .addWidget(CardService.newTextButton()
      .setText('Expand')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('expandSelection')))
    .addWidget(CardService.newTextParagraph()
      .setText('Put each sentence on its own line. Bullets stay together.'))
    .addWidget(CardService.newTextButton()
      .setText('Collapse')
      .setOnClickAction(CardService.newAction().setFunctionName('collapseSelection')))
    .addWidget(CardService.newTextParagraph()
      .setText('Join consecutive selected lines and paragraphs. Keep blank lines and bullet boundaries.'));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Sentence Tools'))
    .addSection(section)
    .build();
}

function expandSelection() {
  return runSentenceTool_('expand');
}

function collapseSelection() {
  return runSentenceTool_('collapse');
}

function runSentenceTool_(mode) {
  var lock = null;
  var locked = false;
  var mutationAttempted = false;
  try {
    if (mode !== 'expand' && mode !== 'collapse') throw new Error('Unknown action.');
    var doc = DocumentApp.getActiveDocument();
    if (!doc) throw new Error('Open a Google Doc, select text, and try again.');
    // Read the active tab's selection on every click. Never retain a selection
    // from opening the panel or fall back to the body or insertion cursor.
    var selection = doc.getSelection();
    if (!selection) return sentenceResponse_('nothing selected', false);

    // A standalone add-on may have no document lock. The user lock still
    // serializes this user's actions without blocking other add-on users.
    lock = LockService.getDocumentLock() || LockService.getUserLock();
    locked = lock.tryLock(5000);
    if (!locked) {
      throw new Error('Sentence Tools is already running. Please try again.');
    }
    // Validate the entire selection and calculate every edit before mutating it.
    var blocks = collectSelectedBlocks_(selection);
    var plan = planSentenceEdits_(blocks, mode);
    var changed = plan.joins.length > 0 || plan.blocks.some(function (block) {
      return block.edits.length > 0;
    });
    if (!changed) return sentenceResponse_('No changes needed.', false);
    mutationAttempted = true;
    applySentencePlan_(plan);
    return sentenceResponse_(mode === 'expand'
      ? 'Expanded selected text.' : 'Collapsed selected text.', true);
  } catch (caught) {
    // Apps Script edits are not transactional. A service error after an edit
    // must not claim that nothing changed; signal changed data in that case.
    return sentenceResponse_(caught.message || String(caught), mutationAttempted);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function sentenceResponse_(message, changed) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(message))
    .setStateChanged(changed)
    .build();
}

function typeName_(element) {
  return String(element.getType());
}

function isBlock_(element) {
  var type = typeName_(element);
  return type === 'PARAGRAPH' || type === 'LIST_ITEM';
}

/** A structural key also works when Apps Script returns fresh element wrappers. */
function elementPath_(element) {
  var parts = [];
  var current = element;
  while (current) {
    var parent = current.getParent();
    if (!parent || typeof parent.getChildIndex !== 'function') {
      parts.unshift(typeName_(current));
      break;
    }
    parts.unshift(parent.getChildIndex(current));
    current = parent;
  }
  return parts;
}

function comparePaths_(left, right) {
  for (var i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    return left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
}

function unsupportedSelection_() {
  return new Error('Select paragraphs or list items containing only text. ' +
    'Images, drawings, equations, smart chips, and other objects are not supported. Nothing was changed.');
}

function collectSelectedBlocks_(selection) {
  var byKey = Object.create(null);

  function getBlock(element) {
    element = typeName_(element) === 'LIST_ITEM' ? element.asListItem() : element.asParagraph();
    var path = elementPath_(element);
    var key = JSON.stringify(path);
    if (byKey[key]) return byKey[key];
    // Positioned images are anchors, not children. Removing a paragraph during
    // collapse must not silently remove or relocate one of these anchors.
    if (element.getPositionedImages().length) throw unsupportedSelection_();
    var children = [];
    var value = '';
    // Do not flatten a paragraph with inline objects: editAsText ignores them,
    // and deleting text that spans one can otherwise delete the object too.
    for (var i = 0; i < element.getNumChildren(); i++) {
      var child = element.getChild(i);
      if (typeName_(child) !== 'TEXT') throw unsupportedSelection_();
      var childText = child.asText().getText();
      children.push({ index: i, offset: value.length, length: childText.length });
      value += childText;
    }
    var parent = element.getParent();
    var block = {
      element: element,
      parent: parent,
      parentKey: JSON.stringify(elementPath_(parent)),
      index: parent.getChildIndex(element),
      path: path,
      text: value,
      children: children,
      intervals: [],
      full: false,
      edits: []
    };
    byKey[key] = block;
    return block;
  }

  function addText(element, start, end) {
    var parent = element.getParent();
    if (!parent || !isBlock_(parent)) throw unsupportedSelection_();
    var block = getBlock(parent);
    var index = parent.getChildIndex(element);
    var child = block.children.filter(function (item) { return item.index === index; })[0];
    if (!child || start < 0 || end > child.length || end < start) {
      throw new Error('The selection changed. Select the text again and retry. Nothing was changed.');
    }
    if (end > start) block.intervals.push({ start: child.offset + start, end: child.offset + end });
  }

  function addWhole(element) {
    var type = typeName_(element);
    if (isBlock_(element)) {
      var block = getBlock(element);
      block.full = true;
      if (block.text.length) block.intervals.push({ start: 0, end: block.text.length });
      return;
    }
    if (type === 'TEXT') {
      addText(element, 0, element.asText().getText().length);
      return;
    }
    // Full table/cell selections may be represented by a container. Each cell
    // is still its own parent, so paragraph joins cannot cross cell boundaries.
    if (['TABLE', 'TABLE_ROW', 'TABLE_CELL', 'BODY_SECTION',
      'HEADER_SECTION', 'FOOTER_SECTION', 'FOOTNOTE_SECTION'].indexOf(type) !== -1) {
      var casts = {
        TABLE: 'asTable', TABLE_ROW: 'asTableRow', TABLE_CELL: 'asTableCell',
        BODY_SECTION: 'asBody', HEADER_SECTION: 'asHeaderSection',
        FOOTER_SECTION: 'asFooterSection', FOOTNOTE_SECTION: 'asFootnoteSection'
      };
      element = element[casts[type]]();
      for (var i = 0; i < element.getNumChildren(); i++) addWhole(element.getChild(i));
      return;
    }
    throw unsupportedSelection_();
  }

  selection.getRangeElements().forEach(function (range) {
    var element = range.getElement();
    if (range.isPartial()) {
      if (typeName_(element) !== 'TEXT') throw unsupportedSelection_();
      addText(element, range.getStartOffset(), range.getEndOffsetInclusive() + 1);
    } else {
      addWhole(element);
    }
  });

  var blocks = Object.keys(byKey).map(function (key) { return byKey[key]; });
  blocks.sort(function (a, b) { return comparePaths_(a.path, b.path); });
  var count = 0;
  blocks.forEach(function (block) {
    block.intervals = unionIntervals_(block.intervals);
    block.intervals.forEach(function (range) { count += range.end - range.start; });
  });
  if (!count) throw new Error('nothing selected');
  return blocks;
}

function unionIntervals_(intervals) {
  var sorted = intervals.slice().sort(function (a, b) { return a.start - b.start; });
  var result = [];
  sorted.forEach(function (range) {
    var previous = result[result.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      result.push({ start: range.start, end: range.end });
    }
  });
  return result;
}

function selectedStart_(block) {
  return block.full || (block.intervals.length && block.intervals[0].start === 0);
}

function selectedEnd_(block) {
  return block.full || (block.intervals.length &&
    block.intervals[block.intervals.length - 1].end === block.text.length);
}

function canJoinBlocks_(left, right) {
  // Empty paragraphs separate sentence runs. A soft break at either edge also
  // makes a blank line when combined with the hard paragraph boundary.
  if (!/\S/.test(left.text) || !/\S/.test(right.text) ||
    /[\n\r\u000b\u2028\u2029]\s*$/.test(left.text) ||
    /^\s*[\n\r\u000b\u2028\u2029]/.test(right.text)) return false;
  return typeName_(left.element) === 'PARAGRAPH' &&
    typeName_(right.element) === 'PARAGRAPH' &&
    String(left.element.getHeading()) === 'NORMAL' &&
    String(right.element.getHeading()) === 'NORMAL' &&
    left.parentKey === right.parentKey && left.index + 1 === right.index &&
    selectedEnd_(left) && selectedStart_(right);
}

function planSentenceEdits_(blocks, mode) {
  var joins = [];
  if (mode === 'collapse') {
    for (var i = 1; i < blocks.length; i++) {
      if (canJoinBlocks_(blocks[i - 1], blocks[i])) {
        joins.push({ left: blocks[i - 1], right: blocks[i] });
        blocks[i - 1].trimEnd = true;
        blocks[i].trimStart = true;
      }
    }
  }

  blocks.forEach(function (block) {
    var edits = [];
    block.intervals.forEach(function (range) {
      var changes = mode === 'expand'
        ? SentenceEngine.expandEdits(block.text, range.start, range.end)
        : SentenceEngine.collapseEdits(block.text, range.start, range.end);
      edits = edits.concat(changes);
    });
    var trims = [];
    if (block.trimStart && block.intervals.length) {
      var first = block.intervals[0];
      var leading = block.text.slice(first.start, first.end).match(/^\s+/);
      if (leading) trims.push({ start: first.start, end: first.start + leading[0].length });
    }
    if (block.trimEnd && block.intervals.length) {
      var last = block.intervals[block.intervals.length - 1];
      var trailing = block.text.slice(last.start, last.end).match(/\s+$/);
      if (trailing) trims.push({ start: last.end - trailing[0].length, end: last.end });
    }
    unionIntervals_(trims).forEach(function (trim) {
      edits = edits.filter(function (edit) {
        return edit.end <= trim.start || edit.start >= trim.end;
      });
      edits.push({ start: trim.start, end: trim.end, text: '' });
    });
    block.edits = edits.filter(function (edit) {
      return block.text.slice(edit.start, edit.end) !== edit.text.replace(/\n/g, '\r');
    }).sort(function (a, b) { return b.start - a.start; });
  });
  return { blocks: blocks, joins: joins };
}

function applySentencePlan_(plan) {
  // Check every snapshot before the first mutation. The lock prevents another
  // instance of this script running concurrently, but does not lock human edits.
  plan.blocks.forEach(function (block) {
    if (block.element.getText() !== block.text) {
      throw new Error('The document changed. Select the text again and retry. Nothing was changed.');
    }
  });

  plan.blocks.slice().reverse().forEach(function (block) {
    if (!block.edits.length) return;
    var text = block.element.editAsText();
    block.edits.forEach(function (edit) {
      // Paragraph/ListItem text uses carriage returns for soft line breaks.
      var replacement = edit.text.replace(/\n/g, '\r');
      // Insert first, so replacing an entire text node never operates on a
      // detached, empty node. Existing characters and their attributes survive.
      if (replacement) text.insertText(edit.start, replacement);
      if (edit.end > edit.start) {
        text.deleteText(edit.start + replacement.length, edit.end - 1 + replacement.length);
      }
    });
  });

  // Join from the end toward the start: each right-hand paragraph still has its
  // original preceding sibling, even when a whole run of paragraphs is selected.
  plan.joins.slice().reverse().forEach(function (join) {
    var left = join.left.element;
    var right = join.right.element;
    var leftText = left.getText();
    var rightText = right.getText();
    if (leftText && rightText && !/\s$/.test(leftText) && !/^\s/.test(rightText)) {
      left.editAsText().insertText(leftText.length, ' ');
    }
    // merge() transfers the existing child elements, retaining their text runs.
    // The surviving paragraph retains the first paragraph's paragraph style.
    right.merge();
  });
}

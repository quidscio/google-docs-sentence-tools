'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/SentenceEngine.js');

function apply(text, edits) {
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}
const expand = (text, start, end) => apply(text, engine.expandEdits(text, start, end));
const collapse = (text, start, end) => apply(text, engine.collapseEdits(text, start, end));

test('periods, questions, exclamations, clusters and closing quotation marks', () => {
  assert.equal(expand('First. Is this next? Yes! Really?! “Indeed.” (Done.) Last.'),
    'First.\nIs this next?\nYes!\nReally?!\n“Indeed.”\n(Done.)\nLast.');
});

test('titles and initials retain names with capital letters', () => {
  assert.equal(expand('Dr. Alice met Mr. Smith and Prof. Jones. J. R. R. Tolkien wrote books. Done.'),
    'Dr. Alice met Mr. Smith and Prof. Jones.\nJ. R. R. Tolkien wrote books.\nDone.');
  assert.equal(expand('Dr. A. Smith met J. I. Packer. Next.'),
    'Dr. A. Smith met J. I. Packer.\nNext.');
  assert.equal(expand('Dr. Who met Dr. May and Dr. Will. They spoke.'),
    'Dr. Who met Dr. May and Dr. Will.\nThey spoke.');
});

test('unspaced exclamations and questions split without breaking URLs or emails', () => {
  assert.equal(expand('Done!Next? Yes. Ready?Yes. “Go!”Now.'),
    'Done!\nNext?\nYes.\nReady?\nYes.\n“Go!”\nNow.');
  assert.equal(expand('Read https://example.com/?Query!Value and wow!Name@example.com now.'),
    'Read https://example.com/?Query!Value and wow!Name@example.com now.');
  assert.equal(expand('One.Next. Version 1.2.3.'), 'One.Next.\nVersion 1.2.3.');
  assert.deepEqual(engine.expandEdits('Done!Next?', 0, 5), []);
  assert.deepEqual(engine.expandEdits('Done!Next?', 5, 10), []);
});

test('common abbreviations can end a sentence based on the following context', () => {
  assert.equal(expand('Bring pens, paper, etc. We need them. Ask Acme Inc. They can help. Meet at 5 p.m. Then leave.'),
    'Bring pens, paper, etc.\nWe need them.\nAsk Acme Inc.\nThey can help.\nMeet at 5 p.m.\nThen leave.');
});

test('abbreviations followed by proper nouns are not split indiscriminately', () => {
  assert.equal(expand('Visit the U.S. Army, e.g. Fort Bragg. Meet at 5 p.m. Monday. Call Acme Inc. representatives.'),
    'Visit the U.S. Army, e.g. Fort Bragg.\nMeet at 5 p.m. Monday.\nCall Acme Inc. representatives.');
  assert.equal(expand('The U.S. Congress bought Inc. shares, e.g. Monday. Meet at 8 a.m. on Tuesday. Meet at 8 a.m. Tomorrow is fine.'),
    'The U.S. Congress bought Inc. shares, e.g. Monday.\nMeet at 8 a.m. on Tuesday.\nMeet at 8 a.m.\nTomorrow is fine.');
});

test('multi-letter degree abbreviations can appear within or at the end of a sentence', () => {
  assert.equal(expand('Ph.D. students met B.Sc. graduates. She has a Ph.D. They celebrated.'),
    'Ph.D. students met B.Sc. graduates.\nShe has a Ph.D.\nThey celebrated.');
});

test('acronyms and street abbreviations can be terminal', () => {
  assert.equal(expand('He lives in the U.S. He works on Main St. It is nearby.'),
    'He lives in the U.S.\nHe works on Main St.\nIt is nearby.');
});

test('decimals, versions, domains and emails retain their internal dots', () => {
  assert.equal(expand('Version 1.2.3 costs $3.14. Email a.b@example.com. Visit example.org. Done.'),
    'Version 1.2.3 costs $3.14.\nEmail a.b@example.com.\nVisit example.org.\nDone.');
});

test('URLs keep query punctuation and internal punctuation', () => {
  assert.equal(expand('Try https://example.com/?q=what! and https://example.com/? now. Done.'),
    'Try https://example.com/?q=what! and https://example.com/? now.\nDone.');
  assert.equal(expand('Visit https://example.com/path. Then leave.'),
    'Visit https://example.com/path.\nThen leave.');
});

test('numeric list labels do not become standalone sentences', () => {
  assert.equal(expand('1. First sentence. Next sentence.'), '1. First sentence.\nNext sentence.');
});

test('wraps inside a sentence collapse, sentence wraps remain, blank lines remain', () => {
  assert.equal(expand('A long\nwrapped sentence.\nNext sentence.\n\nSeparate section.'),
    'A long wrapped sentence.\nNext sentence.\n\nSeparate section.');
});

test('CRLF counts as one line break and supported soft-break characters collapse', () => {
  assert.equal(expand('A long\r\nwrapped sentence.\r\nNext.'), 'A long wrapped sentence.\nNext.');
  assert.equal(collapse('One.\u000bTwo.\u2028Three.\u2029Four.'), 'One. Two. Three. Four.');
  assert.equal(expand('A long\rwrapped sentence.\rNext.'), 'A long wrapped sentence.\nNext.');
  assert.equal(collapse('One.\rTwo.'), 'One. Two.');
});

test('collapse joins single line breaks while preserving blank lines and ordinary spaces', () => {
  assert.equal(collapse('  One.  \n \n Two has  two spaces.\nThree.  '),
    '  One.  \n \n Two has  two spaces. Three.  ');
});

test('collapse preserves blank separators across supported line break encodings', () => {
  for (const separator of ['\n\n', '\r\r', '\r\n\r\n', '\u000b\u000b', '\u2028\u2028', '\u2029\u2029', '\r \t\r\r']) {
    const text = `First.\rSecond.${separator}Third.\rFourth.`;
    const expected = `First. Second.${separator}Third. Fourth.`;
    assert.equal(collapse(text), expected, JSON.stringify(separator));
    assert.equal(collapse(expected), expected, 'a second collapse retains the same separator');
  }
  assert.equal(collapse('First.\r\nSecond.'), 'First. Second.', 'CRLF is one logical break');
});

test('collapse keeps blank lines inside a partial selection and leaves its outside breaks unchanged', () => {
  const text = 'Before.\rFirst.\rSecond.\r \rThird.\rFourth.\rAfter.';
  assert.equal(collapse(text, text.indexOf('First.'), text.indexOf('\rAfter.')),
    'Before.\rFirst. Second.\r \rThird. Fourth.\rAfter.');
});

test('partial selections change only enclosed gaps', () => {
  const text = 'Before. One. Two. After.';
  const start = text.indexOf('One');
  const end = text.indexOf(' After');
  assert.equal(expand(text, start, end), 'Before. One.\nTwo. After.');
  assert.equal(expand(text, start, start + 4), text);
});

test('classification retains preceding context outside a partial selection', () => {
  const text = 'The U.S. Army arrived. Next.';
  assert.equal(expand(text, text.indexOf('S.'), text.length), 'The U.S. Army arrived.\nNext.');
});

test('neither partially selected whitespace nor edge whitespace is edited', () => {
  const text = 'One.   Two.\n\nThree.';
  assert.deepEqual(engine.expandEdits(text, 6, 10), []);
  assert.deepEqual(engine.collapseEdits(text, 0, 12), []);
  assert.deepEqual(engine.expandEdits('One. ', 0, 5), []);
  assert.deepEqual(engine.collapseEdits('\nOne.\n'), []);
});

test('edits use UTF-16 indices and preserve emoji and rich punctuation', () => {
  const text = '😀 Ready. “Go!” Next.';
  assert.equal(expand(text), '😀 Ready.\n“Go!”\nNext.');
  for (const edit of engine.expandEdits(text)) assert.match(text.slice(edit.start, edit.end), /^\s+$/);
});

test('expansion is idempotent and collapse reverses sentence separation', () => {
  const original = 'Dr. Smith works in the U.S. He arrived at 3 p.m. We left.';
  const expanded = expand(original);
  assert.equal(expand(expanded), expanded);
  assert.equal(collapse(expanded), original);
  const nativeExpanded = expanded.replace(/\n/g, '\r');
  assert.equal(expand(nativeExpanded).replace(/\n/g, '\r'), nativeExpanded);
  assert.equal(collapse(nativeExpanded), original);
});

test('empty selections and text produce no edits, invalid offsets fail', () => {
  assert.deepEqual(engine.expandEdits(''), []);
  assert.deepEqual(engine.expandEdits('First. Next.', 3, 3), []);
  assert.throws(() => engine.expandEdits('abc', -1, 2), RangeError);
  assert.throws(() => engine.collapseEdits('abc', 2, 1), RangeError);
  assert.throws(() => engine.expandEdits('abc', 0, 4), RangeError);
  assert.throws(() => engine.expandEdits(42, 0, 1), TypeError);
});

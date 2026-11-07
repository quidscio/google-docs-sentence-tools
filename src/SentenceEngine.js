/*
 * English sentence boundaries without a network call or an Intl dependency.
 * The engine returns whitespace edits; punctuation and words are never rewritten.
 * Abbreviation endings are inherently ambiguous. Titles, initials, acronyms and
 * times use a conservative sentence-starter heuristic rather than treating every
 * capitalized proper noun as a new sentence. See the README for examples.
 */
var SentenceEngine = (function () {
  'use strict';

  var CLOSERS = /[\u0022\u0027\u2019\u201d\u00bb\)\]\}]+$/;
  var OPENERS = /^[\u0022\u0027\u2018\u201c\u00ab\(\[\{]+/;
  var BREAKS = /\r\n|[\n\r\u000b\u2028\u2029]/g;
  var WHITESPACE = /\s+/g;
  var TITLES = new Set(('mr mrs ms mx dr prof rev fr hon pres gov sen rep capt lt col gen sgt ' +
    'adm cmdr cpl maj messrs mme mlle').split(' '));
  var TITLE_NAMES = new Set('Who May Will Do No'.split(' '));
  var PREFIXES = new Set(('e.g i.e vs v cf viz approx fig figs eq eqs no nos vol vols ch sec ' +
    'secs pp p art arts ref refs dept univ est').split(' '));
  var MONTHS = new Set('jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
  var SUFFIXES = new Set('jr sr inc ltd co corp bros assoc ph.d ph.d.s b.sc m.sc d.phil ed.d ll.b ll.m'.split(' '));
  var GENERAL = new Set('etc al misc esp resp'.split(' '));
  var STARTERS = new Set(('I You He She It We They This That These Those The A An There Here ' +
    'However Nevertheless Nonetheless Meanwhile Then Next Finally Afterwards Instead Also ' +
    'Otherwise Today Tomorrow Yesterday Please Thanks Indeed Yes No Unfortunately Fortunately ' +
    'But And Yet So His Her Their Our My Your Its What Why When Where Who Which How ' +
    'Is Are Was Were Do Does Did Can Could Will Would Should May Must').split(' '));
  var DAYS = new Set('Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '));

  function validate(text, start, end) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
      throw new RangeError('selection offsets must be ordered UTF-16 offsets within text');
    }
  }

  function firstWord(right) {
    var match = right.replace(OPENERS, '').match(/^[A-Za-z]+/);
    return match ? match[0] : '';
  }

  function hasSentenceStarter(right) {
    // A. and I. can be initials, even though their letters are also words.
    if (/^[A-Z]\./.test(right.replace(OPENERS, ''))) return false;
    return STARTERS.has(firstWord(right));
  }

  function breakCount(whitespace) {
    return (whitespace.match(BREAKS) || []).length;
  }

  function isSentenceBoundary(text, gapStart, gapEnd) {
    var left = text.slice(0, gapStart).replace(CLOSERS, '');
    var right = text.slice(gapEnd);
    if (!left || !right) return false;
    var punctuation = left.match(/[.!?]+$/);
    if (!punctuation) return false;
    var cluster = punctuation[0];
    var tokenMatch = left.match(/\S+$/);
    var token = tokenMatch ? tokenMatch[0].replace(OPENERS, '') : '';

    // URL query strings and paths contain real ? and ! characters. Their final
    // punctuation still ends a sentence when it follows a nonempty URL value.
    if (/^(?:https?:\/\/|www\.)/i.test(token)) {
      if (/[!?]$/.test(token)) return false;
      if (!/\.$/.test(token) || /\.{2,}$/.test(token)) return false;
      return true;
    }

    if (/[!?]/.test(cluster)) return true;
    // An ellipsis may finish a sentence, or indicate a pause within one.
    if (cluster.length > 1) return /^[A-Z\u201c\u0022\(\[]/.test(right);

    var bare = token.slice(0, -1);
    var key = bare.toLowerCase();
    var word = firstWord(right);
    var isUpper = /^[A-Z]/.test(word);
    var strongStart = hasSentenceStarter(right);

    // A numeral followed by a dot at the beginning of a line is a list label.
    if (/^\d+$/.test(bare) && /(?:^|[\n\r\u000b\u2028\u2029])[ \t]*\d+\.$/.test(left)) return false;
    if (TITLES.has(key)) return strongStart && !TITLE_NAMES.has(word);
    if (PREFIXES.has(key)) {
      // e.g./i.e. introduce examples even when the example is capitalized.
      if (key === 'e.g' || key === 'i.e') return false;
      return strongStart;
    }
    if (MONTHS.has(key)) return strongStart && !/^\d/.test(right);
    if (key === 'a.m' || key === 'p.m') return strongStart && !DAYS.has(word);
    if (key === 'st') return strongStart; // St. Louis / Main St. It is quiet.
    if (SUFFIXES.has(key)) return strongStart;
    if (GENERAL.has(key)) return isUpper;
    // Initials and dotted acronyms: J. Smith, J. R. R. Tolkien, U.S. Army.
    if (/^[A-Z]$/.test(bare) || /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(bare)) return strongStart;
    return true;
  }

  function editsFor(text, start, end, mode) {
    if (start === undefined) start = 0;
    if (end === undefined) end = text.length;
    validate(text, start, end);
    var edits = [];
    var match;
    // Use a new regex per call: the engine is safe to call recursively/in tests.
    var gaps = new RegExp(WHITESPACE.source, 'g');
    while ((match = gaps.exec(text))) {
      var gapStart = match.index;
      var gapEnd = gapStart + match[0].length;
      // Never trim selection edges, edit a partially selected whitespace run,
      // or create a break whose adjacent characters were not both selected.
      if (gapStart <= start || gapEnd >= end) continue;
      var breaks = breakCount(match[0]);
      var replacement;
      if (mode === 'collapse') {
        // Join only adjacent lines; a blank line separates sentence runs.
        if (breaks !== 1) continue;
        replacement = ' ';
      } else {
        // Empty lines are intentional paragraph separation inside a Text node.
        if (breaks > 1) continue;
        if (isSentenceBoundary(text, gapStart, gapEnd)) replacement = '\n';
        else if (breaks === 1) replacement = ' ';
        else continue;
      }
      if (replacement !== match[0]) edits.push({ start: gapStart, end: gapEnd, text: replacement });
    }
    if (mode === 'expand') {
      // ! and ? unambiguously delimit many accidentally unspaced sentences.
      // Periods without a space remain untouched: domains, versions and decimal
      // numbers use the same syntax. Keep URL/email tokens intact as well.
      var unspaced = /[!?]+[\u0022\u0027\u2019\u201d\u00bb\)\]\}]*/g;
      while ((match = unspaced.exec(text))) {
        var position = match.index + match[0].length;
        if (position <= start || position >= end || !/^[A-Z]/.test(text.slice(position))) continue;
        var tokenStart = match.index;
        while (tokenStart > 0 && !/\s/.test(text.charAt(tokenStart - 1))) tokenStart--;
        var wholeTokenEnd = position;
        while (wholeTokenEnd < text.length && !/\s/.test(text.charAt(wholeTokenEnd))) wholeTokenEnd++;
        var wholeToken = text.slice(tokenStart, wholeTokenEnd).replace(OPENERS, '');
        if (/^(?:[a-z][a-z\d+.-]*:\/\/|www\.)/i.test(wholeToken) || wholeToken.indexOf('@') !== -1) continue;
        edits.push({ start: position, end: position, text: '\n' });
      }
    }
    return edits.sort(function (a, b) { return a.start - b.start; });
  }

  return {
    expandEdits: function (text, start, end) { return editsFor(text, start, end, 'expand'); },
    collapseEdits: function (text, start, end) { return editsFor(text, start, end, 'collapse'); }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SentenceEngine;

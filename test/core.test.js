import test from 'node:test';
import assert from 'node:assert/strict';

import { encode, decode } from '../src/index.js';

test('encodes unreserved ASCII unchanged', () => {
  assert.equal(encode('abcXYZ019-_.~'), 'abcXYZ019-_.~');
});

test('escapes reserved and control bytes with uppercase hex', () => {
  assert.equal(encode(' '), '%20');
  assert.equal(encode('+'), '%2B');
  assert.equal(encode('/'), '%2F');
  assert.equal(encode('\n'), '%0A');
});

test('escapes multi-byte UTF-8 sequences byte by byte', () => {
  // U+00E9 is 0xC3 0xA9 in UTF-8.
  assert.equal(encode('\u00e9'), '%C3%A9');
  // U+20AC is 0xE2 0x82 0xAC in UTF-8.
  assert.equal(encode('\u20ac'), '%E2%82%AC');
});

test('round-trips a string containing reserved characters and emoji', () => {
  const original = 'a b+c/d?e#f&g=\u20ac\u{1f600}';
  assert.equal(decode(encode(original)), original);
});

test('decode treats plus as a literal plus, not a space', () => {
  assert.equal(decode('a+b'), 'a+b');
});

test('decode accepts lowercase hex digits', () => {
  assert.equal(decode('%c3%a9'), '\u00e9');
});

test('decode rejects a truncated escape', () => {
  assert.throws(() => decode('%2'), /truncated percent escape/);
  assert.throws(() => decode('%'), /truncated percent escape/);
});

test('decode rejects a non-hex escape', () => {
  assert.throws(() => decode('%2G'), /invalid percent escape/);
  assert.throws(() => decode('%zz'), /invalid percent escape/);
});

test('decode rejects raw non-ASCII input', () => {
  assert.throws(() => decode('\u00e9'), /unexpected non-ASCII character/);
});

test('decode rejects invalid UTF-8 sequences', () => {
  // 0xC3 alone is a truncated two-byte sequence.
  assert.throws(() => decode('%C3'), /truncated UTF-8 sequence/);
  // 0xC0 0x80 is an overlong encoding of NUL.
  assert.throws(() => decode('%C0%80'), /invalid UTF-8 lead byte/);
  // 0xED 0xA0 0x80 encodes a surrogate code point.
  assert.throws(() => decode('%ED%A0%80'), /surrogate/);
});

test('encode rejects lone surrogates', () => {
  assert.throws(() => encode('\ud800'), /lone high surrogate/);
  assert.throws(() => encode('\udc00'), /lone low surrogate/);
});

test('encode and decode reject non-string arguments', () => {
  assert.throws(() => encode(42), TypeError);
  assert.throws(() => decode(null), TypeError);
});

test('empty string round-trips to empty string', () => {
  assert.equal(encode(''), '');
  assert.equal(decode(''), '');
});

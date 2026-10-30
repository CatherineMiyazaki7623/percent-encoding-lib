// Core percent-encoding primitives.
//
// Design notes that are not obvious from the code alone:
//
// * The input to `encode` is a JavaScript string. Strings in JS are sequences
//   of UTF-16 code units, not bytes. To percent-encode "arbitrary strings" in
//   a way that round-trips, we first convert the string to its UTF-8 byte
//   sequence and then escape each byte that is not an unreserved ASCII
//   character. This is the same policy used by RFC 3986 for octets that fall
//   outside the unreserved set.
//
// * We keep `-`, `_`, `.`, and `~` unescaped in addition to the alphanumerics.
//   Those four are the RFC 3986 "unreserved" punctuation marks. Everything
//   else, including `+`, is escaped. `+` is *not* treated as a space on
//   decode: that convention belongs to `application/x-www-form-urlencoded`,
//   not to percent-encoding proper, and mixing the two silently corrupts
//   data that legitimately contains a plus sign.
//
// * Decoding is strict. A `%` that is not followed by two hexadecimal digits
//   is an error rather than being passed through. Passing it through would
//   make `decode(encode(s))` lossy for strings that already contain a literal
//   `%`, and it would hide truncated input from callers. The error is a plain
//   `Error` with a descriptive message so the library stays dependency-free
//   and the failure mode is obvious.
//
// * The decoded bytes must themselves be valid UTF-8. If they are not, we
//   raise rather than substituting U+FFFD, because silently replacing bytes
//   loses the information the caller needs to diagnose the problem.

const UNRESERVED = new Set();
for (let c = 0x30; c <= 0x39; c += 1) UNRESERVED.add(c); // 0-9
for (let c = 0x41; c <= 0x5a; c += 1) UNRESERVED.add(c); // A-Z
for (let c = 0x61; c <= 0x7a; c += 1) UNRESERVED.add(c); // a-z
for (const ch of ['-', '_', '.', '~']) UNRESERVED.add(ch.charCodeAt(0));

const HEX = '0123456789ABCDEF';

function hexValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  return -1;
}

/**
 * Percent-encode a string into a URL-safe ASCII form.
 *
 * The string is first serialised as UTF-8; every byte that is not an RFC 3986
 * unreserved character becomes `%XX` with uppercase hex digits. Uppercase is
 * chosen because it is the canonical form in RFC 3986 section 6.2.2.1 and
 * makes equality comparisons between independently produced encodings work.
 *
 * @param {string} input
 * @returns {string}
 */
export function encode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('encode expects a string');
  }
  const bytes = utf8Encode(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (UNRESERVED.has(b)) {
      out += String.fromCharCode(b);
    } else {
      out += '%' + HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
    }
  }
  return out;
}

/**
 * Decode a percent-encoded string back into the original string.
 *
 * Only `%XX` escapes are interpreted. A literal `+` is preserved as `+`.
 * Invalid escapes and invalid UTF-8 both raise an `Error`.
 *
 * @param {string} input
 * @returns {string}
 */
export function decode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('decode expects a string');
  }
  const bytes = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    if (ch === 0x25) {
      if (i + 2 >= input.length) {
        throw new Error(`truncated percent escape at index ${i}`);
      }
      const hi = hexValue(input.charCodeAt(i + 1));
      const lo = hexValue(input.charCodeAt(i + 2));
      if (hi < 0 || lo < 0) {
        throw new Error(`invalid percent escape at index ${i}`);
      }
      bytes.push((hi << 4) | lo);
      i += 2;
    } else if (ch < 0x80) {
      bytes.push(ch);
    } else {
      // A non-ASCII code unit in the input is not a valid percent-encoded
      // octet. Rejecting it keeps the decoder's contract narrow and avoids
      // guessing whether the caller meant raw UTF-8 or a mis-encoded string.
      throw new Error(`unexpected non-ASCII character at index ${i}`);
    }
  }
  return utf8Decode(bytes);
}

// Minimal UTF-8 encoder. TextEncoder would also work in modern runtimes, but
// rolling it here keeps the module usable in any environment that can run
// ESM and makes the byte-level behaviour visible to the test suite.
function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: must be followed by a low surrogate to form a
      // supplementary code point. A lone surrogate is not valid UTF-8, so we
      // refuse it rather than emitting replacement bytes.
      if (i + 1 >= str.length) {
        throw new Error('lone high surrogate in input');
      }
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Error('lone high surrogate in input');
      }
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('lone low surrogate in input');
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6));
      out.push(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    } else {
      out.push(0xf0 | (code >> 18));
      out.push(0x80 | ((code >> 12) & 0x3f));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    }
  }
  return out;
}

// Minimal strict UTF-8 decoder. Returns a JS string, or throws on malformed
// input. We reject overlong encodings, surrogate code points, and values
// above U+10FFFF, because accepting them would let two different byte
// sequences decode to the same string.
function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let code;
    let extra;
    if (b0 < 0x80) {
      code = b0;
      extra = 0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      code = b0 & 0x1f;
      extra = 1;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      code = b0 & 0x0f;
      extra = 2;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      code = b0 & 0x07;
      extra = 3;
    } else {
      throw new Error(`invalid UTF-8 lead byte 0x${b0.toString(16)}`);
    }

    if (i + extra >= bytes.length) {
      throw new Error('truncated UTF-8 sequence');
    }

    for (let k = 1; k <= extra; k += 1) {
      const bk = bytes[i + k];
      if ((bk & 0xc0) !== 0x80) {
        throw new Error('invalid UTF-8 continuation byte');
      }
      code = (code << 6) | (bk & 0x3f);
    }

    // Reject overlong encodings and values that are not valid scalar values.
    if (extra === 1 && code < 0x80) throw new Error('overlong UTF-8 sequence');
    if (extra === 2 && code < 0x800) throw new Error('overlong UTF-8 sequence');
    if (extra === 3 && code < 0x10000) throw new Error('overlong UTF-8 sequence');
    if (code > 0x10ffff) throw new Error('UTF-8 code point out of range');
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new Error('UTF-8 sequence encodes a surrogate');
    }

    if (code < 0x10000) {
      out += String.fromCharCode(code);
    } else {
      const v = code - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10));
      out += String.fromCharCode(0xdc00 + (v & 0x3ff));
    }
    i += extra + 1;
  }
  return out;
}

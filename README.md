# percent-encoding-lib

Encodes and decodes arbitrary strings into a URL-safe ASCII form using
byte-level percent escapes.

```js
import { encode, decode } from 'percent-encoding-lib';

encode('a b+c');   // 'a%20b%2Bc'
decode('a%20b%2Bc'); // 'a b+c'
```

## Why this exists

`encodeURIComponent` is close, but it leaves `!'()*` unescaped and it will
happily accept lone surrogates, producing a string that cannot be decoded back
to the original. `decodeURIComponent` also treats a malformed escape as a
`URIError` with a message that is hard to act on, and it does not police the
UTF-8 it reconstructs.

This library picks one policy and sticks to it: the input string is serialised
as UTF-8, every byte outside the RFC 3986 unreserved set (`A-Z`, `a-z`, `0-9`,
`-`, `_`, `.`, `~`) becomes an uppercase `%XX` escape, and decoding is strict.
The trade-off is that `+` is *not* decoded as a space. That convention belongs
to `application/x-www-form-urlencoded`, not to percent-encoding, and applying
it here would corrupt any payload that legitimately contains a plus sign.

## The awkward edge

Decoding is strict in three places, and each one throws a plain `Error`:

* a `%` not followed by two hex digits (`'%2G'`, `'%2'`),
* a raw non-ASCII code unit in the input (`decode('é')`),
* a percent-escape sequence that does not form valid UTF-8 (`'%C3'`, `'%C0%80'`,
  `'%ED%A0%80'`).

Encoding is strict too: a lone surrogate raises rather than being silently
replaced with U+FFFD. If you need lenient behaviour, catch the error and
decide what to substitute — the library will not guess for you.

## API

### `encode(input: string): string`

Returns the percent-encoded form of `input`. Throws `TypeError` if `input` is
not a string, and `Error` if `input` contains a lone surrogate.

### `decode(input: string): string`

Returns the string represented by the percent-encoded `input`. Throws
`TypeError` if `input` is not a string, and `Error` on any of the malformed
inputs listed above.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.


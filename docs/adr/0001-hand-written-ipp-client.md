# A hand-written IPP client

The Printer client in `server/printer/` is a small hand-written IPP client with its own codec, not a library. `@sealsystems/ipp` 2.11.0 can't send the PPD keywords the queue needs. A Print-Job it serializes with `copies`, `ColorMode`, `Quality`, `MediaType` and `PageSize` contains `copies` and none of the other four, because the library drops attribute names it doesn't know without an error. The client sends them as `nameWithoutLanguage` values, the way `lp -o` does. Its codec was checked against a real cupsd 2.4.10.

## Consequences

Don't add an IPP library back without checking that a Print-Job it serializes still carries all five keywords.

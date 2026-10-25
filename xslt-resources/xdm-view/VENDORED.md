# Vendored from xdm-viewer / xdm-persistence

These files are copied, not submoduled, from:

- https://github.com/pgfearo/xdm-viewer @ 6424e8ad9a8b1f4df750b9d6adf331eab3fb8407 (`src/*.xsl`),
  plus `xdm:trace` (uncommitted there when copied, 2026-10-24 - update this hash once it's committed)
- https://github.com/pgfearo/xdm-persistence @ 093d5a93e63476335107bc70875d7dcfa6350230 (`src/*.xsl`)

Flattened into one directory. One change from upstream:

1. `xdm-view.xsl`'s import of `xdm-persistence.xsl`, rewritten from the
   sibling-checkout relative path (`../../xdm-persistence/src/xdm-persistence.xsl`)
   to a same-directory one.

The interim local change for XPath 4.0 JNodes (2026-10-16) is no longer
needed: both projects now support JNodes upstream.

To refresh: re-copy `src/*.xsl` from both repos, reapply the import-path edit,
and update the commit hashes above.

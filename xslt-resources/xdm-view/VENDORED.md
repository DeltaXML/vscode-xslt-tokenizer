# Vendored from xdm-viewer / xdm-persistence

These files are copied, not submoduled, from:

- https://github.com/pgfearo/xdm-viewer @ 25c5174e9e3e9522cbe5553e94f117a5ca4baf7d (`src/*.xsl`)
- https://github.com/pgfearo/xdm-persistence @ 79ea673ab2db5908ad15a9bdb6ff6f7e8c5700a2 (`src/*.xsl`)

Flattened into one directory; the only change from upstream is `xdm-view.xsl`'s
import of `xdm-persistence.xsl`, rewritten from the sibling-checkout relative
path (`../../xdm-persistence/src/xdm-persistence.xsl`) to a same-directory one.

To refresh: re-copy `src/*.xsl` from both repos, reapply that one import-path
edit, and update the commit hashes above.

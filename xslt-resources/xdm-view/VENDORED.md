# Vendored from xdm-viewer / xdm-persistence

These files are copied, not submoduled, from:

- https://github.com/pgfearo/xdm-viewer @ 25c5174e9e3e9522cbe5553e94f117a5ca4baf7d (`src/*.xsl`)
- https://github.com/pgfearo/xdm-persistence @ 79ea673ab2db5908ad15a9bdb6ff6f7e8c5700a2 (`src/*.xsl`)

Flattened into one directory. Two changes from upstream:

1. `xdm-view.xsl`'s import of `xdm-persistence.xsl`, rewritten from the
   sibling-checkout relative path (`../../xdm-persistence/src/xdm-persistence.xsl`)
   to a same-directory one.
2. **Interim, 2026-10-16:** XPath 4.0 JNodes are serialized as their values, so
   `xdm:debug` no longer fails with FOTY0013 on a JNode (e.g. a variable
   declared `as="jnode(*, customer)"`). This is the new `zxd:jnode-values` in
   `xdm-serializer-common.xsl`, called by `zxd:build-item-seq`
   (`xdm-serializer.xsl`), and by `zxd:build-item-seq-refs` and
   `zxd:collect-doc-refs` (`xdm-serializer-refs.xsl`). It looks up `fn:jvalue`
   with `function-lookup`, so the modules still compile with XSLT 3.0
   processors. Tested on Saxon-PE 13 (4.0), and on Saxon-PE 13, Saxon-HE 13 and
   Saxon-PE 12.8 (3.0). A JNode's key isn't shown, and function items still
   fail in `zxd:build-atomic`. To be replaced by proper JNode support upstream
   in xdm-persistence.

To refresh: re-copy `src/*.xsl` from both repos, reapply the import-path edit,
reapply change 2 unless upstream now handles JNodes, and update the commit
hashes above.

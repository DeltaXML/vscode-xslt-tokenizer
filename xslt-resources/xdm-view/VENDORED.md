# Vendored from xdm-viewer / xdm-persistence

These files are copied, not submoduled, from:

- https://github.com/pgfearo/xdm-viewer @ 25c5174e9e3e9522cbe5553e94f117a5ca4baf7d (`src/*.xsl`)
- https://github.com/pgfearo/xdm-persistence @ 79ea673ab2db5908ad15a9bdb6ff6f7e8c5700a2 (`src/*.xsl`)

Flattened into one directory. Two changes from upstream:

1. `xdm-view.xsl`'s import of `xdm-persistence.xsl`, rewritten from the
   sibling-checkout relative path (`../../xdm-persistence/src/xdm-persistence.xsl`)
   to a same-directory one.
2. **Interim, 2026-10-16:** support for XPath 4.0 JNodes, so `xdm:debug` no
   longer fails with FOTY0013 on a JNode (e.g. a variable declared
   `as="jnode(*, customer)"`):
   - `xdm-serializer-common.xsl`: new `zxd:is-jnode`, `zxd:jnode-value`,
     `zxd:jnode-path` and `zxd:jnode-values`. They look up `fn:jvalue` and
     `fn:path` with `function-lookup`, so the modules still compile with XSLT
     3.0 processors.
   - `xdm-serializer.xsl` (`zxd:build-item-seq`) and `xdm-serializer-refs.xsl`
     (`zxd:build-item-seq-refs`, `zxd:collect-doc-refs`): a JNode is
     serialized as its value.
   - `xdm-view-text.xsl` (`zxd:husk-value`): in `xdm:debug`, a JNode shows its
     path, e.g. `/lines/*[2]/sku`, above its value, as an XML node does. Its
     array branch takes members by position instead of with `array:for-each`:
     in a version="3.0" module, Saxon 13 passes a JNode member to the
     function as its value.

   Tested on Saxon-PE 13 (4.0), and on Saxon-PE 13, Saxon-HE 13 and Saxon-PE
   12.8 (3.0). Function items still fail in `zxd:build-atomic`. To be replaced
   by proper JNode support upstream in xdm-persistence and xdm-viewer.

To refresh: re-copy `src/*.xsl` from both repos, reapply the import-path edit,
reapply change 2 unless upstream now handles JNodes, and update the commit
hashes above.

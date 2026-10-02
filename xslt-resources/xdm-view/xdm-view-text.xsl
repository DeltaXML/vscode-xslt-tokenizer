<?xml version="1.1" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                exclude-result-prefixes="xsl zxd map array"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Renders an XPath 3.1 Data Model value as indented, JSON-like text
       ({...}, [...], 'string', true()/false(), ...), optionally with
       ANSI color. Works by walking the xdm: tree that
       xdm-persistence's xdm:to-document() produces - the value's shape and
       every atomic value's exact type are already classified there, so
       this only has to render, not re-classify.
  -->

  <xsl:variable name="zxd:RESET" as="xs:string" select="'&#x1B;[0m'"/>
  <xsl:variable name="zxd:RED" as="xs:string" select="'&#x1B;[0;31m'"/>
  <xsl:variable name="zxd:GREEN" as="xs:string" select="'&#x1B;[0;32m'"/>
  <!-- Normal intensity, unlike any of $zxd:BRACKET-COLORS below (all
       bright variants of the same 5 hues) - the one base hue not
       already claimed as a role color elsewhere, used for xdm:debug's
       labels specifically so they read as distinct from real map keys
       (zxd:RED) without clashing with anything else in the palette. -->
  <xsl:variable name="zxd:YELLOW" as="xs:string" select="'&#x1B;[0;33m'"/>
  <xsl:variable name="zxd:BLUE" as="xs:string" select="'&#x1B;[0;34m'"/>
  <xsl:variable name="zxd:MAGENTA" as="xs:string" select="'&#x1B;[0;35m'"/>
  <xsl:variable name="zxd:CYAN" as="xs:string" select="'&#x1B;[0;36m'"/>
  <xsl:variable name="zxd:BRACKET-COLORS" as="xs:string*" select="(
    '&#x1B;[0;91m', '&#x1B;[0;92m', '&#x1B;[0;93m', '&#x1B;[0;95m', '&#x1B;[0;96m'
  )"/>

  <xsl:variable name="zxd:NUMERIC-TYPES" as="xs:string*" select="(
    'xs:integer', 'xs:decimal', 'xs:double', 'xs:float',
    'xs:byte', 'xs:short', 'xs:int', 'xs:long',
    'xs:nonNegativeInteger', 'xs:nonPositiveInteger', 'xs:positiveInteger', 'xs:negativeInteger',
    'xs:unsignedByte', 'xs:unsignedShort', 'xs:unsignedInt', 'xs:unsignedLong'
  )"/>

  <xsl:function name="zxd:colorize" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="color" as="xs:string"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:sequence select="if ($useColor) then $color || $text || $zxd:RESET else $text"/>
  </xsl:function>

  <xsl:function name="zxd:bracket-color" as="xs:string">
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="n" as="xs:integer" select="count($zxd:BRACKET-COLORS)"/>
    <!-- level mod n, not (level - 1) mod n: the latter goes negative (and
         so out of range for indexing $zxd:BRACKET-COLORS) for level 0,
         which the root value's brackets are now rendered at. -->
    <xsl:variable name="idx" as="xs:integer" select="($level mod $n) + 1"/>
    <xsl:sequence select="$zxd:BRACKET-COLORS[$idx]"/>
  </xsl:function>

  <xsl:function name="zxd:indent" as="xs:string">
    <xsl:param name="level" as="xs:integer"/>
    <xsl:sequence select="string-join(for $n in 1 to $level return '  ', '')"/>
  </xsl:function>

  <!-- A map entry's or array member's value stays on the same line as its
       key/preceding siblings only if it's a single atomic value (or empty) -
       anything else (a nested map/array/node, or a multi-item sequence)
       forces its whole container onto multiple lines, one child per line. -->
  <xsl:function name="zxd:is-simple-item-seq" as="xs:boolean">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:sequence select="
      count($items) le 1 and (empty($items) or $items[1]/*[1]/self::xdm:atomic)"/>
  </xsl:function>

  <xsl:function name="xdm:view-text" as="xs:string">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:view-text($value, false())"/>
  </xsl:function>

  <xsl:function name="xdm:view-text" as="xs:string">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:sequence select="xdm:persisted-to-text-view(xdm:to-document($value), $useColor)"/>
  </xsl:function>

  <!-- For a value already persisted via xdm-persistence's xdm:to-document()
       (e.g. read back with doc()) - renders the tree directly rather than
       parsing it into a value and immediately re-serializing it, and
       doesn't need xdm-persistence's xdm:from-document() at all. -->
  <xsl:function name="xdm:persisted-to-text-view" as="xs:string">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="xdm:persisted-to-text-view($doc, false())"/>
  </xsl:function>

  <xsl:function name="xdm:persisted-to-text-view" as="xs:string">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <!-- Level 0: nothing precedes the very first character, so the root
         value's own opening bracket has no indent - matching zxd:indent(0),
         which is what its closing bracket needs to align with.
         Everything below zxd:render-item-seq-text is shared between the
         two persisted formats unchanged - the reference-preserving
         format's xdm:context wraps the same xdm:sequence/xdm:item shape,
         just one level deeper, and introduces exactly one new payload
         kind (xdm:node-ref) that the default format never produces, so
         only the root's own location needs to differ per format. -->
    <xsl:variable name="items" as="element(xdm:item)*" select="
      if (xdm:is-refs-format($doc)) then $doc/xdm:context/xdm:sequence/xdm:item else $doc/xdm:sequence/xdm:item"/>
    <xsl:sequence select="zxd:render-item-seq-text($items, $useColor, 0)"/>
  </xsl:function>

  <!-- Value-level entry point for the reference-preserving mode, mirroring
       xdm:view-text/xdm:to-document-with-refs the same way xdm:view-text
       mirrors xdm:to-document. -->
  <xsl:function name="xdm:view-text-with-refs" as="xs:string">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:view-text-with-refs($value, false())"/>
  </xsl:function>

  <xsl:function name="xdm:view-text-with-refs" as="xs:string">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:sequence select="xdm:persisted-to-text-view(xdm:to-document-with-refs($value), $useColor)"/>
  </xsl:function>

  <!-- A dedicated debug-dump helper for the common pattern of wrapping
       several named variables in a map purely to label them for one
       xsl:message call - $labels' keys are read as plain, unquoted
       labels, not rendered as a real map value in its own right (no
       {}/quoted-key styling), so the wrapper itself doesn't show up as
       noise in the output.

       Deliberately built on plain xdm:to-document(), not
       xdm:to-document-with-refs() - the latter has to copy the *whole*
       document behind any referenced node, to support later
       re-parsing debug output will never do. That's an unacceptable
       cost for something that might run on every iteration of a hot
       loop. Instead, $labels' values are pre-processed by
       zxd:husk-value before serializing: any element()/document-node()
       found (at any depth, through maps/arrays/sequences) is replaced
       by a shallow copy carrying its location as a zxd:path attribute
       (computed via xdm:path() on the *original* node, cheap - O(its
       own depth), no document copy) - see zxd:husk-node/
       zxd:render-node-text for the rest. Two labels pointing at the
       same node each independently compute and show the same path
       text, which is enough to spot the connection without needing
       any actual identity-tracking machinery.

       Each label's ': ' follows its own text immediately - the padding
       needed to line every value up in a common column goes after the
       colon instead, not between the label and the colon - colored
       zxd:YELLOW (distinct from zxd:RED, used for real map keys, so a
       label never reads as though it were one). Each value then starts
       on the same line as its label, rendered exactly as
       xdm:view-text-with-refs would render it standalone, except every
       line after its first is then re-indented (a plain string
       post-process - tokenize on newline, prepend spaces, rejoin -
       rather than threading an extra indent through the whole render
       call chain) so the whole value lines up under where it started,
       not just its first line.

       $title is a required leading parameter, not folded into $labels
       as a reserved key - a "magic" key name would risk colliding with
       a real label and silently misbehaving if mistyped, and would
       break $labels' otherwise-uniform "every entry is a plain label"
       contract. It's also why $title can't instead be an optional
       trailing parameter the way $level is: xdm:debug($labels, $level)
       and xdm:debug($title, $labels) would both be 2-arg overloads of
       the same name, and XSLT/XPath resolves functions by (name,
       arity) only, never by parameter type - the two can't coexist.
       Given a title is meant to mark practically every scattered
       xsl:message call, not be an occasional extra, it's made a
       required first parameter outright rather than adding a
       differently-named variant.

       Color is a separate function (xdm:debug-color) rather than a
       $useColor flag for the same reason $level couldn't also be a
       flag alongside it: two boolean/optional trailing parameters on
       one name run out of arity slots to tell them apart by position
       alone. Splitting color out by name instead - matching
       xdm:view-text/xdm:view-text-with-refs's existing precedent -
       leaves $level the only optional trailing parameter either
       function needs, at position 3.

       A label written with a leading '_' (e.g. '_total') gets a blank
       line inserted above it and renders without the underscore -
       lets related labels be visually grouped within one debug call.
       The marker has to live on the key itself rather than as a
       separate sentinel entry, since map keys are unique and grouping
       may need more than one break. This relies on $labels rendering
       in the order it was written, which XPath 3.1 maps never
       guaranteed - XPath/XQuery/XSLT 4.0 changes that (maps are now
       defined as an ordered sequence of entries; confirmed on Saxon
       13), but on a 3.1-only processor entries may still come out in
       an implementation-defined order, in which case a group's blank
       line can land next to the wrong neighbor. The marker itself
       still works everywhere (it's just string handling on the key);
       only the *placement* relative to other labels depends on
       ordered-map support.
       A label that is only '_' still has a valid (empty) display
       label - it isn't rejected as a degenerate case, just renders
       oddly, matching this project's general "no surprising errors
       over a label string" stance. -->
  <xsl:function name="xdm:debug" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="labels" as="map(xs:string, item()*)"/>
    <xsl:sequence select="zxd:debug-core($title, $labels, false(), 1)"/>
  </xsl:function>

  <!-- $level 1 (the default, via the 2-arg overload above) is
       unindented - level N gets (N - 1) * 5 leading spaces on every
       line of the whole block, banner included, so nested
       xsl:message calls from recursive templates/functions visually
       shift right together with their recursion depth. Every call also
       gets a blank line before its banner (added in zxd:debug-core,
       ahead of the indent step so it's padded consistently with the
       blank lines a '_'-grouped label inserts) - keeps consecutive
       debug calls visually separated in the message stream without
       the caller having to add their own spacing. -->
  <xsl:function name="xdm:debug" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="labels" as="map(xs:string, item()*)"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:sequence select="zxd:debug-core($title, $labels, false(), $level)"/>
  </xsl:function>

  <xsl:function name="xdm:debug-color" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="labels" as="map(xs:string, item()*)"/>
    <xsl:sequence select="zxd:debug-core($title, $labels, true(), 1)"/>
  </xsl:function>

  <xsl:function name="xdm:debug-color" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="labels" as="map(xs:string, item()*)"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:sequence select="zxd:debug-core($title, $labels, true(), $level)"/>
  </xsl:function>

  <xsl:function name="zxd:debug-core" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="labels" as="map(xs:string, item()*)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="banner" as="xs:string" select="zxd:debug-banner($title)"/>
    <xsl:variable name="serialized" as="document-node()" select="xdm:to-document(zxd:husk-value($labels))"/>
    <xsl:variable name="entries" as="element(xdm:entry)*" select="$serialized/xdm:sequence/xdm:item/xdm:map/xdm:entry"/>
    <xsl:variable name="labelWidth" as="xs:integer" select="
      max((0, for $e in $entries return string-length(zxd:debug-display-label(string($e/@key)))))"/>
    <xsl:variable name="prefixWidth" as="xs:integer" select="$labelWidth + 2"/> <!-- + ': ' -->
    <xsl:variable name="continuationPad" as="xs:string" select="zxd:pad-right('', $prefixWidth)"/>
    <xsl:variable name="lines" as="xs:string*" select="
      for $pos in 1 to count($entries) return (
        (if ($pos gt 1 and zxd:is-group-start(string($entries[$pos]/@key))) then '' else ()),
        zxd:debug-label-prefix(zxd:debug-display-label(string($entries[$pos]/@key)), $labelWidth, $useColor) ||
          zxd:indent-continuation-lines(zxd:render-item-seq-text($entries[$pos]/xdm:item, $useColor, 0), $continuationPad)
      )"/>
    <xsl:variable name="body" as="xs:string" select="'&#10;' || $banner || '&#10;' || string-join($lines, '&#10;')"/>
    <xsl:variable name="levelPad" as="xs:string" select="zxd:pad-right('', max((0, ($level - 1) * 5)))"/>
    <xsl:sequence select="zxd:indent-all-lines($body, $levelPad)"/>
  </xsl:function>

  <!-- Deep-walks $value (through maps, arrays, and sequences) and
       replaces every element()/document-node() item with a husked,
       path-annotated copy via zxd:husk-node; every bare text() item
       (e.g. a label whose value is $el/text() directly, not embedded
       in an element) with a whitespace-normalized, truncated copy via
       zxd:husk-text, wrapped with its location via
       zxd:with-node-path; and every attribute()/comment()/
       processing-instruction()/namespace-node() item with itself,
       unchanged, but likewise wrapped with its location - these kinds
       have nowhere on themselves to hang a location marker the way an
       element can carry an extra attribute, hence the wrapper. Used by
       zxd:debug-core before handing $labels to plain xdm:to-document(),
       so the tree serialize/render ever see is already bounded in size
       - no limit needs threading through the renderer itself. -->
  <xsl:function name="zxd:husk-value" as="item()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="
      for $item in $value return
        if ($item instance of element() or $item instance of document-node()) then zxd:husk-node($item)
        else if ($item instance of text()) then zxd:with-node-path($item, zxd:husk-text($item))
        else if ($item instance of attribute() or $item instance of comment()
                 or $item instance of processing-instruction() or $item instance of namespace-node())
             then zxd:with-node-path($item, $item)
        else if ($item instance of map(*)) then
          map:merge(for $k in map:keys($item) return map:entry($k, zxd:husk-value($item($k))))
        else if ($item instance of array(*)) then
          array:for-each($item, function($x as item()*) as item()* { zxd:husk-value($x) })
        else $item"/>
  </xsl:function>

  <!-- Reserved, namespace-qualified map keys used only to carry a
       node's location alongside a value that can't carry a zxd:path
       attribute the way a husked element does (see zxd:with-node-path)
       - QNames, not plain strings, specifically so an ordinary user
       map could never collide with this shape by accident: it would
       need a key that is this exact namespace URI *and* local name,
       not just a string that happens to match. -->
  <xsl:variable name="zxd:NODE-PATH-KEY" as="xs:QName" select="QName('http://deltaxignia.com/ns/xdm-persistence/internal', 'path')"/>
  <xsl:variable name="zxd:NODE-VALUE-KEY" as="xs:QName" select="QName('http://deltaxignia.com/ns/xdm-persistence/internal', 'value')"/>

  <!-- Wraps $displayValue (what should actually render) together with
       $originalNode's location (computed on the *original* node, since
       $displayValue may already be a freshly-built replacement with no
       ancestor context of its own - see zxd:husk-text). Renders as a
       plain xdm:map once serialized, unless zxd:render-payload-text
       recognizes the two reserved keys and unwraps it specially -
       zxd:is-node-path-wrapper/zxd:render-path-wrapped-text do that
       recognition and rendering respectively. -->
  <xsl:function name="zxd:with-node-path" as="map(*)">
    <xsl:param name="originalNode" as="node()"/>
    <xsl:param name="displayValue" as="item()*"/>
    <xsl:sequence select="map{ $zxd:NODE-PATH-KEY: xdm:path($originalNode), $zxd:NODE-VALUE-KEY: $displayValue }"/>
  </xsl:function>

  <!-- The truncated, whitespace-normalized text a bare text() value
       shows in xdm:debug - see zxd:husk-value. An xsl:value-of, not an
       inline XPath text constructor: XSLT's XPath grammar (unlike
       XQuery's) has no bare "text { ... }" node-construction
       expression, so this small function exists to do the
       construction as an instruction and hand back a plain text()
       value for zxd:husk-value's otherwise-pure XPath expression to
       use. -->
  <xsl:function name="zxd:husk-text" as="text()">
    <xsl:param name="node" as="text()"/>
    <xsl:value-of select="zxd:truncate-text(zxd:normalize-for-display($node), $xdm:DEBUG-PRUNE-TEXT-MAX-LENGTH)"/>
  </xsl:function>

  <!-- A public, overridable knob rather than an xdm:debug argument -
       $level already occupies the one extra optional position on
       xdm:debug/xdm:debug-color, and a second trailing parameter would
       force every caller wanting a custom length to also always spell
       out $level (or worse, invite a differently-named function for
       every combination). An xsl:param instead needs no change to any
       call site: a caller's own stylesheet already has higher import
       precedence than this one (it's the one doing the xsl:import), so
       redeclaring the same name there overrides this default with no
       further wiring - the standard XSLT way to make a library
       constant tunable. Namespaced xdm:, not zxd:, precisely because
       it's meant to be reached from outside this module - the zxd:
       namespace's whole point is signaling "not part of the public
       contract", which would contradict documenting this as an
       intentional override point. -->
  <xsl:param name="xdm:DEBUG-PRUNE-TEXT-MAX-LENGTH" as="xs:integer" select="40"/>

  <!-- Truncates $text at $maxLength characters, appending a single
       ellipsis character (not this project's usual three-dot '...' -
       that's zxd:render-node-text's own leaf-truncation marker, kept
       distinct so the two truncation points don't look identical) when
       it was actually cut. -->
  <xsl:function name="zxd:truncate-text" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="maxLength" as="xs:integer"/>
    <xsl:sequence select="
      if (string-length($text) gt $maxLength)
      then substring($text, 1, $maxLength) || '&#x2026;'
      else $text"/>
  </xsl:function>

  <!-- Whether $node's nearest ancestor-or-self xml:space setting (if
       any) is 'preserve' - the standard XML convention for opting a
       subtree out of whitespace normalization, the same one
       xsl:strip-space/xsl:preserve-space honor. The *nearest* setting
       wins, same as everywhere else xml:space applies: an inner
       xml:space="default" turns normalization back on even under an
       outer "preserve", and vice versa. -->
  <xsl:function name="zxd:preserves-space" as="xs:boolean">
    <xsl:param name="node" as="node()"/>
    <!-- General comparison (=), not eq: with no xml:space attribute
         anywhere in the ancestor chain, the left side is an empty
         sequence, and eq (a value comparison, cardinality exactly one)
         would raise a type error there instead of just meaning "no,
         it doesn't preserve" - = correctly evaluates an empty
         sequence as false. -->
    <xsl:sequence select="$node/ancestor-or-self::*[@xml:space][1]/@xml:space = 'preserve'"/>
  </xsl:function>

  <!-- The text a pruned node shows for $textNode: collapsed to single
       spaces and trimmed (fn:normalize-space) - a raw text node often
       carries line breaks and indentation from the source document,
       which would otherwise break xdm:debug's one-line-per-label
       layout - unless zxd:preserves-space says the nearest xml:space
       setting asks to keep it verbatim. Always run before
       zxd:truncate-text, on whichever text ends up being shown, so a
       text that's only long *before* collapsing (or only long after,
       if it's mostly non-whitespace already) is measured accurately
       rather than judged on its raw, pre-normalization length. -->
  <xsl:function name="zxd:normalize-for-display" as="xs:string">
    <xsl:param name="textNode" as="text()"/>
    <xsl:sequence select="
      if (zxd:preserves-space($textNode)) then string($textNode) else normalize-space($textNode)"/>
  </xsl:function>

  <!-- Bounds the display cost of a node value to O(its own attributes +
       direct children + a little text), regardless of how deep or
       large the real subtree is - the element keeps its own
       attributes, its own immediate text-node children (each
       whitespace-normalized via zxd:normalize-for-display, then
       truncated via zxd:truncate-text), and its direct child elements
       with their own attributes and *their* first immediate text-node
       child (normalized and truncated the same way) - nothing past
       that; a document node
       recurses into its child element the same way. Location is
       computed via xdm:path() on the *original* node, before the
       shallow copy loses its ancestor context, and travels along as a
       zxd:path attribute on the husked element - zxd:render-node-text
       knows to pull it back out as a location line and strip it so it
       never displays as a fake extra attribute of the real content.
       Only ever called (via zxd:husk-value) on element()/
       document-node() items - the "otherwise" branch's own $node is
       therefore always an element(). -->
  <xsl:function name="zxd:husk-node" as="node()">
    <xsl:param name="node" as="node()"/>
    <xsl:choose>
      <xsl:when test="$node instance of document-node()">
        <xsl:document>
          <xsl:for-each select="$node/node()">
            <xsl:sequence select="if (. instance of element()) then zxd:husk-node(.) else ."/>
          </xsl:for-each>
        </xsl:document>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="path" as="xs:string" select="xdm:path($node)"/>
        <xsl:for-each select="$node">
          <xsl:copy copy-namespaces="no">
            <xsl:attribute name="zxd:path" select="$path"/>
            <xsl:sequence select="@*"/>
            <xsl:for-each select="node()">
              <xsl:choose>
                <xsl:when test=". instance of element()">
                  <xsl:copy copy-namespaces="no">
                    <xsl:sequence select="@*"/>
                    <xsl:variable name="firstText" as="text()?" select="text()[1]"/>
                    <xsl:variable name="firstTextNormalized" as="xs:string?" select="
                      if (exists($firstText)) then zxd:normalize-for-display($firstText) else ()"/>
                    <xsl:variable name="firstTextTruncated" as="xs:boolean" select="
                      exists($firstTextNormalized) and string-length($firstTextNormalized) gt $xdm:DEBUG-PRUNE-TEXT-MAX-LENGTH"/>
                    <xsl:if test="exists($firstTextNormalized)">
                      <xsl:value-of select="zxd:truncate-text($firstTextNormalized, $xdm:DEBUG-PRUNE-TEXT-MAX-LENGTH)"/>
                    </xsl:if>
                    <!-- Marks that this child had more than what got kept -
                         its own child elements, or more than one text node -
                         so an untruncated first text doesn't read as though
                         it were the whole original content. Skipped when
                         $firstText was already cut by length: that ellipsis
                         already says "not everything is shown" on its own,
                         and a second one right after it would just look
                         like a mistake. -->
                    <xsl:if test="not($firstTextTruncated) and (exists(*) or count(text()) gt 1)">
                      <xsl:value-of select="'&#x2026;'"/>
                    </xsl:if>
                  </xsl:copy>
                </xsl:when>
                <xsl:when test=". instance of text()">
                  <xsl:value-of select="zxd:truncate-text(zxd:normalize-for-display(.), $xdm:DEBUG-PRUNE-TEXT-MAX-LENGTH)"/>
                </xsl:when>
              </xsl:choose>
            </xsl:for-each>
          </xsl:copy>
        </xsl:for-each>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- Unlike zxd:indent-continuation-lines (which leaves a value's own
       first line alone, since it already follows a label on the same
       line), $level's indent applies to every line of the block
       uniformly - there's no "first line already placed" exception
       here, the whole thing is shifting as one unit. -->
  <xsl:function name="zxd:indent-all-lines" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="padding" as="xs:string"/>
    <xsl:sequence select="
      string-join(for $line in tokenize($text, '&#10;') return $padding || $line, '&#10;')"/>
  </xsl:function>

  <!-- A leading '_' on a label requests a blank line above it, to group
       related labels within one debug call - see xdm:debug's own
       comment for why the marker lives on the key and what it depends
       on. Only the first character is checked, so a label with an
       underscore anywhere else ('total_after') is untouched. -->
  <xsl:function name="zxd:is-group-start" as="xs:boolean">
    <xsl:param name="key" as="xs:string"/>
    <xsl:sequence select="starts-with($key, '_')"/>
  </xsl:function>

  <xsl:function name="zxd:debug-display-label" as="xs:string">
    <xsl:param name="key" as="xs:string"/>
    <xsl:sequence select="if (zxd:is-group-start($key)) then substring($key, 2) else $key"/>
  </xsl:function>

  <xsl:variable name="zxd:DEBUG-BANNER-CHAR" as="xs:string" select="'&#x2500;'"/>
  <xsl:variable name="zxd:DEBUG-BANNER-WIDTH" as="xs:integer" select="70"/>

  <!-- A horizontal rule with $title centered in it, marking the start
       of one xsl:debug call clearly when scrolling past many scattered
       ones. A title too long to leave any room for the rule (rare) is
       shown in full with no rule at all, rather than truncated - a
       debug title should never be the thing that gets cut off. -->
  <xsl:function name="zxd:debug-banner" as="xs:string">
    <xsl:param name="title" as="xs:string"/>
    <xsl:variable name="titleText" as="xs:string" select="' ' || $title || ' '"/>
    <xsl:variable name="fillTotal" as="xs:integer" select="max((0, $zxd:DEBUG-BANNER-WIDTH - string-length($titleText)))"/>
    <xsl:variable name="fillLeft" as="xs:integer" select="$fillTotal idiv 2"/>
    <xsl:variable name="fillRight" as="xs:integer" select="$fillTotal - $fillLeft"/>
    <xsl:sequence select="
      zxd:repeat-char($zxd:DEBUG-BANNER-CHAR, $fillLeft) || $titleText || zxd:repeat-char($zxd:DEBUG-BANNER-CHAR, $fillRight)"/>
  </xsl:function>

  <xsl:function name="zxd:repeat-char" as="xs:string">
    <xsl:param name="ch" as="xs:string"/>
    <xsl:param name="n" as="xs:integer"/>
    <xsl:sequence select="string-join(for $i in 1 to $n return $ch, '')"/>
  </xsl:function>

  <!-- $rawLabel's own ': ' immediately follows its text, then enough
       trailing spaces to reach $labelWidth + 2 overall - the colorize
       call wraps only the label text itself, not the padding, so the
       padding's own width is computed from $rawLabel's plain length
       (colorizing first would count the embedded ANSI codes as part of
       the string length and throw the alignment off). -->
  <xsl:function name="zxd:debug-label-prefix" as="xs:string">
    <xsl:param name="rawLabel" as="xs:string"/>
    <xsl:param name="labelWidth" as="xs:integer"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:variable name="pad" as="xs:string" select="zxd:pad-right('', $labelWidth - string-length($rawLabel))"/>
    <xsl:sequence select="zxd:colorize($rawLabel, $zxd:YELLOW, $useColor) || ': ' || $pad"/>
  </xsl:function>

  <xsl:function name="zxd:pad-right" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="width" as="xs:integer"/>
    <xsl:sequence select="$text || string-join(for $i in 1 to ($width - string-length($text)) return ' ', '')"/>
  </xsl:function>

  <!-- Prepends $padding to every line of $text after the first (a
       multi-line value's own first line already follows its label
       directly, so only its later lines need the extra indent). -->
  <xsl:function name="zxd:indent-continuation-lines" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="padding" as="xs:string"/>
    <xsl:variable name="lines" as="xs:string*" select="tokenize($text, '&#10;')"/>
    <xsl:sequence select="
      string-join(for $i in 1 to count($lines) return
        if ($i = 1) then $lines[$i] else $padding || $lines[$i], '&#10;')"/>
  </xsl:function>

  <!-- Renders a sequence of xdm:item elements the way XPath itself would
       write that sequence: 0 items -> '()', 1 item -> just that item (no
       parens), 2+ items -> a parenthesized, comma-separated list. -->
  <xsl:function name="zxd:render-item-seq-text" as="xs:string">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="bc" as="xs:string" select="zxd:bracket-color($level)"/>
    <xsl:choose>
      <xsl:when test="count($items) = 0">
        <xsl:sequence select="zxd:colorize('()', $bc, $useColor)"/>
      </xsl:when>
      <xsl:when test="count($items) = 1">
        <xsl:sequence select="zxd:render-payload-text($items[1]/*[1], $useColor, $level)"/>
      </xsl:when>
      <xsl:when test="some $i in $items satisfies not($i/*[1]/self::xdm:atomic)">
        <xsl:variable name="childIndent" as="xs:string" select="zxd:indent($level + 1)"/>
        <xsl:variable name="closeIndent" as="xs:string" select="zxd:indent($level)"/>
        <xsl:variable name="rendered" as="xs:string*" select="
          for $i in $items return zxd:render-payload-text($i/*[1], $useColor, $level + 1)"/>
        <xsl:sequence select="
          zxd:colorize('(', $bc, $useColor) || '&#10;' || $childIndent ||
          string-join($rendered, ',&#10;' || $childIndent) ||
          '&#10;' || $closeIndent || zxd:colorize(')', $bc, $useColor)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="rendered" as="xs:string*" select="
          for $i in $items return zxd:render-payload-text($i/*[1], $useColor, $level)"/>
        <xsl:sequence select="
          zxd:colorize('(', $bc, $useColor) || string-join($rendered, ', ') || zxd:colorize(')', $bc, $useColor)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-payload-text" as="xs:string">
    <xsl:param name="payload" as="element()"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:choose>
      <xsl:when test="$payload/self::xdm:atomic">
        <xsl:sequence select="zxd:render-atomic-text($payload, $useColor)"/>
      </xsl:when>
      <!-- Checked before the general xdm:map case below, since a
           zxd:with-node-path wrapper serializes as an ordinary
           xdm:map otherwise indistinguishable from a real one. -->
      <xsl:when test="$payload/self::xdm:map and zxd:is-node-path-wrapper($payload)">
        <xsl:sequence select="zxd:render-path-wrapped-text($payload, $useColor, $level)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:map">
        <xsl:sequence select="zxd:render-map-text($payload, $useColor, $level)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:array">
        <xsl:sequence select="zxd:render-array-text($payload, $useColor, $level)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:node-ref">
        <xsl:sequence select="zxd:render-node-ref-text($payload, $useColor, $level)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:text">
        <xsl:sequence select="zxd:colorize('&quot;' || string($payload) || '&quot;', $zxd:CYAN, $useColor)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:comment">
        <xsl:sequence select="zxd:colorize('&lt;!--' || string($payload) || '--&gt;', $zxd:MAGENTA, $useColor)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:pi">
        <xsl:sequence select="zxd:colorize('&lt;?' || string($payload/@name) || ' ' || string($payload) || '?&gt;', $zxd:MAGENTA, $useColor)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:attribute">
        <xsl:sequence select="zxd:colorize('@' || string($payload/@name) || '=&quot;' || string($payload) || '&quot;', $zxd:GREEN, $useColor)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:namespace">
        <xsl:sequence select="
          zxd:colorize('xmlns' || (if (string-length($payload/@prefix) gt 0) then ':' || string($payload/@prefix) else '') ||
                        '=&quot;' || string($payload/@uri) || '&quot;', $zxd:GREEN, $useColor)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:document">
        <xsl:sequence select="zxd:render-node-text($payload/node(), $useColor, $level)"/>
      </xsl:when>
      <xsl:otherwise> <!-- a plain copied element node -->
        <xsl:sequence select="zxd:render-node-text($payload, $useColor, $level)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-atomic-text" as="xs:string">
    <xsl:param name="el" as="element(xdm:atomic)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:variable name="type" as="xs:string" select="$el/@type"/>
    <xsl:variable name="lexical" as="xs:string" select="string($el)"/>
    <xsl:choose>
      <xsl:when test="$type eq 'xs:string'">
        <xsl:sequence select="zxd:colorize('''' || $lexical || '''', $zxd:BLUE, $useColor)"/>
      </xsl:when>
      <xsl:when test="$type eq 'xs:boolean'">
        <xsl:sequence select="zxd:colorize($lexical || '()', $zxd:GREEN, $useColor)"/>
      </xsl:when>
      <xsl:when test="$type = $zxd:NUMERIC-TYPES">
        <xsl:sequence select="zxd:colorize($lexical, $zxd:MAGENTA, $useColor)"/>
      </xsl:when>
      <xsl:when test="$type eq 'xs:QName'">
        <xsl:variable name="uri" as="xs:string?" select="$el/@uri"/>
        <xsl:sequence select="
          zxd:colorize((if (string-length($uri) gt 0) then 'Q{' || $uri || '}' else '') || $lexical, $zxd:CYAN, $useColor)"/>
      </xsl:when>
      <xsl:otherwise>
        <!-- The value is colorized; the '(type)' annotation is left in the
             terminal's default color so it reads as a quieter aside, not
             part of the value itself. -->
        <xsl:sequence select="zxd:colorize($lexical, $zxd:CYAN, $useColor) || ' (' || $type || ')'"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-map-text" as="xs:string">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="bc" as="xs:string" select="zxd:bracket-color($level)"/>
    <xsl:variable name="entryEls" as="element(xdm:entry)*" select="$mapEl/xdm:entry"/>
    <xsl:choose>
      <xsl:when test="empty($entryEls)">
        <xsl:sequence select="zxd:colorize('{', $bc, $useColor) || zxd:colorize('}', $bc, $useColor)"/>
      </xsl:when>
      <xsl:when test="some $e in $entryEls satisfies not(zxd:is-simple-item-seq($e/xdm:item))">
        <xsl:variable name="childIndent" as="xs:string" select="zxd:indent($level + 1)"/>
        <xsl:variable name="closeIndent" as="xs:string" select="zxd:indent($level)"/>
        <xsl:variable name="entries" as="xs:string*" select="
          for $e in $entryEls return zxd:render-entry-text($e, $useColor, $level + 1)"/>
        <xsl:sequence select="
          zxd:colorize('{', $bc, $useColor) || '&#10;' || $childIndent ||
          string-join($entries, ',&#10;' || $childIndent) ||
          '&#10;' || $closeIndent || zxd:colorize('}', $bc, $useColor)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="entries" as="xs:string*" select="
          for $e in $entryEls return zxd:render-entry-text($e, $useColor, $level + 1)"/>
        <xsl:sequence select="
          zxd:colorize('{', $bc, $useColor) || string-join($entries, ', ') || zxd:colorize('}', $bc, $useColor)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-entry-text" as="xs:string">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="keyType" as="xs:string" select="$entry/@key-type"/>
    <xsl:variable name="keyText" as="xs:string" select="
      if ($keyType eq 'xs:string') then '''' || string($entry/@key) || '''' else string($entry/@key)"/>
    <xsl:sequence select="
      zxd:colorize($keyText, $zxd:RED, $useColor) || ': ' ||
      zxd:render-item-seq-text($entry/xdm:item, $useColor, $level)"/>
  </xsl:function>

  <xsl:function name="zxd:render-array-text" as="xs:string">
    <xsl:param name="arrayEl" as="element(xdm:array)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="bc" as="xs:string" select="zxd:bracket-color($level)"/>
    <xsl:variable name="memberEls" as="element(xdm:member)*" select="$arrayEl/xdm:member"/>
    <xsl:choose>
      <xsl:when test="empty($memberEls)">
        <xsl:sequence select="zxd:colorize('[', $bc, $useColor) || zxd:colorize(']', $bc, $useColor)"/>
      </xsl:when>
      <xsl:when test="some $m in $memberEls satisfies not(zxd:is-simple-item-seq($m/xdm:item))">
        <xsl:variable name="childIndent" as="xs:string" select="zxd:indent($level + 1)"/>
        <xsl:variable name="closeIndent" as="xs:string" select="zxd:indent($level)"/>
        <xsl:variable name="members" as="xs:string*" select="
          for $m in $memberEls return zxd:render-item-seq-text($m/xdm:item, $useColor, $level + 1)"/>
        <xsl:sequence select="
          zxd:colorize('[', $bc, $useColor) || '&#10;' || $childIndent ||
          string-join($members, ',&#10;' || $childIndent) ||
          '&#10;' || $closeIndent || zxd:colorize(']', $bc, $useColor)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="members" as="xs:string*" select="
          for $m in $memberEls return zxd:render-item-seq-text($m/xdm:item, $useColor, $level + 1)"/>
        <xsl:sequence select="
          zxd:colorize('[', $bc, $useColor) || string-join($members, ', ') || zxd:colorize(']', $bc, $useColor)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- Whether $entry's key is exactly the reserved zxd:NODE-PATH-KEY/
       zxd:NODE-VALUE-KEY QName $keyVar names - not just a matching
       local name, but the exact reserved namespace URI too (see
       zxd:with-node-path). -->
  <xsl:function name="zxd:is-reserved-node-path-key" as="xs:boolean">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:param name="keyVar" as="xs:QName"/>
    <xsl:sequence select="
      $entry/@key-type eq 'xs:QName'
      and string($entry/@key) eq local-name-from-QName($keyVar)
      and string($entry/@key-uri) eq namespace-uri-from-QName($keyVar)"/>
  </xsl:function>

  <!-- Whether $mapEl is a zxd:with-node-path wrapper rather than a real
       user map - exactly two entries, one keyed by each reserved
       QName. A real map would need to use both exact reserved
       namespaced keys to be mistaken for this, not just entries that
       happen to have similar-looking string keys. -->
  <xsl:function name="zxd:is-node-path-wrapper" as="xs:boolean">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:variable name="entries" as="element(xdm:entry)*" select="$mapEl/xdm:entry"/>
    <xsl:sequence select="
      count($entries) eq 2
      and (some $e in $entries satisfies zxd:is-reserved-node-path-key($e, $zxd:NODE-PATH-KEY))
      and (some $e in $entries satisfies zxd:is-reserved-node-path-key($e, $zxd:NODE-VALUE-KEY))"/>
  </xsl:function>

  <!-- Unwraps a zxd:with-node-path wrapper for display: the wrapped
       value's own rendering (via zxd:render-item-seq-text, so whatever
       kind it is renders exactly as it normally would), with the
       location line prepended above it - same "don't stack onto the
       value's own leading newline" handling as
       zxd:render-node-ref-text, which this otherwise mirrors. -->
  <xsl:function name="zxd:render-path-wrapped-text" as="xs:string">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="pathEntry" as="element(xdm:entry)" select="$mapEl/xdm:entry[zxd:is-reserved-node-path-key(., $zxd:NODE-PATH-KEY)]"/>
    <xsl:variable name="valueEntry" as="element(xdm:entry)" select="$mapEl/xdm:entry[zxd:is-reserved-node-path-key(., $zxd:NODE-VALUE-KEY)]"/>
    <xsl:variable name="pathLine" as="xs:string" select="string($pathEntry/xdm:item[1]/xdm:atomic[1])"/>
    <xsl:variable name="rendered" as="xs:string" select="zxd:render-item-seq-text($valueEntry/xdm:item, $useColor, $level)"/>
    <xsl:variable name="prefix" as="xs:string" select="'&#10;' || zxd:indent($level)"/>
    <xsl:variable name="renderedBody" as="xs:string" select="
      if (starts-with($rendered, $prefix)) then substring($rendered, string-length($prefix) + 1) else $rendered"/>
    <xsl:sequence select="$pathLine || $prefix || $renderedBody"/>
  </xsl:function>

  <!-- The resolved node's own rendering (exactly as zxd:render-node-text
       would render it inline), with the location line
       (zxd:render-node-ref-path-text) prepended on its own line above,
       in the terminal's default color - not colorized like the node
       body itself, so it reads as a quiet annotation rather than part
       of the value. Always puts the node's rendering on its own line(s)
       below the location, even when it would otherwise be short enough
       to stay inline after a 'key: ' prefix. -->
  <xsl:function name="zxd:render-node-ref-text" as="xs:string">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="resolved" as="node()" select="zxd:resolve-node-ref($ref)"/>
    <xsl:variable name="pathLine" as="xs:string" select="zxd:render-node-ref-path-text($ref)"/>
    <xsl:variable name="rendered" as="xs:string" select="zxd:render-node-text($resolved, $useColor, $level)"/>
    <xsl:variable name="prefix" as="xs:string" select="'&#10;' || zxd:indent($level)"/>
    <!-- zxd:render-node-text already starts its own output with $prefix
         when the resolved node has descendant elements (its multi-line
         branch) - stripped here so the two don't stack into a blank-
         looking double newline; the single-line (leaf) branch has no
         such prefix, so nothing is stripped and $prefix supplies the
         line break the path line needs either way. -->
    <xsl:variable name="renderedBody" as="xs:string" select="
      if (starts-with($rendered, $prefix)) then substring($rendered, string-length($prefix) + 1) else $rendered"/>
    <xsl:sequence select="$pathLine || $prefix || $renderedBody"/>
  </xsl:function>

  <!-- Removes just the one zxd:path marker attribute zxd:husk-node adds
       (see zxd:render-node-text), keeping everything else - the node's
       real attributes and children - untouched. -->
  <xsl:function name="zxd:strip-path-attr" as="element()">
    <xsl:param name="el" as="element()"/>
    <xsl:for-each select="$el">
      <xsl:copy copy-namespaces="no">
        <xsl:sequence select="@* except @zxd:path"/>
        <xsl:sequence select="node()"/>
      </xsl:copy>
    </xsl:for-each>
  </xsl:function>

  <!-- A real (element/document) node has no compact XPath-literal form. A
       leaf-like node (no descendant elements) is shown as truncated,
       single-line markup; one with descendant elements is pretty-printed
       with conventional XML indentation instead, aligned to the current
       nesting level - truncating nested markup to a fixed length would
       just cut it apart awkwardly.

       A zxd:path attribute on $node means it was husked for xdm:debug
       (zxd:husk-node) - shown as an uncolored location line above the
       node's own rendering (mirroring zxd:render-node-ref-text's own
       path-line handling, including its "don't stack onto the
       multi-line branch's own leading newline" fix), then stripped so
       it never displays as a fake extra attribute of the real content.
       Every other caller (xdm:view-text, a resolved xdm:node-ref, ...)
       never sets this attribute, so it's a no-op for them. -->
  <xsl:function name="zxd:render-node-text" as="xs:string">
    <xsl:param name="node" as="node()*"/>
    <xsl:param name="useColor" as="xs:boolean"/>
    <xsl:param name="level" as="xs:integer"/>
    <xsl:variable name="pathLine" as="xs:string?" select="($node/self::element()/@zxd:path/string(.))[1]"/>
    <xsl:variable name="displayNode" as="node()*" select="
      for $n in $node return
        if ($n instance of element() and exists($n/@zxd:path)) then zxd:strip-path-attr($n) else $n"/>
    <xsl:variable name="clean" as="node()*" select="zxd:strip-unused-namespaces($displayNode)"/>
    <xsl:variable name="rendered" as="xs:string">
      <xsl:choose>
        <xsl:when test="exists($clean/descendant::*)">
          <xsl:variable name="indent" as="xs:string" select="zxd:indent($level)"/>
          <xsl:variable name="raw" as="xs:string" select="
            string-join(for $n in $clean return serialize($n, map{'method':'xml', 'indent': true()}), '&#10;')"/>
          <!-- Whether serialize() surrounds a lone element's indented markup
               with a leading/trailing newline is implementation-defined (the
               exact whitespace under indent="yes" isn't part of the spec,
               and does vary between Saxon versions) - so any such leading or
               trailing newline is stripped explicitly here, rather than
               assuming a fixed one is (or isn't) present and dropping a
               token by position, which silently ate the real opening tag on
               Saxon versions that don't add the leading newline.
               The (always-added, by us) leading newline is emitted as plain
               text BEFORE the color escape (rather than joined into the
               colorized text) - some terminals/log sinks swallow a bare
               newline that immediately follows a color-start code with
               nothing in between, which otherwise merges the element's start
               tag back onto the 'key: ' line. -->
          <xsl:variable name="withoutLeadingNewline" as="xs:string" select="
            if (starts-with($raw, '&#10;')) then substring($raw, 2) else $raw"/>
          <xsl:variable name="trimmed" as="xs:string" select="
            if (ends-with($withoutLeadingNewline, '&#10;'))
            then substring($withoutLeadingNewline, 1, string-length($withoutLeadingNewline) - 1)
            else $withoutLeadingNewline"/>
          <xsl:variable name="body" as="xs:string" select="
            string-join(tokenize($trimmed, '&#10;'), '&#10;' || $indent)"/>
          <xsl:sequence select="'&#10;' || $indent || zxd:colorize($body, $zxd:BLUE, $useColor)"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:variable name="maxLength" as="xs:integer" select="80"/>
          <xsl:variable name="raw" as="xs:string" select="
            string-join(for $n in $clean return serialize($n, map{'method':'xml', 'indent': false()}), '')"/>
          <xsl:variable name="text" as="xs:string" select="
            if (string-length($raw) gt $maxLength) then substring($raw, 1, $maxLength - 3) || '...' else $raw"/>
          <xsl:sequence select="zxd:colorize($text, $zxd:BLUE, $useColor)"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <xsl:variable name="prefix" as="xs:string" select="'&#10;' || zxd:indent($level)"/>
    <xsl:variable name="renderedBody" as="xs:string" select="
      if (starts-with($rendered, $prefix)) then substring($rendered, string-length($prefix) + 1) else $rendered"/>
    <xsl:sequence select="if (exists($pathLine)) then $pathLine || $prefix || $renderedBody else $rendered"/>
  </xsl:function>

</xsl:stylesheet>

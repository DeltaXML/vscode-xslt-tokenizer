<?xml version="1.0" encoding="UTF-8"?>
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
       Renders an XPath 3.1 Data Model value as a sequence of <xdm:token>/
       <xdm:group> elements - the same shape xdm-view-text.xsl renders as a
       plain string, just with every fragment's semantic kind (string,
       number, boolean, map key, or plain punctuation) already classified
       on it, rather than left for a consumer to re-parse out of text. A
       consumer that wants to color this the way a source-code editor
       would no longer has to lex it back apart first - and can't
       misclassify a string value's own content as if it were punctuation,
       a real risk when re-parsing xdm:view-text's own output (e.g. an
       unescaped quote character inside a string value).

       <xdm:token type="string|number|boolean|name|value|punct">text</xdm:token>
       is a leaf - exactly one fragment of display text, already tagged
       with its kind. The type names are deliberately the same ones VS
       Code's own `debugTokenExpression.*` theme colors use (string,
       number, boolean, name, value), so a consumer can map type directly
       to the matching CSS variable with no translation table
       of its own; punct (brackets, commas, colons) has no VS Code
       equivalent and is meant to stay in the default foreground, same as
       the Debug Console leaves its own punctuation uncolored. A node's
       markup (an element or document value, which has no compact
       tokenizable form of its own) is one "value" token carrying its
       already-truncated/pretty-printed text as-is, embedded newlines and
       all - unlike every other punct/token boundary here, that text is
       not something a consumer is expected to re-lay-out.

       <xdm:group kind="map|array|sequence|entry|node-ref|attribute|namespace"
       foldable="true|false">...</xdm:group> is a container. A map/array's
       own children (after its opening punct token, before its closing
       one) are one kind="entry" group per entry/member, each holding
       that entry's own key/colon/value tokens (or just a value, for an
       array/sequence) plus its own trailing comma - not because entries
       fold independently (they don't; only kind="entry" is never itself
       foldable="true") but so a consumer's CSS can lay each one out on
       its own line purely by switching its display from inline to block
       when the parent is expanded, with indentation following for free
       from the ordinary block box model - nothing here needs to compute
       or track a nesting depth itself. foldable on a map/array/sequence
       is true exactly when xdm-view-text.xsl's own layout would have
       spread that container over multiple lines rather than inlining it
       on one - the same zxd:is-simple-item-seq decision, reused rather
       than re-derived, so the tokenized and plain-text renderings never
       disagree about which containers are "big enough to matter".
       Punctuation and layout are otherwise deliberately not baked into
       any token's text - line breaks and indentation are a consumer/CSS
       concern, the same way they would be for any other structured-data
       renderer.

       kind="node-path" is the one exception to "no further nesting
       beyond entry": xdm:view-tokens (not xdm:persisted-to-token-view,
       and not xdm:view-tokens-with-refs, which already shows this via
       kind="node-ref" - see below) shows every element()/document-node()
       value's own xdm:path() location as a leading 'value' token above
       its markup, the same information xdm:debug already shows for node
       values (zxd:husk-node), just without xdm:debug's pruning/
       truncation - the tokens view always shows a node's full rendering.
       This only works by computing the path on the *original* live
       value before xdm:to-document() ever copies it into the persisted
       tree (via zxd:with-node-paths/the existing zxd:with-node-path
       wrapper xdm-view-text.xsl already defines for xdm:debug's own
       use) - a path recomputed *after* persistence would reflect the
       copy's position inside the persisted xdm: tree, not the node's
       real location, so this can only be offered from the value-level
       entry point, never from a document already persisted separately.

       $minimize (default false, via the 1-arg overload below) reuses
       xdm:debug's own node-shrinking - zxd:prune-node, extracted from
       zxd:husk-node so it carries no path-attribute wiring of its own -
       for every element()/document-node() value, the same "own
       attributes/text plus direct children's tags/attributes/first text,
       nothing deeper" shrink xdm:debug applies, with a trailing '…' where
       something was cut. It's the same shrink, not a smaller version of
       it - large or deeply-nested node values are exactly as much of a
       problem for a tokens consumer as for an xsl:message call, and
       there was no reason to invent a second way to bound them. The
       location this file always shows for a node value (kind="node-path"
       above) is unaffected either way - $minimize only changes whether
       the node's own markup, not its location, is shrunk. -->
  <xsl:function name="xdm:view-tokens" as="element()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:view-tokens($value, false())"/>
  </xsl:function>

  <xsl:function name="xdm:view-tokens" as="element()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="minimize" as="xs:boolean"/>
    <xsl:sequence select="xdm:persisted-to-token-view(xdm:to-document(zxd:with-node-paths($value, $minimize)))"/>
  </xsl:function>

  <!-- Deep-walks $value (through maps, arrays, and sequences - mirroring
       zxd:husk-value's own traversal) and wraps every element()/
       document-node() item with its xdm:path() location, computed here
       while it's still the real, live node (see this file's header
       comment) - and, when $minimize is true, with zxd:prune-node's
       shrunk copy standing in for the node itself rather than the node
       unchanged. Every other item kind (atomics, maps, arrays,
       attributes, text, ...) is left alone entirely regardless of
       $minimize; xdm:debug's reasons for widening its own equivalent
       traversal to those other kinds are specific to fitting a value
       into one debug-message line, which doesn't apply here. -->
  <xsl:function name="zxd:with-node-paths" as="item()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="minimize" as="xs:boolean"/>
    <xsl:sequence select="
      for $item in $value return
        if ($item instance of element() or $item instance of document-node())
        then zxd:with-node-path($item, if ($minimize) then zxd:prune-node($item) else $item)
        else if ($item instance of map(*)) then
          map:merge(for $k in map:keys($item) return map:entry($k, zxd:with-node-paths($item($k), $minimize)))
        else if ($item instance of array(*)) then
          array:for-each($item, function($x as item()*) as item()* { zxd:with-node-paths($x, $minimize) })
        else $item"/>
  </xsl:function>

  <!-- For a value already persisted via xdm-persistence's xdm:to-document()
       (e.g. read back with doc()) - renders the tree directly, same
       precedent as xdm:persisted-to-text-view/xdm:persisted-to-html-view. -->
  <xsl:function name="xdm:persisted-to-token-view" as="element()*">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="items" as="element(xdm:item)*" select="
      if (xdm:is-refs-format($doc)) then $doc/xdm:context/xdm:sequence/xdm:item else $doc/xdm:sequence/xdm:item"/>
    <xsl:sequence select="zxd:render-item-seq-tokens($items)"/>
  </xsl:function>

  <!-- Value-level entry point for the reference-preserving mode, mirroring
       xdm:view-text-with-refs/xdm:view-html-fragment-with-refs the same
       way they mirror xdm:to-document-with-refs. -->
  <xsl:function name="xdm:view-tokens-with-refs" as="element()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:persisted-to-token-view(xdm:to-document-with-refs($value))"/>
  </xsl:function>

  <xsl:function name="zxd:token" as="element(xdm:token)">
    <xsl:param name="type" as="xs:string"/>
    <xsl:param name="text" as="xs:string"/>
    <xdm:token type="{$type}"><xsl:value-of select="$text"/></xdm:token>
  </xsl:function>

  <xsl:function name="zxd:punct" as="element(xdm:token)">
    <xsl:param name="text" as="xs:string"/>
    <xsl:sequence select="zxd:token('punct', $text)"/>
  </xsl:function>

  <!-- Wraps $tokens as one kind="entry" group - one row of a map/array/
       sequence - with its own trailing ', ' when $hasNext, so the comma
       ends up inside the entry that precedes it rather than as a
       separate sibling between two entries; that's what lets a
       consumer's CSS put each entry on its own line (entry { display:
       block }) without a lone comma stranding itself on a line of its
       own. Never itself foldable="true" - see this file's header
       comment. -->
  <xsl:function name="zxd:entry" as="element(xdm:group)">
    <xsl:param name="tokens" as="element()*"/>
    <xsl:param name="hasNext" as="xs:boolean"/>
    <xdm:group kind="entry" foldable="false">
      <xsl:sequence select="$tokens"/>
      <xsl:if test="$hasNext"><xsl:sequence select="zxd:punct(', ')"/></xsl:if>
    </xdm:group>
  </xsl:function>

  <!-- Renders a sequence of xdm:item elements the way xdm-view-text.xsl's
       zxd:render-item-seq-text does: 0 items -> a single '()' punct token,
       1 item -> just that item's own tokens (no wrapping group), 2+ items
       -> a foldable "sequence" group, parenthesized and comma-separated,
       one kind="entry" per item. -->
  <xsl:function name="zxd:render-item-seq-tokens" as="element()*">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:choose>
      <xsl:when test="count($items) = 0">
        <xsl:sequence select="zxd:punct('()')"/>
      </xsl:when>
      <xsl:when test="count($items) = 1">
        <xsl:sequence select="zxd:render-payload-tokens($items[1]/*[1])"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="foldable" as="xs:boolean" select="
          some $i in $items satisfies not($i/*[1]/self::xdm:atomic)"/>
        <xdm:group kind="sequence" foldable="{$foldable}">
          <xsl:sequence select="zxd:punct('(')"/>
          <xsl:for-each select="$items">
            <xsl:sequence select="zxd:entry(zxd:render-payload-tokens(./*[1]), position() ne last())"/>
          </xsl:for-each>
          <xsl:sequence select="zxd:punct(')')"/>
        </xdm:group>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-payload-tokens" as="element()*">
    <xsl:param name="payload" as="element()"/>
    <xsl:choose>
      <xsl:when test="$payload/self::xdm:atomic">
        <xsl:sequence select="zxd:render-atomic-tokens($payload)"/>
      </xsl:when>
      <!-- Checked before the general xdm:map case below, since a
           zxd:with-node-path wrapper (added by zxd:with-node-paths -
           see this file's header comment) serializes as an ordinary
           xdm:map otherwise indistinguishable from a real one -
           mirroring zxd:render-payload-text's own precedent. -->
      <xsl:when test="$payload/self::xdm:map and zxd:is-node-path-wrapper($payload)">
        <xsl:sequence select="zxd:render-path-wrapped-tokens($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:map">
        <xsl:sequence select="zxd:render-map-tokens($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:array">
        <xsl:sequence select="zxd:render-array-tokens($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:node-ref">
        <xsl:sequence select="zxd:render-node-ref-tokens($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:text">
        <xsl:sequence select="zxd:token('string', '&quot;' || string($payload) || '&quot;')"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:comment">
        <xsl:sequence select="zxd:token('value', '&lt;!--' || string($payload) || '--&gt;')"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:pi">
        <xsl:sequence select="zxd:token('value', '&lt;?' || string($payload/@name) || ' ' || string($payload) || '?&gt;')"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:attribute">
        <xdm:group kind="attribute" foldable="false">
          <xsl:sequence select="zxd:token('name', '@' || string($payload/@name))"/>
          <xsl:sequence select="zxd:punct('=')"/>
          <xsl:sequence select="zxd:token('string', '&quot;' || string($payload) || '&quot;')"/>
        </xdm:group>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:namespace">
        <xdm:group kind="namespace" foldable="false">
          <xsl:sequence select="
            zxd:token('name', 'xmlns' || (if (string-length($payload/@prefix) gt 0) then ':' || string($payload/@prefix) else ''))"/>
          <xsl:sequence select="zxd:punct('=')"/>
          <xsl:sequence select="zxd:token('string', '&quot;' || string($payload/@uri) || '&quot;')"/>
        </xdm:group>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:document">
        <xsl:sequence select="zxd:render-node-tokens($payload/node())"/>
      </xsl:when>
      <xsl:otherwise> <!-- a plain copied element node -->
        <xsl:sequence select="zxd:render-node-tokens($payload)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-atomic-tokens" as="element(xdm:token)+">
    <xsl:param name="el" as="element(xdm:atomic)"/>
    <xsl:variable name="type" as="xs:string" select="$el/@type"/>
    <xsl:variable name="lexical" as="xs:string" select="string($el)"/>
    <xsl:choose>
      <xsl:when test="$type eq 'xs:string'">
        <xsl:sequence select="zxd:token('string', '''' || $lexical || '''')"/>
      </xsl:when>
      <xsl:when test="$type eq 'xs:boolean'">
        <xsl:sequence select="zxd:token('boolean', $lexical || '()')"/>
      </xsl:when>
      <xsl:when test="$type = $zxd:NUMERIC-TYPES">
        <xsl:sequence select="zxd:token('number', $lexical)"/>
      </xsl:when>
      <xsl:when test="$type eq 'xs:QName'">
        <xsl:variable name="uri" as="xs:string?" select="$el/@uri"/>
        <xsl:sequence select="
          zxd:token('value', (if (string-length($uri) gt 0) then 'Q{' || $uri || '}' else '') || $lexical)"/>
      </xsl:when>
      <xsl:otherwise>
        <!-- Two tokens, not one merged into the other: 'value' for the
             lexical value itself, 'punct' for the '(type)' annotation -
             matching zxd:render-atomic-text's own choice to leave this
             annotation in the default/uncolored foreground while the
             value itself is colored, the same reuse-punct-for-"plain
             text" convention this file's node-path/node-ref location
             lines already use. -->
        <xsl:sequence select="zxd:token('value', $lexical)"/>
        <xsl:sequence select="zxd:token('punct', ' (' || $type || ')')"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-map-tokens" as="element(xdm:group)">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:variable name="entryEls" as="element(xdm:entry)*" select="$mapEl/xdm:entry"/>
    <xsl:variable name="foldable" as="xs:boolean" select="
      exists($entryEls) and (some $e in $entryEls satisfies not(zxd:is-simple-item-seq($e/xdm:item)))"/>
    <xdm:group kind="map" foldable="{$foldable}">
      <xsl:sequence select="zxd:punct('{')"/>
      <xsl:for-each select="$entryEls">
        <xsl:sequence select="zxd:entry(zxd:render-entry-tokens(.), position() ne last())"/>
      </xsl:for-each>
      <xsl:sequence select="zxd:punct('}')"/>
    </xdm:group>
  </xsl:function>

  <xsl:function name="zxd:render-entry-tokens" as="element()*">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:variable name="keyType" as="xs:string" select="$entry/@key-type"/>
    <xsl:variable name="keyText" as="xs:string" select="
      if ($keyType eq 'xs:string') then '''' || string($entry/@key) || '''' else string($entry/@key)"/>
    <xsl:sequence select="zxd:token('name', $keyText)"/>
    <xsl:sequence select="zxd:punct(': ')"/>
    <xsl:sequence select="zxd:render-item-seq-tokens($entry/xdm:item)"/>
  </xsl:function>

  <xsl:function name="zxd:render-array-tokens" as="element(xdm:group)">
    <xsl:param name="arrayEl" as="element(xdm:array)"/>
    <xsl:variable name="memberEls" as="element(xdm:member)*" select="$arrayEl/xdm:member"/>
    <xsl:variable name="foldable" as="xs:boolean" select="
      exists($memberEls) and (some $m in $memberEls satisfies not(zxd:is-simple-item-seq($m/xdm:item)))"/>
    <xdm:group kind="array" foldable="{$foldable}">
      <xsl:sequence select="zxd:punct('[')"/>
      <xsl:for-each select="$memberEls">
        <xsl:sequence select="zxd:entry(zxd:render-item-seq-tokens(./xdm:item), position() ne last())"/>
      </xsl:for-each>
      <xsl:sequence select="zxd:punct(']')"/>
    </xdm:group>
  </xsl:function>

  <!-- A real node's markup, as a single 'value' token - reuses
       zxd:render-node-text (from xdm-view-text.xsl) with useColor=false so
       it never emits ANSI escapes, rather than re-implementing its
       truncation/pretty-print/cross-Saxon-version whitespace handling a
       second time. Always called at level 0: the surrounding indentation
       zxd:render-node-text would otherwise add for a non-zero level is a
       layout concern for whoever positions this token, not something to
       bake into the token's own text - only the leading newline the
       multi-line branch unconditionally adds (regardless of level) is
       stripped here, the same "don't stack a leading blank line" fix
       zxd:render-node-ref-text/zxd:render-path-wrapped-text already apply
       for their own callers. -->
  <xsl:function name="zxd:render-node-tokens" as="element(xdm:token)">
    <xsl:param name="node" as="node()*"/>
    <xsl:variable name="rendered" as="xs:string" select="zxd:render-node-text($node, false(), 0)"/>
    <xsl:variable name="text" as="xs:string" select="
      if (starts-with($rendered, '&#10;')) then substring($rendered, 2) else $rendered"/>
    <xsl:sequence select="zxd:token('value', $text)"/>
  </xsl:function>

  <!-- The resolved node's own tokens (zxd:render-node-tokens), with the
       location line (zxd:render-node-ref-path-text, from
       xdm-view-common.xsl) as a leading 'value' token - not foldable
       itself (see this file's header comment for why fold support stops
       at map/array/sequence for now). -->
  <xsl:function name="zxd:render-node-ref-tokens" as="element(xdm:group)">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:variable name="resolved" as="node()" select="zxd:resolve-node-ref($ref)"/>
    <xdm:group kind="node-ref" foldable="false">
      <!-- 'punct', not 'value' - matches zxd:render-node-ref-text's own
           choice to leave this line in the default/uncolored foreground
           so it reads as a quiet annotation, not part of the value
           itself; a consumer's CSS is expected to also put it on its
           own line, ahead of the node's own rendering, the same way. -->
      <xsl:sequence select="zxd:token('punct', zxd:render-node-ref-path-text($ref))"/>
      <xsl:sequence select="zxd:render-node-tokens($resolved)"/>
    </xdm:group>
  </xsl:function>

  <!-- Unwraps a zxd:with-node-path wrapper (added by zxd:with-node-paths
       for xdm:view-tokens - not to be confused with kind="node-ref",
       which is xdm:view-tokens-with-refs's own, differently-sourced
       equivalent): the wrapped value's own tokens
       (zxd:render-item-seq-tokens, so whatever kind it is renders
       exactly as it normally would - always a single node's markup in
       practice, since zxd:with-node-paths only ever wraps element()/
       document-node() items), with the location line
       (zxd:render-node-ref-path-text's sibling for this wrapper shape)
       as a leading 'value' token, mirroring zxd:render-node-ref-tokens's
       own shape. A distinct kind from "node-ref" on purpose - this is a
       plain node shown with its location, not a resolved reference,
       even though a consumer's default styling may reasonably treat the
       two the same. -->
  <xsl:function name="zxd:render-path-wrapped-tokens" as="element(xdm:group)">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:variable name="pathEntry" as="element(xdm:entry)" select="$mapEl/xdm:entry[zxd:is-reserved-node-path-key(., $zxd:NODE-PATH-KEY)]"/>
    <xsl:variable name="valueEntry" as="element(xdm:entry)" select="$mapEl/xdm:entry[zxd:is-reserved-node-path-key(., $zxd:NODE-VALUE-KEY)]"/>
    <xsl:variable name="pathLine" as="xs:string" select="string($pathEntry/xdm:item[1]/xdm:atomic[1])"/>
    <xdm:group kind="node-path" foldable="false">
      <!-- 'punct', not 'value' - see zxd:render-node-ref-tokens's own
           comment on this same choice, which this mirrors. -->
      <xsl:sequence select="zxd:token('punct', $pathLine)"/>
      <xsl:sequence select="zxd:render-item-seq-tokens($valueEntry/xdm:item)"/>
    </xdm:group>
  </xsl:function>

</xsl:stylesheet>

<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:js="http://example.com/ns/json-schema"
                xmlns:axsl="http://example.com/ns/xslt-alias"
                exclude-result-prefixes="#all"
                version="4.0">

   <xsl:note format="xdoc-md">
      Converts a JSON Schema to XSLT 4.0 record types: an `xsl:item-type` declaration for the root schema, and one
      for each schema in `$defs`. The schema's descriptions become `xsl:note` documentation for the types and their
      fields.

      The schema is read as a tree of JNodes, so it's navigated with path expressions: `//get('$ref')` finds every
      reference, at any depth, and `jkey()` gives the name of a property or definition.

      JSON Schema keywords supported: `type` (including a list of types, e.g. `["string", "null"]`), `properties`,
      `required`, `items`, `enum`, `$ref` (to `#/$defs/...`) and `description`. Validation keywords such as
      `pattern` or `minimum` have no record-type equivalent, and are ignored.

      @param $schema-uri the JSON Schema to convert - relative to this stylesheet
      @param $root-name the name of the item type for the root schema - by default, from the schema's `title`
      @variable $types-uri the stylesheet module to write the item types to - from the schema's file name, e.g.
      `order-types.xsl` for `order.schema.json`, next to the schema
   </xsl:note>

   <xsl:character-map name="newlines">
      <xsl:output-character character="&#xA;" string="&#xA;"/>
   </xsl:character-map>

   <xsl:output method="text"/>

   <!-- the output is a stylesheet module: literal result elements in the axsl namespace become xsl elements -->
   <xsl:namespace-alias stylesheet-prefix="axsl" result-prefix="xsl"/>

   <xsl:param name="schema-uri" as="xs:string" select="'order.schema.json'"/>
   <xsl:param name="root-name" as="xs:string?"/>
   <xsl:variable name="types-uri" as="xs:string" select="replace($schema-uri, '(\.schema)?\.json$', '') || '-types.xsl'"/>

   <!-- the JSON Schema keywords used here: the others are allowed in the schema, but not checked or used -->
   <xsl:item-type name="schema" as="record(
         type? as (xs:string | array(xs:string)),
         title? as xs:string,
         description? as xs:string,
         properties? as map(xs:string, map(*)),
         required? as array(xs:string),
         items? as map(*),
         enum? as array(item()?),
         '$ref'? as xs:string,
         '$defs'? as map(xs:string, map(*))
      )">
      <xsl:note format="xdoc-md">
         A JSON Schema, or one of the schemas within it. It can't refer to itself (Saxon 13 doesn't allow recursive
         item types), so the schemas within it are `map(*)` values: a JNode for one is converted to a
         `jnode(*, schema)` when it's passed to a function.
      </xsl:note>
   </xsl:item-type>

   <xsl:variable name="root" as="jnode(*, schema)" select="jtree(js:schema(json-doc($schema-uri)))"/>
   <xsl:variable name="defs" as="jnode()*" select="$root/get('$defs')/*"/>

   <xsl:function name="js:schema" as="schema">
      <xsl:note format="xdoc-md">
         A schema with only the keywords in the `schema` record type, as are the schemas within it.

         A `jnode(*, schema)` type matches a JNode only when its value is an *instance* of the record type, and a map
         with other keys, such as `$id` or `minLength`, isn't. Converting the map to the record type, as for this
         function's parameter, drops those keys.

         @param $schema the schema
      </xsl:note>
      <xsl:param name="schema" as="schema"/>
      <xsl:sequence select="map:merge((
                               map:remove($schema, ('properties', 'items', '$defs')),
                               $schema?properties ! map{'properties': js:schemas(.)},
                               $schema?items ! map{'items': js:schema(.)},
                               $schema?'$defs' ! map{'$defs': js:schemas(.)}
                            ))"/>
   </xsl:function>

   <xsl:function name="js:schemas" as="map(xs:string, schema)">
      <xsl:param name="schemas" as="map(xs:string, map(*))"/>
      <xsl:sequence select="map:merge(map:for-each($schemas, function($name, $schema) { map{$name: js:schema($schema)} }))"/>
   </xsl:function>

   <xsl:template name="xsl:initial-template">
      <xsl:result-document href="{resolve-uri($types-uri, static-base-uri())}" method="xml" indent="yes" use-character-maps="newlines">
         <axsl:stylesheet version="4.0">
            <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
            <axsl:note format="xdoc-md" xsl:expand-text="yes">
               ### XSLT type declarations extracted from JSON Schema: {$schema-uri}

               Generated from {$schema-uri} by schema-to-records.xsl: **regenerate this file rather than edit it**.

               @version 1.0
            </axsl:note>
            <!-- the generated types use the xs prefix in their 'as' attributes, where the serializer can't see it -->
            <xsl:call-template name="js:item-type">
               <xsl:with-param name="name" select="($root-name, js:type-name($root/title), 'root')[1]"/>
               <xsl:with-param name="schema" select="$root"/>
            </xsl:call-template>
            <xsl:for-each select="$defs">
               <xsl:call-template name="js:item-type">
                  <xsl:with-param name="name" select="jkey()"/>
                  <xsl:with-param name="schema" select="."/>
                  <xsl:with-param name="def" select="jkey()"/>
               </xsl:call-template>
            </xsl:for-each>
         </axsl:stylesheet>
      </xsl:result-document>
      <xsl:variable name="type-count" as="xs:integer" select="count($defs) + 1"/>
      <xsl:select>
         `Wrote {$type-count} item types to {$types-uri}
`
      </xsl:select>
   </xsl:template>

   <xsl:template name="js:item-type">
      <xsl:note format="xdoc-md">
         Writes an `xsl:item-type` declaration for a schema, with an `xsl:note` for its description and those of its
         properties. The note for a property that's `map(*)` because its references lead back to this type says why.

         @param $name the name of the item type
         @param $schema the schema
         @param $def the name of the definition in `$defs` that's being declared, if it is one
      </xsl:note>
      <xsl:param name="name" as="xs:string"/>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:param name="def" as="xs:string?"/>
      <xsl:variable name="back-refs" as="xs:string*" select="distinct-values(js:refs($schema)[$def = js:reachable(., ())])"/>
      <!-- the properties whose references lead back to this type: their types use map(*) instead -->
      <xsl:variable name="recursive-fields" as="jnode()*" select="$schema/properties/*[js:refs(.) = $back-refs]"/>
      <xsl:variable name="described-fields" as="jnode()*" select="$schema/properties/*[exists(js:description(.)) or exists(. intersect $recursive-fields)]"/>
      <!-- an item type can't have an occurrence indicator, as a sequence type can -->
      <xsl:variable name="item-type" as="xs:string" select="replace(js:sequence-type($schema, $def), '\?$', '')"/>
      <!-- a record type's lines are indented relative to the line it starts on: here, within xsl:item-type -->
      <axsl:item-type name="{$name}" as="{replace($item-type, '&#10;', '&#10;      ')}">
         <xsl:if test="exists($schema/description) or exists($described-fields)">
            <!-- the note's text is written with its own line breaks and indentation, as for a note in a stylesheet -->
            <axsl:note format="xdoc-md">
               <xsl:variable name="note-lines" as="xs:string*">
                  <xsl:select>
                     $schema/description,
                     ''[exists($schema/description) and exists($described-fields)]
                  </xsl:select>
                  <xsl:for-each select="$described-fields">
                     <xsl:variable name="recursion-note" as="xs:string?" select="js:recursion-note(., $name)[exists(current() intersect $recursive-fields)]"/>
                     <xsl:sequence select="string-join((`@field {js:field-name(jkey())}`, js:description(.), $recursion-note), ' ')"/>
                  </xsl:for-each>
               </xsl:variable>
               <!-- each line is indented within the note, and the end tag is indented as for the start tag -->
               <xsl:variable name="indented-lines" as="xs:string*">
                  <xsl:select>
                     $note-lines ! `{if (.) then '         ' || . else ''}
`
                  </xsl:select>
               </xsl:variable>
               <xsl:select>
                  `
{string-join($indented-lines)}      `
               </xsl:select>
            </axsl:note>
         </xsl:if>
      </axsl:item-type>
   </xsl:template>

   <xsl:function name="js:recursion-note" as="xs:string">
      <xsl:note format="xdoc-md">
         Why a property's type uses `map(*)` for its references, e.g. for `line`'s `bundle-items`, which are lines too.
         Saxon 13 doesn't allow recursive item types, directly or through other types.

         @param $property the property's schema
         @param $type-name the name of the item type it's a field of
      </xsl:note>
      <xsl:param name="property" as="jnode(*, schema)"/>
      <xsl:param name="type-name" as="xs:string"/>
      <!-- in Markdown code spans: plain strings, as a backtick in a string template would have to be doubled -->
      <xsl:variable name="refs" as="xs:string" select="string-join(distinct-values(js:refs($property)) ! ('`' || . || '`'), ', ')"/>
      <!-- e.g. a line's bundle-items are lines: a direct reference needs no explanation of where it leads -->
      <xsl:variable name="leads-back" as="xs:string?" select="(', which refers back to `' || $type-name || '`')[js:refs($property) != $type-name]"/>
      <xsl:sequence select="'(`map(*)` rather than ' || $refs || $leads-back || ': Saxon 13 doesn''t allow recursive item types.)'"/>
   </xsl:function>

   <xsl:function name="js:description" as="xs:string?">
      <xsl:note format="xdoc-md">
         A schema's description - or, for a `$ref` with no description of its own, that of the definition it refers to.

         @param $schema the schema
      </xsl:note>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:sequence select="($schema/description, $defs[jkey() = js:refs($schema)[1]]/description)[1]"/>
   </xsl:function>

   <xsl:function name="js:sequence-type" as="xs:string">
      <xsl:note format="xdoc-md">
         The XPath sequence type for the values a schema allows. A JSON `null` is an empty sequence, so a schema that
         allows `null` gives an optional type, e.g. `xs:string?`.

         @param $schema the schema
         @param $def the name of the definition being declared, if any - references that lead back to it are `map(*)`
      </xsl:note>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:param name="def" as="xs:string?"/>
      <xsl:variable name="types" as="xs:string*" select="data($schema/type/jvalue())"/>
      <xsl:variable name="non-null-types" as="xs:string*" select="$types[. ne 'null']"/>
      <xsl:variable name="optional" as="xs:string?" select="'?'[$types = 'null']"/>
      <xsl:choose>
         <xsl:when test="exists($schema/get('$ref'))">
            <xsl:sequence select="js:ref-type($schema/get('$ref'), $def)"/>
         </xsl:when>
         <xsl:when test="exists($schema/enum)">
            <xsl:sequence select="js:enum-type($schema)"/>
         </xsl:when>
         <xsl:when test="empty($types)">
            <!-- no type: it may be implied by other keywords -->
            <xsl:sequence select="if (exists($schema/properties)) then js:json-type($schema, 'object', $def)
                                  else if (exists($schema/items)) then js:json-type($schema, 'array', $def)
                                  else 'item()?'"/>
         </xsl:when>
         <xsl:when test="empty($non-null-types)">
            <xsl:sequence select="'empty-sequence()'"/>
         </xsl:when>
         <xsl:when test="count($non-null-types) eq 1">
            <xsl:sequence select="js:json-type($schema, $non-null-types, $def) || $optional"/>
         </xsl:when>
         <xsl:otherwise>
            <xsl:sequence select="'(' || string-join($non-null-types ! js:json-type($schema, ., $def), ' | ') || ')' || $optional"/>
         </xsl:otherwise>
      </xsl:choose>
   </xsl:function>

   <xsl:function name="js:json-type" as="xs:string">
      <xsl:note format="xdoc-md">
         The XPath item type for one of the JSON types a schema allows. Every JSON number is parsed as an
         `xs:double`, so `integer` is `xs:double` too: `xs:integer` would reject the parsed data.

         @param $schema the schema
         @param $type the JSON type, e.g. `object`
         @param $def the name of the definition being declared, if any
      </xsl:note>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:param name="type" as="xs:string"/>
      <xsl:param name="def" as="xs:string?"/>
      <xsl:choose>
         <xsl:when test="$type eq 'string'">xs:string</xsl:when>
         <xsl:when test="$type = ('number', 'integer')">xs:double</xsl:when>
         <xsl:when test="$type eq 'boolean'">xs:boolean</xsl:when>
         <xsl:when test="$type eq 'array'">
            <xsl:sequence select="'array(' || (if (exists($schema/items)) then js:sequence-type($schema/items, $def) else '*') || ')'"/>
         </xsl:when>
         <xsl:when test="$type eq 'object' and exists($schema/properties/*)">
            <xsl:sequence select="js:record-type($schema, $def)"/>
         </xsl:when>
         <xsl:when test="$type eq 'object'">map(*)</xsl:when>
         <xsl:otherwise>item()</xsl:otherwise>
      </xsl:choose>
   </xsl:function>

   <xsl:function name="js:record-type" as="xs:string">
      <xsl:note format="xdoc-md">
         The record type for an object schema with properties: one field per property, each on a line of its own.
         A property that isn't `required` is an optional field, e.g. `notes? as xs:string`.

         The fields are indented relative to the line the record type starts on, and so are the lines of a record
         type within a field. The `newlines` character map keeps the line breaks when the `as` attribute is
         serialized - otherwise they're written as `&amp;#xA;`.

         @param $schema the object schema
         @param $def the name of the definition being declared, if any
      </xsl:note>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:param name="def" as="xs:string?"/>
      <xsl:variable name="required" as="xs:string*" select="data($schema/required/jvalue())"/>
      <xsl:variable name="fields" as="xs:string*">
         <xsl:for-each select="$schema/properties/*">
            <xsl:variable name="key" as="xs:string" select="jkey()"/>
            <xsl:variable name="type" as="xs:string" select="replace(js:sequence-type(., $def), '&#10;', '&#10;   ')"/>
            <xsl:sequence select="`   {js:field-name($key)}{'?'[not($key = $required)]} as {$type}`"/>
         </xsl:for-each>
      </xsl:variable>
      <xsl:sequence select="'record(&#10;' || string-join($fields, ',&#10;') || '&#10;)'"/>
   </xsl:function>

   <xsl:function name="js:enum-type" as="xs:string">
      <xsl:note format="xdoc-md">
         The type for an `enum`: an XPath 4.0 enumeration type when the values are strings, e.g.
         `enum('paid', 'shipped')`, or else `xs:anyAtomicType`. Either is optional when `null` is one of the values.

         @param $schema the schema with the `enum`
      </xsl:note>
      <xsl:param name="schema" as="jnode(*, schema)"/>
      <xsl:variable name="values" as="item()*" select="$schema/enum/* ! jvalue()"/>
      <xsl:variable name="optional" as="xs:string?" select="'?'[exists($schema/enum/*[empty(jvalue())])]"/>
      <xsl:sequence select="if (every $value in $values satisfies $value instance of xs:string)
                            then 'enum(' || string-join($values ! js:string-literal(.), ', ') || ')' || $optional
                            else 'xs:anyAtomicType' || $optional"/>
   </xsl:function>

   <xsl:function name="js:ref-type" as="xs:string">
      <xsl:note format="xdoc-md">
         The type for a `$ref`: the name of the item type declared for the definition it refers to. The type is
         `map(*)` instead when the definition isn't in this schema's `$defs`, or when it leads back to the
         definition being declared (directly or through other definitions): Saxon 13 doesn't allow recursive item
         types.

         @param $ref the reference, e.g. `#/$defs/address`
         @param $def the name of the definition being declared, if any
      </xsl:note>
      <xsl:param name="ref" as="xs:string"/>
      <xsl:param name="def" as="xs:string?"/>
      <xsl:variable name="name" as="xs:string" select="substring-after($ref, '#/$defs/')"/>
      <xsl:sequence select="if (not($name = $defs ! jkey()) or $def = js:reachable($name, ())) then 'map(*)' else $name"/>
   </xsl:function>

   <xsl:function name="js:refs" as="xs:string*">
      <xsl:note format="xdoc-md">
         The names of the definitions a schema refers to, anywhere within it.

         @param $schema the schema
      </xsl:note>
      <xsl:param name="schema" as="jnode()"/>
      <xsl:sequence select="$schema//get('$ref')/jvalue()[starts-with(., '#/$defs/')] ! substring-after(., '#/$defs/')"/>
   </xsl:function>

   <xsl:function name="js:reachable" as="xs:string*">
      <xsl:note format="xdoc-md">
         The names of the definitions that can be reached from the given ones by following references - including the
         given ones.

         @param $names the definitions to start from
         @param $found the definitions found so far
      </xsl:note>
      <xsl:param name="names" as="xs:string*"/>
      <xsl:param name="found" as="xs:string*"/>
      <xsl:variable name="new" as="xs:string*" select="distinct-values($names[not(. = $found)])"/>
      <xsl:sequence select="if (empty($new)) then $found
                            else js:reachable($defs[jkey() = $new] ! js:refs(.), ($found, $new))"/>
   </xsl:function>

   <xsl:function name="js:field-name" as="xs:string">
      <xsl:note format="xdoc-md">
         A property name as a record field name: quoted, as a string literal, when it isn't an NCName.

         @param $name the property name
      </xsl:note>
      <xsl:param name="name" as="xs:string"/>
      <xsl:sequence select="if ($name castable as xs:NCName) then $name else js:string-literal($name)"/>
   </xsl:function>

   <xsl:function name="js:type-name" as="xs:string?">
      <xsl:note format="xdoc-md">
         A name for an item type, made from a schema's title, e.g. `customer-order` for "Customer Order".

         @param $title the title, if there is one
      </xsl:note>
      <xsl:param name="title" as="xs:string?"/>
      <xsl:variable name="name" as="xs:string?" select="$title ! lower-case(.) ! replace(., '[^\p{L}\p{Nd}_.\-]+', '-') ! replace(., '^[^\p{L}_]+|-+$', '')"/>
      <xsl:sequence select="$name[. castable as xs:NCName]"/>
   </xsl:function>

   <xsl:function name="js:string-literal" as="xs:string">
      <xsl:param name="value" as="xs:string"/>
      <xsl:sequence select='"&apos;" || replace($value, "&apos;", "&apos;&apos;") || "&apos;"'/>
   </xsl:function>

</xsl:stylesheet>

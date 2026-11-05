# JSON Schema to record types

XPath 4.0 JNodes let you navigate JSON (maps and arrays) with path expressions, as you would XML: `$order/customer/name`,
`$schema//get('$ref')`, `../..`, `jkey()`. When a JNode is declared with a record type, e.g. `jnode(*, order)`, the
editor knows which fields each step can reach. It checks each step, offers the field names as completions, and shows
each field's type and documentation on hover.

## Requirements

- **Saxon-PE 13 or Saxon-EE 13**, with XPath 4.0 syntax enabled. Saxon-HE 13 rejects XPath 4.0 syntax, so it can't run
  these stylesheets.
- **For the editor features:** [XSLT/XPath for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=deltaxml.xslt-xpath).
  Its Quick Run enables XPath 4.0 syntax for a `version="4.0"` stylesheet. Point its `XSLT.tasks.saxonJar` setting at
  your Saxon-PE or Saxon-EE jar.

To run the stylesheets from the command line instead (with the jar's `lib` folder and licence next to it):

```
java -cp saxon-pe-13.0.jar net.sf.saxon.Transform -xsl:schema-to-records.xsl -it --allowSyntaxExtensions:on
java -cp saxon-pe-13.0.jar net.sf.saxon.Transform -xsl:order-report.xsl -it --allowSyntaxExtensions:on
```

## How it works

This sample works in two stages:

1. `schema-to-records.xsl` converts a JSON Schema to XSLT 4.0 record types, reading the schema as JNodes.
2. `order-report.xsl` reads order data typed with the generated types.

```
json-schema-records/
├── order.schema.json        a JSON Schema for an order: $defs for customer, address and line
├── schema-to-records.xsl    stage 1: writes an xsl:item-type for the schema and each of its $defs
├── order-types.xsl          stage 1's output: the order, customer, address and line record types
├── order.json               an order, valid against the schema
└── order-report.xsl         stage 2: includes order-types.xsl, and prints a summary of order.json
```

## Try it

1. Open `schema-to-records.xsl` and run it with **Quick Run**, choosing 'None' as the XML context file, so it starts
   from `xsl:initial-template`. It writes `order-types.xsl` next to the schema, and reports `Wrote 4 item types to
   order-types.xsl`.
2. Open `order-types.xsl`. There's an `xsl:item-type` for the root schema (`order`, from its `title`), and one for
   each schema in `$defs`. Each property's `description` becomes an `@field` in the type's documentation note.
3. Open `order-report.xsl` and run it with **Quick Run** (again with no context file). The result is:

   ```
   Order ORD-1042, placed 2026-10-14 - paid
   Customer: Sam Taylor (sam.taylor@example.com)

   1. 2 x BK-0042 Notes on the Analytical Engine @ GBP 18.50 = GBP 37.00
   2. 1 x KIT-7 Electronics starter kit @ GBP 64.00 = GBP 64.00
          includes 1 x TL-1 Soldering iron
          includes 1 x TL-2 Multimeter

   Total: GBP 101.00
   Ship to: 4 Mill Lane, Cambridge, CB2 1RX, GB
   ```

Things to try in `order-report.xsl`:

- Type `$order/customer/` - the completions are the customer's fields: `name`, `email`, `address` and
  `loyalty-points`.
- Change `$order/customer/name` to `$order/customer/nam`. The warning is *Child step 'nam' - this is not a field of the
  record type: customer*. The same applies at any depth, e.g. `$order/customer/address/town`.
- Hover on `unit-price` in `$line/unit-price`, or on the `line` in `jnode(*, line)`. The hover shows the field's type,
  and the type's documentation from the schema.
- Change `$order/id` to `$order-value/id`. This is an error, because `/` needs a JNode, not a map: use
  `jtree($order-value)/id` or `$order-value?id`. Saxon 13 reports XPTY0019.
- Add a property to `customer` in `order.schema.json`, e.g. `"phone": { "type": "string" }`, and run
  `schema-to-records.xsl` again. `$order/customer/` now offers `phone`.

## How the generator uses JNodes

`schema-to-records.xsl` reads the schema with `jtree(json-doc(...))`, so the schema is a tree it can navigate:

- `$root/get('$defs')/*` gives the definitions. `get('...')` is the node test for keys that aren't NCNames.
- `jkey()` gives the name of a definition or property, and `jvalue()` gives a JNode's value.
- `$schema//get('$ref')` finds every reference within a schema, at any depth. The `?` lookup operator has no
  descendant axis in Saxon 13, which doesn't support `??`.
- Its functions take `jnode(*, schema)` parameters. The `schema` record type lists the JSON Schema keywords the
  generator uses, so `$schema/properties`, `$schema/items` and `$schema/get('$ref')` are checked too.

How JSON Schema maps to XPath types:

| JSON Schema | XPath type |
|---|---|
| `"type": "object"` with `properties` | `record(...)`, one field per property: `name? as T` unless it's `required` |
| `"type": "object"` with no `properties` | `map(*)` |
| `"type": "array"`, `items` | `array(T)` - `array(*)` with no `items` |
| `"type": "string"` / `"boolean"` | `xs:string` / `xs:boolean` |
| `"type": "number"` or `"integer"` | `xs:double`: every JSON number is parsed as an `xs:double`, so `xs:integer` would reject the data |
| `"type": ["string", "null"]` | `xs:string?`: a JSON `null` is an empty sequence |
| `"type": ["string", "number"]` | `(xs:string \| xs:double)` |
| `"enum": ["paid", "shipped"]` | `enum('paid', 'shipped')`, or `xs:anyAtomicType` when the values aren't all strings |
| `"$ref": "#/$defs/address"` | `address`, the item type declared for the definition |
| no `type` | taken from `properties` or `items` if there are any, or else `item()?` |

Validation keywords such as `pattern`, `minimum` and `format` have no record-type equivalent, so they're ignored. So are
`oneOf`, `anyOf`, `allOf`, `additionalProperties` and `patternProperties`.

## Things to know about record types in Saxon 13

These limits shaped the sample:

- **No recursive item types.** A `line` can contain `bundle-items` that are themselves lines, but an `xsl:item-type`
  can't refer to itself, directly or through other types: Saxon reports SXTA0001. The generator uses `map(*)` for a
  reference that leads back to the type being declared, so `bundle-items` is `array(map(*))`. The field's `@field`
  documentation explains why, so hovering on `bundle-items` shows it. The steps after `$line/bundle-items/*` aren't
  checked. `xsl:record-type`, which would allow
  recursion, isn't implemented in Saxon 13.
- **No extensible records.** `record(a, *)` was dropped from the 4.0 specification, so a record type lists every field
  it allows.
- **A `jnode(*, T)` type checks for an *instance* of `T`.** A map with keys that `T` doesn't declare isn't an instance,
  so `jtree(json-doc('order.json'))` doesn't match `jnode(*, order)` if the data has extra properties. JSON Schema
  allows extra properties by default. Converting the value to the record type first drops the extra keys, at every
  depth, and fails if a required field is missing or has the wrong type:

  ```xml
  <xsl:variable name="order-value" as="order" select="json-doc($order-uri)"/>
  <xsl:variable name="order" as="jnode(*, order)" select="jtree($order-value)"/>
  ```

  The generator does the same to the schema itself, in `js:schema()`, because a schema has keywords such as
  `$schema`, `$id` and `minLength` that the `schema` record type doesn't declare.
- **A value with a record type needs `jtree()` before `/`.** `$order-value/id` is a static error (XPTY0019). Use
  `jtree($order-value)/id`, or declare the variable as a `jnode(*, order)` as above.

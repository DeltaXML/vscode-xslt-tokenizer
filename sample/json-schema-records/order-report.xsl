<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ord="http://example.com/ns/order-report"
                exclude-result-prefixes="#all"
                version="4.0">

   <xsl:note format="xdoc-md">
      Prints a summary of an order, read from JSON. The `order`, `customer`, `line` and `address` record types are
      generated from `order.schema.json` by `schema-to-records.xsl`, so the editor checks each path step - e.g.
      `$order/customer/name` - against the schema, and offers the schema's property names as completions.

      @param $order-uri the order to summarise - relative to this stylesheet
   </xsl:note>

   <xsl:include href="order-types.xsl"/>

   <xsl:output method="text"/>

   <xsl:param name="order-uri" as="xs:string" select="'order.json'"/>

   <!--
        Converting the parsed JSON to the 'order' type checks it against the schema's types, and drops any properties
        that the schema doesn't declare. A jnode(*, order) type matches only a JNode whose value is an instance of
        'order' - which a map with extra keys isn't.
   -->
   <xsl:variable name="order-value" as="order" select="json-doc($order-uri)"/>
   <xsl:variable name="order" as="jnode(*, order)" select="jtree($order-value)"/>

   <xsl:template name="xsl:initial-template">
      <xsl:variable name="customer" as="jnode(*, customer)" select="$order/customer"/>
      <xsl:variable name="ship-to" as="jnode(*, address)" select="($order/shipping-address, $customer/address)[1]"/>
      <xsl:variable name="total" as="xs:double" select="sum($order/lines/* ! ord:line-total(.))"/>
      <xsl:variable name="notes" as="xs:string?" select="$order/notes/jvalue()"/>

      <xsl:variable name="lines" as="xs:string" select="string-join($order/lines/* ! ord:line(.))"/>

      <xsl:text expand-text="yes">
Order {$order/id}, placed {$order/placed} - {$order/status}
Customer: {$customer/name} ({$customer/email})

{$lines}
Total: {ord:price($total, $order/currency)}
Ship to: {ord:address($ship-to)}
Notes: {$notes}
      </xsl:text>

   </xsl:template>

   <xsl:function name="ord:line" as="xs:string">
      <xsl:note format="xdoc-md">
         A line of the summary for an order line, followed by a line for each of the items in it, if it's a bundle.

         @param $line the order line
      </xsl:note>
      <xsl:param name="line" as="jnode(*, line)"/>
      <!-- a JNode knows where it is in the tree: jkey() is its position in the 'lines' array, and '../..' is the order -->
      <xsl:variable name="number" as="xs:integer" select="jkey($line)"/>
      <xsl:variable name="currency" as="xs:string" select="$line/../../currency"/>
      <xsl:variable name="product" as="xs:string" select="string-join(($line/sku, $line/description), ' ')"/>
      <xsl:variable name="unit-price" as="xs:string" select="ord:price($line/unit-price, $currency)"/>
      <xsl:variable name="line-total" as="xs:string" select="ord:price(ord:line-total($line), $currency)"/>
      <!-- the type of bundle-items is array(map(*)), so the steps after it aren't checked -->
      <xsl:variable name="bundle-items" as="xs:string*" select="
         $line/bundle-items/* ! `       includes {quantity} x {string-join((sku, description), ' ')}&#10;`"/>
      
      <xsl:text expand-text="yes">
{$number}. {$line/quantity} x {$product} @ {$unit-price} = {$line-total}
{string-join($bundle-items)}
      </xsl:text>
      
   </xsl:function>

   <xsl:function name="ord:line-total" as="xs:double">
      <xsl:param name="line" as="jnode(*, line)"/>
      <xsl:sequence select="$line/quantity * $line/unit-price"/>
   </xsl:function>

   <xsl:function name="ord:address" as="xs:string">
      <xsl:param name="address" as="jnode(*, address)"/>
      <xsl:sequence select="string-join(($address/street, $address/city, $address/post-code, $address/country), ', ')"/>
   </xsl:function>

   <xsl:function name="ord:price" as="xs:string">
      <xsl:param name="amount" as="xs:double"/>
      <xsl:param name="currency" as="xs:string"/>
      <xsl:variable name="formatted" as="xs:string" select="format-number($amount, '#,##0.00')"/>
      <xsl:sequence select="`{$currency} {$formatted}`"/>
   </xsl:function>

</xsl:stylesheet>

<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="4.0">
   <xsl:note format="xdoc-md">
               ### XSLT type declarations extracted from JSON Schema: order.schema.json

               Generated from order.schema.json by schema-to-records.xsl: **regenerate this file rather than edit it**.

               @version 1.0
            </xsl:note>
   <xsl:item-type name="order"
                  as="record(
         id as xs:string,
         placed as xs:string,
         status as enum('pending', 'paid', 'shipped', 'cancelled'),
         currency as xs:string,
         customer as customer,
         lines as array(line),
         shipping-address? as address,
         gift? as xs:boolean,
         notes? as xs:string?
      )">
      <xsl:note format="xdoc-md">
         A customer order, with its line items.

         @field id The order number, e.g. ORD-1042.
         @field placed The date the order was placed.
         @field status Where the order has got to.
         @field currency The ISO 4217 code for the currency of the prices.
         @field customer The person who placed the order.
         @field lines The items ordered.
         @field shipping-address Where to send the order, when it isn't the customer's own address.
         @field gift Whether to gift-wrap the order and leave out the prices.
         @field notes Delivery notes, if any.
      </xsl:note>
   </xsl:item-type>
   <xsl:item-type name="customer"
                  as="record(
         name as xs:string,
         email as xs:string,
         address? as address,
         loyalty-points? as xs:double
      )">
      <xsl:note format="xdoc-md">
         The person who placed the order.

         @field name The customer's full name.
         @field email Where order updates are sent.
         @field address A postal address.
         @field loyalty-points Points to spend on later orders.
      </xsl:note>
   </xsl:item-type>
   <xsl:item-type name="address"
                  as="record(
         street as xs:string,
         city as xs:string,
         post-code? as xs:string,
         country as xs:string
      )">
      <xsl:note format="xdoc-md">
         A postal address.

         @field street The house number and street.
         @field city The town or city.
         @field post-code The postal code, where the country has them.
         @field country The ISO 3166 two-letter country code.
      </xsl:note>
   </xsl:item-type>
   <xsl:item-type name="line"
                  as="record(
         sku as xs:string,
         description? as xs:string,
         quantity as xs:double,
         unit-price as xs:double,
         bundle-items? as array(map(*))
      )">
      <xsl:note format="xdoc-md">
         One line of an order: a quantity of a product, at a unit price.

         @field sku The stock-keeping unit: the product's code.
         @field description The product's name, as shown to the customer.
         @field quantity How many were ordered.
         @field unit-price The price of one, in the order's currency.
         @field bundle-items For a bundle, the items in it - included in the bundle's price. (`map(*)` rather than `line`: Saxon 13 doesn't allow recursive item types.)
      </xsl:note>
   </xsl:item-type>
</xsl:stylesheet>

(: attribute  :) element/@attribute,
(: number     :) 125.87e-5,
(: operator   :) a div b,
(: variable   :) $variable,
(: string-1   :) 'a ''single "quoted" string'' here',
(: string-2   :) "a ""double 'quoted' string"" here",
(: uriLiteral :) Q{http://example.com.test},
(: nodeType   :) node(),
(: simmpleType:) $a castable as xs:integer,
(: axis       :) parent::book,
(: name       :) dxl:simple-book,
(: declaration:) let $a := book return 
(: function   :) count($a),
(: map        :) map {'a': 'b'}
(: array      :) array {1, 2}
(: comment (:nested:) :)
5 < 2
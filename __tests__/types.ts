export interface ExpectedTokenData {
    suite: string;
    description: string;
    attributeName: string;
    tests: Array<{
        label: string;
        xpath: string;
        tokens: Array<[string, string]>;
    }>;
}

export interface RawLexerTestData {
  suite: string;
  attributeName: string;
  descriptor: string;
  testCases: [string, string][];
}
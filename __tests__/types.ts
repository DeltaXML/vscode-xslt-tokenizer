export interface ExpectedTokenData {
  suite: string;
  description: string;
  source: string;
  attributeName: string;
  tests: Array<{
    label: string;
    xpath: string;
    tokens: Array<[string, string]>;
  }>;
}

export interface RawLexerTestData {
  suite: string;
  source: string;
  attributeName: string;
  description: string;
  testCases: [string, string][];
}
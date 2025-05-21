export const testMatch = ['**\\__tests__\\*.spec.ts'];
export const transform = {
  '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
};
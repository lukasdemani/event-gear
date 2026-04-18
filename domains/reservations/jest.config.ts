import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@eventgear/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@eventgear/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@eventgear/events$': '<rootDir>/../../packages/events/src/index.ts',
    '^@eventgear/config$': '<rootDir>/../../packages/config/src/index.ts',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};

export default config;

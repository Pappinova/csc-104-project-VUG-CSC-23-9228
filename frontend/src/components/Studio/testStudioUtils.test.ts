import { describe, it, expect } from 'vitest';
import {
  buildAssertionSnippet,
  buildRustTestScript,
  buildTypeScriptTestScript,
  executeRecordedStep,
  type TestSuite,
} from './testStudioUtils';

describe('test studio generation', () => {
  it('builds a Rust assertion using assert_eq', () => {
    const snippet = buildAssertionSnippet({ kind: 'storage', path: 'owner' }, 'alice');
    expect(snippet).toContain('assert_eq!(storage.get("owner"), alice);');
  });

  it('builds a TypeScript script with expectations', () => {
    const suite: TestSuite = {
      id: 'suite-1',
      name: 'TokenSuite',
      language: 'typescript',
      steps: [
        {
          id: 'step-1',
          kind: 'invoke',
          label: 'mint',
          contractName: 'TokenContract',
          method: 'mint',
          args: [{ name: 'to', type: 'string', value: 'alice' }],
          expected: {
            target: { kind: 'return' },
            expectedValue: 'true',
            operator: 'assert_eq',
          },
          status: 'idle',
        },
      ],
    };

    const script = buildTypeScriptTestScript(suite);
    expect(script).toContain('expect(result0).toEqual(true);');
  });

  it('builds a Rust suite that includes the contract invocation', () => {
    const suite: TestSuite = {
      id: 'suite-2',
      name: 'TransferSuite',
      language: 'rust',
      steps: [
        {
          id: 'step-1',
          kind: 'invoke',
          label: 'transfer',
          contractName: 'TokenContract',
          method: 'transfer',
          args: [{ name: 'to', type: 'string', value: 'bob' }],
          expected: {
            target: { kind: 'return' },
            expectedValue: 'true',
            operator: 'assert_eq',
          },
          status: 'idle',
        },
      ],
    };

    const script = buildRustTestScript(suite);
    expect(script).toContain('fn transfer_suite()');
    expect(script).toContain('client.transfer');
  });

  it('executes a step and passes for matching assertion results', async () => {
    const result = await executeRecordedStep(
      {
        id: 's1',
        kind: 'invoke',
        label: 'mint',
        contractName: 'TokenContract',
        method: 'mint',
        args: [],
        expected: {
          target: { kind: 'return' },
          expectedValue: 'true',
          operator: 'assert_eq',
        },
        result: true,
        status: 'idle',
      },
      {
        invoke: async () => true,
      },
    );

    expect(result.passed).toBe(true);
  });
});

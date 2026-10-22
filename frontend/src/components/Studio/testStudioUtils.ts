export type StepKind = 'deploy' | 'invoke' | 'query';

export type ContractArgument = {
  name: string;
  type: string;
  value: string;
};

export type AssertionTarget =
  | { kind: 'return'; path?: string }
  | { kind: 'storage'; path: string }
  | { kind: 'event'; eventName: string; field?: string };

export type RecordedStep = {
  id: string;
  kind: StepKind;
  label: string;
  contractName?: string;
  method: string;
  args: ContractArgument[];
  expected?: {
    target: AssertionTarget;
    expectedValue: string;
    operator: 'assert_eq';
  };
  result?: unknown;
  status?: 'idle' | 'pass' | 'fail';
  error?: string;
};

export type TestSuite = {
  id: string;
  name: string;
  language: 'rust' | 'typescript';
  steps: RecordedStep[];
};

export type ExecutionResult = {
  passed: boolean;
  value?: unknown;
  error?: string;
};

export type RuntimeAdapter = {
  deploy?: (contractName: string, args?: ContractArgument[]) => Promise<unknown>;
  invoke?: (contractName: string, method: string, args: ContractArgument[]) => Promise<unknown>;
  query?: (contractName: string, method: string, args: ContractArgument[]) => Promise<unknown>;
};

export function createEmptyStep(kind: StepKind = 'invoke'): RecordedStep {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `step-${Date.now()}`,
    kind,
    label: '',
    contractName: 'MyContract',
    method: '',
    args: [],
    expected: undefined,
    status: 'idle',
  };
}

export function buildAssertionSnippet(target: AssertionTarget, expectedValue: string): string {
  const value = expectedValue;

  if (target.kind === 'return') {
    return `assert_eq!(result, ${value});`;
  }

  if (target.kind === 'storage') {
    return `assert_eq!(storage.get("${target.path}"), ${value});`;
  }

  if (target.kind === 'event') {
    const fieldExpr = target.field ? `["${target.field}"]` : '';
    return `assert_eq!(events[0].name, "${target.eventName}");\nassert_eq!(events[0]${fieldExpr}, ${value});`;
  }

  return `assert_eq!(result, ${value});`;
}

export function buildRustTestScript(suite: TestSuite): string {
  const contractName = suite.steps[0]?.contractName ?? 'MyContract';
  const lines: string[] = [];
  lines.push('use soroban_sdk::{contracterror, Env, String};');
  lines.push('');
  lines.push(`#[test]`);
  lines.push(`fn ${suite.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}() {`);
  lines.push('    let env = Env::default();');
  lines.push(`    let contract_id = env.register_contract(None, ${contractName});`);
  lines.push(`    let client = ${contractName}Client::new(&env, &contract_id);`);
  lines.push('');

  suite.steps.forEach((step, idx) => {
    const methodArgs = step.args
      .map((arg) => `${arg.name}: ${arg.type === 'string' ? `String::from("${arg.value}")` : arg.value}`)
      .join(', ');

    const call = step.kind === 'deploy'
      ? `let result_${idx} = client.${step.method}(&env${step.args.length ? ', ' : ''}${methodArgs});`
      : `let result_${idx} = client.${step.method}(&env${step.args.length ? ', ' : ''}${methodArgs});`;

    lines.push(`    ${call}`);
    if (step.expected) {
      const assertion = buildAssertionSnippet(step.expected.target, step.expected.expectedValue).replace(/\n/g, '\n    ');
      lines.push(`    ${assertion}`);
    }
    lines.push('');
  });

  lines.push('}');
  return lines.join('\n');
}

export function buildTypeScriptTestScript(suite: TestSuite): string {
  const lines: string[] = [];
  lines.push("import { describe, it, expect } from 'vitest';");
  lines.push("import { ContractClient } from './contract-client';");
  lines.push('');
  lines.push(`describe('${suite.name}', () => {`);
  lines.push(`  it('records ${suite.name}', async () => {`);
  lines.push('    const client = new ContractClient();');
  lines.push('');

  suite.steps.forEach((step, idx) => {
    const args = step.args.map((arg) => `${arg.name}: ${arg.type === 'string' ? `"${arg.value}"` : arg.value}`).join(', ');
    const invocation = step.kind === 'deploy'
      ? `const result${idx} = await client.deploy('${step.method}', { ${args} });`
      : step.kind === 'query'
        ? `const result${idx} = await client.query('${step.method}', { ${args} });`
        : `const result${idx} = await client.invoke('${step.method}', { ${args} });`;

    lines.push(`    ${invocation}`);
    if (step.expected) {
      const expectation = step.expected.target.kind === 'return'
        ? `expect(result${idx}).toEqual(${step.expected.expectedValue});`
        : step.expected.target.kind === 'storage'
          ? `expect(await client.getStorage('${step.expected.target.path}')).toEqual(${step.expected.expectedValue});`
          : `expect((await client.getEvents()).at(0)?.name).toBe('${step.expected.target.eventName}');`;

      lines.push(`    ${expectation}`);
    }
    lines.push('');
  });

  lines.push('  });');
  lines.push('});');
  return lines.join('\n');
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function suiteToJson(suite: TestSuite): string {
  return JSON.stringify(suite, null, 2);
}

export function suiteFromJson(input: string): TestSuite {
  return safeJsonParse<TestSuite>(input, {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `suite-${Date.now()}`,
    name: 'ImportedSuite',
    language: 'typescript',
    steps: [],
  });
}

export async function executeRecordedStep(
  step: RecordedStep,
  runtime: RuntimeAdapter,
): Promise<ExecutionResult> {
  try {
    if (!step.method) {
      throw new Error('Missing method name.');
    }

    if (step.kind === 'deploy' && runtime.deploy) {
      const value = await runtime.deploy(step.contractName ?? 'MyContract', step.args);
      step.result = value;
      step.status = 'pass';
      return { passed: true, value };
    }

    if (step.kind === 'query' && runtime.query) {
      const value = await runtime.query(step.contractName ?? 'MyContract', step.method, step.args);
      step.result = value;
      step.status = 'pass';
      return { passed: true, value };
    }

    if (runtime.invoke) {
      const value = await runtime.invoke(step.contractName ?? 'MyContract', step.method, step.args);
      step.result = value;
      step.status = 'pass';
      return { passed: true, value };
    }

    throw new Error('No runtime adapter is available for this step type.');
  } catch (error) {
    const err = error instanceof Error ? error.message : 'Unknown execution error';
    step.status = 'fail';
    step.error = err;
    return { passed: false, error: err };
  }
}

export function validateAssertionAgainstResult(step: RecordedStep): ExecutionResult {
  const expected = step.expected;
  const value = step.result;

  if (!expected) {
    return { passed: true, value };
  }

  const expectedText = String(expected.expectedValue).trim();
  const actualText = String(value ?? '').trim();

  if (expected.operator === 'assert_eq') {
    const passed = actualText === expectedText;
    step.status = passed ? 'pass' : 'fail';
    if (!passed) {
      step.error = `Expected "${expectedText}" but received "${actualText}"`;
      return { passed: false, error: step.error };
    }

    return { passed: true, value };
  }

  step.status = 'pass';
  return { passed: true, value };
}

export async function executeSuite(
  suite: TestSuite,
  runtime: RuntimeAdapter,
): Promise<{ passed: boolean; results: ExecutionResult[] }> {
  const results: ExecutionResult[] = [];

  for (const step of suite.steps) {
    const result = await executeRecordedStep(step, runtime);
    results.push(result);

    if (!result.passed) {
      return { passed: false, results };
    }

    const assertionResult = validateAssertionAgainstResult(step);
    results.push(assertionResult);

    if (!assertionResult.passed) {
      return { passed: false, results };
    }
  }

  return { passed: true, results };
}

export const DEFAULT_TEST_SUITE: TestSuite = {
  id: 'suite-1',
  name: 'ContractInteractionSuite',
  language: 'typescript',
  steps: [
    {
      id: 'step-1',
      kind: 'invoke',
      label: 'transfer funds',
      contractName: 'TokenContract',
      method: 'transfer',
      args: [
        { name: 'to', type: 'string', value: 'alice' },
        { name: 'amount', type: 'number', value: '1000' },
      ],
      expected: {
        target: { kind: 'return' },
        expectedValue: 'true',
        operator: 'assert_eq',
      },
      status: 'idle',
    },
  ],
};

export const __test_exports = {
  buildAssertionSnippet,
  buildRustTestScript,
  buildTypeScriptTestScript,
  buildTypeScriptTestScript,
};

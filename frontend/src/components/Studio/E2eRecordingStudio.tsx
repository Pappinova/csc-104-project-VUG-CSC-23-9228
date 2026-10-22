import React, { useMemo, useRef, useState } from 'react';
import {
  buildRustTestScript,
  buildTypeScriptTestScript,
  createEmptyStep,
  executeSuite,
  suiteFromJson,
  suiteToJson,
  type ContractArgument,
  type RecordedStep,
  type RuntimeAdapter,
  type StepKind,
  type TestSuite,
} from './testStudioUtils';

type StudioProps = {
  initialContractName?: string;
  runtime?: RuntimeAdapter;
};

const defaultSuite: TestSuite = {
  id: 'suite-1',
  name: 'ContractInteractionSuite',
  language: 'typescript',
  steps: [
    {
      id: 'step-1',
      kind: 'invoke',
      label: 'Mint token',
      contractName: 'TokenContract',
      method: 'mint',
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

export default function E2eRecordingStudio({
  initialContractName = 'MyContract',
  runtime,
}: StudioProps) {
  const [suite, setSuite] = useState<TestSuite>(defaultSuite);
  const [selectedLanguage, setSelectedLanguage] = useState<'rust' | 'typescript'>('typescript');
  const [isPlaying, setIsPlaying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const generatedScript = useMemo(() => {
    return selectedLanguage === 'rust'
      ? buildRustTestScript({ ...suite, language: 'rust' })
      : buildTypeScriptTestScript({ ...suite, language: 'typescript' });
  }, [selectedLanguage, suite]);

  const updateSuite = (next: TestSuite) => {
    setSuite(next);
  };

  const addStep = (kind: StepKind = 'invoke') => {
    const newStep = createEmptyStep(kind);
    newStep.label = `${kind} step ${suite.steps.length + 1}`;
    newStep.contractName = initialContractName;
    newStep.method = kind === 'deploy' ? 'deploy' : 'invoke';
    setSuite((current) => ({
      ...current,
      steps: [...current.steps, newStep],
    }));
  };

  const updateStep = (stepId: string, updater: (step: RecordedStep) => RecordedStep) => {
    setSuite((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? updater(step) : step)),
    }));
  };

  const updateArg = (stepId: string, argIndex: number, field: keyof ContractArgument, value: string) => {
    updateStep(stepId, (step) => {
      const next = [...step.args];
      next[argIndex] = { ...next[argIndex], [field]: value };
      return { ...step, args: next };
    });
  };

  const addArg = (stepId: string) => {
    updateStep(stepId, (step) => ({
      ...step,
      args: [...step.args, { name: `arg${step.args.length + 1}`, type: 'string', value: '' }],
    }));
  };

  const removeArg = (stepId: string, argIndex: number) => {
    updateStep(stepId, (step) => ({
      ...step,
      args: step.args.filter((_, index) => index !== argIndex),
    }));
  };

  const saveSuite = async () => {
    const content = suiteToJson(suite);
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${suite.name}.json`,
          types: [{ description: 'JSON Test Suite', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        localStorage.setItem(`studio-suite:${suite.name}`, content);
      }

      setStatusMessage('Suite saved to workspace');
      setErrorMessage(null);
    } catch (e) {
      localStorage.setItem(`studio-suite:${suite.name}`, content);
      setStatusMessage('Saved to browser storage fallback');
      setErrorMessage(null);
    }
  };

  const loadSuite = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'JSON Test Suite', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        updateSuite(suiteFromJson(text));
        setStatusMessage('Suite loaded');
        setErrorMessage(null);
      } else {
        const input = fileInputRef.current;
        input?.click();
      }
    } catch (e) {
      setErrorMessage('Unable to open file picker. Try the fallback upload.');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      updateSuite(suiteFromJson(text));
      setStatusMessage('Loaded from uploaded file');
      setErrorMessage(null);
    });
  };

  const playAll = async () => {
    setIsPlaying(true);
    setErrorMessage(null);

    try {
      const execution = await executeSuite(suite, runtime ?? {
        invoke: async (_, method, args) => {
          const argMap = Object.fromEntries(args.map((arg) => [arg.name, arg.value]));
          return { method, args: argMap, ok: true };
        },
        query: async (_, method, args) => {
          const argMap = Object.fromEntries(args.map((arg) => [arg.name, arg.value]));
          return { method, args: argMap, ok: true };
        },
        deploy: async () => ({ ok: true }),
      });

      if (!execution.passed) {
        setErrorMessage('One or more steps failed.');
        setStatusMessage('Playback failed');
      } else {
        setStatusMessage('Play All succeeded');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Playback error');
      setStatusMessage('Playback error');
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>E2E Recording Studio</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => addStep('deploy')}>+ Deploy</button>
          <button onClick={() => addStep('invoke')}>+ Invoke</button>
          <button onClick={() => addStep('query')}>+ Query</button>
          <button onClick={playAll} disabled={isPlaying}>{isPlaying ? 'Playing...' : 'Play All'}</button>
          <button onClick={saveSuite}>Save Suite</button>
          <button onClick={loadSuite}>Load Suite</button>
          <input ref={fileInputRef} type="file" accept=".json" hidden onChange={handleFileUpload} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label>
          Suite name:
          <input
            value={suite.name}
            onChange={(e) => updateSuite({ ...suite, name: e.target.value })}
            style={{ marginLeft: 8 }}
          />
        </label>

        <label>
          Output language:
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value as 'rust' | 'typescript')}
            style={{ marginLeft: 8 }}
          >
            <option value="typescript">TypeScript</option>
            <option value="rust">Rust</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {suite.steps.map((step, stepIndex) => (
          <div
            key={step.id}
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 12,
              padding: 12,
              background: '#fafafa',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>
                {stepIndex + 1}. {step.kind}
              </strong>
              <span
                style={{
                  background: step.status === 'fail' ? '#ffe5e5' : step.status === 'pass' ? '#e7f9ee' : '#f0f0f0',
                  color: step.status === 'fail' ? '#b42318' : '#067647',
                  borderRadius: 999,
                  padding: '4px 8px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {step.status ?? 'idle'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input
                value={step.label}
                onChange={(e) => updateStep(step.id, (current) => ({ ...current, label: e.target.value }))}
                placeholder="Step label"
              />
              <input
                value={step.contractName ?? initialContractName}
                onChange={(e) => updateStep(step.id, (current) => ({ ...current, contractName: e.target.value }))}
                placeholder="Contract name"
              />
              <input
                value={step.method}
                onChange={(e) => updateStep(step.id, (current) => ({ ...current, method: e.target.value }))}
                placeholder="Method name"
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Arguments</strong>
                <button onClick={() => addArg(step.id)}>+ Add arg</button>
              </div>

              {step.args.length === 0 && <div style={{ color: '#888', marginTop: 8 }}>No arguments recorded.</div>}

              {step.args.map((arg, index) => (
                <div key={`${step.id}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 8, marginTop: 8 }}>
                  <input
                    value={arg.name}
                    onChange={(e) => updateArg(step.id, index, 'name', e.target.value)}
                    placeholder="arg name"
                  />
                  <select
                    value={arg.type}
                    onChange={(e) => updateArg(step.id, index, 'type', e.target.value)}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="address">address</option>
                    <option value="bytes">bytes</option>
                  </select>
                  <input
                    value={arg.value}
                    onChange={(e) => updateArg(step.id, index, 'value', e.target.value)}
                    placeholder="value"
                  />
                  <button onClick={() => removeArg(step.id, index)}>Remove</button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <strong>Assertion</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                <select
                  value={step.expected?.target.kind ?? 'return'}
                  onChange={(e) => {
                    const kind = e.target.value as 'return' | 'storage' | 'event';
                    updateStep(step.id, (current) => ({
                      ...current,
                      expected: {
                        target:
                          kind === 'storage'
                            ? { kind: 'storage', path: current.expected?.target.kind === 'storage' ? current.expected.target.path : 'state.key' }
                            : kind === 'event'
                              ? { kind: 'event', eventName: current.expected?.target.kind === 'event' ? current.expected.target.eventName : 'Transfer' }
                              : { kind: 'return' },
                        expectedValue: current.expected?.expectedValue ?? 'true',
                        operator: 'assert_eq',
                      },
                    }));
                  }}
                >
                  <option value="return">Return value</option>
                  <option value="storage">Storage</option>
                  <option value="event">Event</option>
                </select>

                <input
                  value={step.expected?.target.kind === 'storage' ? (step.expected.target.path ?? '') : step.expected?.target.kind === 'event' ? (step.expected.target.eventName ?? '') : ''}
                  onChange={(e) => {
                    updateStep(step.id, (current) => {
                      if (!current.expected) return current;
                      const target = current.expected.target;
                      return {
                        ...current,
                        expected: {
                          ...current.expected,
                          target:
                            target.kind === 'storage'
                              ? { ...target, path: e.target.value }
                              : target.kind === 'event'
                                ? { ...target, eventName: e.target.value }
                                : target,
                        },
                      };
                    });
                  }}
                  placeholder={step.expected?.target.kind === 'storage' ? 'storage path' : 'event name'}
                />

                <input
                  value={step.expected?.expectedValue ?? ''}
                  onChange={(e) => {
                    updateStep(step.id, (current) => ({
                      ...current,
                      expected: current.expected ? { ...current.expected, expectedValue: e.target.value } : undefined,
                    }));
                  }}
                  placeholder="expected value"
                />
              </div>
            </div>

            {step.error && (
              <div style={{ marginTop: 12, color: '#b42318', background: '#fef3f2', padding: 8, borderRadius: 8 }}>
                {step.error}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ border: '1px solid #d9d9d9', borderRadius: 12, padding: 12, background: '#111827', color: '#f9fafb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Generated script</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSelectedLanguage('typescript')} style={{ background: selectedLanguage === 'typescript' ? '#2563eb' : '#374151' }}>
              TS
            </button>
            <button onClick={() => setSelectedLanguage('rust')} style={{ background: selectedLanguage === 'rust' ? '#f97316' : '#374151' }}>
              Rust
            </button>
          </div>
        </div>

        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12, fontSize: 12 }}>
          {generatedScript}
        </pre>
      </div>

      <div style={{ color: errorMessage ? '#b42318' : '#0f766e' }}>
        {statusMessage}
        {errorMessage && ` — ${errorMessage}`}
      </div>
    </div>
  );
}

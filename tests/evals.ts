import WebSocket from 'ws';

interface BenchmarkResult {
  name: string;
  query: string;
  ttftMs: number;
  totalTimeMs: number;
  toolCalled?: string;
  toolDurationMs?: number;
  outputPreview: string;
  passed: boolean;
}

const WS_URL = 'ws://127.0.0.1:3001/ws';

async function runBenchmark(
  name: string,
  query: string,
  expectedTool?: string,
  interruptAfterMs?: number
): Promise<BenchmarkResult> {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve) => ws.on('open', resolve));

  const t0 = Date.now();
  let firstTokenTime = 0;
  let toolCalled: string | undefined;
  let toolDurationMs: number | undefined;
  let assistantText = '';
  let interrupted = false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        name,
        query,
        ttftMs: firstTokenTime ? firstTokenTime - t0 : -1,
        totalTimeMs: Date.now() - t0,
        toolCalled,
        toolDurationMs,
        outputPreview: assistantText || '[TIMEOUT]',
        passed: false,
      });
    }, 25000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'text_delta' && !firstTokenTime) {
        firstTokenTime = Date.now();
      }

      if (msg.type === 'tool_call_start') {
        toolCalled = msg.toolName;
      }

      if (msg.type === 'tool_call_complete') {
        toolDurationMs = msg.durationMs;
      }

      if (msg.type === 'interrupt_confirmed') {
        interrupted = true;
      }

      if (msg.type === 'transcript_update' && msg.entry.role === 'assistant') {
        assistantText = msg.entry.text;
        clearTimeout(timeout);
        ws.close();

        const passed = expectedTool ? toolCalled === expectedTool : (interruptAfterMs ? interrupted : assistantText.length > 0);

        resolve({
          name,
          query,
          ttftMs: firstTokenTime ? firstTokenTime - t0 : -1,
          totalTimeMs: Date.now() - t0,
          toolCalled,
          toolDurationMs,
          outputPreview: assistantText.length > 70 ? assistantText.slice(0, 70) + '...' : assistantText,
          passed,
        });
      }
    });

    const turnId = `bench_${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'user_transcript',
      id: turnId,
      text: query,
      isFinal: true,
      timestamp: Date.now(),
    }));

    if (interruptAfterMs) {
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'user_interrupt',
          reason: 'benchmark_barge_in',
          timestamp: Date.now(),
        }));
      }, interruptAfterMs);
    }
  });
}

async function main() {
  console.log('========================================================================');
  console.log('🚀 RUNNING LOCAL VOICE AGENT EVALUATION BENCHMARK (M4 PRO + OLLAMA)');
  console.log('========================================================================\n');

  const benchmarks = [
    {
      name: 'Conversational Greeting',
      query: 'Hi how are you',
    },
    {
      name: 'M4 Hardware Telemetry Tool',
      query: 'What are the current MacBook Pro M4 hardware and system metrics?',
      expectedTool: 'getSystemMetrics',
    },
    {
      name: 'Local DB Inventory Tool',
      query: 'Check our local inventory for MacBook Pro M4 stock.',
      expectedTool: 'checkMockDatabase',
    },
    {
      name: 'System Logs Search Tool',
      query: 'Show me recent warning logs from the voice engine or network.',
      expectedTool: 'querySystemLogs',
    },
    {
      name: 'Real-Time Barge-In Kill Switch',
      query: 'Give me a very long, multi-paragraph essay explaining the entire history of Unix operating systems from 1969 to present.',
      interruptAfterMs: 1500,
    },
  ];

  const results: BenchmarkResult[] = [];

  for (const b of benchmarks) {
    process.stdout.write(`Benchmarking [${b.name}]... `);
    const res = await runBenchmark(b.name, b.query, b.expectedTool, b.interruptAfterMs);
    results.push(res);
    console.log(res.passed ? '✔ PASSED' : '❌ FAILED');
  }

  console.log('\n========================================================================');
  console.log('📊 BENCHMARK EVALUATION RESULTS');
  console.log('========================================================================');
  console.table(
    results.map((r) => ({
      Scenario: r.name,
      Status: r.passed ? 'PASS' : 'FAIL',
      'TTFT (ms)': r.ttftMs > 0 ? `${r.ttftMs}ms` : 'N/A',
      'Total Latency': `${r.totalTimeMs}ms`,
      'Tool Called': r.toolCalled || 'None',
      'Tool Execution': r.toolDurationMs !== undefined ? `${r.toolDurationMs}ms` : 'N/A',
      'Spoken Response': r.outputPreview,
    }))
  );

  const allPassed = results.every((r) => r.passed);
  console.log(`\nOverall Evaluation: ${allPassed ? '🎉 ALL BENCHMARKS PASSED' : '⚠️ SOME BENCHMARKS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark fatal error:', err);
  process.exit(1);
});

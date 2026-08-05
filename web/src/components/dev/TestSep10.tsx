'use client';

import { useState } from 'react';
import { discoverAnchor } from '@/lib/anchor';
import { authenticateWithAnchor } from '@/lib/sep10';
import { getAssetTransferInfo } from '@/lib/sep24';

/**
 * Dev-only panel for manually verifying the SEP-10 auth round trip and the
 * SEP-24 /info endpoint against a live anchor. Not rendered in production —
 * gate any usage of this component behind `process.env.NODE_ENV !== 'production'`
 * at the call site.
 */
export default function TestSep10({ publicKey }: { publicKey: string | null }) {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [infoRunning, setInfoRunning] = useState(false);

  const append = (line: string) => setLog((prev) => [...prev, line]);

  const run = async () => {
    if (!publicKey) {
      append('No public key available — make sure a wallet/session is active.');
      return;
    }
    setRunning(true);
    setLog([]);
    try {
      append('Discovering anchor...');
      const anchor = await discoverAnchor();
      append(`Anchor config: ${JSON.stringify(anchor, null, 2)}`);

      append('Authenticating (may prompt for PIN)...');
      const token = await authenticateWithAnchor(anchor, publicKey);
      append(`JWT received: ${token.slice(0, 24)}...`);

      const payload = JSON.parse(
        atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      append(`JWT payload: ${JSON.stringify(payload, null, 2)}`);

      append('Calling authenticateWithAnchor again to test cache...');
      const cached = await authenticateWithAnchor(anchor, publicKey);
      append(cached === token ? 'Cache hit confirmed (same token returned).' : 'Different token returned — cache miss or refresh.');
    } catch (e: unknown) {
      append(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const runInfo = async () => {
    if (!publicKey) {
      append('No public key available — make sure a wallet/session is active.');
      return;
    }
    setInfoRunning(true);
    try {
      append('--- SEP-24 /info test ---');
      append('Discovering anchor...');
      const anchor = await discoverAnchor();

      append('Fetching USDC transfer info (will reuse cached JWT if available)...');
      const info = await getAssetTransferInfo(anchor, publicKey, 'USDC');
      append(`USDC transfer info: ${JSON.stringify(info, null, 2)}`);
    } catch (e: unknown) {
      append(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInfoRunning(false);
    }
  };

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg text-xs">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="font-semibold text-slate-600">SEP-10/24 Dev Test</span>
        <div className="flex gap-1.5">
          <button
            onClick={run}
            disabled={running}
            className="rounded-lg bg-slate-800 text-white px-3 py-1 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run SEP-10'}
          </button>
          <button
            onClick={runInfo}
            disabled={infoRunning}
            className="rounded-lg bg-slate-600 text-white px-3 py-1 disabled:opacity-50"
          >
            {infoRunning ? 'Running…' : 'Run /info'}
          </button>
        </div>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500">
        {log.join('\n\n')}
      </pre>
    </div>
  );
}
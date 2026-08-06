'use client';

import { useState } from 'react';
import { discoverAnchor } from '@/lib/anchor';
import { authenticateWithAnchor } from '@/lib/sep10';
import { getAssetTransferInfo, startDepositSession, getTransactionStatus } from '@/lib/sep24';

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
  const [depositRunning, setDepositRunning] = useState(false);
  const [statusRunning, setStatusRunning] = useState(false);
  const [txnIdInput, setTxnIdInput] = useState('0f4487eb-8e5a-4704-a3e0-3b0c35cb9934');

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

  const runDeposit = async () => {
    if (!publicKey) {
      append('No public key available — make sure a wallet/session is active.');
      return;
    }
    setDepositRunning(true);
    try {
      append('--- SEP-24 startDepositSession test ---');
      append('Discovering anchor...');
      const anchor = await discoverAnchor();

      append('Starting interactive deposit session (will reuse cached JWT if available)...');
      const session = await startDepositSession(anchor, publicKey, 'USDC');
      append(`Deposit session: ${JSON.stringify(session, null, 2)}`);
      append('Opening session.url in a new tab — complete the anchor form there, then come back.');
      window.open(session.url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      append(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDepositRunning(false);
    }
  };

  const runStatus = async () => {
    if (!publicKey) {
      append('No public key available — make sure a wallet/session is active.');
      return;
    }
    if (!txnIdInput.trim()) {
      append('Enter a transaction id first.');
      return;
    }
    setStatusRunning(true);
    try {
      append('--- SEP-24 getTransactionStatus test ---');
      append('Discovering anchor...');
      const anchor = await discoverAnchor();

      append(`Fetching status for transaction ${txnIdInput.trim()}...`);
      const txn = await getTransactionStatus(anchor, publicKey, txnIdInput.trim());
      append(`Transaction: ${JSON.stringify(txn, null, 2)}`);
    } catch (e: unknown) {
      append(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStatusRunning(false);
    }
  };

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-lg text-xs">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span className="font-semibold text-slate-600">SEP-10/24 Dev Test</span>
        <div className="flex gap-1.5 flex-wrap">
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
          <button
            onClick={runDeposit}
            disabled={depositRunning}
            className="rounded-lg bg-cyan-600 text-white px-3 py-1 disabled:opacity-50"
          >
            {depositRunning ? 'Running…' : 'Run Deposit'}
          </button>
          <button
            onClick={runStatus}
            disabled={statusRunning}
            className="rounded-lg bg-indigo-600 text-white px-3 py-1 disabled:opacity-50"
          >
            {statusRunning ? 'Running…' : 'Run Status'}
          </button>
        </div>
      </div>
      <input
        type="text"
        value={txnIdInput}
        onChange={(e) => setTxnIdInput(e.target.value)}
        placeholder="transaction id to check"
        className="w-full mb-2 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-mono"
      />
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500">
        {log.join('\n\n')}
      </pre>
    </div>
  );
}
'use client';

import { useState } from 'react';

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export type DepositMode = 'faucet' | 'bank';

interface BankDepositLimits {
  min: number | null;
  max: number | null;
}

export default function DepositPanel({
  phpRate,
  busy,
  loading,
  depositAmount,
  onDepositAmountChange,
  onDeposit,
  bankBusy = false,
  bankError = '',
  bankStatus = '',
  bankLimits = null,
  onStartBankDeposit,
}: {
  phpRate: number;
  busy: boolean;
  loading: boolean;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  onDeposit: () => void;
  /** Bank-transfer (SEP-24 anchor) deposit — all optional so this panel still
   *  works unchanged if the caller doesn't wire up the bank flow. */
  bankBusy?: boolean;
  bankError?: string;
  bankStatus?: string;
  bankLimits?: BankDepositLimits | null;
  onStartBankDeposit?: () => void;
}) {
  const [mode, setMode] = useState<DepositMode>('faucet');
  const depositValue = (Number(depositAmount) || 0) * phpRate;

  return (
    <div className="rounded-2xl bg-white border border-slate-100 p-5 text-[#1A1A1A] space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <span className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Deposit</span>
        {onStartBankDeposit && (
          <div className="flex rounded-full bg-slate-50 border border-slate-100 p-0.5 text-[10px] font-semibold uppercase tracking-wide">
            <button
              onClick={() => setMode('faucet')}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                mode === 'faucet' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'
              }`}
            >
              Test Faucet
            </button>
            <button
              onClick={() => setMode('bank')}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                mode === 'bank' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'
              }`}
            >
              Bank Transfer
            </button>
          </div>
        )}
      </div>

      {mode === 'faucet' && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="deposit-amount" className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
              Amount
            </label>
            <div className="relative flex items-center">
              <input
                id="deposit-amount"
                type="number"
                value={depositAmount}
                onChange={(e) => onDepositAmountChange(e.target.value)}
                placeholder="0.00"
                disabled={busy}
                className="w-full rounded-xl bg-slate-50 border border-slate-100 pl-4 pr-20 py-3.5 text-2xl font-semibold tabular-nums text-slate-800 outline-none focus:border-[#A0F0F0] focus:bg-white disabled:opacity-50 transition-colors placeholder:text-slate-300"
              />
              <span className="absolute right-3.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-1">
                USDC
              </span>
            </div>
            <p className="text-right text-[11px] text-slate-400 font-medium px-1">
              ≈ ₱{depositValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <button
            onClick={onDeposit}
            disabled={busy || loading || !depositAmount || Number(depositAmount) <= 0}
            className="w-full py-3.5 rounded-xl bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white text-xs font-bold uppercase tracking-widest hover:opacity-95 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 shadow-sm shadow-orange-900/10"
          >
            {busy && <Spinner className="animate-spin h-3 w-3 text-white" />}
            <span>{busy ? 'Processing…' : 'Deposit USDC'}</span>
          </button>
        </>
      )}

      {mode === 'bank' && onStartBankDeposit && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Deposit USDC via a linked bank transfer. You&apos;ll fill in the amount and payment
            details on the next screen.
          </p>

          {bankLimits && (bankLimits.min !== null || bankLimits.max !== null) && (
            <p className="text-[10px] text-slate-400">
              {bankLimits.min !== null && `Min ${bankLimits.min} USDC`}
              {bankLimits.min !== null && bankLimits.max !== null && ' · '}
              {bankLimits.max !== null && `Max ${bankLimits.max} USDC`}
            </p>
          )}

          {bankStatus && <p className="text-[11px] text-cyan-600">{bankStatus}</p>}
          {bankError && <p className="text-[11px] text-rose-500">{bankError}</p>}

          <button
            onClick={onStartBankDeposit}
            disabled={bankBusy}
            className="w-full py-3.5 rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:opacity-95 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 shadow-sm shadow-cyan-900/10"
          >
            {bankBusy && <Spinner className="animate-spin h-3 w-3 text-white" />}
            <span>{bankBusy ? 'Starting…' : 'Start Bank Deposit'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
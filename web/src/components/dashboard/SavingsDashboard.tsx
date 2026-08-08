'use client';

import TestSep10 from '@/components/dev/TestSep10';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchBalances, type Balances } from '@/lib/balances';
import { walletService, authFetch } from '@/lib/wallet';
import { discoverAnchor } from '@/lib/anchor';
import { getAssetTransferInfo, startDepositSession, pollTransactionUntilTerminal } from '@/lib/sep24';
import {
  contractConfigured,
  readSavingsState,
  readVaultBalanceSummary,
  type SavingsState,
  type VaultBalanceSummary,
} from '@/lib/contract';
import {
  transferUSDC,
  getTransferState,
  subscribeToTransferState,
  resetTransferState,
  createPendingTransferApproval,
  getPendingTransferApprovalsForAddress,
  updatePendingTransferApproval,
  removePendingTransferApproval,
  type PendingTransferApproval,
} from '@/lib/transfer';
import { loadHistory, type HistoryEntry } from '@/lib/history';
import { BudgetProvider } from '@/lib/budgets';
import { useSwipeX } from '@/lib/useSwipeX';

// Component Imports
import NavBar, { AppTab } from './NavBar';
import VaultZone from './VaultZone';
import WalletZone from './WalletZone';
import History from '@/components/dashboard/History';
import Profile from '@/components/profile/Profile';
import Vaults from '@/components/vault/Vaults';
import CreateVault from '@/components/vault/CreateVault';
import NotificationBell from '@/components/shared/NotificationBell';
import { useToast } from '@/components/shared/Toast';

import PinUnlockPanel from './PinUnlockPanel';
import DepositPanel from '@/components/dashboard/DepositPanel';
import ReceivePanel from '@/components/dashboard/ReceivePanel';
import WithdrawPanel from './WithdrawPanel';
import SendPanel from './SendPanel';
import type { Panel } from '@/lib/dashboardTypes';
import type { UserProfile, TrustScore } from '@/lib/auth/verification';
import Contacts from '@/components/contacts/Contacts';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function parseScannedPayload(raw: string): { address: string | null; amount: string | null } {
  const trimmed = raw.trim();
  if (STELLAR_ADDRESS_RE.test(trimmed)) return { address: trimmed, amount: null };
  try {
    const withoutScheme = trimmed.replace(/^web\+stellar:pay\??/i, '').replace(/^stellar:/i, '');
    const [maybeAddress, query] = withoutScheme.split('?');
    const params = new URLSearchParams(query ?? '');
    const address = (params.get('destination') || maybeAddress || '').trim();
    const amount = params.get('amount');
    if (STELLAR_ADDRESS_RE.test(address)) return { address, amount };
  } catch {}
  return { address: null, amount: null };
}

interface WalletContextProps {
  publicKey: string | null;
  connecting: boolean;
  status: string;
  network: string;
  provider: string;
  signerAvailable: boolean;
  error: string | null;
  disconnect?: () => void;
}

interface DashboardProps {
  publicKey: string | null;
  wallet: WalletContextProps;
  onLogout: () => void | Promise<void>;
  headerActions?: React.ReactNode;
  connectWalletAction?: React.ReactNode;
  username?: string;
  avatarSrc?: string;
}

const SESSION_KEY_MISSING_MESSAGE = 'Your session key is unavailable. Please unlock your account again.';

export default function SavingsDashboard({ publicKey, wallet, onLogout, headerActions, connectWalletAction, username, avatarSrc }: DashboardProps) {
  const router = useRouter();
  const configured = contractConfigured();
  const { showToast } = useToast();
  
  const [state, setState] = useState<SavingsState | null>(null);
  const [walletBalances, setWalletBalances] = useState<Balances | null>(null);
  const [vaultSummary, setVaultSummary] = useState<VaultBalanceSummary | null>(null);
  const [phpRate, setPhpRate] = useState<number>(58.60);
  const [loading, setLoading] = useState<boolean>(configured);
  const [vaultSummaryLoading, setVaultSummaryLoading] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  
  const [homeZone, setHomeZone] = useState<'vault' | 'wallet'>('vault');
  const [panel, setPanel] = useState<Panel>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('home');

  const TAB_ORDER: AppTab[] = ['home', 'vaults', 'activity', 'profile'];
  const changePageTab = (direction: 1 | -1) => {
    const idx = TAB_ORDER.indexOf(activeTab);
    const next = idx + direction;
    if (next >= 0 && next < TAB_ORDER.length) setActiveTab(TAB_ORDER[next]);
  };
  const pageSwipe = useSwipeX(() => changePageTab(1), () => changePageTab(-1));
  const [busy, setBusy] = useState(false);
  const [transferState, setTransferState] = useState(getTransferState());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trust, setTrust] = useState<TrustScore | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [vaultsCount, setVaultsCount] = useState<number>(0);
  const [focusVaultId, setFocusVaultId] = useState<string | null>(null);

  const navigateToVault = (vaultId?: string | null) => {
    setActiveTab('vaults');
    if (!vaultId) {
      setFocusVaultId(null);
      return;
    }

    setFocusVaultId(vaultId);
    setTimeout(() => setFocusVaultId((current) => (current === vaultId ? null : current)), 4000);
  };

  const handleHistorySelection = (entry: HistoryEntry) => {
    if (entry.kind === 'send' || entry.kind === 'receive') {
      setActiveTab('home');
      setHomeZone('wallet');
      setPanel(null);
      return;
    }

    if (entry.kind === 'deposit' || entry.kind === 'withdraw') {
      setActiveTab('home');
      setHomeZone('vault');
      setPanel(null);
      return;
    }

    if (entry.kind === 'vault_create' && entry.vaultId) {
      navigateToVault(entry.vaultId);
      return;
    }

    setActiveTab('home');
    setHomeZone('vault');
    setPanel(null);
  };

  // Form & Action states
  const [depositAmount, setDepositAmount] = useState('250');
  const [bankDepositBusy, setBankDepositBusy] = useState(false);
  const [bankDepositError, setBankDepositError] = useState('');
  const [bankDepositStatus, setBankDepositStatus] = useState('');
  const [bankDepositLimits, setBankDepositLimits] = useState<{ min: number | null; max: number | null } | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('50');
  const [recipient, setRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferCategory, setTransferCategory] = useState<string | undefined>(undefined);
  const [sendMode, setSendMode] = useState<'amount' | 'qr'>('amount');
  const [receiveMode, setReceiveMode] = useState<'address' | 'qr'>('address');
  const [receiveRequestAmount, setReceiveRequestAmount] = useState('');
  const [scanError, setScanError] = useState('');
  const [scannedOk, setScannedOk] = useState(false);
  
  // Auth states
  const [needsPin, setNeedsPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<void>) | null>(null);
  
  const [pendingApproval, setPendingApproval] = useState<PendingTransferApproval | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [referralCode, setReferralCode] = useState<string | undefined>(undefined);

  const safeNumber = (v: unknown): number => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };

  const loadVaultSummary = useCallback(async (key: string | null) => {
    if (!key) { setVaultSummary(null); return; }
    setVaultSummaryLoading(true);
    try {
      setVaultSummary(await readVaultBalanceSummary(key));
    } catch {
      setVaultSummary(null);
    } finally {
      setVaultSummaryLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      setState(await readSavingsState());
      await loadVaultSummary(publicKey);
      if (publicKey) setWalletBalances(await fetchBalances(publicKey));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to read contract', 'error');
    } finally {
      setLoading(false);
    }
  }, [configured, loadVaultSummary, publicKey, showToast]);

  const refreshHistory = useCallback(async (address: string | null) => {
    if (!address) { setHistory([]); return; }
    setHistory(await loadHistory(address));
  }, []);

  const refreshPendingApproval = useCallback(async () => {
    if (!publicKey) { setPendingApproval(null); return; }
    setPendingLoading(true);
    try {
      const transfers = await getPendingTransferApprovalsForAddress();
      setPendingApproval(transfers[0] ?? null);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load transfer requests', 'error');
    } finally {
      setPendingLoading(false);
    }
  }, [publicKey, showToast]);

  useEffect(() => {
    if (!publicKey) return;
    authFetch('/api/users/me').then(r => r.json()).then(d => {
      setProfile(d.profile ?? null);
      setTrust(d.trust ?? null);
      setPoints(d.points ?? 0);
      setVaultsCount(d.vaultsCount ?? 0);
      setReferralCode(d.referralCode ?? undefined);
    }).catch(() => {
      setProfile(null); setTrust(null); setPoints(0); setVaultsCount(0);
    });
  }, [publicKey]);

  useEffect(() => {
    if (!configured) return;
    let ignore = false;
    setLoading(true);
    readSavingsState()
      .then(next => { if (!ignore) setState(next); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [configured]);

  useEffect(() => {
    let ignore = false;
    if (!publicKey) { setHistory([]); return; }
    loadHistory(publicKey).then(data => { if (!ignore) setHistory(data); });
    return () => { ignore = true; };
  }, [publicKey]);

  useEffect(() => {
    let ignore = false;
    if (!publicKey) { setWalletBalances(null); return; }
    fetchBalances(publicKey)
      .then(b => { if (!ignore) setWalletBalances(b); })
      .catch(() => { if (!ignore) setWalletBalances(null); });
    return () => { ignore = true; };
  }, [publicKey]);

  useEffect(() => {
    let ignore = false;
    if (!publicKey) { setVaultSummary(null); return; }
    queueMicrotask(() => { if (!ignore) void loadVaultSummary(publicKey); });
    return () => { ignore = true; };
  }, [loadVaultSummary, publicKey]);

  useEffect(() => subscribeToTransferState(() => setTransferState(getTransferState())), []);

  useEffect(() => {
    if (panel !== 'send' || sendMode !== 'qr') {
      setScanError('');
      setScannedOk(false);
    }
  }, [panel, sendMode]);

  useEffect(() => {
    let ignore = false;
    queueMicrotask(() => { if (!ignore) void refreshPendingApproval(); });
    return () => { ignore = true; };
  }, [refreshPendingApproval]);

  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(r => r.json())
      .then(d => { if (d?.rates?.PHP) setPhpRate(d.rates.PHP); })
      .catch(() => {});
  }, []);

  const handleCopyAddress = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleQrScanResult = useCallback((raw: string) => {
    const { address, amount } = parseScannedPayload(raw);
    if (!address) {
      setScanError('That QR code did not contain a valid Stellar address.');
      setScannedOk(false);
      return;
    }
    setRecipient(address);
    if (amount) setTransferAmount(amount);
    setScanError('');
    setScannedOk(true);
    setTimeout(() => { setSendMode('amount'); setScannedOk(false); }, 700);
  }, []);

  const runWithReauth = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Action failed';
      if (message === SESSION_KEY_MISSING_MESSAGE) {
        setPendingRetry(() => action);
        setNeedsPin(true);
        return;
      }
      throw e;
    }
  };

  const handleUnlockAndRetry = async () => {
    setUnlocking(true);
    setPinError('');
    try {
      await walletService.unlockPinAccount(pinInput);
      setNeedsPin(false);
      setPinInput('');
      if (pendingRetry) {
        await pendingRetry();
        setPendingRetry(null);
      }
    } catch (e: unknown) {
      setPinError(e instanceof Error ? e.message : 'Incorrect PIN');
    } finally {
      setUnlocking(false);
    }
  };

  const handleDeposit = async () => {
    if (!publicKey || !depositAmount || Number(depositAmount) <= 0) return;
    setBusy(true);
    try {
      await runWithReauth(async () => {
        const res = await authFetch('/api/faucet/usdc', { method: 'POST', body: JSON.stringify({ amount: depositAmount }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Failed to fund wallet with test USDC.');
        await refresh();
        await refreshHistory(publicKey);
        showToast(`Received ${data.amount} test USDC!`, 'success');
        setPanel(null);
      });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Deposit failed', 'error');
    } finally {
      setBusy(false);
      resetTransferState();
    }
  };

  useEffect(() => {
  if (panel !== 'deposit' || !publicKey) return;
  let ignore = false;
  (async () => {
    try {
      const anchor = await discoverAnchor();
      const info = await getAssetTransferInfo(anchor, publicKey, 'USDC');
      if (!ignore) setBankDepositLimits({ min: info.depositMin, max: info.depositMax });
    } catch {
      if (!ignore) setBankDepositLimits(null);
    }
  })();
  return () => { ignore = true; };
}, [panel, publicKey]);

const handleStartBankDeposit = async () => {
  if (!publicKey) return;
  setBankDepositBusy(true);
  setBankDepositError('');
  setBankDepositStatus('');
  try {
    const anchor = await discoverAnchor();
    const session = await startDepositSession(anchor, publicKey, 'USDC');
    window.open(session.url, '_blank', 'noopener,noreferrer');
    setBankDepositStatus('Complete the deposit form in the new tab, then come back here.');

    pollTransactionUntilTerminal(anchor, publicKey, session.id, { intervalMs: 5000, timeoutMs: 10 * 60 * 1000 })
      .then((txn) => {
        if (txn.status === 'completed') {
          setBankDepositStatus('Deposit completed — refreshing your balance…');
          void refresh();
          void refreshHistory(publicKey);
        } else {
          setBankDepositStatus(`Deposit ended with status: ${txn.status}`);
        }
      })
      .catch((e: unknown) => {
        setBankDepositError(e instanceof Error ? e.message : 'Lost track of the deposit status.');
      });
  } catch (e: unknown) {
    setBankDepositError(e instanceof Error ? e.message : 'Failed to start bank deposit');
  } finally {
    setBankDepositBusy(false);
  }
};

  const handleTransferRequest = async (category?: string) => {
    if (!publicKey || !recipient || !transferAmount) return;
    setTransferCategory(category);
    setBusy(true);
    try {
      await createPendingTransferApproval(recipient, Number(transferAmount));
      showToast('Transfer request created. The receiver must approve it before it can be sent.', 'success');
      await refreshPendingApproval();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create transfer request', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveAsSender = async () => { /* Same standard logic... */ };
  const handleApproveAsReceiver = async () => { /* Same standard logic... */ };
  const handleSubmitApprovedTransfer = async () => { /* Same standard logic... */ };
  const handleVoidPendingApproval = async () => { /* Same standard logic... */ };

  if (!configured) {
    return (
      <div className="p-6 max-w-md mx-auto bg-white border border-slate-100 rounded-2xl text-slate-800 flex items-center gap-3">
        <p className="text-xs font-light tracking-wide text-slate-400">Deploy the Soroban tracking contract to access your assets.</p>
      </div>
    );
  }

  const walletUsdcBalance = safeNumber(walletBalances?.usdc);
  const usdcBalance = safeNumber(vaultSummary?.balance ?? safeNumber(state?.saved));
  const totalEquivalentInPhp = walletUsdcBalance * phpRate;
  const purchasingPowerSaved = walletUsdcBalance * (phpRate * 0.06);

  const formatCurrency = (value: number) =>
    `₱${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <BudgetProvider history={history}>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0.5; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slideInRight {
          animation: slideInRight 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }
      `}</style>
      <div className="max-w-md mx-auto min-h-210 bg-[#fffdfb] rounded-[2.5rem] overflow-hidden shadow-xl relative flex flex-col justify-between font-sans tracking-tight border border-slate-200/40 text-[#1A1A1A]">
        
        <div {...pageSwipe} className="flex-1 pb-36 overflow-y-auto touch-pan-y">
          {activeTab === 'home' && (
            <div className="px-6 pt-7 flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                {headerActions}
              </div>
              <NotificationBell
                publicKey={publicKey}
                onNavigateToVault={navigateToVault}
                onNavigateToTransfer={() => {
                  setActiveTab('activity');
                }}
              />
            </div>
          )}

          {activeTab === 'home' && (
            <div className="mx-6 mt-5 flex items-center justify-center gap-2">
              <span
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  homeZone === 'vault' ? 'w-6 bg-[#FF9F1C]' : 'w-1.5 bg-slate-200'
                }`}
                aria-hidden="true"
              />
              <span
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  homeZone === 'wallet' ? 'w-6 bg-cyan-500' : 'w-1.5 bg-slate-200'
                }`}
                aria-hidden="true"
              />
              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-300 font-semibold">
                Swipe to switch
              </span>
            </div>
          )}

          {/* Zones */}
          {activeTab === 'home' && homeZone === 'vault' && (
            <VaultZone 
              loading={loading}
              showBalance={showBalance}
              onToggleBalance={() => setShowBalance(!showBalance)}
              totalEquivalentInPhp={totalEquivalentInPhp}
              walletUsdcBalance={walletUsdcBalance}
              panel={panel}
              setPanel={setPanel}
              goalProgress={vaultSummary?.progress ?? 0}
              hasVault={vaultsCount > 0}
              vaultName={vaultSummary?.purpose}
              targetLabel={vaultSummary ? `${formatCurrency(vaultSummary.balance)} of ${formatCurrency(vaultSummary.goalAmount)}` : undefined}
              members={vaultSummary ? [{ id: 'self', initial: 'ME', color: 'bg-[#FF9F1C]' }] : []}
              onViewVaultDetails={() => setActiveTab('vaults')}
              onSwipeToWallet={() => { setHomeZone('wallet'); setPanel(null); }}
            />
          )}

          {activeTab === 'home' && homeZone === 'wallet' && (
            <WalletZone 
              loading={loading}
              showBalance={showBalance}
              onToggleBalance={() => setShowBalance(!showBalance)}
              totalEquivalentInPhp={totalEquivalentInPhp}
              walletUsdcBalance={walletUsdcBalance}
              panel={panel}
              setPanel={setPanel}
              history={history}
              onSeeAllActivity={() => setActiveTab('activity')}
              onSwipeToVault={() => { setHomeZone('vault'); setPanel(null); }}
            />
          )}

          {/* Slide Inline Configuration Panels */}
          {activeTab === 'home' && panel && (
            <div className="mx-4 mt-2 space-y-3 animate-slideInRight">
              {(transferState.status !== 'idle') && (
                <div className="p-3 bg-white rounded-xl border border-slate-100 space-y-1 text-[11px]">
                  <p className="text-slate-400 font-light">{transferState.message}</p>
                </div>
              )}

              {needsPin && (
                <PinUnlockPanel
                  pinInput={pinInput} onPinInputChange={setPinInput}
                  pinError={pinError} unlocking={unlocking}
                  onUnlock={handleUnlockAndRetry}
                  onCancel={() => { setNeedsPin(false); setPinInput(''); setPinError(''); setPendingRetry(null); }}
                />
              )}

              {panel === 'deposit' && (
                <DepositPanel
                  phpRate={phpRate} busy={busy} loading={loading}
                  depositAmount={depositAmount} onDepositAmountChange={setDepositAmount}
                  onDeposit={handleDeposit}
                  bankBusy={bankDepositBusy}
                  bankError={bankDepositError}
                  bankStatus={bankDepositStatus}
                  bankLimits={bankDepositLimits}
                  onStartBankDeposit={handleStartBankDeposit}
                />
              )}

              {panel === 'receive' && publicKey && (
                <ReceivePanel
                  publicKey={publicKey} receiveMode={receiveMode} onReceiveModeChange={setReceiveMode}
                  copied={copied} onCopyAddress={handleCopyAddress}
                  receiveRequestAmount={receiveRequestAmount} onReceiveRequestAmountChange={setReceiveRequestAmount}
                />
              )}

              {panel === 'withdraw' && (
                <WithdrawPanel
                  withdrawAmount={withdrawAmount} onWithdrawAmountChange={setWithdrawAmount}
                  busy={busy} usdcBalance={usdcBalance} phpRate={phpRate}
                />
              )}

              {panel === 'send' && (
                <SendPanel
                  publicKey={publicKey} sendMode={sendMode} onSendModeChange={setSendMode}
                  pendingApproval={pendingApproval} recipient={recipient} onRecipientChange={setRecipient}
                  transferAmount={transferAmount} onTransferAmountChange={setTransferAmount}
                  busy={busy} onTransferRequest={handleTransferRequest}
                  onApproveAsSender={handleApproveAsSender} onApproveAsReceiver={handleApproveAsReceiver}
                  onSubmitApprovedTransfer={handleSubmitApprovedTransfer} onVoidPendingApproval={handleVoidPendingApproval}
                  needsPin={needsPin} scannedOk={scannedOk} scanError={scanError} onQrScanResult={handleQrScanResult}
                />
              )}

              {panel === 'create' && publicKey && (
                <div className="rounded-2xl bg-white border border-slate-100 p-2 text-[#1A1A1A] animate-fadeIn">
                  <CreateVault
                    publicKey={publicKey}
                    onCreated={() => { showToast('Vault initialized.', 'success'); void refresh(); }}
                    onClose={() => setPanel(null)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Core Tabs Views */}
          {activeTab === 'activity' && <div className="pt-8 animate-slideInRight"><History history={history} loading={loading} onRefresh={refresh} onSelectEntry={handleHistorySelection} /></div>}
          
          {activeTab === 'profile' && (
            <div className="pt-8 animate-slideInRight">
              <Profile 
                publicKey={publicKey} phpRate={phpRate} copied={copied} purchasingPowerSaved={purchasingPowerSaved}
                onCopyAddress={handleCopyAddress} wallet={wallet} loading={loading} onRefresh={refresh}
                onOpenSettings={() => router.push('/settings')} username={username ?? profile?.displayName ?? undefined} avatarSrc={avatarSrc}
                points={points} vaultsCount={vaultsCount} phoneVerified={profile?.phoneVerified}
                referralCode={referralCode}
                phoneNumber={profile?.phoneNumber ?? undefined} identityVerified={profile?.alternativeIdVerified}
              />
            </div>
          )}
          
          {activeTab === 'vaults' && (
            <div className="pt-8 animate-slideInRight">
              <Vaults
                publicKey={publicKey}
                loading={loading}
                onWalletChanged={refresh}
                focusVaultId={focusVaultId}
                onFocusHandled={() => setFocusVaultId(null)}
                onFocusVaultNotFound={() => showToast('This vault is no longer available.', 'error')}
              />
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="pt-8">
              <Contacts
                publicKey={publicKey}
                onSendToContact={(pubkey) => {
                  setRecipient(pubkey);
                  setHomeZone('wallet');
                  setPanel('send');
                  setActiveTab('home');
                }}
              />
            </div>
          )}
        </div>

        {/* Floating Nav */}
        <NavBar 
          activeTab={activeTab} 
          onTabChange={(tab) => { setActiveTab(tab); setPanel(null); }}
          homeZone={homeZone}
        />
        
      </div>
      <TestSep10 publicKey={publicKey} />
    </BudgetProvider>
  );
}
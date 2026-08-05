'use client';
import { useState, useEffect, useCallback } from 'react';
import { authFetch, walletService, signWithCurrentAccount } from '@/lib/wallet';
import { submitSignedXDR, pollTransaction, pollTransactionForResult } from '@/lib/payment';
import {
  buildUpdateGoalXDR,
  buildUpdateLockXDR,
  buildRemoveMemberXDR,
  buildCloseVaultXDR,
  buildRequestWithdrawalXDR,
  buildApproveWithdrawalXDR,
  buildExecuteWithdrawalXDR,
} from '@/lib/contract';
import { SESSION_KEY_MISSING_MESSAGE, type VaultData, type VaultMemberRow, type VaultProposalRow, type VaultWithdrawalRequestRow } from './types';

interface VaultManagePanelProps {
  vault: VaultData;
  isOwned: boolean;
  isMemberOnly: boolean;
  publicKey: string | null;
  onChanged: () => void;
}

type PendingWithdrawalAction =
  | { kind: 'request'; recipient: string; amount: number }
  | { kind: 'approve'; request: VaultWithdrawalRequestRow }
  | { kind: 'execute'; request: VaultWithdrawalRequestRow }
  | null;

export default function VaultManagePanel({ vault, isOwned, isMemberOnly, publicKey, onChanged }: VaultManagePanelProps) {
  const [manageLoading, setManageLoading] = useState(false);
  const [manageError, setManageError] = useState('');
  const [members, setMembers] = useState<VaultMemberRow[]>([]);
  const [proposals, setProposals] = useState<VaultProposalRow[]>([]);

  const [proposeType, setProposeType] = useState<'edit_goal' | 'edit_lock' | null>(null);
  const [proposeGoal, setProposeGoal] = useState('');
  const [proposeLock, setProposeLock] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState('');

  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [deletingVault, setDeletingVault] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [proposalActionError, setProposalActionError] = useState('');
  const [proposalNeedsPin, setProposalNeedsPin] = useState(false);
  const [proposalPinInput, setProposalPinInput] = useState('');
  const [proposalPinError, setProposalPinError] = useState('');
  const [proposalUnlocking, setProposalUnlocking] = useState(false);
  const [pendingProposalExecution, setPendingProposalExecution] = useState<VaultProposalRow | null>(null);

  const [withdrawalRequests, setWithdrawalRequests] = useState<VaultWithdrawalRequestRow[]>([]);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestRecipient, setRequestRecipient] = useState('');
  const [requestAmount, setRequestAmount] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const [withdrawalBusy, setWithdrawalBusy] = useState<string | null>(null);
  const [withdrawalActionError, setWithdrawalActionError] = useState('');
  const [withdrawalNeedsPin, setWithdrawalNeedsPin] = useState(false);
  const [withdrawalPinInput, setWithdrawalPinInput] = useState('');
  const [withdrawalPinError, setWithdrawalPinError] = useState('');
  const [withdrawalUnlocking, setWithdrawalUnlocking] = useState(false);

  const [pendingWithdrawalAction, setPendingWithdrawalAction] = useState<PendingWithdrawalAction>(null);

  const [rotationDraft, setRotationDraft] = useState<string[]>([]);
  const [rotationContribution, setRotationContribution] = useState('');
  const [showRotationSetup, setShowRotationSetup] = useState(false);
  const [settingRotation, setSettingRotation] = useState(false);
  const [rotationError, setRotationError] = useState('');

  const loadManageData = useCallback(async () => {
    setManageLoading(true);
    setManageError('');
    try {
      const [membersRes, proposalsRes, withdrawalsRes] = await Promise.all([
        authFetch(`/api/vaults/${vault.id}/members`),
        authFetch(`/api/vaults/${vault.id}/proposals`),
        authFetch(`/api/vaults/${vault.id}/withdrawal-requests`),
      ]);
      const membersData = await membersRes.json();
      const proposalsData = await proposalsRes.json();
      const withdrawalsData = await withdrawalsRes.json();
      if (!membersRes.ok) throw new Error(membersData?.error ?? 'Failed to load members');
      if (!proposalsRes.ok) throw new Error(proposalsData?.error ?? 'Failed to load proposals');
      if (!withdrawalsRes.ok) throw new Error(withdrawalsData?.error ?? 'Failed to load withdrawal requests');
      setMembers(membersData);
      setProposals(proposalsData);
      setWithdrawalRequests(withdrawalsData);
    } catch (e: unknown) {
      setManageError(e instanceof Error ? e.message : 'Failed to load vault management data');
    } finally {
      setManageLoading(false);
    }
  }, [vault.id]);

  // Load members + proposals as soon as this panel mounts (i.e. as soon as it's shown).
  useEffect(() => {
    let canceled = false;
    void Promise.resolve().then(() => {
      if (canceled) return;
      void loadManageData();
    });
    return () => {
      canceled = true;
    };
  }, [loadManageData]);

  const handleLeave = async () => {
    if (!publicKey) return;
    setLeaving(true);
    setLeaveError('');
    try {
      const xdr = await buildRemoveMemberXDR(publicKey, vault.onChainVaultId, publicKey);
      const signedXdr = await signWithCurrentAccount(xdr);
      const hash = await submitSignedXDR(signedXdr);
      await pollTransaction(hash);

      const res = await authFetch(`/api/vaults/${vault.id}/leave`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to leave vault');

      onChanged();
    } catch (e: unknown) {
      setLeaveError(e instanceof Error ? e.message : 'Failed to leave vault');
    } finally {
      setLeaving(false);
    }
  };

  const handleDeletePersonalVault = async () => {
    if (!publicKey) return;
    setDeletingVault(true);
    setDeleteError('');
    try {
      const xdr = await buildCloseVaultXDR(publicKey, vault.onChainVaultId);
      const signedXdr = await signWithCurrentAccount(xdr);
      const hash = await submitSignedXDR(signedXdr);
      await pollTransaction(hash);

      const res = await authFetch(`/api/vaults/${vault.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to delete vault');
      onChanged();
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete vault');
    } finally {
      setDeletingVault(false);
    }
  };

  const handleProposeSubmit = async () => {
    if (!proposeType) return;
    setProposing(true);
    setProposeError('');
    try {
      const changes =
        proposeType === 'edit_goal'
          ? { targetAmount: Number(proposeGoal) }
          : { lockUntil: proposeLock };

      const res = await authFetch(`/api/vaults/${vault.id}/proposals`, {
        method: 'POST',
        body: JSON.stringify({ type: proposeType, changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create proposal');

      setProposeType(null);
      setProposeGoal('');
      setProposeLock('');
      await loadManageData();
    } catch (e: unknown) {
      setProposeError(e instanceof Error ? e.message : 'Failed to create proposal');
    } finally {
      setProposing(false);
    }
  };

  const handleApproveProposal = async (proposalId: string) => {
    setProposalBusy(proposalId);
    setProposalActionError('');
    try {
      const res = await authFetch(`/api/vaults/${vault.id}/proposals/${proposalId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to approve proposal');
      await loadManageData();
    } catch (e: unknown) {
      setProposalActionError(e instanceof Error ? e.message : 'Failed to approve proposal');
    } finally {
      setProposalBusy(null);
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    setProposalBusy(proposalId);
    setProposalActionError('');
    try {
      const res = await authFetch(`/api/vaults/${vault.id}/proposals/${proposalId}/reject`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to reject proposal');
      await loadManageData();
    } catch (e: unknown) {
      setProposalActionError(e instanceof Error ? e.message : 'Failed to reject proposal');
    } finally {
      setProposalBusy(null);
    }
  };

  const handleExecuteProposal = async (proposal: VaultProposalRow) => {
    setProposalBusy(proposal.id);
    setProposalActionError('');
    try {
      if (proposal.type === 'edit_goal' && proposal.changes?.targetAmount) {
        const xdr = await buildUpdateGoalXDR(vault.ownerPubkey, vault.onChainVaultId, proposal.changes.targetAmount);
        const signedXdr = await signWithCurrentAccount(xdr);
        const hash = await submitSignedXDR(signedXdr);
        await pollTransaction(hash);
      } else if (proposal.type === 'edit_lock' && proposal.changes?.lockUntil) {
        const lockTimestamp = Math.floor(new Date(proposal.changes.lockUntil).getTime() / 1000);
        const xdr = await buildUpdateLockXDR(vault.ownerPubkey, vault.onChainVaultId, lockTimestamp);
        const signedXdr = await signWithCurrentAccount(xdr);
        const hash = await submitSignedXDR(signedXdr);
        await pollTransaction(hash);
      }
      // type === 'delete' assumes balance is already 0 (distributed) before reaching here.

      const res = await authFetch(`/api/vaults/${vault.id}/proposals/${proposal.id}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to execute proposal');

      await loadManageData();
      onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to execute proposal';
      if (message === SESSION_KEY_MISSING_MESSAGE) {
        setPendingProposalExecution(proposal);
        setProposalNeedsPin(true);
        setProposalBusy(null);
        return;
      }
      setProposalActionError(message);
    } finally {
      setProposalBusy(null);
    }
  };

  const handleProposalUnlockAndRetry = async () => {
    setProposalUnlocking(true);
    setProposalPinError('');
    try {
      await walletService.unlockPinAccount(proposalPinInput);
      setProposalNeedsPin(false);
      setProposalPinInput('');
      if (pendingProposalExecution) {
        const proposal = pendingProposalExecution;
        setPendingProposalExecution(null);
        await handleExecuteProposal(proposal);
      }
    } catch (e: unknown) {
      setProposalPinError(e instanceof Error ? e.message : 'Incorrect PIN');
    } finally {
      setProposalUnlocking(false);
    }
  };

  const handleRequestWithdrawal = async (recipient: string, amount: number) => {
    if (!publicKey) return;
    setRequesting(true);
    setRequestError('');
    try {
      const xdr = await buildRequestWithdrawalXDR(publicKey, vault.onChainVaultId, recipient, amount);
      const signedXdr = await signWithCurrentAccount(xdr);
      const hash = await submitSignedXDR(signedXdr);
      const returnValue = await pollTransactionForResult(hash);
      const onChainRequestId = String(returnValue);

      const res = await authFetch(`/api/vaults/${vault.id}/withdrawal-requests`, {
        method: 'POST',
        body: JSON.stringify({ onChainRequestId, recipientPubkey: recipient, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create withdrawal request');

      setShowRequestForm(false);
      setRequestRecipient('');
      setRequestAmount('');
      await loadManageData();
      onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to request withdrawal';
      if (message === SESSION_KEY_MISSING_MESSAGE) {
        setPendingWithdrawalAction({ kind: 'request', recipient, amount });
        setWithdrawalNeedsPin(true);
        setRequesting(false);
        return;
      }
      setRequestError(message);
    } finally {
      setRequesting(false);
    }
  };

  const handleApproveWithdrawal = async (request: VaultWithdrawalRequestRow) => {
    if (!publicKey) return;
    setWithdrawalBusy(request.id);
    setWithdrawalActionError('');
    try {
      const xdr = await buildApproveWithdrawalXDR(publicKey, vault.onChainVaultId, request.onChainRequestId);
      const signedXdr = await signWithCurrentAccount(xdr);
      const hash = await submitSignedXDR(signedXdr);
      await pollTransaction(hash);

      const res = await authFetch(`/api/vaults/${vault.id}/withdrawal-requests/${request.id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to approve withdrawal request');
      await loadManageData();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to approve withdrawal request';
      if (message === SESSION_KEY_MISSING_MESSAGE) {
        setPendingWithdrawalAction({ kind: 'approve', request });
        setWithdrawalNeedsPin(true);
        setWithdrawalBusy(null);
        return;
      }
      setWithdrawalActionError(message);
    } finally {
      setWithdrawalBusy(null);
    }
  };

  const handleExecuteWithdrawal = async (request: VaultWithdrawalRequestRow) => {
    if (!publicKey) return;
    setWithdrawalBusy(request.id);
    setWithdrawalActionError('');
    try {
      const xdr = await buildExecuteWithdrawalXDR(publicKey, vault.onChainVaultId, request.onChainRequestId);
      const signedXdr = await signWithCurrentAccount(xdr);
      const hash = await submitSignedXDR(signedXdr);
      await pollTransaction(hash);

      const res = await authFetch(`/api/vaults/${vault.id}/withdrawal-requests/${request.id}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to execute withdrawal request');

      await loadManageData();
      onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to execute withdrawal request';
      if (message === SESSION_KEY_MISSING_MESSAGE) {
        setPendingWithdrawalAction({ kind: 'execute', request });
        setWithdrawalNeedsPin(true);
        setWithdrawalBusy(null);
        return;
      }
      setWithdrawalActionError(message);
    } finally {
      setWithdrawalBusy(null);
    }
  };

  const handleWithdrawalUnlockAndRetry = async () => {
    setWithdrawalUnlocking(true);
    setWithdrawalPinError('');
    try {
      await walletService.unlockPinAccount(withdrawalPinInput);
      setWithdrawalNeedsPin(false);
      setWithdrawalPinInput('');
      const action = pendingWithdrawalAction;
      setPendingWithdrawalAction(null);
      if (action?.kind === 'request') {
        await handleRequestWithdrawal(action.recipient, action.amount);
      } else if (action?.kind === 'approve') {
        await handleApproveWithdrawal(action.request);
      } else if (action?.kind === 'execute') {
        await handleExecuteWithdrawal(action.request);
      }
    } catch (e: unknown) {
      setWithdrawalPinError(e instanceof Error ? e.message : 'Incorrect PIN');
    } finally {
      setWithdrawalUnlocking(false);
    }
  };

  const moveRotationMember = (index: number, direction: -1 | 1) => {
    setRotationDraft((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const openRotationSetup = () => {
    setRotationDraft(members.map((m) => m.pubkey));
    setRotationContribution('');
    setRotationError('');
    setShowRotationSetup(true);
  };

  const handleSetRotation = async () => {
    setSettingRotation(true);
    setRotationError('');
    try {
      const contributionAmount = Number(rotationContribution);
      if (!contributionAmount || contributionAmount <= 0) {
        throw new Error('Enter a valid per-round contribution amount.');
      }
      const res = await authFetch(`/api/vaults/${vault.id}/rotation`, {
        method: 'POST',
        body: JSON.stringify({ rotationOrder: rotationDraft, contributionAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to set rotation order');
      setShowRotationSetup(false);
      await loadManageData();
      onChanged();
    } catch (e: unknown) {
      setRotationError(e instanceof Error ? e.message : 'Failed to set rotation order');
    } finally {
      setSettingRotation(false);
    }
  };

  const pendingWithdrawalRequest = withdrawalRequests.find((r) => r.status === 'pending');
  const withdrawalMajorityCount = Math.floor(members.length / 2) + 1;
  const withdrawalReadyToExecute = pendingWithdrawalRequest
    ? pendingWithdrawalRequest.approvals.length * 2 > members.length
    : false;

  const proposeDelete = async () => {
    setProposing(true);
    setProposeError('');
    try {
      const res = await authFetch(`/api/vaults/${vault.id}/proposals`, {
        method: 'POST',
        body: JSON.stringify({ type: 'delete' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to propose deletion');
      await loadManageData();
    } catch (e: unknown) {
      setProposeError(e instanceof Error ? e.message : 'Failed to propose deletion');
    } finally {
      setProposing(false);
    }
  };

  const pendingProposal = proposals.find((p) => p.status === 'pending' || p.status === 'approved');

  if (manageLoading) {
    return <p className="text-[11px] text-slate-400 text-center py-2">Loading…</p>;
  }
  if (manageError) {
    return <p className="text-[10px] text-rose-500">{manageError}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Members list */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Members</p>
        <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 text-[11px]">
              <span className="font-mono text-slate-600 truncate">{m.pubkey}</span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">{m.role}</span>
            </div>
          ))}
          {members.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-slate-400">No members found.</p>
          )}
        </div>
      </div>

      {/* Pending / approved proposal display */}
      {pendingProposal && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {pendingProposal.type.replace('_', ' ')} proposal
            </span>
            <span className={`text-[9px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
              pendingProposal.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {pendingProposal.status}
            </span>
          </div>
          {pendingProposal.changes?.targetAmount && (
            <p className="text-[11px] text-slate-500">New goal: {pendingProposal.changes.targetAmount} USDC</p>
          )}
          {pendingProposal.changes?.lockUntil && (
            <p className="text-[11px] text-slate-500">New unlock date: {new Date(pendingProposal.changes.lockUntil).toLocaleDateString()}</p>
          )}

          {proposalActionError && <p className="text-[10px] text-rose-500">{proposalActionError}</p>}

          {proposalNeedsPin && (
            <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-2">
              <p className="text-[9px] uppercase tracking-wider text-slate-400 font-light">
                Enter PIN to continue
              </p>
              <input
                type="password"
                inputMode="numeric"
                value={proposalPinInput}
                onChange={(e) => setProposalPinInput(e.target.value)}
                placeholder="••••"
                disabled={proposalUnlocking}
                className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0] disabled:opacity-50"
              />
              {proposalPinError && <p className="text-[9px] text-rose-500">{proposalPinError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleProposalUnlockAndRetry}
                  disabled={proposalUnlocking || !proposalPinInput}
                  className="flex-1 py-2 rounded-lg bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white text-[10px] uppercase tracking-wider font-normal disabled:opacity-40"
                >
                  {proposalUnlocking ? 'Unlocking…' : 'Unlock & continue'}
                </button>
                <button
                  onClick={() => { setProposalNeedsPin(false); setProposalPinInput(''); setProposalPinError(''); setPendingProposalExecution(null); }}
                  disabled={proposalUnlocking}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wide text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {pendingProposal.status === 'pending' && !isOwned && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleApproveProposal(pendingProposal.id)}
                disabled={proposalBusy === pendingProposal.id}
                className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
              >
                {proposalBusy === pendingProposal.id ? 'Approving…' : 'Approve'}
              </button>
              <button
                onClick={() => handleRejectProposal(pendingProposal.id)}
                disabled={proposalBusy === pendingProposal.id}
                className="flex-1 py-2 rounded-lg bg-rose-50 text-rose-600 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}

          {pendingProposal.status === 'approved' && isOwned && (
            <button
              onClick={() => handleExecuteProposal(pendingProposal)}
              disabled={proposalBusy === pendingProposal.id || proposalNeedsPin}
              className="w-full py-2 rounded-lg bg-[#FF9F1C] text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
            >
              {proposalBusy === pendingProposal.id ? 'Executing…' : 'Execute Approved Change'}
            </button>
          )}
        </div>
      )}

      {/* Owner: propose edit / delete */}
      {isOwned && vault.vaultType === 'Collaborative' && !pendingProposal && (
        <div className="space-y-2">
          {proposeType === null ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setProposeType('edit_goal')}
                className="py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wider text-slate-500 font-semibold"
              >
                Propose New Goal
              </button>
              <button
                onClick={() => setProposeType('edit_lock')}
                className="py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wider text-slate-500 font-semibold"
              >
                Propose New Lock Date
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-100 p-3 space-y-2">
              {proposeType === 'edit_goal' ? (
                <input
                  type="number"
                  value={proposeGoal}
                  onChange={(e) => setProposeGoal(e.target.value)}
                  placeholder="New goal amount (USDC)"
                  className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0]"
                />
              ) : (
                <input
                  type="date"
                  value={proposeLock}
                  onChange={(e) => setProposeLock(e.target.value)}
                  className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0]"
                />
              )}
              {proposeError && <p className="text-[10px] text-rose-500">{proposeError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleProposeSubmit}
                  disabled={proposing || (proposeType === 'edit_goal' ? !proposeGoal : !proposeLock)}
                  className="flex-1 py-2 rounded-lg bg-[#FF9F1C] text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
                >
                  {proposing ? 'Submitting…' : 'Submit Proposal'}
                </button>
                <button
                  onClick={() => { setProposeType(null); setProposeGoal(''); setProposeLock(''); setProposeError(''); }}
                  disabled={proposing}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wide text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paluwagan rotation setup (owner, collaborative, not yet set) */}
      {vault.vaultType === 'Collaborative' && isOwned && !vault.rotationOrder && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Paluwagan Rotation (optional)</p>

          {!showRotationSetup && (
            <>
              <button
                onClick={openRotationSetup}
                disabled={members.length < 2}
                className="w-full py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wider text-slate-500 font-semibold disabled:opacity-40"
              >
                Set Up Rotation Order
              </button>
              {members.length < 2 && (
                <p className="text-[10px] text-slate-400">Invite at least one more member first.</p>
              )}
            </>
          )}

          {showRotationSetup && (
            <div className="rounded-xl border border-slate-100 p-3 space-y-2">
              {rotationError && <p className="text-[10px] text-rose-500">{rotationError}</p>}

              <p className="text-[10px] text-slate-400">Payout order (use ↑/↓ to reorder):</p>
              <ul className="space-y-1">
                {rotationDraft.map((pubkey, i) => (
                  <li
                    key={pubkey}
                    className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
                  >
                    <span className="font-mono text-slate-600">
                      {i + 1}. {pubkey.slice(0, 6)}…{pubkey.slice(-4)}
                    </span>
                    <span className="flex gap-1">
                      <button
                        onClick={() => moveRotationMember(i, -1)}
                        disabled={i === 0}
                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveRotationMember(i, 1)}
                        disabled={i === rotationDraft.length - 1}
                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <input
                type="number"
                placeholder="Fixed contribution per round"
                value={rotationContribution}
                onChange={(e) => setRotationContribution(e.target.value)}
                className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0]"
              />

              <div className="flex gap-2">
                <button
                  onClick={handleSetRotation}
                  disabled={settingRotation || !rotationContribution}
                  className="flex-1 py-2 rounded-lg bg-[#FF9F1C] text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
                >
                  {settingRotation ? 'Saving…' : 'Confirm Rotation'}
                </button>
                <button
                  onClick={() => setShowRotationSetup(false)}
                  disabled={settingRotation}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wide text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Withdrawal requests (collaborative vaults) */}
      {vault.vaultType === 'Collaborative' && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Withdrawal Requests</p>

          {withdrawalActionError && <p className="text-[10px] text-rose-500">{withdrawalActionError}</p>}

          {!pendingWithdrawalRequest && !showRequestForm && (
            <button
              onClick={() => {
                if (vault.rotationOrder && vault.contributionAmount) {
                  const rotation = vault.rotationOrder;
                  const nextRecipient = rotation[vault.currentRound ? vault.currentRound % rotation.length : 0];
                  setRequestRecipient(nextRecipient);
                  setRequestAmount(String(vault.contributionAmount * members.length));
                }
                setShowRequestForm(true);
              }}
              className="w-full py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wider text-slate-500 font-semibold"
            >
              Request Withdrawal
            </button>
          )}

          {!pendingWithdrawalRequest && showRequestForm && (
            <div className="rounded-xl border border-slate-100 p-3 space-y-2">
              {requestError && <p className="text-[10px] text-rose-500">{requestError}</p>}
              <input
                type="text"
                placeholder="Recipient public key"
                value={requestRecipient}
                onChange={(e) => setRequestRecipient(e.target.value)}
                disabled={Boolean(vault.rotationOrder)}
                className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0] disabled:opacity-60"
              />
              <input
                type="number"
                placeholder="Amount"
                value={requestAmount}
                onChange={(e) => setRequestAmount(e.target.value)}
                disabled={Boolean(vault.rotationOrder)}
                className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0] disabled:opacity-60"
              />
              {vault.rotationOrder && (
                <p className="text-[10px] text-slate-400">Locked to this round's rotation recipient and full pot amount.</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleRequestWithdrawal(requestRecipient, Number(requestAmount))}
                  disabled={requesting || !requestRecipient || !requestAmount}
                  className="flex-1 py-2 rounded-lg bg-[#FF9F1C] text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
                >
                  {requesting ? 'Submitting…' : 'Submit Request'}
                </button>
                <button
                  onClick={() => { setShowRequestForm(false); setRequestRecipient(''); setRequestAmount(''); setRequestError(''); }}
                  disabled={requesting}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wide text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {pendingWithdrawalRequest && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
              <p className="text-[11px] text-slate-500">
                Withdraw {pendingWithdrawalRequest.amount} USDC to{' '}
                <span className="font-mono text-slate-600">
                  {pendingWithdrawalRequest.recipientPubkey.slice(0, 6)}…{pendingWithdrawalRequest.recipientPubkey.slice(-4)}
                </span>
              </p>
              <p className="text-[11px] text-slate-400">
                {pendingWithdrawalRequest.approvals.length} / {withdrawalMajorityCount} approvals
              </p>

              {!withdrawalNeedsPin && (
                <div className="flex gap-2 pt-1">
                  {!pendingWithdrawalRequest.approvals.some((a) => a.pubkey === publicKey) && (
                    <button
                      onClick={() => handleApproveWithdrawal(pendingWithdrawalRequest)}
                      disabled={withdrawalBusy === pendingWithdrawalRequest.id}
                      className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
                    >
                      {withdrawalBusy === pendingWithdrawalRequest.id ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                  <button
                    onClick={() => handleExecuteWithdrawal(pendingWithdrawalRequest)}
                    disabled={withdrawalBusy === pendingWithdrawalRequest.id || !withdrawalReadyToExecute}
                    className="flex-1 py-2 rounded-lg bg-[#FF9F1C] text-white text-[10px] uppercase tracking-wider font-semibold disabled:opacity-50"
                  >
                    {withdrawalBusy === pendingWithdrawalRequest.id ? 'Executing…' : 'Execute'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Withdrawal PIN re-auth — sibling of the pending-request card above, not
              nested inside it, since a session-key expiry can happen on the initial
              "request" action too, before any WithdrawalRequest exists yet. Nesting
              this inside `pendingWithdrawalRequest && (...)` meant the PIN prompt
              silently failed to render for that case: signWithCurrentAccount would
              throw, withdrawalNeedsPin would flip to true, but its container never
              mounted, so the UI looked like nothing had happened. */}
          {withdrawalNeedsPin && (
            <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-2">
              <p className="text-[9px] uppercase tracking-wider text-slate-400 font-light">
                Enter PIN to continue
              </p>
              <input
                type="password"
                inputMode="numeric"
                value={withdrawalPinInput}
                onChange={(e) => setWithdrawalPinInput(e.target.value)}
                placeholder="••••"
                disabled={withdrawalUnlocking}
                className="w-full rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs outline-none focus:border-[#A0F0F0] disabled:opacity-50"
              />
              {withdrawalPinError && <p className="text-[9px] text-rose-500">{withdrawalPinError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleWithdrawalUnlockAndRetry}
                  disabled={withdrawalUnlocking || !withdrawalPinInput}
                  className="flex-1 py-2 rounded-lg bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white text-[10px] uppercase tracking-wider font-normal disabled:opacity-40"
                >
                  {withdrawalUnlocking ? 'Unlocking…' : 'Unlock & continue'}
                </button>
                <button
                  onClick={() => { setWithdrawalNeedsPin(false); setWithdrawalPinInput(''); setWithdrawalPinError(''); setPendingWithdrawalAction(null); }}
                  disabled={withdrawalUnlocking}
                  className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10px] uppercase tracking-wide text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leave (non-owner collaborative member) */}
      {isMemberOnly && (
        <div className="space-y-1.5">
          {leaveError && <p className="text-[10px] text-rose-500">{leaveError}</p>}
          <button
            onClick={handleLeave}
            disabled={leaving}
            className="w-full py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[11px] font-semibold uppercase tracking-wider disabled:opacity-50"
          >
            {leaving ? 'Leaving…' : 'Leave Vault'}
          </button>
        </div>
      )}

      {/* Delete (owner, personal vault) */}
      {isOwned && vault.vaultType === 'Personal' && (
        <div className="space-y-1.5">
          {deleteError && <p className="text-[10px] text-rose-500">{deleteError}</p>}
          {vault.status === 'Closed' ? (
            <p className="text-[10px] text-slate-400 text-center py-2">This vault has been closed.</p>
          ) : (
            <button
              onClick={handleDeletePersonalVault}
              disabled={deletingVault || vault.balance !== 0}
              title={vault.balance !== 0 ? 'Withdraw all funds before deleting' : undefined}
              className="w-full py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[11px] font-semibold uppercase tracking-wider disabled:opacity-40"
            >
              {deletingVault ? 'Deleting…' : 'Delete Vault'}
            </button>
          )}
        </div>
      )}

      {/* Delete (owner, collaborative vault — via proposal) */}
      {isOwned && vault.vaultType === 'Collaborative' && !pendingProposal && (
        <div className="space-y-1.5">
          {proposeError && <p className="text-[10px] text-rose-500">{proposeError}</p>}
          <button
            onClick={proposeDelete}
            disabled={proposing || vault.balance !== 0}
            title={vault.balance !== 0 ? 'Distribute all funds before proposing deletion' : undefined}
            className="w-full py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[11px] font-semibold uppercase tracking-wider disabled:opacity-40"
          >
            {proposing ? 'Proposing…' : 'Propose Vault Deletion'}
          </button>
        </div>
      )}
    </div>
  );
}
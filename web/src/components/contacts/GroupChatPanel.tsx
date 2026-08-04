'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGroupMessages, sendGroupMessage, addGroupMembers, leaveGroup, deleteGroup, type GroupMessage } from '@/lib/groups';
import { StrKey } from '@stellar/stellar-sdk';

export default function GroupChatPanel({
  publicKey,
  groupId,
  groupName,
  isAdmin,
  onClose,
  onLeft,
}: {
  publicKey: string;
  groupId: string;
  groupName: string;
  isAdmin: boolean;
  onClose: () => void;
  onLeft: () => void;
}) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberAddress, setNewMemberAddress] = useState('');
  const [memberActionBusy, setMemberActionBusy] = useState(false);
  const [memberActionError, setMemberActionError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setMessages(await fetchGroupMessages(groupId));
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await sendGroupMessage(groupId, draft.trim());
      setDraft('');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleLeave = async () => {
    setMemberActionBusy(true);
    setMemberActionError('');
    try {
      await leaveGroup(groupId);
      onLeft();
    } catch (e: unknown) {
      setMemberActionError(e instanceof Error ? e.message : 'Failed to leave group');
      setMemberActionBusy(false);
    }
  };

  const handleDelete = async () => {
    setMemberActionBusy(true);
    setMemberActionError('');
    try {
      await deleteGroup(groupId);
      onLeft();
    } catch (e: unknown) {
      setMemberActionError(e instanceof Error ? e.message : 'Failed to delete group');
      setMemberActionBusy(false);
    }
  };

  const handleAddMember = async () => {
    const trimmed = newMemberAddress.trim();
    if (!trimmed) return;
    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setMemberActionError('Please provide a valid Stellar public address.');
      return;
    }
    setMemberActionBusy(true);
    setMemberActionError('');
    try {
      await addGroupMembers(groupId, [trimmed]);
      setNewMemberAddress('');
      setShowAddMember(false);
    } catch (e: unknown) {
      setMemberActionError(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      setMemberActionBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-slate-100" aria-label="Back">
          <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="font-semibold text-sm text-slate-800 truncate flex-1">{groupName}</h3>
        <div className="relative">
          <button onClick={() => setShowMenu((v) => !v)} className="p-2 rounded-full hover:bg-slate-100" aria-label="Group options">
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
          {showMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
              {isAdmin && (
                <button
                  onClick={() => { setShowMenu(false); setShowAddMember(true); }}
                  className="w-full text-left px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Add Member
                </button>
              )}
              {isAdmin ? (
                <button
                  onClick={() => { setShowMenu(false); void handleDelete(); }}
                  disabled={memberActionBusy}
                  className="w-full text-left px-4 py-2.5 text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                >
                  Delete Group
                </button>
              ) : (
                <button
                  onClick={() => { setShowMenu(false); void handleLeave(); }}
                  disabled={memberActionBusy}
                  className="w-full text-left px-4 py-2.5 text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                >
                  Leave Group
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showAddMember && (
        <div className="px-5 py-3 border-b border-slate-100 space-y-2 bg-slate-50/60">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMemberAddress}
              onChange={(e) => setNewMemberAddress(e.target.value)}
              placeholder="Stellar Public Address (G...)"
              disabled={memberActionBusy}
              className="flex-1 rounded-xl bg-white border border-slate-200 px-3 py-2 text-[11px] font-mono text-slate-600 outline-none focus:border-[#A0F0F0] disabled:opacity-50"
            />
            <button
              onClick={handleAddMember}
              disabled={memberActionBusy || !newMemberAddress.trim()}
              className="px-4 rounded-xl bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white text-[10px] uppercase tracking-wide disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {memberActionError && <p className="text-[11px] text-rose-500 font-light">{memberActionError}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <p className="text-center text-xs text-slate-400 py-6">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-6">No messages yet. Say hello!</p>
        ) : (
          messages.map((m) => {
            const isMine = m.senderPubkey === publicKey;
            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-xs leading-snug ${
                    isMine
                      ? 'bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  {!isMine && (
                    <p className="text-[9px] font-semibold text-[#FF5E00] mb-0.5">
                      {m.senderName || `${m.senderPubkey.slice(0, 6)}...`}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`text-[9px] mt-1 ${isMine ? 'text-white/70' : 'text-slate-400'}`}>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="px-4 pb-2">
          <p className="text-[11px] text-rose-500 font-light">{error}</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="Type a message…"
          disabled={sending}
          className="flex-1 rounded-full bg-slate-50 border border-slate-100 px-4 py-2.5 text-xs text-slate-800 outline-none focus:border-[#A0F0F0] disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          className="w-10 h-10 rounded-full bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white flex items-center justify-center disabled:opacity-40 shrink-0"
          aria-label="Send"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
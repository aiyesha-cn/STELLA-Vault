'use client';

import { useState } from 'react';
import { createGroup } from '@/lib/groups';
import type { Contact } from '@/lib/contacts';

export default function NewGroupPanel({
  contacts,
  onClose,
  onCreated,
}: {
  contacts: Contact[];
  onClose: () => void;
  onCreated: (groupId: string, groupName: string) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraAddress, setExtraAddress] = useState('');
  const [extraAddresses, setExtraAddresses] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const toggleContact = (pubkey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  };

  const addExtraAddress = () => {
    const trimmed = extraAddress.trim();
    if (!trimmed) return;
    if (!extraAddresses.includes(trimmed)) {
      setExtraAddresses((prev) => [...prev, trimmed]);
    }
    setExtraAddress('');
  };

  const removeExtraAddress = (addr: string) => {
    setExtraAddresses((prev) => prev.filter((a) => a !== addr));
  };

  const handleCreate = async () => {
    const memberPubkeys = [...selected, ...extraAddresses];
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }
    if (memberPubkeys.length === 0) {
      setError('Add at least one member');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const group = await createGroup(name.trim(), memberPubkeys);
      onCreated(group.id, group.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setCreating(false);
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
        <h3 className="font-semibold text-sm text-slate-800">New Group</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-light">Group Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Roommates"
            disabled={creating}
            className="w-full rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-[#A0F0F0] disabled:opacity-50 transition-colors"
          />
        </div>

        {contacts.length > 0 && (
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-light">From your contacts</label>
            <div className="space-y-2">
              {contacts.map((c) => (
                <label
                  key={c.pubkey}
                  className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.pubkey)}
                    onChange={() => toggleContact(c.pubkey)}
                    className="w-4 h-4"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{c.label || c.username || 'Unnamed contact'}</p>
                    <p className="text-[10px] text-slate-400 font-mono truncate">{c.pubkey}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-light">Add by address</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={extraAddress}
              onChange={(e) => setExtraAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtraAddress(); } }}
              placeholder="Stellar Public Address (G...)"
              disabled={creating}
              className="flex-1 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-[11px] font-mono text-slate-600 outline-none focus:border-[#A0F0F0] disabled:opacity-50 transition-colors"
            />
            <button
              onClick={addExtraAddress}
              disabled={creating || !extraAddress.trim()}
              className="px-4 rounded-xl bg-slate-100 text-slate-600 text-[10px] uppercase tracking-wide disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {extraAddresses.length > 0 && (
            <div className="space-y-1.5">
              {extraAddresses.map((addr) => (
                <div key={addr} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-mono text-slate-600 truncate">{addr}</span>
                  <button onClick={() => removeExtraAddress(addr)} className="text-[10px] text-rose-500 uppercase tracking-wide shrink-0 ml-2">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-rose-500 font-light">{error}</p>}
      </div>

      <div className="px-5 py-4 border-t border-slate-100">
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim() || (selected.size === 0 && extraAddresses.length === 0)}
          className="w-full py-3 rounded-xl bg-linear-to-r from-[#FF9F1C] to-[#F37A00] text-white text-[10px] uppercase tracking-widest hover:opacity-95 transition-opacity disabled:opacity-40"
        >
          {creating ? 'Creating…' : 'Create Group'}
        </button>
      </div>
    </div>
  );
}
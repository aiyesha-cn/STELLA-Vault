import { authFetch } from './wallet';

export interface GroupMember {
  pubkey: string;
  username: string | null;
}

export interface GroupChat {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  members: GroupMember[];
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderPubkey: string;
  senderName?: string | null;
  body: string;
  createdAt: string;
}

export async function fetchGroups(): Promise<GroupChat[]> {
  const res = await authFetch('/api/groups');
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Failed to load groups');
  return data.groups ?? [];
}

export async function createGroup(name: string, memberPubkeys: string[]): Promise<GroupChat> {
  const res = await authFetch('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, memberPubkeys }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Failed to create group');
  return data.group;
}

export async function fetchGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const res = await authFetch(`/api/groups/${groupId}/messages`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Failed to load messages');
  return data.messages ?? [];
}

export async function sendGroupMessage(groupId: string, body: string): Promise<GroupMessage> {
  const res = await authFetch(`/api/groups/${groupId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Failed to send message');
  return data.message;
}

export async function addGroupMembers(groupId: string, memberPubkeys: string[]): Promise<void> {
  const res = await authFetch(`/api/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ memberPubkeys }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Failed to add members');
}

export async function leaveGroup(groupId: string): Promise<void> {
  const res = await authFetch(`/api/groups/${groupId}/leave`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to leave group');
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  const res = await authFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to delete group');
  }
}
import type { Session } from './session';

function id(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function matchesConfiguredId(expected: string, values: unknown[]): boolean {
  const configured = id(expected);
  const present = values.filter(value => value !== undefined && value !== null);
  return configured !== null && present.length > 0 && present.every(value => id(value) === configured);
}

export interface LinkedChatwootTarget {
  phone: string;
  conversationId: number;
}

/** Fail closed when account, inbox, contact or conversation identity is absent. */
export function linkedChatwootTarget(payload: any, accountId: string, inboxId: string, event: 'message' | 'resolved'): LinkedChatwootTarget | null {
  if (!payload || typeof payload !== 'object') return null;
  if (!matchesConfiguredId(accountId, [payload.account?.id, payload.account_id, payload.conversation?.account_id])) return null;
  if (!matchesConfiguredId(inboxId, [payload.inbox?.id, payload.inbox_id, payload.conversation?.inbox_id])) return null;

  const conversationCandidates = event === 'message'
    ? [payload.conversation?.id, payload.conversation_id]
    : [payload.conversation?.id, payload.conversation_id, payload.id];
  const conversationIds = conversationCandidates.filter(value => value !== undefined && value !== null).map(id);
  if (conversationIds.length === 0 || conversationIds[0] === null ||
      !conversationIds.every(value => value === conversationIds[0])) return null;

  const phones = [
    payload.conversation?.meta?.sender?.identifier,
    payload.meta?.sender?.identifier,
    payload.contact?.identifier,
  ].filter(value => value !== undefined && value !== null);
  if (phones.length === 0 || !phones.every(value => typeof value === 'string' && /^\d{10,15}$/.test(value) && value === phones[0])) return null;
  return { phone: phones[0], conversationId: conversationIds[0]! };
}

export function isLinkedSession(session: Session | null, conversationId: number): boolean {
  return session?.step === 'with_agent' && session.data.conversationId === String(conversationId);
}

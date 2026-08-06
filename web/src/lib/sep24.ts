import type { AnchorConfig } from './anchor';
import { authenticateWithAnchor } from './sep10';

interface Sep24AssetInfo {
  enabled: boolean;
  min_amount?: number;
  max_amount?: number;
  fee_fixed?: number;
  fee_percent?: number;
}

interface Sep24InfoResponse {
  deposit?: Record<string, Sep24AssetInfo>;
  withdraw?: Record<string, Sep24AssetInfo>;
  fee?: { enabled: boolean };
  features?: { account_creation?: boolean; claimable_balances?: boolean };
}

export interface AssetTransferInfo {
  assetCode: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMin: number | null;
  depositMax: number | null;
  withdrawMin: number | null;
  withdrawMax: number | null;
}

/**
 * SEP-24 `/info`: confirms which assets the anchor supports for interactive
 * deposit/withdraw, and their min/max amounts. Requires a SEP-10 JWT even
 * though `/info` itself is nominally public on some anchors — testanchor
 * expects the Authorization header, so we always send it.
 */
export async function getAssetTransferInfo(
  anchor: AnchorConfig,
  account: string,
  assetCode: string,
): Promise<AssetTransferInfo> {
  const token = await authenticateWithAnchor(anchor, account);

  // NOTE: new URL('/info', base) with a leading slash discards base's own
  // path (e.g. '/sep24'), resolving against the origin instead. Ensure the
  // base has a trailing slash and use a relative (no leading slash) path so
  // it correctly appends rather than replaces.
  const base = anchor.transferServerSep24.endsWith('/')
    ? anchor.transferServerSep24
    : `${anchor.transferServerSep24}/`;
  const infoUrl = new URL('info', base);
  const res = await fetch(infoUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SEP-24 /info request failed: ${res.status} ${body}`);
  }

  const info = (await res.json()) as Sep24InfoResponse;

  const deposit = info.deposit?.[assetCode];
  const withdraw = info.withdraw?.[assetCode];

  if (!deposit && !withdraw) {
    throw new Error(`Anchor does not list ${assetCode} in /info deposit or withdraw`);
  }

  return {
    assetCode,
    depositEnabled: deposit?.enabled ?? false,
    withdrawEnabled: withdraw?.enabled ?? false,
    depositMin: deposit?.min_amount ?? null,
    depositMax: deposit?.max_amount ?? null,
    withdrawMin: withdraw?.min_amount ?? null,
    withdrawMax: withdraw?.max_amount ?? null,
  };
}

export interface InteractiveSession {
  /** URL to open in a popup (web) or in-app browser view (Expo, later). */
  url: string;
  /** Transaction id to poll via GET /transaction?id=... until it completes. */
  id: string;
}

interface Sep24InteractiveResponse {
  type: string; // expected 'interactive_customer_info_needed'
  url: string;
  id: string;
}

/** Joins a SEP-24 base URL with a path segment, without dropping the base's
 *  own path (see the /info bug this pattern was extracted to avoid). */
function sep24Url(base: string, path: string): URL {
  const withTrailingSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(path, withTrailingSlash);
}

async function startInteractiveSession(
  anchor: AnchorConfig,
  account: string,
  assetCode: string,
  kind: 'deposit' | 'withdraw',
): Promise<InteractiveSession> {
  const token = await authenticateWithAnchor(anchor, account);

  const url = sep24Url(anchor.transferServerSep24, `transactions/${kind}/interactive`);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // NOTE: the SEP-24 spec's reference examples show
    // application/x-www-form-urlencoded, but testanchor.stellar.org actually
    // rejects that content type ("is not supported") and requires JSON.
    // Confirmed live against the real anchor before trusting this.
    body: JSON.stringify({ asset_code: assetCode, account }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`SEP-24 ${kind} interactive session request failed: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as Sep24InteractiveResponse;
  if (!data.url || !data.id) {
    throw new Error(`SEP-24 ${kind} interactive session response missing url or id`);
  }

  return { url: data.url, id: data.id };
}

/**
 * SEP-24 step 3 (deposit): opens an interactive KYC/deposit-instructions
 * session with the anchor. Caller is responsible for opening the returned
 * `url` (popup on web, in-app browser view on Expo later) and then polling
 * `getTransactionStatus(anchor, account, id)` until it settles.
 */
export async function startDepositSession(
  anchor: AnchorConfig,
  account: string,
  assetCode: string,
): Promise<InteractiveSession> {
  return startInteractiveSession(anchor, account, assetCode, 'deposit');
}

/** SEP-24 withdraw is the mirror of startDepositSession, for withdrawals. */
export async function startWithdrawSession(
  anchor: AnchorConfig,
  account: string,
  assetCode: string,
): Promise<InteractiveSession> {
  return startInteractiveSession(anchor, account, assetCode, 'withdraw');
}

// Statuses per SEP-24 spec. Anchors may not use every value, but these are
// the ones the spec defines as terminal vs. in-progress.
export type Sep24TransactionStatus =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'error';

export interface Sep24Transaction {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: Sep24TransactionStatus;
  moreInfoUrl: string | null;
  startedAt: string | null;
  refunded: boolean;
  to: string | null;
  amountIn: number | null;
  amountOut: number | null;
  stellarTransactionId: string | null;
}

interface Sep24TransactionResponse {
  transaction: {
    id: string;
    kind: 'deposit' | 'withdrawal';
    status: Sep24TransactionStatus;
    more_info_url?: string;
    started_at?: string;
    refunded?: boolean;
    to?: string;
    amount_in?: string;
    amount_out?: string;
    stellar_transaction_id?: string;
  };
}

/**
 * SEP-24 step 5: fetch the current state of a transaction started via
 * startDepositSession/startWithdrawSession. The live anchor response nests
 * the transaction under a `transaction` key (confirmed against
 * testanchor.stellar.org) — not a flat object as some docs imply.
 */
export async function getTransactionStatus(
  anchor: AnchorConfig,
  account: string,
  transactionId: string,
): Promise<Sep24Transaction> {
  const token = await authenticateWithAnchor(anchor, account);

  const url = sep24Url(anchor.transferServerSep24, 'transaction');
  url.searchParams.set('id', transactionId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SEP-24 transaction status request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Sep24TransactionResponse;
  const txn = data.transaction;
  if (!txn?.id) {
    throw new Error('SEP-24 transaction status response missing transaction.id');
  }

  return {
    id: txn.id,
    kind: txn.kind,
    status: txn.status,
    moreInfoUrl: txn.more_info_url ?? null,
    startedAt: txn.started_at ?? null,
    refunded: txn.refunded ?? false,
    to: txn.to ?? null,
    amountIn: txn.amount_in ? Number(txn.amount_in) : null,
    amountOut: txn.amount_out ? Number(txn.amount_out) : null,
    stellarTransactionId: txn.stellar_transaction_id ?? null,
  };
}

const TERMINAL_STATUSES: Sep24TransactionStatus[] = [
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error',
];

/**
 * Polls getTransactionStatus until the transaction reaches a terminal state
 * (completed, refunded, expired, or an error status), or until timeoutMs is
 * exceeded. Does not distinguish success from failure terminal states —
 * caller should check the returned `status`.
 */
export async function pollTransactionUntilTerminal(
  anchor: AnchorConfig,
  account: string,
  transactionId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<Sep24Transaction> {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const txn = await getTransactionStatus(anchor, account, transactionId);
    if (TERMINAL_STATUSES.includes(txn.status)) {
      return txn;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for transaction ${transactionId} to reach a terminal state (last status: ${txn.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
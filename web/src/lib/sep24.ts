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

/** SEP-24 step 3 (withdraw): same shape as startDepositSession, for withdrawals. */
export async function startWithdrawSession(
  anchor: AnchorConfig,
  account: string,
  assetCode: string,
): Promise<InteractiveSession> {
  return startInteractiveSession(anchor, account, assetCode, 'withdraw');
}
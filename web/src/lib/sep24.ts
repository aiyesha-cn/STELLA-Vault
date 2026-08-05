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

  const infoUrl = new URL('/info', anchor.transferServerSep24);
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
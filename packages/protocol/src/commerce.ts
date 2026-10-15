/** Commerce owns orders and provider proof; Meta alone grants game value. */
export interface EntitlementCommandV1 {
  version: 1;
  commandId: string;
  kind: 'grant' | 'revoke';
  source: 'payment' | 'rewarded_ad';
  orderId: string;
  provider: string;
  providerTransactionId: string;
  accountId: string;
  productId: string;
  catalogVersion: string;
  payloadHash: string;
  at: number;
  originalCommandId?: string;
}

export interface EntitlementReceipt {
  commandId: string;
  payloadHash: string;
  status: 'applied' | 'revoked' | 'review-required';
  at: number;
}

export type EntitlementResult =
  { ok: true; receipt: EntitlementReceipt } | { ok: false; code: string };

/** Price is absent until a real provider's SKU and currency have been configured. */
export interface CommerceOffer {
  productId: string;
  catalogVersion: string;
  source: 'payment' | 'rewarded_ad';
  nameKey: string;
  contentsKey: string;
  contents: {
    materials?: Record<string, number>;
    moduleId?: string;
    seasonId?: string;
    soulbound: true;
  };
  dailyLimit?: number;
  available: boolean;
  unavailableReason?: 'E_COMMERCE_UNAVAILABLE';
  price?: { amountMinor: number; currency: string };
}

export type CommerceOrderState =
  'created' | 'pending' | 'fulfilled' | 'revocation-pending' | 'revoked' | 'review-required';

export interface CommerceOrderView {
  orderId: string;
  productId: string;
  catalogVersion: string;
  state: CommerceOrderState;
  createdAt: number;
  receipt?: EntitlementReceipt;
}

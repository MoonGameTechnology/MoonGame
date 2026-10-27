/**
 * The look of a corporation's base in the hub (CORP-14). The head buys a style in the store
 * with personal Sovereigns ◆ for the whole corporation and applies it. The style stays with
 * the corporation when the head changes and is lost with the corporation.
 */

/** The free style every corporation has. */
export const CORP_STYLE_STANDARD = 'standard';

/** The caller's corporation as `GET /meta-economy/corp-style` reports it. */
export interface MetaCorpStyleView {
  /** The caller heads the corporation: only the head buys and applies styles. */
  head: boolean;
  /** Applied style: `standard` until the head applies another one. */
  active: string;
  /** Styles the corporation bought. `standard` is not listed: every corporation has it. */
  owned: string[];
}

/** `corp` is null outside a corporation and while the caller's application is pending. */
export interface MetaCorpStyleResponse {
  corp: MetaCorpStyleView | null;
}

export interface MetaCorpStyleApplyCommand {
  requestId: string;
  styleId: string;
}

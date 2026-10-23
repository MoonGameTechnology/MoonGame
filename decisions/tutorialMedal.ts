/**
 * The tutorial medal on this device (owner's decision 2026-10-23: it lives in the account
 * profile). The guided first match is played offline, so the medal is first earned here,
 * per callsign, and then handed to each account server once: a guest keeps it until signing
 * in, and a server that was unreachable at the end of the lesson gets it on the next hub.
 *
 * Earned only by the whole course: the guide reached its end AND the garrisoned world of
 * the assault chapter is ours. A guide finished by skipping its chapters is not the course.
 */

export interface TutorialMedalRecord {
  earned: boolean;
  /** Servers that already hold the claim, so it is sent once per server. */
  claimed: string[];
}

/** Enough for the servers one device plays on; the oldest claim drops first (a resend is harmless). */
export const TUTORIAL_MEDAL_SERVERS = 8;

const FRESH: TutorialMedalRecord = { earned: false, claimed: [] };

/** Fail-secure parse: anything malformed reads as not earned. */
export function parseTutorialMedal(raw: string | null): TutorialMedalRecord {
  if (!raw) return { ...FRESH, claimed: [] };
  try {
    const v = JSON.parse(raw) as { earned?: unknown; claimed?: unknown };
    if (v.earned !== true) return { ...FRESH, claimed: [] };
    const claimed = Array.isArray(v.claimed)
      ? v.claimed.filter(
          (s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 512,
        )
      : [];
    return { earned: true, claimed: claimed.slice(-TUTORIAL_MEDAL_SERVERS) };
  } catch {
    return { ...FRESH, claimed: [] };
  }
}

/** The end of a guide run: `fresh` opens the award window, only on the first earning. */
export function earnTutorialMedal(
  record: TutorialMedalRecord,
  run: { completed: boolean; assaultWon: boolean },
): { record: TutorialMedalRecord; fresh: boolean } {
  if (!run.completed || !run.assaultWon || record.earned) return { record, fresh: false };
  return { record: { earned: true, claimed: [] }, fresh: true };
}

/** Does this server still need the claim? */
export function tutorialMedalPending(record: TutorialMedalRecord, server: string): boolean {
  return record.earned && !record.claimed.includes(server);
}

/** The server confirmed the claim. */
export function claimTutorialMedal(
  record: TutorialMedalRecord,
  server: string,
): TutorialMedalRecord {
  if (!record.earned || record.claimed.includes(server)) return record;
  return { earned: true, claimed: [...record.claimed, server].slice(-TUTORIAL_MEDAL_SERVERS) };
}

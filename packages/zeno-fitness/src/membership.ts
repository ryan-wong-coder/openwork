import { membershipDataSchema } from "@zeno/core/schema";
import type { MembershipCard } from "./types.js";
/** The caller's existing QR renderer encodes this exact value; it is never opened as a URL. */
export function membershipQrPayload(card: MembershipCard): string { return membershipDataSchema.parse(card).code; }
export function membershipExpired(card: MembershipCard, now = Date.now()): boolean { return card.expiresAt !== null && card.expiresAt < now; }

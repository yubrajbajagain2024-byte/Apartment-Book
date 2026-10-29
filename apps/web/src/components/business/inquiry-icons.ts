import { Building2, Megaphone, Store, Tag, type LucideIcon } from "lucide-react";
import type { InquiryKind } from "@apartment-book/shared";

/** The icon of what an inquiry is about, in the inbox's list and at the top of the chat. */
export const INQUIRY_ICONS: Record<InquiryKind, LucideIcon> = { listing: Building2, post: Tag, ad: Megaphone, profile: Store };

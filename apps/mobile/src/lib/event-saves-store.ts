import { getSavedEventIds, toggleEventSave } from "@apartment-book/shared";
import { createIdSetStore } from "./id-set-store";

/** The events the signed-in person saved (event_saves, migration 61): one set for the Events tab, Saved and the details screen. */
export const savedEvents = createIdSetStore(getSavedEventIds, toggleEventSave);

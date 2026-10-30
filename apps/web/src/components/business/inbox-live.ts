"use client";

import { useSyncExternalStore } from "react";

/*
 * What the portal knows live about its inbox, in one place: the unread count as last counted, and the newest message
 * that arrived while the portal was open. The alerts (message-alerts.tsx) own the one realtime channel and write here;
 * the sidebar's badge (desktop and drawer), the tab's title and the inbox's list read from here. One channel and one
 * count for the whole shell, however many parts of the page show the number. Module state: it lives as long as the
 * page does, across client-side navigations, and is reset by a full load.
 */

type Live = {
  /** Null until the alerts have counted; the server's number stands until then. */
  unread: number | null;
  /** The newest message event seen on this page: which chat, and the message's own time (the database's clock). */
  lastMessage: { conversationId: string; createdAt: string } | null;
};

let live: Live = { unread: null, lastMessage: null };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function subscribeInboxLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readInboxLive(): Live {
  return live;
}

export function setInboxUnread(unread: number): void {
  if (live.unread === unread) return;
  live = { ...live, unread };
  emit();
}

/** A message reached the portal (any sender): the inbox's list checks against it when it next mounts. */
export function noteInboxMessage(message: { conversationId: string; createdAt: string }): void {
  live = { ...live, lastMessage: message };
  emit();
}

const unreadSnapshot = () => live.unread;
const serverSnapshot = () => null;

/** The unread count: live once the alerts have counted, the server's number before that (and on the server). */
export function useInboxUnread(initial: number): number {
  const unread = useSyncExternalStore(subscribeInboxLive, unreadSnapshot, serverSnapshot);
  return unread ?? initial;
}

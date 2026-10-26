"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Where the chat components link: the student site's Messages by default; the business portal's Inbox, which has no
 * "new chat" (businesses only reply) and no student profiles to open, when it reuses them.
 */
export type MessagesPaths = {
  /** The list and each chat live under this path. */
  base: string;
  /** The "New message" page, or null where chats cannot be started. */
  newChat: string | null;
  /** Where a person's profile opens, or null where there are no profiles to open. */
  profile: string | null;
  /** What an empty list says. */
  emptyText: string;
  /**
   * "business": the portal's team inbox. The list is "Inquiries", and a chat's header says it is a student's inquiry
   * instead of showing that student's activity, which stays between students.
   */
  audience: "student" | "business";
};

const STUDENT: MessagesPaths = {
  base: "/messages",
  newChat: "/messages/new",
  profile: "/profile",
  emptyText: "No conversations yet. Message a listing owner, or start a new chat.",
  audience: "student",
};

const MessagesPathsContext = createContext<MessagesPaths>(STUDENT);

export function MessagesPathsProvider({ value, children }: { value: MessagesPaths; children: ReactNode }) {
  return <MessagesPathsContext.Provider value={value}>{children}</MessagesPathsContext.Provider>;
}

export function useMessagesPaths(): MessagesPaths {
  return useContext(MessagesPathsContext);
}

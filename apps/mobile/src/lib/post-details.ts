import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { campusLabel, DEFAULT_POST_AUDIENCE, POST_AUDIENCES, profileIdByUsername, type PostAudience } from "@apartment-book/shared";
import { errorText } from "./hooks";
import { supabase } from "./supabase";

/*
 * What a post or reel may carry since migration 44, read the way every screen shows it: a title, one link, who can see
 * it and whether comments are off. A database without the migration hands back rows with none of these fields at all,
 * so each one is read here with the plain post's default and the post shows exactly as before.
 */

/** Who can see a post. A row without the field (or with a value this app does not know) is Global, as every post was. */
export function postAudience(post: { audience?: string | null }): PostAudience {
  const found = POST_AUDIENCES.find((a) => a.value === post.audience);
  return found ? found.value : DEFAULT_POST_AUDIENCE;
}

/**
 * "Friends only", "Selected people", … for a post's audience. A campus post is named by its university ("Texas State"),
 * as the audience picker names it, when the university is known; "Campus only" otherwise.
 */
export function audienceLabel(audience: PostAudience, universityName?: string | null): string {
  if (audience === "campus" && universityName?.trim()) return campusLabel(universityName);
  return POST_AUDIENCES.find((a) => a.value === audience)?.label ?? "Global";
}

/**
 * Whether a post can be sent into a chat. The database lets a card in only when everyone in that chat can see the post:
 * a Global post always, a campus one when they are at that campus. Friends-only and selected-people posts are not offered.
 */
export function canShareAudience(audience: PostAudience): boolean {
  return audience === "global" || audience === "campus";
}

/** The post's own link when it is a web address (the database only stores http and https ones), else null. */
export function postLink(link: string | null | undefined): string | null {
  const url = link?.trim();
  return url && /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** How much of a link its pill shows before "…": the site and the start of the path, never the whole address. */
const LINK_LABEL_MAX = 30;

/** "instagram.com/unibuzz…" from "https://www.instagram.com/unibuzz/reels/?hl=en": the site without "www.", the path without its query. */
export function linkLabel(url: string): string {
  const match = /^https?:\/\/(?:[^@/?#\s]*@)?([^/?#:\s]+)(?::\d+)?([^?#\s]*)/i.exec(url.trim());
  if (!match) return url;
  let path = match[2].replace(/\/+$/, "");
  try {
    path = decodeURI(path);
  } catch {
    // A malformed escape: shown as it was written.
  }
  const label = match[1].toLowerCase().replace(/^www\./, "") + path;
  return label.length > LINK_LABEL_MAX ? `${label.slice(0, LINK_LABEL_MAX - 1).trimEnd()}…` : label;
}

/**
 * Opens the profile behind an @mention in a caption. A caption keeps the username as it was written, and usernames can
 * change, so one that leads nowhere now says so quietly instead. A second tap while the first is still asking is ignored.
 */
export function useOpenMention(): (username: string) => void {
  const router = useRouter();
  const busy = useRef(false);
  return useCallback(
    (username: string) => {
      if (busy.current) return;
      busy.current = true;
      profileIdByUsername(supabase, username)
        .then((id) => {
          if (id) router.push({ pathname: "/profile/[id]", params: { id } });
          else Alert.alert(`@${username}`, "No one has that username now.");
        })
        .catch((e: unknown) => Alert.alert("Couldn't open this profile", errorText(e)))
        .finally(() => {
          busy.current = false;
        });
    },
    [router],
  );
}

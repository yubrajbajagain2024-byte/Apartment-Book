/**
 * The columns every feed post is read with: the post, its author (with their university's email domain, for the
 * verified mark) and its university. Its own module, so feed.ts and follows.ts can both use it without importing each
 * other (feed.ts re-exports it).
 */
export const FEED_POST_SELECT =
  "*, author:profiles!feed_posts_author_id_fkey(id, full_name, avatar_url, university:universities(email_domain)), university:universities!feed_posts_university_id_fkey(id, name)";

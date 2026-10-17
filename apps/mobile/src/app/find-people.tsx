import { PeopleSearch } from "@/components/people-search";

/**
 * The people search pushed over another screen (the share sheet's Find people, a profile's Find friends), under a native
 * "Search" header, with the box focused at once, like TikTok. The Search tab in the bottom bar shows the same screen and
 * owns the /search address; this one is /find-people.
 */
export default function SearchScreen() {
  return <PeopleSearch autoFocus />;
}

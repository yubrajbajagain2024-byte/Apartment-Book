import { PeopleSearch } from "@/components/people-search";

/**
 * The people search pushed over another screen (Home's Search button, top right before the bell; the share sheet's Find
 * people; a profile's Find friends), under a native "Search" header, with the box focused at once, like TikTok.
 */
export default function SearchScreen() {
  return <PeopleSearch autoFocus />;
}

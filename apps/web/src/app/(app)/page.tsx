import type { Metadata } from "next";
import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { HomeTabs } from "@/components/home/home-tabs";
import { PostsFeed } from "@/components/home/posts-feed";
import { loadPostsSection } from "@/components/home/posts-section.server";
import { ReelsFeed } from "@/components/home/reels-feed";
import { loadReelsSection } from "@/components/home/reels-section.server";
import { BuzzFeed } from "@/components/home/buzz-feed";
import { loadBuzzSection } from "@/components/home/buzz-section.server";

type SearchParams = { [key: string]: string | string[] | undefined };

function sectionFrom(params: SearchParams): HomeSection {
  const tab = firstParam(params.tab);
  return HOME_SECTIONS.find((s) => s.value === tab)?.value ?? DEFAULT_HOME_SECTION;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const section = sectionFrom(await searchParams);
  return { title: section === "reels" ? "Reels" : section === "buzz" ? "Buzz" : "Home" };
}

/** Home: Reels | Buzz | Posts. The apartment listings moved to /apartments. */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const section = sectionFrom(params);
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);

  return (
    <div className="-mt-4 flex w-full flex-col gap-1 sm:mt-0 sm:gap-4">
      {/* Someone browsing every campus stays on "All universities" when they change tab. */}
      <HomeTabs active={section} all={firstParam(params.university) === "all"} />
      {/* Posts and Buzz are one 500px column; Reels gets a little more room for its previous / next buttons. */}
      <div className={cn("mx-auto w-full", section === "reels" ? "max-w-[640px]" : "max-w-[500px]")}>
        <HomeSectionBody section={section} load={{ supabase, user, profile, params }} />
      </div>
    </div>
  );
}

async function HomeSectionBody({
  section,
  load,
}: {
  section: HomeSection;
  load: { supabase: Awaited<ReturnType<typeof createClient>>; user: Awaited<ReturnType<typeof getCurrentUser>>; profile: Awaited<ReturnType<typeof getCurrentProfile>>; params: SearchParams };
}) {
  const { supabase, user, profile, params } = load;
  if (section === "reels") {
    const props = await loadReelsSection(supabase, user, profile, params);
    // The feed keeps its own list once mounted, so a different campus needs a fresh one.
    return <ReelsFeed key={props.universityId ?? "all"} {...props} />;
  }
  if (section === "buzz") {
    const props = await loadBuzzSection(supabase, user, profile, params);
    return <BuzzFeed key={JSON.stringify(props.filters)} {...props} />;
  }
  const props = await loadPostsSection(supabase, user, profile, params);
  // The key remounts the feed when the campus filter changes, so it starts from page one again.
  return <PostsFeed key={JSON.stringify(props.filters)} {...props} />;
}

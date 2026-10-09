import type { Metadata } from "next";
import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { HomeTabs } from "@/components/home/home-tabs";
import { HomeSwipe } from "@/components/home/home-swipe";
import { ForYouFeed } from "@/components/home/for-you-feed";
import { loadForYouSection } from "@/components/home/for-you-section.server";
import { PostsFeed } from "@/components/home/posts-feed";
import { loadPostsSection } from "@/components/home/posts-section.server";
import { ReelsFeed } from "@/components/home/reels-feed";
import { loadReelsSection } from "@/components/home/reels-section.server";
import { BuzzFeed } from "@/components/home/buzz-feed";
import { loadBuzzSection } from "@/components/home/buzz-section.server";

type SearchParams = { [key: string]: string | string[] | undefined };

/** The landing tab is the site's Home in the browser tab; the others go by their own name. */
const TITLES: Record<HomeSection, string> = { foryou: "Home", buzz: "Buzz", posts: "Posts", reels: "Reels" };

function sectionFrom(params: SearchParams): HomeSection {
  const tab = firstParam(params.tab);
  return HOME_SECTIONS.find((s) => s.value === tab)?.value ?? DEFAULT_HOME_SECTION;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  return { title: TITLES[sectionFrom(await searchParams)] };
}

/** Home: For you | Buzz | Posts | Reels. The apartment listings moved to /apartments. */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const section = sectionFrom(params);
  // Someone browsing every campus stays on "All universities" when they change tab.
  const all = firstParam(params.university) === "all";
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);

  return (
    <div className="-mt-4 flex w-full flex-col gap-1 sm:mt-0 sm:gap-4">
      <HomeTabs active={section} all={all} />
      {/* For you, Posts and Buzz are one 500px column; Reels gets a little more room for its previous / next buttons. */}
      <div className={cn("mx-auto w-full", section === "reels" ? "max-w-[640px]" : "max-w-[500px]")}>
        {/* On a touch screen, swiping the section sideways moves to the tab next to it. */}
        <HomeSwipe section={section} all={all}>
          <HomeSectionBody section={section} load={{ supabase, user, profile, params }} />
        </HomeSwipe>
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
  // Every feed keeps its own list once mounted, so the key remounts it when the campus (or another filter) changes and it starts from page one again.
  switch (section) {
    case "foryou": {
      const props = await loadForYouSection(supabase, user, profile, params);
      return <ForYouFeed key={props.filters.universityId ?? "all"} {...props} />;
    }
    case "buzz": {
      const props = await loadBuzzSection(supabase, user, profile, params);
      return <BuzzFeed key={JSON.stringify(props.filters)} {...props} />;
    }
    case "posts": {
      const props = await loadPostsSection(supabase, user, profile, params);
      return <PostsFeed key={JSON.stringify(props.filters)} {...props} />;
    }
    case "reels": {
      const props = await loadReelsSection(supabase, user, profile, params);
      return <ReelsFeed key={props.universityId ?? "all"} {...props} />;
    }
  }
}

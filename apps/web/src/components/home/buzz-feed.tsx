"use client";

import { BuzzPane, type BuzzPaneProps } from "@/components/buzz/pane";

export type BuzzFeedProps = BuzzPaneProps & { filters: { section: "buzz" } };

/** Home → Buzz: the UniVerse Buzz pane (components/buzz), in Home's content column. */
export function BuzzFeed(props: BuzzFeedProps) {
  return <BuzzPane userId={props.userId} compose={props.compose} campusFallback={props.campusFallback} fixtures={props.fixtures} />;
}

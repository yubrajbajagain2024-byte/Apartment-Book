import { redirect } from "next/navigation";

/** The Buzz composer is a sheet on Home now: old links (and the Create menu) open it there. */
export default function NewBuzzPage() {
  redirect("/?tab=buzz&compose=1");
}

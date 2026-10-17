import { Redirect } from "expo-router";

/** The Marketplace is the third page of the Explore tab now: an old link to /marketplace (the website's address) lands on it. */
export default function MarketplaceRedirect() {
  return <Redirect href={{ pathname: "/(tabs)/housing", params: { section: "marketplace" } }} />;
}

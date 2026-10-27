import { useCallback } from "react";
import { useNavigation, useRouter } from "expo-router";
import { compose, type ComposeMode, type ListingMode } from "./compose-store";
import { dropUploads } from "./compose-media";

type Router = ReturnType<typeof useRouter>;

/**
 * Opens the create flow on its camera, starting a fresh post or reel. What every create button calls; `upload` (the
 * profile menu's Upload) has the camera open its library at once.
 */
export function openCompose(router: Router, mode: ComposeMode, opts: { upload?: boolean } = {}) {
  dropUploads();
  compose.start(mode);
  router.push({ pathname: "/compose", params: opts.upload ? { mode, upload: "1" } : { mode } } as never);
}

/**
 * Opens the create flow for a roommate post or a Marketplace item (Explore's +): the same camera, on the back lens
 * (it is the room or the thing that is photographed), with Skip for a listing without pictures.
 */
export function openListingCompose(router: Router, mode: ListingMode) {
  dropUploads();
  compose.start(mode);
  router.push({ pathname: "/compose", params: { mode } } as never);
}

/**
 * Closes the whole create flow from any of its screens: the full-screen modal goes, taking its camera, editor and
 * publish screen with it (a plain back would only step back inside it).
 */
export function useCloseCompose(): () => void {
  const navigation = useNavigation();
  const router = useRouter();
  return useCallback(() => {
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else router.replace("/(tabs)");
  }, [navigation, router]);
}

import { useCallback } from "react";
import { useNavigation, useRouter } from "expo-router";
import { compose, type ComposeMode } from "./compose-store";
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

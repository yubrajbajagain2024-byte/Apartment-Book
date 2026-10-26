import type { ComponentType, ReactElement } from "react";
import type { ViewProps } from "react-native";
import NativeMaskedView from "@react-native-masked-view/masked-view";

/**
 * @react-native-masked-view/masked-view, typed by its props. The package's own types build the class on React Native's
 * NativeMethods, which React Native 0.88 no longer exports, so TypeScript sees no props on it. The component is the same.
 */
export const MaskedView = NativeMaskedView as unknown as ComponentType<ViewProps & { maskElement: ReactElement; androidRenderingMode?: "software" | "hardware" }>;

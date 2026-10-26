import type { ComponentType, ReactElement } from "react";
import type { ViewProps } from "react-native";
import MaskedViewImpl from "@react-native-masked-view/masked-view";

/**
 * `@react-native-masked-view/masked-view`, typed again: its own types build the class from `ReactNative.NativeMethods`,
 * which React Native 0.88 no longer exports, so TypeScript loses its props. The component itself is unchanged.
 */
export const MaskedView = MaskedViewImpl as unknown as ComponentType<
  ViewProps & { maskElement: ReactElement; androidRenderingMode?: "software" | "hardware" }
>;

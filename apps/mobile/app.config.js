// The app's config is app.json. This file hands it on unchanged, so EAS and every production build read exactly what
// app.json says, with one exception that applies only when asked for:
//
// CAMPCONNECT_FREE_SIGNING=1 (set by `npm run ios:device`) makes an iOS build that a free Apple ID can sign with
// Xcode's Personal Team, for testing on your own iPhone without a paid Apple Developer Program membership:
//  - Its own bundle id: com.apartmentbook.app.<your Mac user name>, or CAMPCONNECT_BUNDLE_ID when set. A free team
//    must register an id that no other team has, and the test copy then sits beside any other build of the app.
//  - No Push Notifications entitlement (aps-environment): a free team cannot sign it. That copy gets no pushes, so a
//    call rings it while the app is open (over realtime) or as soon as it comes back to the front, never while closed.
// Everything else (LiveKit, camera, microphone, background audio) is the same as in the real builds.
const os = require("os");
const { withEntitlementsPlist } = require("expo/config-plugins");

/** Drops the entitlement expo-notifications adds. Listed first, so its change runs after every other plugin's. */
function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
}

module.exports = ({ config }) => {
  if (process.env.CAMPCONNECT_FREE_SIGNING !== "1") return config;
  const user = os.userInfo().username.toLowerCase().replace(/[^a-z0-9]/g, "") || "local";
  const bundleIdentifier = process.env.CAMPCONNECT_BUNDLE_ID || `${config.ios.bundleIdentifier}.${user}`;
  return {
    ...config,
    ios: { ...config.ios, bundleIdentifier },
    plugins: [withoutPushEntitlement, ...(config.plugins ?? [])],
  };
};

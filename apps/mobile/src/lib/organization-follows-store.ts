import { listFollowedOrganizationIds, toggleOrganizationFollow } from "@apartment-book/shared";
import { createIdSetStore } from "./id-set-store";

/** The organizations the signed-in person follows (organization_follows, migration 61), for every Follow pill at once. */
export const organizationFollows = createIdSetStore(listFollowedOrganizationIds, toggleOrganizationFollow);

import type { Metadata } from "next";
import { lookupInvite } from "@apartment-book/shared";
import { BusinessJoinForm } from "@/components/business/auth-forms";
import { PortalLink } from "@/components/business/portal-base";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a team" };

/** The link the owner passes on: the invite names the business and the address; whoever signs up here joins the team. */
export default async function BusinessJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupInvite(await createClient(), token).catch(() => null);
  if (!invite || !invite.valid) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-bold">This invite is no longer valid</h1>
        <p className="text-sm text-gray-600">It was used, revoked or has expired. Ask the business owner to send a new link.</p>
        <PortalLink href="/login" className="font-semibold text-brand-600 hover:underline">
          Log in instead
        </PortalLink>
      </div>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-center text-2xl font-bold">Join {invite.businessName}</h1>
      <p className="mb-6 text-center text-sm text-gray-600">
        You were invited as <span className="font-medium text-gray-900">{invite.email}</span>. Choose a password to join the team on UniBuzz Business.
      </p>
      <BusinessJoinForm token={token} email={invite.email} businessName={invite.businessName} />
    </>
  );
}

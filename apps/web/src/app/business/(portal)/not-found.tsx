import { PortalLink } from "@/components/business/portal-base";
import { bizButton, Panel } from "@/components/business/ui";

/** A portal address that leads nowhere, or to something that is not this business's. */
export default function PortalNotFound() {
  return (
    <Panel className="mx-auto flex max-w-lg flex-col items-center px-8 py-14 text-center">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">Not here</h1>
      <p className="mt-2 text-[15px] text-biz-ink-3">This page does not exist, or it belongs to another business.</p>
      <PortalLink href="/" className={bizButton({ variant: "primary", className: "mt-6" })}>
        Back to the dashboard
      </PortalLink>
    </Panel>
  );
}

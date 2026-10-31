/**
 * Every portal page arrives the same way: a short fade in place, no movement, so a change of page never pops or shifts
 * (a template is remounted on each navigation, so the fade plays once per page; the sidebar, outside it, stays put).
 * The inbox's chats are a deeper segment: switching between them leaves the list and this wrapper alone.
 */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return <div className="biz-page-in">{children}</div>;
}

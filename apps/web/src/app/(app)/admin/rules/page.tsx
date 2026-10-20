import { listRulePacks } from "@/lib/buzz-server/rule-packs";
import { LIMITATIONS } from "@/lib/staff/constants";
import { fetchRulePacks, requireStaff, staffMetadata } from "@/lib/staff/server";
import { Ago } from "@/components/staff/live";
import { LimitationsPanel, Pill, Section } from "@/components/staff/parts";
import { RulePackToggle } from "@/components/staff/rule-pack-toggle";

export const generateMetadata = () => staffMetadata("Rules · Trust & Safety");

/**
 * Rules (UniVerse RulesPage): the engine's rule packs on and off (admins; each toggle is audited and reaches the write
 * API through ts_writer_context().enabledRulePacks), and the Limitations panel for everyone.
 */
export default async function StaffRulesPage() {
  const me = await requireStaff();
  const admin = me.role === "admin";
  const state = admin ? await fetchRulePacks() : [];
  // version and rule count come from the engine itself (server-only package)
  const engine = new Map(listRulePacks().map((p) => [p.id, p] as const));

  return (
    <div className="flex flex-col gap-6">
      {admin ? (
        <Section title="Rule packs" hint="toggles are audited">
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            {state.map((p) => {
              const info = engine.get(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-900">{p.id}</span>
                      {p.id === "baseline" ? <Pill variant="outline">always on</Pill> : null}
                      {!info ? (
                        <Pill variant="outline" tone="amber">
                          not in this engine build
                        </Pill>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-500">
                      {info ? `v${info.version} · ${info.ruleCount} rules` : "unknown pack"}
                      {p.updatedBy && p.updatedAt ? (
                        <>
                          {` · changed by ${p.updatedBy} `}
                          <Ago ms={p.updatedAt} />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <RulePackToggle id={p.id} enabled={p.enabled} locked={p.id === "baseline"} />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-gray-500">Every Buzz write is checked against every enabled pack; the strictest outcome wins. PII and behavioural checks always run.</p>
        </Section>
      ) : (
        <p className="text-sm text-gray-600">Rule packs are managed by admins. The limitations below apply to every review.</p>
      )}
      <LimitationsPanel items={LIMITATIONS} />
    </div>
  );
}

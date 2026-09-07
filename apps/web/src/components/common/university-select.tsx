import type { University } from "@apartment-book/shared";
import { Select } from "@/components/ui/input";

export function UniversitySelect({
  universities,
  name = "universityId",
  id,
  defaultValue,
  emptyLabel = "Not specified",
  className,
  onChange,
}: {
  universities: University[];
  name?: string;
  id?: string;
  defaultValue?: string | null;
  emptyLabel?: string;
  className?: string;
  onChange?: (universityId: string) => void;
}) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""} className={className} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
      <option value="">{emptyLabel}</option>
      {universities.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.city ? ` — ${u.city}` : ""}
        </option>
      ))}
    </Select>
  );
}

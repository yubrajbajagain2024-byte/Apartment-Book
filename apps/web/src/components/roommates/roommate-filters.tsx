import { GENDER_PREFERENCES, RADIUS_OPTIONS_MILES, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar } from "@/components/common/filter-bar";

export type RoommateFilterValues = {
  q?: string;
  university?: string;
  type?: string;
  maxBudget?: string;
  gender?: string;
  radius?: string;
};

export function RoommateFilters({ universities, values, hasFilters }: { universities: University[]; values: RoommateFilterValues; hasFilters: boolean }) {
  return (
    <FilterBar action="/roommates" hasFilters={hasFilters}>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Keywords, neighbourhood…" />
      </label>
      <label className="flex min-w-48 flex-col gap-1 text-xs font-medium text-gray-600">
        University
        <Select name="university" defaultValue={values.university ?? "all"}>
          <option value="all">All universities</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex w-44 flex-col gap-1 text-xs font-medium text-gray-600">
        Post type
        <Select name="type" defaultValue={values.type ?? ""}>
          <option value="">All posts</option>
          <option value="has_room">Has a room</option>
          <option value="needs_room">Looking for a room</option>
        </Select>
      </label>
      <label className="flex w-32 flex-col gap-1 text-xs font-medium text-gray-600">
        Max budget
        <Input name="maxBudget" type="number" min={0} defaultValue={values.maxBudget ?? ""} placeholder="Any" />
      </label>
      {values.university && values.university !== "all" ? (
        <label className="flex w-40 flex-col gap-1 text-xs font-medium text-gray-600">
          Distance from campus
          <Select name="radius" defaultValue={values.radius ?? ""}>
            <option value="">Any distance</option>
            {RADIUS_OPTIONS_MILES.map((miles) => (
              <option key={miles} value={miles}>
                Within {miles} {miles === 1 ? "mile" : "miles"}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <label className="flex w-36 flex-col gap-1 text-xs font-medium text-gray-600">
        Open to
        <Select name="gender" defaultValue={values.gender ?? ""}>
          <option value="">Anyone</option>
          {GENDER_PREFERENCES.filter((g) => g.value !== "any").map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
      </label>
    </FilterBar>
  );
}

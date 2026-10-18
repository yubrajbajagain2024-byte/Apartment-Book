import { GENDER_PREFERENCES, RADIUS_OPTIONS_MILES, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar, FilterChip, FilterLabel } from "@/components/common/filter-bar";

export type RoommateFilterValues = {
  q?: string;
  university?: string;
  type?: string;
  maxBudget?: string;
  gender?: string;
  radius?: string;
  video?: string;
};

export function RoommateFilters({ universities, values, hasFilters }: { universities: University[]; values: RoommateFilterValues; hasFilters: boolean }) {
  return (
    <FilterBar action="/roommates" hasFilters={hasFilters}>
      <FilterLabel className="min-w-40 flex-1">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Keywords, neighbourhood…" />
      </FilterLabel>
      <FilterLabel className="min-w-48">
        University
        <Select name="university" defaultValue={values.university ?? "all"}>
          <option value="all">All universities</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </FilterLabel>
      <FilterLabel className="w-44">
        Post type
        <Select name="type" defaultValue={values.type ?? ""}>
          <option value="">All posts</option>
          <option value="has_room">Has a room</option>
          <option value="needs_room">Looking for a room</option>
        </Select>
      </FilterLabel>
      <FilterLabel className="w-32">
        Max budget
        <Input name="maxBudget" type="number" min={0} defaultValue={values.maxBudget ?? ""} placeholder="Any" />
      </FilterLabel>
      {values.university && values.university !== "all" ? (
        <FilterLabel className="w-40">
          Distance from campus
          <Select name="radius" defaultValue={values.radius ?? ""}>
            <option value="">Any distance</option>
            {RADIUS_OPTIONS_MILES.map((miles) => (
              <option key={miles} value={miles}>
                Within {miles} {miles === 1 ? "mile" : "miles"}
              </option>
            ))}
          </Select>
        </FilterLabel>
      ) : null}
      <div className="flex h-11 items-center">
        <FilterChip name="video" value="1" defaultChecked={values.video === "1"} label="Video only" />
      </div>
      <FilterLabel className="w-36">
        Open to
        <Select name="gender" defaultValue={values.gender ?? ""}>
          <option value="">Anyone</option>
          {GENDER_PREFERENCES.filter((g) => g.value !== "any").map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
      </FilterLabel>
    </FilterBar>
  );
}

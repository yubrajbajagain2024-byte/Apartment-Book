import { APARTMENT_SORTS, RADIUS_OPTIONS_MILES, type University } from "@apartment-book/shared";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { FilterBar } from "@/components/common/filter-bar";

export type ApartmentFilterValues = {
  q?: string;
  university?: string;
  minPrice?: string;
  maxPrice?: string;
  bedrooms?: string;
  furnished?: string;
  pets?: string;
  radius?: string;
  video?: string;
  sort?: string;
};

export function ApartmentFilters({ universities, values, hasFilters }: { universities: University[]; values: ApartmentFilterValues; hasFilters: boolean }) {
  return (
    <FilterBar action="/" hasFilters={hasFilters}>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Neighbourhood, keywords…" />
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
      <label className="flex w-28 flex-col gap-1 text-xs font-medium text-gray-600">
        Min price
        <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
      </label>
      <label className="flex w-28 flex-col gap-1 text-xs font-medium text-gray-600">
        Max price
        <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
      </label>
      <label className="flex w-32 flex-col gap-1 text-xs font-medium text-gray-600">
        Bedrooms
        <Select name="bedrooms" defaultValue={values.bedrooms ?? ""}>
          <option value="">Any</option>
          <option value="0">Studio+</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
        </Select>
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
      <label className="flex w-44 flex-col gap-1 text-xs font-medium text-gray-600">
        Sort by
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {APARTMENT_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex h-10 items-center gap-4">
        <Checkbox name="video" value="1" defaultChecked={values.video === "1"} label="Video tours only" />
        <Checkbox name="furnished" value="1" defaultChecked={values.furnished === "1"} label="Furnished" />
        <Checkbox name="pets" value="1" defaultChecked={values.pets === "1"} label="Pets OK" />
      </div>
    </FilterBar>
  );
}

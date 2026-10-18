import { APARTMENT_SORTS, RADIUS_OPTIONS_MILES, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar, FilterChip, FilterLabel } from "@/components/common/filter-bar";

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
    <FilterBar action="/apartments" hasFilters={hasFilters}>
      <FilterLabel className="min-w-40 flex-1">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Neighbourhood, keywords…" />
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
      <FilterLabel className="w-28">
        Min price
        <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
      </FilterLabel>
      <FilterLabel className="w-28">
        Max price
        <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
      </FilterLabel>
      <FilterLabel className="w-32">
        Bedrooms
        <Select name="bedrooms" defaultValue={values.bedrooms ?? ""}>
          <option value="">Any</option>
          <option value="0">Studio+</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
        </Select>
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
      <FilterLabel className="w-44">
        Sort by
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {APARTMENT_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FilterLabel>
      <div className="flex h-11 items-center gap-2">
        <FilterChip name="video" value="1" defaultChecked={values.video === "1"} label="Video tours only" />
        <FilterChip name="furnished" value="1" defaultChecked={values.furnished === "1"} label="Furnished" />
        <FilterChip name="pets" value="1" defaultChecked={values.pets === "1"} label="Pets OK" />
      </div>
    </FilterBar>
  );
}

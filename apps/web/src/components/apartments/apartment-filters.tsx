import { APARTMENT_SORTS, RADIUS_OPTIONS_MILES, type University } from "@apartment-book/shared";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { FilterBar, FilterField } from "@/components/common/filter-bar";

export type ApartmentFilterValues = {
  q?: string;
  university?: string;
  minPrice?: string;
  maxPrice?: string;
  bedrooms?: string;
  furnished?: string;
  pets?: string;
  radius?: string;
  sort?: string;
  view?: string;
};

export function ApartmentFilters({ universities, values, hasFilters }: { universities: University[]; values: ApartmentFilterValues; hasFilters: boolean }) {
  return (
    <FilterBar action="/" hasFilters={hasFilters}>
      {values.view === "map" ? <input type="hidden" name="view" value="map" /> : null}
      <FilterField label="Search">
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Neighbourhood, keywords…" />
      </FilterField>
      <FilterField label="University">
        <Select name="university" defaultValue={values.university ?? "all"}>
          <option value="all">All universities</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </FilterField>
      {values.university && values.university !== "all" ? (
        <FilterField label="Distance from campus">
          <Select name="radius" defaultValue={values.radius ?? ""}>
            <option value="">Any distance</option>
            {RADIUS_OPTIONS_MILES.map((miles) => (
              <option key={miles} value={miles}>
                Within {miles} {miles === 1 ? "mile" : "miles"}
              </option>
            ))}
          </Select>
        </FilterField>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <FilterField label="Min price">
          <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
        </FilterField>
        <FilterField label="Max price">
          <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
        </FilterField>
      </div>
      <FilterField label="Bedrooms">
        <Select name="bedrooms" defaultValue={values.bedrooms ?? ""}>
          <option value="">Any</option>
          <option value="0">Studio+</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
        </Select>
      </FilterField>
      <FilterField label="Sort by">
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {APARTMENT_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FilterField>
      <div className="flex flex-col gap-2 pt-1">
        <Checkbox name="furnished" value="1" defaultChecked={values.furnished === "1"} label="Furnished" />
        <Checkbox name="pets" value="1" defaultChecked={values.pets === "1"} label="Pets OK" />
      </div>
    </FilterBar>
  );
}

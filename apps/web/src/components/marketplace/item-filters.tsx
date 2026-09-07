import { ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_SORTS, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar, FilterField } from "@/components/common/filter-bar";

export type ItemFilterValues = {
  q?: string;
  university?: string;
  category?: string;
  condition?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
};

export function ItemFilters({ universities, values, hasFilters }: { universities: University[]; values: ItemFilterValues; hasFilters: boolean }) {
  return (
    <FilterBar action="/marketplace" hasFilters={hasFilters}>
      <FilterField label="Search">
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Mattress, desk, textbook…" />
      </FilterField>
      <FilterField label="Category">
        <Select name="category" defaultValue={values.category ?? ""}>
          <option value="">All categories</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
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
      <FilterField label="Condition">
        <Select name="condition" defaultValue={values.condition ?? ""}>
          <option value="">Any</option>
          {ITEM_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FilterField>
      <div className="grid grid-cols-2 gap-2">
        <FilterField label="Min price">
          <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
        </FilterField>
        <FilterField label="Max price">
          <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
        </FilterField>
      </div>
      <FilterField label="Sort by">
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {ITEM_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FilterField>
    </FilterBar>
  );
}

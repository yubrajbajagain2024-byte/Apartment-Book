import { ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_SORTS, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar, FilterLabel } from "@/components/common/filter-bar";

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
      <FilterLabel className="min-w-40 flex-1">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Mattress, desk, textbook…" />
      </FilterLabel>
      <FilterLabel className="min-w-44">
        Category
        <Select name="category" defaultValue={values.category ?? ""}>
          <option value="">All categories</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
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
      <FilterLabel className="w-32">
        Condition
        <Select name="condition" defaultValue={values.condition ?? ""}>
          <option value="">Any</option>
          {ITEM_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FilterLabel>
      <FilterLabel className="w-24">
        Min price
        <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
      </FilterLabel>
      <FilterLabel className="w-24">
        Max price
        <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
      </FilterLabel>
      <FilterLabel className="w-40">
        Sort by
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {ITEM_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FilterLabel>
    </FilterBar>
  );
}

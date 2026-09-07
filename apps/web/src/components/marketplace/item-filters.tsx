import { ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_SORTS, type University } from "@apartment-book/shared";
import { Input, Select } from "@/components/ui/input";
import { FilterBar } from "@/components/common/filter-bar";

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
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
        Search
        <Input name="q" defaultValue={values.q ?? ""} placeholder="Mattress, desk, textbook…" />
      </label>
      <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-gray-600">
        Category
        <Select name="category" defaultValue={values.category ?? ""}>
          <option value="">All categories</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
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
      <label className="flex w-32 flex-col gap-1 text-xs font-medium text-gray-600">
        Condition
        <Select name="condition" defaultValue={values.condition ?? ""}>
          <option value="">Any</option>
          {ITEM_CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex w-24 flex-col gap-1 text-xs font-medium text-gray-600">
        Min price
        <Input name="minPrice" type="number" min={0} defaultValue={values.minPrice ?? ""} placeholder="0" />
      </label>
      <label className="flex w-24 flex-col gap-1 text-xs font-medium text-gray-600">
        Max price
        <Input name="maxPrice" type="number" min={0} defaultValue={values.maxPrice ?? ""} placeholder="Any" />
      </label>
      <label className="flex w-40 flex-col gap-1 text-xs font-medium text-gray-600">
        Sort by
        <Select name="sort" defaultValue={values.sort ?? "newest"}>
          {ITEM_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>
    </FilterBar>
  );
}

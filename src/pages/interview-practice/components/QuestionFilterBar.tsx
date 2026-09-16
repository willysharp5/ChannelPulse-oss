import { useState } from "react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import {
  CATEGORY_LABELS,
  type BankCompany,
  type QuestionCategory,
  type QuestionDifficulty,
  type QuestionFilters,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import {
  Building2,
  Check,
  ChevronDown,
  ListChecks,
  Layers,
  Gauge,
  Milestone,
  TrendingUp,
  X,
} from "lucide-react";

const SENIORITY = [
  { value: "intern", label: "Intern" },
  { value: "new_grad", label: "New Grad" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff / Principal" },
  { value: "manager", label: "Manager+" },
];
const DIFFS: QuestionDifficulty[] = ["easy", "medium", "hard"];
const ALL = "__all__";

const TRIGGER =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-transparent px-3 text-xs shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface Props {
  companies: BankCompany[];
  facets: { roles: string[]; stages: string[] };
  value: QuestionFilters;
  onChange: (next: QuestionFilters) => void;
}

/** Searchable, MULTI-select company picker — type to filter, tick multiple. */
function CompanyMultiCombobox({
  companies,
  value,
  onChange,
}: {
  companies: BankCompany[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id]
    );
  const label =
    value.length === 0
      ? "Companies"
      : value.length === 1
        ? companies.find((c) => c.id === value[0])?.name ?? "1 company"
        : `${value.length} companies`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(TRIGGER, value.length ? "text-foreground" : "text-muted-foreground")}
        >
          <Building2 className="size-3.5 opacity-70" />
          <span className="max-w-[11rem] truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search companies…" className="h-9" />
          <CommandList>
            <CommandEmpty>No companies found.</CommandEmpty>
            {value.length > 0 ? (
              <CommandItem value="__clear companies" onSelect={() => onChange([])}>
                <X className="size-3.5" />
                Clear ({value.length})
              </CommandItem>
            ) : null}
            {companies.map((c) => (
              <CommandItem
                key={c.id}
                value={c.name}
                onSelect={() => toggle(c.id)}
              >
                <Check
                  className={cn(
                    "size-3.5",
                    value.includes(c.id) ? "opacity-100" : "opacity-0"
                  )}
                />
                {c.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Small multi-select popover (checkbox list) for category / difficulty. */
function MultiSelectPopover({
  icon: Icon,
  label,
  options,
  value,
  onChange,
  capitalize,
}: {
  icon: React.ElementType;
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  capitalize?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const text =
    value.length === 0
      ? label
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? `1 ${label}`
        : `${value.length} selected`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(TRIGGER, value.length ? "text-foreground" : "text-muted-foreground")}
        >
          <Icon className="size-3.5 opacity-70" />
          <span className="max-w-[9rem] truncate">{text}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                value.includes(o.value)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40"
              )}
            >
              {value.includes(o.value) ? <Check className="size-3" /> : null}
            </span>
            <span className={cn(capitalize && "capitalize")}>{o.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Dropdown filter toolbar over the whole question bank. */
export function QuestionFilterBar({ companies, facets, value, onChange }: Props) {
  const set = (key: keyof QuestionFilters, v: string) =>
    onChange({ ...value, [key]: v === ALL ? undefined : v });

  const active =
    !!value.companyId ||
    (value.companyIds?.length ?? 0) > 0 ||
    !!value.role ||
    !!value.category ||
    (value.categories?.length ?? 0) > 0 ||
    !!value.difficulty ||
    (value.difficulties?.length ?? 0) > 0 ||
    !!value.stage ||
    !!value.seniority;

  const trigger = "h-8 gap-1.5 rounded-full text-xs";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CompanyMultiCombobox
        companies={companies}
        value={value.companyIds ?? []}
        onChange={(ids) =>
          onChange({ ...value, companyIds: ids.length ? ids : undefined })
        }
      />

      <Select value={value.role ?? ALL} onValueChange={(v) => set("role", v)}>
        <SelectTrigger className={trigger} size="sm">
          <ListChecks className="size-3.5 opacity-70" />
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL}>Any role</SelectItem>
          {facets.roles.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <MultiSelectPopover
        icon={Layers}
        label="Type"
        options={(Object.keys(CATEGORY_LABELS) as QuestionCategory[]).map(
          (c) => ({ value: c, label: CATEGORY_LABELS[c] })
        )}
        value={value.categories ?? []}
        onChange={(cats) =>
          onChange({
            ...value,
            categories: cats.length
              ? (cats as QuestionCategory[])
              : undefined,
          })
        }
      />

      <MultiSelectPopover
        icon={Gauge}
        label="Difficulty"
        capitalize
        options={DIFFS.map((d) => ({ value: d, label: d }))}
        value={value.difficulties ?? []}
        onChange={(diffs) =>
          onChange({
            ...value,
            difficulties: diffs.length
              ? (diffs as QuestionDifficulty[])
              : undefined,
          })
        }
      />

      {facets.stages.length > 0 ? (
        <Select value={value.stage ?? ALL} onValueChange={(v) => set("stage", v)}>
          <SelectTrigger className={trigger} size="sm">
            <Milestone className="size-3.5 opacity-70" />
            <SelectValue placeholder="Round" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>Any round</SelectItem>
            {facets.stages.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select
        value={value.seniority ?? ALL}
        onValueChange={(v) => set("seniority", v)}
      >
        <SelectTrigger className={trigger} size="sm">
          <TrendingUp className="size-3.5 opacity-70" />
          <SelectValue placeholder="Seniority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any seniority</SelectItem>
          {SENIORITY.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-xs text-muted-foreground"
          onClick={() =>
            onChange({ query: value.query })
          }
        >
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

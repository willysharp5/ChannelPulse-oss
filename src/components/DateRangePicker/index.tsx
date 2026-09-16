import { useMemo, useState } from "react";
import moment, { type Moment } from "moment";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateRangeValue {
  from: Date | null;
  to: Date | null;
}

interface Preset {
  id: string;
  label: string;
  range: () => DateRangeValue;
}

const PRESETS: Preset[] = [
  { id: "all", label: "All time", range: () => ({ from: null, to: null }) },
  {
    id: "today",
    label: "Today",
    range: () => ({
      from: moment().startOf("day").toDate(),
      to: moment().endOf("day").toDate(),
    }),
  },
  {
    id: "yesterday",
    label: "Yesterday",
    range: () => ({
      from: moment().subtract(1, "day").startOf("day").toDate(),
      to: moment().subtract(1, "day").endOf("day").toDate(),
    }),
  },
  {
    id: "7d",
    label: "Last 7 days",
    range: () => ({
      from: moment().subtract(6, "days").startOf("day").toDate(),
      to: moment().endOf("day").toDate(),
    }),
  },
  {
    id: "30d",
    label: "Last 30 days",
    range: () => ({
      from: moment().subtract(29, "days").startOf("day").toDate(),
      to: moment().endOf("day").toDate(),
    }),
  },
  {
    id: "month",
    label: "This month",
    range: () => ({
      from: moment().startOf("month").toDate(),
      to: moment().endOf("month").toDate(),
    }),
  },
  {
    id: "year",
    label: "This year",
    range: () => ({
      from: moment().startOf("year").toDate(),
      to: moment().endOf("year").toDate(),
    }),
  },
];

const sameDay = (a: Date | null, b: Date | null) =>
  !!a && !!b && moment(a).isSame(moment(b), "day");

/** Friendly label for the trigger button. */
function labelFor(value: DateRangeValue): string {
  if (!value.from && !value.to) return "All time";
  // Match a named preset when the range lines up with one.
  for (const p of PRESETS) {
    const r = p.range();
    if (
      p.id !== "all" &&
      sameDay(r.from, value.from) &&
      sameDay(r.to, value.to)
    ) {
      return p.label;
    }
  }
  const from = value.from ? moment(value.from) : null;
  const to = value.to ? moment(value.to) : null;
  if (from && to) {
    if (from.isSame(to, "day")) return from.format("MMM D, YYYY");
    const sameYear = from.isSame(to, "year");
    return `${from.format("MMM D")} – ${to.format(
      sameYear ? "MMM D, YYYY" : "MMM D, YYYY"
    )}`;
  }
  if (from) return `From ${from.format("MMM D, YYYY")}`;
  if (to) return `Until ${to.format("MMM D, YYYY")}`;
  return "All time";
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * A large, friendly date-range picker: quick presets on the left and a real
 * month calendar on the right. Click a day to start a range, click another to
 * finish it. Dependency-free (built on moment + Popover).
 */
export const DateRangePicker = ({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Moment>(() =>
    moment(value.to || value.from || undefined).startOf("month")
  );

  const days = useMemo(() => {
    const start = viewMonth.clone().startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, i) => start.clone().add(i, "days"));
  }, [viewMonth]);

  const from = value.from ? moment(value.from) : null;
  const to = value.to ? moment(value.to) : null;

  const activePreset = PRESETS.find((p) => {
    const r = p.range();
    if (p.id === "all") return !value.from && !value.to;
    return sameDay(r.from, value.from) && sameDay(r.to, value.to);
  })?.id;

  const applyPreset = (p: Preset) => {
    onChange(p.range());
    setOpen(false);
  };

  const onDayClick = (day: Moment) => {
    // No range yet, or a complete range → start a new one.
    if (!value.from || (value.from && value.to)) {
      onChange({ from: day.clone().startOf("day").toDate(), to: null });
      return;
    }
    // We have a start but no end.
    const startM = moment(value.from);
    if (day.isBefore(startM, "day")) {
      onChange({
        from: day.clone().startOf("day").toDate(),
        to: startM.clone().endOf("day").toDate(),
      });
    } else {
      onChange({
        from: value.from,
        to: day.clone().endOf("day").toDate(),
      });
    }
  };

  const inRange = (day: Moment) =>
    from && to && day.isSameOrAfter(from, "day") && day.isSameOrBefore(to, "day");
  const isStart = (day: Moment) => from && day.isSame(from, "day");
  const isEnd = (day: Moment) => to && day.isSame(to, "day");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-10 justify-start gap-2 font-normal", className)}
        >
          <CalendarIcon className="size-4 text-primary" />
          <span className="truncate">{labelFor(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0" sideOffset={8}>
        <div className="flex flex-col sm:flex-row">
          {/* Presets */}
          <div className="flex shrink-0 flex-col gap-0.5 border-b border-border/60 p-2 sm:border-b-0 sm:border-r">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  activePreset === p.id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() =>
                  setViewMonth((m) => m.clone().subtract(1, "month"))
                }
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Previous month"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <span className="text-sm font-medium">
                {viewMonth.format("MMMM YYYY")}
              </span>
              <button
                onClick={() => setViewMonth((m) => m.clone().add(1, "month"))}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Next month"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="flex h-7 items-center justify-center text-2xs font-medium text-muted-foreground"
                >
                  {w}
                </div>
              ))}
              {days.map((day) => {
                const outside = !day.isSame(viewMonth, "month");
                const start = isStart(day);
                const end = isEnd(day);
                const within = inRange(day);
                const isToday = day.isSame(moment(), "day");
                return (
                  <button
                    key={day.format("YYYY-MM-DD")}
                    onClick={() => onDayClick(day)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors",
                      outside ? "text-muted-foreground/40" : "text-foreground",
                      within && !start && !end && "bg-primary/10",
                      (start || end) &&
                        "bg-primary text-primary-foreground hover:bg-primary",
                      !start && !end && "hover:bg-accent",
                      isToday && !start && !end && "ring-1 ring-primary/50"
                    )}
                  >
                    {day.date()}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-xs text-muted-foreground">
                {from
                  ? to
                    ? `${from.format("MMM D")} – ${to.format("MMM D, YYYY")}`
                    : `${from.format("MMM D, YYYY")} · pick end date`
                  : "Pick a start date"}
              </span>
              {(value.from || value.to) && (
                <button
                  onClick={() => onChange({ from: null, to: null })}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <XIcon className="size-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

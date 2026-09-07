import Link from "next/link";
import { Button, Field, Input, Select } from "@/components/ui";
import { AGENT_CATEGORIES } from "@/lib/domain/classify";
import { RULE_SET_V1 } from "@/lib/domain/inclusion";
import { ENTITY_FAMILIES, FAMILY_LABELS } from "@/lib/ilsos/layout";
import type { Filters } from "@/lib/queries/filters";

/**
 * The association filter bar.
 *
 * A plain GET form: the filter state lives in the URL, so any view is
 * shareable, bookmarkable and reproducible in an export.
 */
export function FilterBar({
  filters,
  runDates,
  statusCodes,
  action = "/associations",
}: {
  filters: Filters;
  runDates: string[];
  statusCodes: { code: string; count: number }[];
  action?: string;
}) {
  // The Active-only filter is meaningless until a status code list is mapped.
  const statusMappingAvailable = false;

  return (
    <form
      action={action}
      method="get"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
    >
      <input type="hidden" name="mode" value={filters.mode} />

      <Field label="Legal name contains">
        <Input name="q" defaultValue={filters.q ?? ""} placeholder="e.g. lake shore" />
      </Field>

      <Field label="Illinois file number">
        <Input name="fileNumber" defaultValue={filters.fileNumber ?? ""} placeholder="00123456" />
      </Field>

      <Field label="Entity family">
        <Select name="family" defaultValue={filters.family ?? ""}>
          <option value="">All families</option>
          {ENTITY_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {FAMILY_LABELS[family]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Association category">
        <Select name="signal" defaultValue={filters.signal ?? ""}>
          <option value="">Any inclusion signal</option>
          {RULE_SET_V1.rules.map((rule) => (
            <option key={rule.key} value={rule.key}>
              {rule.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Agent category">
        <Select name="category" defaultValue={filters.category ?? ""}>
          <option value="">Any category</option>
          {AGENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Exact registered agent">
        <Input
          name="agentExact"
          defaultValue={filters.agentExactName ?? ""}
          placeholder="exact source spelling"
        />
      </Field>

      <Field label="Normalized agent organization">
        <Input
          name="agent"
          defaultValue={filters.agentGroupingKey ?? ""}
          placeholder="grouping key"
        />
      </Field>

      <Field label="Reviewed status">
        <Select name="reviewed" defaultValue={filters.reviewed ?? ""}>
          <option value="">Reviewed and unreviewed</option>
          <option value="yes">Reviewed only</option>
          <option value="no">Not yet reviewed</option>
        </Select>
      </Field>

      <Field label="Entity status">
        <Select name="status" defaultValue={filters.statusCode ?? ""}>
          <option value="">Any status code</option>
          {statusCodes.map((status) => (
            <option key={status.code} value={status.code}>
              {status.code} — source code not yet mapped ({status.count.toLocaleString("en-US")})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Source run date">
        <Select name="runDate" defaultValue={filters.sourceRunDate ?? ""}>
          <option value="">Any run date</option>
          {runDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-1">
        <label className="flex items-center gap-2 text-xs text-ink-600">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={filters.includeArchived}
            className="rounded border-ink-300"
          />
          Include archived entities
        </label>
        <label
          className="flex items-center gap-2 text-xs text-ink-600"
          title="The roster matches on legal name alone, so it holds every association that ever existed. About a third are dissolved."
        >
          <input
            type="checkbox"
            name="standing"
            value="all"
            defaultChecked={filters.standing === "all"}
            disabled={!statusMappingAvailable}
            className="rounded border-ink-300"
          />
          Include dissolved and revoked entities
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          {/* A link, not a submit: navigating to the bare path is what clears
              the filter state, since the state lives entirely in the URL. */}
          <Link
            href={action}
            className="inline-flex items-center justify-center rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
          >
            Clear
          </Link>
        </div>
      </div>
    </form>
  );
}

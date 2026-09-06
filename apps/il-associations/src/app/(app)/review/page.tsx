import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  ProvisionalNotice,
  Select,
  Table,
  Td,
  Th,
  categoryTone,
  count,
  share,
} from "@/components/ui";
import { AGENT_CATEGORIES } from "@/lib/domain/classify";
import { listMergeCandidates, listReviewQueue } from "@/lib/queries/agents";
import { bulkSetOverride } from "@/lib/actions/agents";

export const dynamic = "force-dynamic";

const BUCKETS = [
  { key: "other", label: "Other organization / review" },
  { key: "low_confidence", label: "Low confidence" },
  { key: "unreviewed", label: "Not yet reviewed" },
  { key: "all", label: "All organizations" },
] as const;

type Bucket = (typeof BUCKETS)[number]["key"];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawBucket = Array.isArray(params.bucket) ? params.bucket[0] : params.bucket;
  const bucket: Bucket = BUCKETS.some((entry) => entry.key === rawBucket)
    ? (rawBucket as Bucket)
    : "other";
  const page = Number(Array.isArray(params.page) ? params.page[0] : (params.page ?? 1)) || 1;

  const [queue, mergeCandidates] = await Promise.all([
    listReviewQueue({ bucket, page }),
    listMergeCandidates(50),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-normal text-ink-900">Classification review</h1>

      <ProvisionalNotice />

      <Card>
        <CardBody className="text-xs text-ink-600">
          Automatic classification is deterministic and rule-based — no language model is used, so
          it is cheap, repeatable and fully explainable. It is also only a first pass. Work through
          the queues below before treating any market-share figure as final.
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((entry) => (
          <Link
            key={entry.key}
            href={`/review?bucket=${entry.key}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
              bucket === entry.key
                ? "bg-accent-600 text-white ring-accent-600"
                : "bg-white text-ink-700 ring-ink-300 hover:bg-ink-50"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title={`${count(queue.total)} organizations in this queue`}
          description={`Page ${queue.page} of ${queue.pageCount}. Tick rows and apply one category to all of them, or open an organization to review it individually.`}
        />

        {queue.rows.length === 0 ? (
          <CardBody>
            <EmptyState title="Nothing waiting in this queue." />
          </CardBody>
        ) : (
          <form action={bulkSetOverride}>
            <Table>
              <thead className="bg-ink-50">
                <tr>
                  <Th />
                  <Th>Organization</Th>
                  <Th>Automatic</Th>
                  <Th>Effective</Th>
                  <Th>Confidence</Th>
                  <Th align="right">Associations</Th>
                  <Th align="right">Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {queue.rows.map((row) => (
                  <tr key={row.organization_id} className="hover:bg-ink-50">
                    <Td>
                      <input
                        type="checkbox"
                        name="organizationId"
                        value={row.organization_id ?? ""}
                        aria-label={`Select ${row.display_name}`}
                        className="rounded border-ink-300"
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/agents/${row.organization_id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {row.display_name}
                      </Link>
                      <span className="block font-mono text-[11px] text-ink-400">
                        {row.grouping_key}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={categoryTone(row.automatic_category)}>
                        {row.automatic_category}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={categoryTone(row.effective_category)}>
                        {row.effective_category}
                      </Badge>
                      {row.reviewed_at ? (
                        <Badge tone="ok" className="ml-1">
                          reviewed
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-ink-500">{row.automatic_confidence}</Td>
                    <Td align="right">{count(row.association_count)}</Td>
                    <Td align="right">{share(row.share_percent)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="flex flex-wrap items-end gap-3 border-t border-ink-200 px-4 py-3">
              <div className="w-56">
                <label className="mb-1 block text-xs font-medium text-ink-600">
                  Set selected to
                </label>
                <Select name="category" required defaultValue="">
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {AGENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-72">
                <label className="mb-1 block text-xs font-medium text-ink-600">Review note</label>
                <Input name="note" placeholder="Applied to every selected organization" />
              </div>
              <Button type="submit" size="sm">
                Apply to selected
              </Button>
              <p className="text-xs text-ink-500">Every change is recorded in the audit log.</p>
            </div>
          </form>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-4 py-3 text-xs">
          {queue.page > 1 ? (
            <Link
              href={`/review?bucket=${bucket}&page=${queue.page - 1}`}
              className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
            >
              Previous
            </Link>
          ) : null}
          {queue.page < queue.pageCount ? (
            <Link
              href={`/review?bucket=${bucket}&page=${queue.page + 1}`}
              className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
            >
              Next
            </Link>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Possible duplicate normalizations"
          description="Organizations whose grouping keys differ only by a trailing phrase. These are suggestions only — approve an alias on the agent page to merge them."
        />
        {mergeCandidates.length === 0 ? (
          <CardBody className="text-xs text-ink-500">No near-duplicate groupings found.</CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Organization A</Th>
                <Th align="right">A count</Th>
                <Th>Organization B</Th>
                <Th align="right">B count</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {mergeCandidates.map((pair) => (
                <tr key={`${pair.a_id}-${pair.b_id}`}>
                  <Td>
                    <Link href={`/agents/${pair.a_id}`} className="text-accent-700 hover:underline">
                      {pair.a_name}
                    </Link>
                  </Td>
                  <Td align="right">{count(pair.a_count)}</Td>
                  <Td>
                    <Link href={`/agents/${pair.b_id}`} className="text-accent-700 hover:underline">
                      {pair.b_name}
                    </Link>
                  </Td>
                  <Td align="right">{count(pair.b_count)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

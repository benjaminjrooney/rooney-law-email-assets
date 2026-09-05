import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getStorage } from "@/lib/storage";

/**
 * Stream one artifact of an export run.
 *
 * Downloads go through the app rather than a public object URL so they stay
 * behind authentication. Where the storage driver can issue a signed URL, the
 * request is redirected to it instead of proxying the bytes.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id, index } = await context.params;
  const sql = getSql();
  const [run] = await sql<
    { artifacts: { name: string; storageKey: string; byteSize: number }[] }[]
  >`SELECT artifacts FROM export_runs WHERE id = ${Number(id)}`;

  const artifact = run?.artifacts?.[Number(index)];
  if (!artifact) {
    return NextResponse.json({ error: "No such export artifact." }, { status: 404 });
  }

  const storage = getStorage();
  const signed = await storage.signedUrl(artifact.storageKey, 300);
  if (signed) return NextResponse.redirect(signed);

  const stream = await storage.get(artifact.storageKey);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "content-type": contentTypeFor(artifact.name),
      "content-length": String(artifact.byteSize),
      "content-disposition": `attachment; filename="${artifact.name.replace(/"/g, "")}"`,
    },
  });
}

function contentTypeFor(name: string): string {
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (name.endsWith(".zip")) return "application/zip";
  if (name.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

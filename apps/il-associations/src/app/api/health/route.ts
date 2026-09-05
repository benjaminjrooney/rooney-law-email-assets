import { NextResponse } from "next/server";

/** Railway health check. Deliberately does not touch the database. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "il-associations" });
}

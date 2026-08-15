import { NextResponse } from "next/server";
import { runAgent } from "@/lib/runAgent";
import { AgentError, InputFormData } from "@/lib/types";

// Discovery runs server-side: browsers forbid setting the User-Agent header
// that the Nominatim and Overpass usage policies require, and this keeps the
// upstream services off the client's origin entirely.
export async function POST(request: Request) {
  const input = (await request.json()) as InputFormData;

  if (!input.location?.trim()) {
    return NextResponse.json(
      { error: { kind: "location_not_found", message: "Please enter a location." } },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await runAgent(input));
  } catch (e) {
    if (e instanceof AgentError) {
      return NextResponse.json({ error: { kind: e.kind, message: e.message } }, { status: 400 });
    }
    console.error("Unexpected search failure:", e);
    return NextResponse.json(
      {
        error: {
          kind: "network",
          message: "An unexpected error occurred. Please try again.",
        },
      },
      { status: 500 }
    );
  }
}

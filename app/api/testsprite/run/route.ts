import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const runnerUrl = process.env.RAILWAY_RUNNER_URL;
  if (!runnerUrl) {
    return NextResponse.json(
      { error: "Runner service is not configured (RAILWAY_RUNNER_URL missing)." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const res = await fetch(`${runnerUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach the runner service. Please try again." },
      { status: 502 }
    );
  }
}

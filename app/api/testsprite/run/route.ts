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
    const res = await fetch(`${runnerUrl.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    let data: unknown = { message: raw };
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { error: "Runner returned invalid JSON.", raw: raw.slice(0, 500) };
      }
    }

    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach the runner service.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}

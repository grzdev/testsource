import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const runnerUrl = process.env.RAILWAY_RUNNER_URL;
  if (!runnerUrl) {
    return NextResponse.json(
      { error: "Runner service is not configured (RAILWAY_RUNNER_URL missing)." },
      { status: 503 }
    );
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Job ID required." }, { status: 400 });
  }

  try {
    const res = await fetch(`${runnerUrl}/jobs/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Normalise to the shape the TestSpriteRunner component expects
    return NextResponse.json({
      id: data.id,
      status: data.status,
      stage: data.stage,
      logs: data.logs ?? [],
      error: data.error ?? null,
      results: data.results ?? null,
      proxyUrl: data.proxyUrl ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach the runner service. Please try again." },
      { status: 502 }
    );
  }
}

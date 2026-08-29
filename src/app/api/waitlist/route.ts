import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES = new Set(["reel", "waitlist", "home"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      email?: unknown;
      source?: unknown;
      website?: unknown;
    };

    if (typeof body.website === "string" && body.website.length > 0) {
      return NextResponse.json({ ok: true });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const source = typeof body.source === "string" && VALID_SOURCES.has(body.source)
      ? body.source
      : "waitlist";
    const createdAt = new Date().toISOString();
    const pathname = `waitlist/${createdAt.slice(0, 10)}/${Date.now()}-${randomUUID()}.json`;

    await put(pathname, JSON.stringify({ email, source, createdAt }), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });

    return NextResponse.json({ ok: true }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "The waitlist is busy. Try again in a moment." },
      { status: 503 },
    );
  }
}

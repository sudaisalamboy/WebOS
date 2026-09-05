import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    message: "WebOS API",
    credits: {
      madeBy: "Sudais Alam",
      builtWith: "AIFuzX"
    }
  });
}
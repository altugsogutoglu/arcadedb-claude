import { NextResponse } from "next/server";
import { getUsers } from "../../../lib/db";
import { validateUser } from "../../../lib/validate";

export async function GET() {
  const users = await getUsers();
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const body = await req.json();
  validateUser(body);
  return NextResponse.json({ ok: true });
}

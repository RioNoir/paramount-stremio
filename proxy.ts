import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  console.log(`${request.method} ${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

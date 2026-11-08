// web/proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPreviewHarnessPath, previewHarnessAllowed } from "@/lib/paperpal/preview-guard";

export async function proxy(request: NextRequest) {
  if (isPreviewHarnessPath(request.nextUrl.pathname)) {
    if (!previewHarnessAllowed(request.headers.get("host"))) {
      return new NextResponse("Not found", { status: 404 });
    }
    const preview = NextResponse.next();
    preview.headers.set("Content-Security-Policy", "connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'");
    preview.headers.set("Cache-Control", "private, no-store");
    preview.headers.set("X-Robots-Tag", "noindex, nofollow");
    return preview;
  }
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => request.cookies.get(name)?.value,
        set: (name, value, options) => {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove: (name, options) => {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  // /me/* is reached straight from an email footer, so an expired session is
  // the common case, not the edge case — bounce to the magic-link form rather
  // than rendering an empty roster-less page.
  const protectedPath = request.nextUrl.pathname.startsWith("/dashboard")
    || request.nextUrl.pathname.startsWith("/availability")
    || request.nextUrl.pathname.startsWith("/me")
    || request.nextUrl.pathname.startsWith("/admin");

  if (protectedPath && !session) {
    const redirect = new URL("/", request.url);
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|papers).*)"],
};

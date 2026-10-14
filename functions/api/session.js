
export async function onRequestGet(context) {
  const urlConfigured =
    typeof context.env.SUPABASE_URL === "string" &&
    context.env.SUPABASE_URL.startsWith("https://");

  const secretConfigured =
    typeof context.env.SUPABASE_SECRET_KEY === "string" &&
    context.env.SUPABASE_SECRET_KEY.length > 0;

  const ready = urlConfigured && secretConfigured;

  return new Response(
    JSON.stringify({
      authenticated: false,
      server_configured: ready,
      message: ready
        ? "VRiichi! backend configuration is ready."
        : "VRiichi! backend configuration is incomplete."
    }),
    {
      status: ready ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

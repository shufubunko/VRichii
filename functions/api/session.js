
export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      authenticated: false,
      message: "A verified player session is required."
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}

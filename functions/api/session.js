
export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      authenticated: false,
      message: "VRiichi! session verification is not yet enabled."
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

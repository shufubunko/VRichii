
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function sha256(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestGet({ request, env }) {
  const cookies = request.headers.get("Cookie") || "";

  const token = cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("vriichi_session="))
    ?.slice("vriichi_session=".length);

  // Never accept an absent or malformed session.
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return json({
      authenticated: false,
      message: "Player login required."
    }, 401);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return json({
      authenticated: false,
      message: "Authentication temporarily unavailable."
    }, 503);
  }

  try {
    const tokenHash = await sha256(token);

    const endpoint = new URL(
      `${env.SUPABASE_URL}/rest/v1/game_sessions`
    );

    endpoint.searchParams.set(
      "select",
      "player_id,expires_at,revoked_at"
    );
    endpoint.searchParams.set(
      "token_hash",
      `eq.${tokenHash}`
    );
    endpoint.searchParams.set("limit", "1");

    const result = await fetch(endpoint, {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!result.ok) {
      return json({
        authenticated: false,
        message: "Authentication service unavailable."
      }, 503);
    }

    const sessions = await result.json();
    const session = sessions[0];

    if (
      !session ||
      session.revoked_at !== null ||
      !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= Date.now()
    ) {
      return json({
        authenticated: false,
        message: "Session expired or invalid."
      }, 401);
    }

    return json({
      authenticated: true,
      player_id: session.player_id,
    });
  } catch (error) {
    console.error("Session verification failed");

    return json({
      authenticated: false,
      message: "Authentication service unavailable."
    }, 503);
  }
}

import { createClient } from "jsr:@supabase/supabase-js@2";

const CLIENT_ID = "dad4b417c6ee01d8ab4659320979d311";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CALLBACK =
  `${PROJECT_URL}/functions/v1/itch-callback`;

const PORTAL = "https://vriichi-auth.pages.dev";

function reply(message: string, status = 200): Response {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

  for (const name of [
    "vriichi_oauth_state",
    "vriichi_link_state",
  ]) {
    for (const path of [
      "/functions/v1",
      "/functions/v1/itch-callback",
    ]) {
      headers.append(
        "Set-Cookie",
        `${name}=; HttpOnly; Secure; SameSite=Lax; ` +
        `Path=${path}; Max-Age=0`
      );
    }
  }

  return new Response(message, { status, headers });
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(digest));
}

function getCookie(request: Request, name: string) {
  const parts = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim());

  const entry = parts.find(
    (part) => part.startsWith(`${name}=`)
  );

  return entry?.slice(name.length + 1) ?? null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") {
    return reply("Method not allowed", 405);
  }

  const url = new URL(request.url);

  if (url.searchParams.has("error")) {
    return reply("itch.io authorization was cancelled.", 400);
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!state || !code ||
      !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    return reply("Invalid authorization response.", 403);
  }

  const loginCookie = getCookie(
    request, "vriichi_oauth_state"
  );

  const linkCookie = getCookie(
    request, "vriichi_link_state"
  );

  if (state !== loginCookie && state !== linkCookie) {
    return reply("Login state did not match.", 403);
  }

  let accessToken: string | null = null;

  try {
    if (!PROJECT_URL || !SERVICE_KEY) {
      return reply("Server configuration unavailable.", 503);
    }

    const admin = createClient(PROJECT_URL, SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Consume the OAuth attempt only once.
    const stateHash = await hash(state);

    const { data: attempt, error: attemptError } =
      await admin
        .from("itch_oauth_attempts")
        .delete()
        .eq("state_hash", stateHash)
        .gt("expires_at", new Date().toISOString())
        .select("code_verifier, purpose, player_id")
        .maybeSingle();

    if (attemptError || !attempt) {
      return reply("Authorization expired or already used.", 403);
    }

    const isLink = attempt.purpose === "link";

    if (isLink) {
      if (state !== linkCookie || !attempt.player_id) {
        return reply("Invalid account-linking request.", 403);
      }
    } else if (
      attempt.purpose !== "login" ||
      state !== loginCookie
    ) {
      return reply("Invalid login request.", 403);
    }

    // Exchange authorization code using PKCE.
    const tokenResponse = await fetch(
      "https://api.itch.io/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: attempt.code_verifier,
          redirect_uri: CALLBACK,
          client_id: CLIENT_ID,
        }),
      }
    );

    if (!tokenResponse.ok) {
      return reply("itch.io authorization failed.", 401);
    }

    const tokenData = await tokenResponse.json();

    if (typeof tokenData.access_token !== "string") {
      return reply("Invalid itch.io token response.", 401);
    }

    accessToken = tokenData.access_token;

    // Identify the account directly with itch.io.
    const profileResponse = await fetch(
      "https://api.itch.io/profile",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!profileResponse.ok) {
      return reply("Could not verify itch.io account.", 401);
    }

    const profileData = await profileResponse.json();
    const itchUser = profileData.user;

    if (
      !itchUser ||
      !Number.isSafeInteger(itchUser.id) ||
      typeof itchUser.username !== "string"
    ) {
      return reply("Invalid itch.io profile.", 401);
    }

    if (!isLink) {
      return reply(
        "VRiichi! itch.io identity verified!\n\n" +
        `Username: ${itchUser.username}\n\n` +
        "Game session integration is coming next."
      );
    }

    const playerId = attempt.player_id;
    const itchId = String(itchUser.id);

    // Check whether the identity is already linked.
    const { data: existing, error: lookupError } =
      await admin
        .from("player_identities")
        .select("player_id")
        .eq("provider", "itch")
        .eq("provider_user_id", itchId)
        .maybeSingle();

    if (lookupError) {
      return reply("Could not check account link.", 500);
    }

    if (existing) {
      if (existing.player_id === playerId) {
        return reply(
          "This itch.io account is already linked " +
          "to your VRiichi! profile.\n\n" +
          `Return to ${PORTAL}`
        );
      }

      return reply(
        "This itch.io account is linked " +
        "to another VRiichi! account.",
        409
      );
    }

    // Insert only. Never overwrite an existing link.
    // Database UNIQUE constraints guard races.
    const { error: insertError } = await admin
      .from("player_identities")
      .insert({
        player_id: playerId,
        provider: "itch",
        provider_user_id: itchId,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return reply(
          "An account link already exists. " +
          "No changes were made.",
          409
        );
      }

      console.error("Account linking failed", insertError.code);
      return reply("Could not save account link.", 500);
    }

    return reply(
      "VRiichi! Account Linked Successfully!\n\n" +
      `itch.io: ${itchUser.username}\n` +
      "Your existing player profile was preserved.\n\n" +
      `Return to ${PORTAL}`
    );
  } catch (error) {
    console.error("OAuth callback error", error);
    return reply("Account verification failed.", 500);
  } finally {
    // Discard the verification token after use.
    if (accessToken) {
      try {
        await fetch("https://api.itch.io/oauth/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            token: accessToken,
          }),
        });
      } catch {
        console.error("Token revocation failed");
      }
    }
  }
});

const crypto = require("crypto");

const COOKIE_SESSION = "ynex_rbx_session";
const COOKIE_TX = "ynex_rbx_oauth_tx";
const OAUTH_BASE = "https://apis.roblox.com/oauth/v1";

function secret() {
  return process.env.ROBLOX_SESSION_SECRET || "";
}
function key() {
  if (!secret()) throw new Error("ROBLOX_SESSION_SECRET não configurado.");
  return crypto.createHash("sha256").update(secret()).digest();
}
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
function unseal(value) {
  try {
    const data = Buffer.from(value, "base64url");
    if (data.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const clear = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(clear);
  } catch (_) { return null; }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([name]) => name));
}
function setCookie(res, name, value, maxAge, path = "/api") {
  const current = res.getHeader("Set-Cookie");
  const item = `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
  res.setHeader("Set-Cookie", current ? (Array.isArray(current) ? [...current, item] : [current, item]) : item);
}
function clearCookie(res, name, path = "/api") {
  setCookie(res, name, "", 0, path);
}
function configError(res) {
  const missing = ["ROBLOX_CLIENT_ID", "ROBLOX_CLIENT_SECRET", "ROBLOX_REDIRECT_URI", "ROBLOX_SESSION_SECRET"]
    .filter(name => !process.env[name]);
  if (!missing.length) return false;
  res.status(503).send(`<!doctype html><meta charset="utf-8"><title>Configuração necessária</title><body style="font:16px Arial;background:#080b14;color:#fff;padding:40px"><h2>Login Roblox ainda não configurado</h2><p>Configure as variáveis de ambiente na Vercel: ${missing.join(", ")}.</p><p>Depois, tente novamente.</p></body>`);
  return true;
}
async function tokenRequest(params) {
  const body = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID,
    client_secret: process.env.ROBLOX_CLIENT_SECRET,
    ...params
  });
  const response = await fetch(OAUTH_BASE + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body,
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "O Roblox não autorizou a sessão.");
  return payload;
}
function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  return res.end();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const action = String(req.query?.action || "session");
  const jar = cookies(req);

  if (action === "logout") {
    const current = unseal(jar[COOKIE_SESSION]);
    if (current?.accessToken && process.env.ROBLOX_CLIENT_ID && process.env.ROBLOX_CLIENT_SECRET) {
      try {
        const revokeBody = new URLSearchParams({
          client_id: process.env.ROBLOX_CLIENT_ID,
          client_secret: process.env.ROBLOX_CLIENT_SECRET,
          token: current.accessToken,
          token_type_hint: "access_token"
        });
        await fetch(OAUTH_BASE + "/token/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: revokeBody,
          signal: AbortSignal.timeout(8000)
        });
      } catch (_) {}
    }
    clearCookie(res, COOKIE_SESSION);
    return redirect(res, "/?roblox=logout");
  }

  if (configError(res)) return;

  if (action === "start") {
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    setCookie(res, COOKIE_TX, seal({ state, verifier, exp: Date.now() + 10 * 60 * 1000 }), 600);
    const url = new URL("https://apis.roblox.com/oauth/v1/authorize");
    url.search = new URLSearchParams({
      client_id: process.env.ROBLOX_CLIENT_ID,
      redirect_uri: process.env.ROBLOX_REDIRECT_URI,
      scope: "openid profile",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state
    }).toString();
    return redirect(res, url.toString());
  }

  if (action === "callback") {
    const tx = unseal(jar[COOKIE_TX]);
    clearCookie(res, COOKIE_TX);
    if (req.query?.error || !req.query?.code || !tx || tx.exp < Date.now() || req.query?.state !== tx.state) {
      return redirect(res, "/?roblox=error");
    }
    try {
      const tokens = await tokenRequest({
        grant_type: "authorization_code",
        code: String(req.query.code),
        redirect_uri: process.env.ROBLOX_REDIRECT_URI,
        code_verifier: tx.verifier
      });
      const profileResponse = await fetch(OAUTH_BASE + "/userinfo", {
        headers: { Authorization: "Bearer " + tokens.access_token, Accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      const profile = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profile.sub) throw new Error("Não foi possível confirmar o perfil Roblox.");
      const session = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + Number(tokens.expires_in || 900) * 1000,
        user: {
          id: String(profile.sub),
          name: profile.preferred_username || profile.nickname || profile.name || "Roblox user",
          displayName: profile.name || profile.nickname || profile.preferred_username || "Roblox user",
          picture: profile.picture || null,
          profile: profile.profile || ("https://www.roblox.com/users/" + encodeURIComponent(profile.sub) + "/profile")
        }
      };
      setCookie(res, COOKIE_SESSION, seal(session), 60 * 60 * 24 * 7);
      return redirect(res, "/?roblox=connected");
    } catch (error) {
      return redirect(res, "/?roblox=error");
    }
  }

  if (action === "session") {
    let session = unseal(jar[COOKIE_SESSION]);
    if (!session?.user || !session.refreshToken) return res.status(401).json({ authenticated: false });
    try {
      if (session.expiresAt < Date.now() + 60000) {
        const refreshed = await tokenRequest({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken
        });
        session.accessToken = refreshed.access_token;
        session.refreshToken = refreshed.refresh_token || session.refreshToken;
        session.expiresAt = Date.now() + Number(refreshed.expires_in || 900) * 1000;
        setCookie(res, COOKIE_SESSION, seal(session), 60 * 60 * 24 * 7);
      }
      return res.status(200).json({ authenticated: true, user: session.user });
    } catch (_) {
      clearCookie(res, COOKIE_SESSION);
      return res.status(401).json({ authenticated: false, error: "Sua sessão expirou. Entre novamente." });
    }
  }

  return res.status(400).json({ error: "Ação inválida." });
};

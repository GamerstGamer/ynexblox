module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username || username.length > 20 || !/^[A-Za-z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Informe um nome de usuário Roblox válido." });
  }

  try {
    const upstream = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        usernames: [username],
        excludeBannedUsers: false
      }),
      signal: AbortSignal.timeout(10000)
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload || !Array.isArray(payload.data)) {
      return res.status(upstream.status === 429 ? 429 : 502).json({
        error: upstream.status === 429
          ? "O Roblox está recebendo muitas consultas. Tente novamente em instantes."
          : "O serviço do Roblox está temporariamente indisponível."
      });
    }

    const player = payload.data[0];
    if (!player || !Number.isFinite(Number(player.id))) {
      return res.status(404).json({ error: "Usuário não encontrado. Confira o nome e tente novamente." });
    }

    return res.status(200).json({
      id: Number(player.id),
      name: player.name,
      displayName: player.displayName
    });
  } catch (error) {
    return res.status(502).json({
      error: error.name === "TimeoutError"
        ? "O Roblox demorou para responder. Tente novamente."
        : "Não foi possível consultar o Roblox agora."
    });
  }
};

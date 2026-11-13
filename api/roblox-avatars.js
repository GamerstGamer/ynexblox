module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const submitted = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!submitted.length || submitted.length > 100) {
    return res.status(400).json({ error: "Envie entre 1 e 100 usuários." });
  }

  const users = submitted
    .filter(item => item && typeof item.name === "string" && /^[A-Za-z0-9_]{3,20}$/.test(item.name))
    .map(item => ({
      name: item.name,
      userId: /^\d{1,20}$/.test(String(item.userId || "")) ? String(item.userId) : null
    }));
  if (!users.length) return res.status(400).json({ error: "Nenhum nome de usuário válido." });

  const getJson = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("Roblox API respondeu " + response.status);
    return response.json();
  };

  const unresolved = users.filter(user => !user.userId);
  for (let offset = 0; offset < unresolved.length; offset += 50) {
    const batch = unresolved.slice(offset, offset + 50);
    try {
      const lookup = await getJson("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: batch.map(user => user.name),
          excludeBannedUsers: false
        })
      });
      (lookup.data || []).forEach(found => {
        const match = users.find(user => user.name.toLowerCase() === String(found.name || "").toLowerCase());
        if (match && found.id) match.userId = String(found.id);
      });
    } catch (_) {
      // Continue: entries that already have a saved userId can still receive thumbnails.
    }
  }

  const ids = [...new Set(users.map(user => user.userId).filter(Boolean))];
  const images = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    try {
      const params = new URLSearchParams({
        userIds: batch.join(","),
        size: "48x48",
        format: "Png",
        isCircular: "true"
      });
      const thumbnails = await getJson("https://thumbnails.roblox.com/v1/users/avatar-headshot?" + params.toString());
      (thumbnails.data || []).forEach(item => {
        if (item.targetId && item.imageUrl && item.state === "Completed") {
          images.set(String(item.targetId), item.imageUrl);
        }
      });
    } catch (_) {
      // Return resolved IDs even if Roblox has not generated a thumbnail yet.
    }
  }

  return res.status(200).json({
    data: users.map(user => ({
      name: user.name,
      userId: user.userId,
      imageUrl: user.userId ? (images.get(user.userId) || null) : null
    }))
  });
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const userId = String(req.query?.userId || "");
  const view = String(req.query?.view || "friends");
  const cursor = String(req.query?.cursor || "");
  if (!/^\d{1,20}$/.test(userId)) {
    return res.status(400).json({ error: "ID de usuário Roblox inválido." });
  }
  if (!["friends", "followers", "following"].includes(view)) {
    return res.status(400).json({ error: "Lista social inválida." });
  }

  const get = async url => {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const error = new Error("Roblox API " + response.status);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const base = "https://friends.roblox.com/v1/users/" + encodeURIComponent(userId);
  const countPaths = [
    ["friends", base + "/friends/count"],
    ["followers", base + "/followers/count"],
    ["following", base + "/followings/count"]
  ];
  const countResults = await Promise.allSettled(countPaths.map(([, url]) => get(url)));
  const counts = {};
  countPaths.forEach(([key], index) => {
    const result = countResults[index];
    counts[key] = result.status === "fulfilled" ? Number(result.value?.count ?? 0) : null;
  });

  const endpoint = view === "friends" ? "/friends" : view === "followers" ? "/followers" : "/followings";
  const params = new URLSearchParams({ limit: "30", sortOrder: view === "friends" ? "Asc" : "Desc" });
  if (cursor) params.set("cursor", cursor);

  let list = [];
  let nextPageCursor = null;
  let listError = null;
  try {
    const payload = await get(base + endpoint + "?" + params.toString());
    list = Array.isArray(payload?.data) ? payload.data : [];
    nextPageCursor = payload?.nextPageCursor || null;
  } catch (error) {
    listError = error.status === 401 || error.status === 403
      ? "O Roblox exige uma sessão própria para exibir esta lista. O login OAuth do site não concede essa permissão."
      : "Esta lista está temporariamente indisponível pela API do Roblox.";
  }

  if (list.length) {
    try {
      const ids = list.map(user => String(user.id)).filter(id => /^\d+$/.test(id));
      const thumbUrl = "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
        encodeURIComponent(ids.join(",")) + "&size=150x150&format=Png&isCircular=true";
      const thumbPayload = await get(thumbUrl);
      const thumbs = new Map((thumbPayload.data || []).map(item => [String(item.targetId), item.imageUrl]));
      list = list.map(user => ({
        id: String(user.id),
        name: String(user.name || ""),
        displayName: String(user.displayName || user.name || ""),
        avatar: thumbs.get(String(user.id)) || null
      }));
    } catch (_) {
      list = list.map(user => ({
        id: String(user.id),
        name: String(user.name || ""),
        displayName: String(user.displayName || user.name || ""),
        avatar: null
      }));
    }
  }

  return res.status(200).json({
    view,
    users: list,
    nextPageCursor,
    counts,
    listError,
    partialCounts: countResults.some(result => result.status !== "fulfilled")
  });
};

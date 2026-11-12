module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const userId = String(req.query?.userId || "");
  if (!/^\d{1,20}$/.test(userId)) {
    return res.status(400).json({ error: "ID de usuário Roblox inválido." });
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

  return res.status(200).json({
    counts,
    partialCounts: countResults.some(result => result.status !== "fulfilled")
  });
};

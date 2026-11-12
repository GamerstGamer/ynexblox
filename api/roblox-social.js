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
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Roblox API " + response.status);
    return response.json();
  };
  const base = "https://friends.roblox.com/v1/users/" + encodeURIComponent(userId);
  const [friends, friendCount, followerCount, followingCount] = await Promise.allSettled([
    get(base + "/friends?limit=100&sortOrder=Asc"),
    get(base + "/friends/count"),
    get(base + "/followers/count"),
    get(base + "/followings/count")
  ]);
  const count = result => result.status === "fulfilled" ? Number(result.value?.count ?? 0) : null;
  return res.status(200).json({
    friends: friends.status === "fulfilled" && Array.isArray(friends.value?.data)
      ? friends.value.data.slice(0, 100).map(user => ({
          id: String(user.id),
          name: String(user.name || ""),
          displayName: String(user.displayName || user.name || "")
        }))
      : [],
    counts: {
      friends: count(friendCount),
      followers: count(followerCount),
      following: count(followingCount)
    },
    partial: {
      friends: friends.status !== "fulfilled",
      friendCount: friendCount.status !== "fulfilled",
      followers: followerCount.status !== "fulfilled",
      following: followingCount.status !== "fulfilled"
    }
  });
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const profileUrl = "https://www.tiktok.com/@alanstly";
    const endpoint = "https://pulse.walls.sh/profile?url=" + encodeURIComponent(profileUrl);
    const response = await fetch(endpoint, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("TikTok stats provider returned " + response.status);

    const data = await response.json();
    if (data.content_unavailable || data.error || data.platform && data.platform !== "tiktok") {
      throw new Error("Profile data is temporarily unavailable");
    }

    const followers = Number(data.followers);
    const likes = Number(data.likes);
    if (!Number.isFinite(followers) || !Number.isFinite(likes)) {
      throw new Error("The provider did not return profile statistics");
    }

    return res.status(200).json({
      username: data.handle || "alanstly",
      followers,
      likes,
      fetchedAt: data.fetchedAt || new Date().toISOString()
    });
  } catch (error) {
    return res.status(502).json({ error: "Não foi possível atualizar os dados do TikTok agora." });
  }
};

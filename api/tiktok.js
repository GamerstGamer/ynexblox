module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=300");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const profileUrl = "https://www.tiktok.com/@alanstly";
    const endpoint = "https://pulse.walls.sh/profile?url=" + encodeURIComponent(profileUrl);
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "YNeXBlox/1.0" }
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error || data.content_unavailable || data.platform !== "tiktok") {
      return res.status(response.status === 429 ? 429 : 502).json({
        error: data.error || "O provedor não conseguiu consultar o perfil público."
      });
    }

    const followers = Number(data.followers);
    const likes = Number(data.likes);
    if (!Number.isFinite(followers) || !Number.isFinite(likes) || followers < 0 || likes < 0) {
      return res.status(502).json({ error: "O provedor não retornou seguidores e curtidas válidos." });
    }

    return res.status(200).json({
      username: data.handle || "alanstly",
      followers,
      likes,
      fetchedAt: data.fetchedAt || new Date().toISOString()
    });
  } catch (error) {
    return res.status(502).json({ error: "Falha ao consultar o serviço externo do TikTok." });
  }
};

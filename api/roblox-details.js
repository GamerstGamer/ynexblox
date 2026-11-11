module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = Number(req.body?.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID de usuário Roblox inválido." });
  }

  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Accept": "application/json",
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Roblox API returned " + response.status);
    return response.json();
  };

  const postJson = (url, body) => fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const classifyAsset = assetType => {
    const typeId = Number(
      assetType && typeof assetType === "object"
        ? (assetType.id ?? assetType.assetTypeId)
        : assetType
    );
    const typeName = String(
      assetType && typeof assetType === "object"
        ? (assetType.name ?? assetType.type ?? "")
        : ""
    ).toLowerCase().replace(/[^a-z]/g, "");

    if (typeName.includes("emote") || typeId === 61) return "emotes";

    const clothingIds = new Set([2, 11, 12, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
    const accessoryIds = new Set([8, 41, 42, 43, 44, 45, 46, 47, 76, 77]);

    if (
      clothingIds.has(typeId) ||
      /^(tshirt|shirt|pants|jacket|sweater|shorts|dressskirt|leftshoe|rightshoe).*accessory$/.test(typeName) ||
      ["tshirt", "shirt", "pants", "jacket", "sweater", "shorts"].includes(typeName)
    ) return "clothing";

    if (
      accessoryIds.has(typeId) ||
      typeName.includes("accessory") ||
      ["hat", "hair", "face", "neck", "shoulder", "front", "back", "waist"].includes(typeName)
    ) return "accessories";

    return "items";
  };

  try {
    const [avatarResult, wearingResult, presenceResult, profileResult] = await Promise.allSettled([
      fetchJson("https://thumbnails.roblox.com/v1/users/avatar?userIds=" + userId + "&size=420x420&format=Png&isCircular=false"),
      fetchJson("https://avatar.roblox.com/v1/users/" + userId + "/currently-wearing"),
      postJson("https://presence.roblox.com/v1/presence/users", { userIds: [userId] }),
      fetchJson("https://users.roblox.com/v1/users/" + userId)
    ]);

    const avatarData = avatarResult.status === "fulfilled" ? avatarResult.value?.data?.[0] : null;
    const assetIds = wearingResult.status === "fulfilled" && Array.isArray(wearingResult.value?.assetIds)
      ? wearingResult.value.assetIds.filter(id => Number.isSafeInteger(Number(id))).slice(0, 30).map(Number)
      : [];

    let itemDetails = [];
    if (assetIds.length) {
      try {
        const catalog = await postJson("https://catalog.roblox.com/v1/catalog/items/details", {
          items: assetIds.map(id => ({ itemType: "Asset", id }))
        });
        itemDetails = Array.isArray(catalog.data) ? catalog.data : [];
      } catch (error) {
        itemDetails = [];
      }

      // A API de catálogo pode omitir alguns itens. Busca os nomes ausentes
      // individualmente na API de economia do Roblox como alternativa.
      const knownIds = new Set(
        itemDetails
          .filter(item => item && item.name)
          .map(item => Number(item.id))
      );
      const missingIds = assetIds.filter(id => !knownIds.has(id));

      const fallbackDetails = await Promise.allSettled(
        missingIds.map(async id => {
          const detail = await fetchJson(
            "https://economy.roblox.com/v2/assets/" + id + "/details"
          );
          return {
            id,
            name: detail.Name || detail.name || null,
            assetType: detail.AssetTypeId || null
          };
        })
      );

      for (const result of fallbackDetails) {
        if (result.status === "fulfilled" && result.value.name) {
          itemDetails.push(result.value);
        }
      }
    }

    let itemImages = [];
    if (assetIds.length) {
      try {
        const thumbs = await fetchJson(
          "https://thumbnails.roblox.com/v1/assets?assetIds=" + assetIds.join(",") + "&size=150x150&format=Png"
        );
        itemImages = Array.isArray(thumbs.data) ? thumbs.data : [];
      } catch (error) {
        itemImages = [];
      }
    }

    const imageById = new Map(itemImages.map(item => [Number(item.targetId), item.imageUrl]));
    const items = assetIds.map(id => {
      const detail = itemDetails.find(item => Number(item.id) === id) || {};
      return {
        id,
        name: detail.name || "Nome não disponível",
        assetType: detail.assetType || null,
        category: classifyAsset(detail.assetType),
        imageUrl: imageById.get(id) || null,
        url: "https://www.roblox.com/catalog/" + id
      };
    });

    const presence = presenceResult.status === "fulfilled"
      ? presenceResult.value?.userPresences?.[0] || null
      : null;
    const presenceType = Number(presence?.userPresenceType ?? 0);
    const statusLabels = {
      0: "Offline",
      1: "Online",
      2: "Jogando",
      3: "No Roblox Studio"
    };

    return res.status(200).json({
      avatarUrl: avatarData?.imageUrl || null,
      avatarState: avatarData?.state || null,
      bio: profileResult.status === "fulfilled" ? (profileResult.value?.description || "") : null,
      items,
      presence: {
        type: presenceType,
        label: statusLabels[presenceType] || "Status indisponível",
        lastLocation: presence?.lastLocation || null,
        placeId: presence?.placeId || null,
        gameId: presence?.gameId || null
      },
      partial: {
        avatar: avatarResult.status !== "fulfilled",
        items: wearingResult.status !== "fulfilled",
        presence: presenceResult.status !== "fulfilled",
        profile: profileResult.status !== "fulfilled"
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "Não foi possível carregar os detalhes públicos desse jogador agora."
    });
  }
};

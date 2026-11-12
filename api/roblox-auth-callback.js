const authHandler = require("./roblox-auth");

module.exports = async (req, res) => {
  req.query = { ...(req.query || {}), action: "callback" };
  return authHandler(req, res);
};

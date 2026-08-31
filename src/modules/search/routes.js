const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { globalSearch } = require("./searchService");

const searchRouter = express.Router();

searchRouter.use(authenticate);

searchRouter.get("/", (req, res) => {
  const result = globalSearch(req.query, req.user);
  return res.json({ success: true, message: "Search completed.", data: result.data, meta: result.meta });
});

module.exports = { searchRouter };

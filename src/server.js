require("dotenv").config();

const { createApp } = require("./app");
const { assertRuntimeConfig } = require("./config");

assertRuntimeConfig();

const app = createApp();
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`WMS API listening on port ${port}`);
});

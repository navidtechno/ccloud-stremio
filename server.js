// Starts the CCloud Stremio addon HTTP server.
//   PORT=7000 node server.js
const { serveHTTP } = require("stremio-addon-sdk");
const addon = require("./src/addon");
const PORT = Number(process.env.PORT || 7000);
serveHTTP(addon, { port: PORT });
console.log(`CCloud Stremio addon listening on http://0.0.0.0:${PORT}/manifest.json`);

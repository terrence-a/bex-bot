// Workaround for Node 21+ incompatibility with Webex SDK trying to set read-only global navigator
if (global.navigator) {
  delete (global as any).navigator;
}

import express from "express";
import bodyParser from "body-parser";
import { config } from "./config";
import { framework, setupWebexBot } from "./webex";

// Require webhook module directly as it's not strongly typed
const webhook = require("webex-node-bot-framework/webhook");

const app = express();
app.use(bodyParser.json());

// Set up bot framework event handlers
setupWebexBot();

// Start the framework
framework.start();
console.log("Starting framework, please wait...");

app.get("/", (req, res) => {
  res.send("I'm alive.");
});

app.post("/", webhook(framework));

const server = app.listen(config.port, () => {
  framework.debug("framework listening on port %s", config.port);
  console.log(`Server is running on port ${config.port}`);
});

process.on("SIGINT", () => {
  framework.debug("stopping...");
  console.log("Shutting down...");
  server.close();
  framework.stop().then(() => {
    process.exit();
  });
});

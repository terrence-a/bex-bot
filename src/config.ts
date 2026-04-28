import dotenv from "dotenv";

dotenv.config();

export const config = {
  webexToken: process.env.BOTTOKEN || "",
  webhookUrl: process.env.WEBHOOKURL || "",
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  openCodeServerUrl: process.env.OPENCODE_URL || "http://127.0.0.1:9898",
};

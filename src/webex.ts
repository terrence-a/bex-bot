import Framework from "webex-node-bot-framework";
import { config } from "./config";
import { sessionManager } from "./sessionManager";
import { opencode } from "./opencode";

export const framework = new Framework({
  token: config.webexToken,
  webhookUrl: config.webhookUrl,
  port: config.port,
});

export async function setupWebexBot() {
  await sessionManager.init(opencode.createSession.bind(opencode));
  framework.on("initialized", () => {
    console.log("Webex bot framework initialized!");
  });

  framework.on("spawn", (bot: any, id: string, actorId: string) => {
    if (actorId) {
      bot.say("markdown", "Hello! I am connected to OpenCode AI. Send me a message to begin.");
    }
  });

  framework.on("attachmentAction", async (bot: any, trigger: any) => {
    const inputs = trigger.attachmentAction.inputs;
    if (inputs && inputs.permissionId) {
      const roomId = bot.room.id;
      const roomState = sessionManager.getRoomState(roomId);
      const sessionId = sessionManager.getSessionIdBySlug(roomState.activeSlug);

      if (sessionId) {
        await opencode.sendPermission(sessionId, inputs.permissionId, inputs.action);
        bot.say("markdown", `_Tool execution ${inputs.action}d._`);
      }
    }
  });

  framework.hears(/.*/, async (bot: any, trigger: any) => {
    const text = trigger.text?.trim();
    console.log(`Received message: "${text}" from roomId: ${bot.room.id}`);
    
    if (!text) {
      console.log("Empty text, ignoring.");
      return;
    }

    const roomId = bot.room.id;

    if (text.startsWith("!")) {
      const parts = text.split(" ");
      const cmd = parts[0].toLowerCase();
      
      if (cmd === "!sessions") {
        try {
          const allSessions = await opencode.listSessions();
          const roomState = sessionManager.getRoomState(roomId);
          const cachedSessions = sessionManager.getSessions();
          // Build reverse map: sessionId -> our bot slug
          const idToSlug: Record<string, string> = {};
          for (const [slug, id] of Object.entries(cachedSessions)) {
            idToSlug[id] = slug;
          }
          let reply = "**OpenCode Sessions:**\n";
          allSessions.forEach((s, i) => {
            const botSlug = idToSlug[s.id];
            const isActive = botSlug === roomState.activeSlug;
            const activeMarker = isActive ? " ✅" : "";
            reply += `**${i + 1}.** \`${s.slug}\`${activeMarker} — _${s.title}_\n`;
          });
          reply += `\nUse \`!switch <number>\` to switch sessions.`;
          bot.say("markdown", reply);
        } catch (e) {
          bot.say("markdown", "_Failed to fetch sessions from OpenCode._");
        }
        return;
      }

      if (cmd === "!switch") {
        const indexStr = parts[1];
        const index = parseInt(indexStr, 10);
        if (!indexStr || isNaN(index) || index < 1) {
          bot.say("markdown", "_Usage: !switch <number> — use !sessions to see the list._");
          return;
        }
        try {
          const allSessions = await opencode.listSessions();
          const target = allSessions[index - 1];
          if (!target) {
            bot.say("markdown", `_No session at position **${index}**. Use !sessions to see the list._`);
            return;
          }
          // If not in cache yet, add it
          let targetSlug = sessionManager.getSlugBySessionId(target.id);
          if (!targetSlug) {
            targetSlug = sessionManager.addSession(target.id);
          }
          sessionManager.updateRoomState(roomId, { activeSlug: targetSlug });
          bot.say("markdown", `_Switched to session **${index}**: \`${target.slug}\` (bot slug: **${targetSlug}**)._`);
        } catch (e) {
          bot.say("markdown", "_Failed to switch session._");
        }
        return;
      }
      
      if (cmd === "!new") {
        bot.say("markdown", "_Creating new session..._");
        try {
          const newSessionId = await opencode.createSession();
          const newSlug = sessionManager.addSession(newSessionId);
          sessionManager.updateRoomState(roomId, { activeSlug: newSlug });
          bot.say("markdown", `_Created and switched to new session: **${newSlug}**._`);
        } catch (e) {
          bot.say("markdown", "_Failed to create a new OpenCode session._");
        }
        return;
      }
      
      if (cmd === "!telepathy") {
        const state = parts[1]?.toLowerCase();
        if (state === "on" || state === "off") {
          const isTelepathy = state === "on";
          sessionManager.updateRoomState(roomId, { telepathy: isTelepathy });
          bot.say("markdown", `_Full Telepathy mode turned **${state.toUpperCase()}**._`);
        } else {
          bot.say("markdown", "_Usage: !telepathy on|off_");
        }
        return;
      }
      
      bot.say("markdown", "_Unknown command._");
      return;
    }

    const roomState = sessionManager.getRoomState(roomId);
    let sessionId = sessionManager.getSessionIdBySlug(roomState.activeSlug);
    console.log(`Current sessionId for room ${roomId} is: ${sessionId} (slug: ${roomState.activeSlug})`);

    if (!sessionId) {
      bot.say("markdown", "_Error: Active session not found._");
      return;
    }

    console.log(`Sending prompt to OpenCode session: ${sessionId}`);
    try {
      await opencode.sendPrompt(sessionId, text);
      console.log("Prompt sent to OpenCode successfully.");
    } catch (e) {
      console.error("Error sending prompt to OpenCode", e);
      bot.say("markdown", "_Failed to send message to OpenCode._");
    }
  }, 99999);

  function extractField(obj: any, fieldNames: string[]): any {
    if (!obj || typeof obj !== "object") return undefined;
    for (const name of fieldNames) {
      if (obj[name]) return obj[name];
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "object") {
        const found = extractField(obj[key], fieldNames);
        if (found) return found;
      }
    }
    return undefined;
  }

  // Listen to OpenCode events and push them to Webex
  // Track assistant message IDs and buffer streaming text
  const assistantMessageIds = new Set<string>();
  // messageId -> latest accumulated text
  const pendingText = new Map<string, string>();
  // messageId -> sessionId (so we can flush to correct rooms)
  const pendingSessionId = new Map<string, string>();

  opencode.listenEvents((eventObj) => {
    const { event, data } = eventObj;

    const sessionId = extractField(data, ["sessionID", "sessionId"]);
    if (!sessionId) return;

    const eventSlug = sessionManager.getSlugBySessionId(sessionId);
    if (!eventSlug) return;

    const eventType: string = data?.payload?.type || event || data?.type || "";

    // Step 1: Track assistant message IDs
    if (eventType === "message.updated") {
      const info = data?.payload?.properties?.info;
      if (info?.role === "assistant" && info?.id) {
        assistantMessageIds.add(info.id);
        pendingSessionId.set(info.id, sessionId);
      }
      return;
    }

    // Step 2: Buffer the latest text for each assistant message part
    if (eventType === "message.part.updated") {
      const part = data?.payload?.properties?.part;
      if (!part || part.type !== "text" || !part.text) return;
      const messageId: string = part.messageID;
      if (!messageId || !assistantMessageIds.has(messageId)) return;
      // Always overwrite — streaming sends accumulated text, so latest = complete
      pendingText.set(messageId, part.text);
      return;
    }

    // Step 3: session.updated signals the AI turn is complete — flush buffered text
    if (eventType === "session.updated") {
      for (const [messageId, text] of pendingText.entries()) {
        const msgSessionId = pendingSessionId.get(messageId);
        if (!msgSessionId) continue;
        const msgSlug = sessionManager.getSlugBySessionId(msgSessionId);
        if (!msgSlug) continue;

        for (const bot of framework.bots) {
          const roomId = bot.room.id;
          const roomState = sessionManager.getRoomState(roomId);
          const isActiveSession = roomState.activeSlug === msgSlug;
          const isTelepathy = roomState.telepathy;

          if (isActiveSession || isTelepathy) {
            const prefix = isTelepathy ? `**[${msgSlug}]**: ` : "";
            bot.say("markdown", prefix + text);
          }
        }
        pendingText.delete(messageId);
        pendingSessionId.delete(messageId);
        assistantMessageIds.delete(messageId);
      }
      return;
    }

    // Handle tool permission requests
    if (eventType === "permission.request" || eventType === "permission" || extractField(data, ["permissionId"])) {
      const permissionId = extractField(data, ["permissionId", "id"]);
      const description = extractField(data, ["description", "message"]) || "The AI is requesting permission to execute a tool.";

      for (const bot of framework.bots) {
        const roomId = bot.room.id;
        const roomState = sessionManager.getRoomState(roomId);
        const isActiveSession = roomState.activeSlug === eventSlug;
        const isTelepathy = roomState.telepathy;

        if ((isActiveSession || isTelepathy) && permissionId && sessionManager.getActivePermissionId(roomId) !== permissionId) {
          sessionManager.setActivePermissionId(roomId, permissionId);

          const card = {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.2",
            body: [
              { type: "TextBlock", text: "Tool Execution Approval Required", weight: "Bolder", size: "Medium" },
              { type: "TextBlock", text: (isTelepathy ? `**[${eventSlug}]**: ` : "") + description, wrap: true }
            ],
            actions: [
              { type: "Action.Submit", title: "Approve", data: { action: "approve", permissionId } },
              { type: "Action.Submit", title: "Deny", data: { action: "deny", permissionId } }
            ]
          };

          bot.sendCard(card, "Tool Execution Approval Required: Please use a client that supports Adaptive Cards.");
        }
      }
    }
  });
}

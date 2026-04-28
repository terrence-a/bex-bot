import { config } from "./config";

const baseUrl = config.openCodeServerUrl;

export const opencode = {
  async createSession(): Promise<string> {
    const res = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    return data.id;
  },

  async sendPrompt(sessionId: string, message: string): Promise<void> {
    await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: message }],
      }),
    });
  },

  async listSessions(): Promise<Array<{ id: string; slug: string; title: string }>> {
    const res = await fetch(`${baseUrl}/session`);
    const data: any = await res.json();
    return data.map((s: any) => ({ id: s.id, slug: s.slug, title: s.title }));
  },

  async sendPermission(
    sessionId: string,
    permissionId: string,
    action: "approve" | "deny"
  ): Promise<void> {
    await fetch(
      `${baseUrl}/session/${sessionId}/permissions/${permissionId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
  },

  async listenEvents(callback: (eventObj: { event: string; data: any }) => void) {
    while (true) {
      try {
        console.log("[SSE] Connecting to OpenCode event stream...");
        const res = await fetch(`${baseUrl}/global/event`, {
          headers: { Accept: "text/event-stream" },
        });

        if (!res.body) throw new Error("No response body in SSE");

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        console.log("[SSE] Connected.");

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            console.log("[SSE] Stream ended, reconnecting...");
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEventName = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (dataStr === "[DONE]") continue;
              try {
                const data = JSON.parse(dataStr);
                const evType = data?.payload?.type || currentEventName || "";
                console.log(`[SSE] event: ${evType}`);
                callback({ event: currentEventName, data });
              } catch (e) {
                console.error("[SSE] Failed to parse data:", dataStr);
              }
            }
          }
        }
      } catch (error) {
        console.error("[SSE] Connection error:", error);
      }
      // Wait 2s before reconnecting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  },
};

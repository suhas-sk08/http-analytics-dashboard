import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({ port: 5001 });

wss.on("connection", (ws) => {
  console.log("✅ WebSocket client connected (5001)");

  ws.on("close", () => {
    console.log("❌ WebSocket client disconnected");
  });
});

export function broadcastUpdate(payload: any) {
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

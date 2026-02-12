import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { HttpLog } from "@shared/schema";

export function useWebSocket() {
  const [logs, setLogs] = useState<HttpLog[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    function connect() {
      // 🔥 DO NOT use location.host in dev
     const wsUrl = "ws://127.0.0.1:5001";

      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "initial") {
          setLogs(message.data);
          return;
        }

        if (message.type === "update") {
          setLogs((prev) => [message.data, ...prev].slice(0, 100));
          return;
        }

        if (message.event === "AI_ALERT") {
          toast({
            title: `🚨 ${message.severity?.toUpperCase() || "AI ALERT"}`,
            description: message.message,
            variant:
              message.severity === "critical" ? "destructive" : "default",
          });
        }
      };

      wsRef.current.onclose = () => {
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [toast]);

  return { logs };
}

import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { HTTPAnalyticsAgent } from "./ai-agents/agent";

export async function registerRoutes( app: Express,
  aiAgent: HTTPAnalyticsAgent | null = null
): Promise<Server> {
  setupAuth(app);
 app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ 
      status: "ok",
      timestamp: new Date().toISOString(),
      aiAgent: aiAgent ? "enabled" : "disabled",
    });
  });

  // ───────────────── AI Agent Routes ─────────────────
  if (aiAgent) {
    // Get AI agent status
    app.get("/api/ai-agent/status", (_req: Request, res: Response) => {
      try {
        const status = aiAgent.getStatus();
        res.json(status);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get specific endpoint statistics
    app.get("/api/ai-agent/endpoint/:url", (req: Request, res: Response) => {
      try {
        const url = decodeURIComponent(req.params.url);
        const stats = aiAgent.getEndpointStats(url);

        if (!stats) {
          return res.status(404).json({ error: "Endpoint not found" });
        }

        res.json(stats);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger manual check
    app.post("/api/ai-agent/check", async (req: Request, res: Response) => {
      try {
        const { url } = req.body;

        if (!url) {
          return res.status(400).json({ error: "URL is required" });
        }

        const result = await aiAgent.checkEndpoint(url);

        res.json({
          success: true,
          result,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Generate on-demand report
    app.post("/api/ai-agent/report", async (req: Request, res: Response) => {
      try {
        const { startDate, endDate } = req.body;

        const report = await aiAgent.generateReport({
          start: new Date(startDate || Date.now() - 24 * 60 * 60 * 1000),
          end: new Date(endDate || Date.now()),
        });

        res.json({
          success: true,
          report,
          generatedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Add endpoint to monitoring
    app.post("/api/ai-agent/monitor", async (req: Request, res: Response) => {
      try {
        const { url, interval, expectedStatus } = req.body;

        if (!url) {
          return res.status(400).json({ error: "URL is required" });
        }

        aiAgent.addEndpoint({
          url,
          interval: interval || 60000,
          expectedStatus: expectedStatus || [200],
        });

        res.json({
          success: true,
          message: `Started monitoring ${url}`,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stop monitoring endpoint
    app.delete("/api/ai-agent/monitor/:url", (req: Request, res: Response) => {
      try {
        const url = decodeURIComponent(req.params.url);
        aiAgent.removeEndpoint(url);

        res.json({
          success: true,
          message: `Stopped monitoring ${url}`,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stop all monitoring
    app.post("/api/ai-agent/stop", (_req: Request, res: Response) => {
      try {
        aiAgent.stopMonitoring();

        res.json({
          success: true,
          message: "All monitoring stopped",
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Restart monitoring with new config
    app.post("/api/ai-agent/restart", async (req: Request, res: Response) => {
      try {
        const { endpoints } = req.body;

        if (!endpoints || !Array.isArray(endpoints)) {
          return res.status(400).json({
            error: "endpoints array is required",
          });
        }

        aiAgent.stopMonitoring();
        await aiAgent.startMonitoring(endpoints);

        res.json({
          success: true,
          message: "Monitoring restarted",
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  } else {
    // AI Agent is disabled - return helpful error messages
    const aiDisabledHandler = (_req: Request, res: Response) => {
      res.status(503).json({
        error: "AI Agent is not enabled",
        message: "Add AI_PROVIDER and API key to .env file to enable AI features",
        setup: {
          gemini: "Get free API key: https://makersuite.google.com/app/apikey",
          groq: "Get free API key: https://console.groq.com/",
          ollama: "Download: https://ollama.com/download",
        },
      });
    };

    app.get("/api/ai-agent/status", aiDisabledHandler);
    app.post("/api/ai-agent/check", aiDisabledHandler);
    app.post("/api/ai-agent/report", aiDisabledHandler);
    app.post("/api/ai-agent/monitor", aiDisabledHandler);
  }
  app.get("/api/logs", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

    try {
      const logs = await storage.getHttpLogs(startDate, endDate);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  const httpServer = createServer(app);

  // Setup WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    // Send initial data
    const sendInitialData = async () => {
      if (ws.readyState === WebSocket.OPEN) {
        const logs = await storage.getHttpLogs(
          new Date(Date.now() - 24 * 60 * 60 * 1000),
          new Date()
        );
        ws.send(JSON.stringify({ type: 'initial', data: logs }));
      }
    };
    sendInitialData();

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
    });
  });

  // Add method to broadcast updates to all connected clients
  storage.onNewLog = (log) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', data: log }));
      }
    });
  };
const server = createServer(app);
  return httpServer;
}
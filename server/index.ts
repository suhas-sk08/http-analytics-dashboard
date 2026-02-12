import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { HTTPAnalyticsAgent } from "./ai-agents/agent";
import { setupScheduledReports, setupAlertRules } from "./ai-agents/scheduler";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ───────────────── Logging middleware ─────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  res.json = (body: any) => {
    capturedJsonResponse = body;
    return originalResJson(body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine.length > 80 ? logLine.slice(0, 79) + "…" : logLine);
    }
  });

  next();
});

// ───────────────── Initialize AI Agent ─────────────────
const initializeAIAgent = () => {
  try {
    // Choose AI provider from environment
    const provider = (process.env.AI_PROVIDER || "gemini") as any;
    
    let config: any;

    switch (provider) {
      case "gemini":
        config = {
          provider: "gemini",
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
        };
        break;

      case "groq":
        config = {
          provider: "groq",
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || "llama-3.2-3b-preview",
        };
        break;

      case "ollama":
        config = {
          provider: "ollama",
          baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
          model: process.env.OLLAMA_MODEL || "llama3.2",
        };
        break;

      case "anthropic":
        config = {
          provider: "anthropic",
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: "claude-sonnet-4-20250514",
        };
        break;

      case "openai":
        config = {
          provider: "openai",
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
          model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
        };
        break;

      case "huggingface":
        config = {
          provider: "huggingface",
          apiKey: process.env.HUGGINGFACE_API_KEY,
          model: process.env.HUGGINGFACE_MODEL || "meta-llama/Llama-3.2-3B-Instruct",
        };
        break;

      case "cohere":
        config = {
          provider: "cohere",
          apiKey: process.env.COHERE_API_KEY,
        };
        break;

      default:
        // Default to Gemini (free and easy)
        log("⚠️  No AI provider configured, defaulting to Gemini");
        log("   Set AI_PROVIDER and API key in .env file");
        config = {
          provider: "gemini",
          apiKey: process.env.GEMINI_API_KEY || "",
          model: "gemini-1.5-flash",
        };
    }

    // Check if API key is provided (skip for Ollama)
    if (provider !== "ollama" && !config.apiKey) {
      log("⚠️  AI Agent disabled: No API key found");
      log(`   Add ${provider.toUpperCase()}_API_KEY to your .env file`);
      return null;
    }

    const aiAgent = new HTTPAnalyticsAgent(config);

    // Configure default endpoints to monitor
    const defaultEndpoints = [
      {
        url: "https://httpstat.us/200",
        interval: 30000, // 30 seconds
        expectedStatus: [200],
      },
      {
        url: "https://httpstat.us/500",
        interval: 60000, // 1 minute
        expectedStatus: [500],
      },
      {
        url: "https://api.github.com",
        interval: 120000, // 2 minutes
        expectedStatus: [200],
      },
    ];

    // Start monitoring
    aiAgent.startMonitoring(defaultEndpoints);

    // Setup scheduled reports
    setupScheduledReports(aiAgent);
    setupAlertRules(aiAgent);

    log(`🤖 AI Agent initialized with ${provider} provider`);

    return aiAgent;
  } catch (error: any) {
    log(`❌ Failed to initialize AI Agent: ${error.message}`);
    return null;
  }
};

// ───────────────── Bootstrap server ─────────────────
(async () => {
  // Initialize AI Agent first
  const aiAgent = initializeAIAgent();

  // Register routes (pass aiAgent if it exists)
  const server = await registerRoutes(app, aiAgent);

  // ───────────────── WebSocket Server (SEPARATE PATH) ─────────────────
  // Create WebSocket server on a DIFFERENT path to avoid Vite conflict
  if (aiAgent) {
    const wss = new WebSocketServer({ 
      server, 
      path: "/ws/ai-agent" // IMPORTANT: Use different path than Vite's default WebSocket
    });
    
    wss.on("connection", (ws) => {
      log("🔌 AI Agent WebSocket client connected");

      // Send initial status
      ws.send(JSON.stringify({
        type: "status",
        data: aiAgent.getStatus(),
      }));

      // Listen for AI insights and broadcast to clients
      const insightHandler = (insight: any) => {
        ws.send(JSON.stringify({
          type: "ai-insight",
          insight,
        }));
      };

      const checkHandler = (result: any) => {
        ws.send(JSON.stringify({
          type: "check-completed",
          result,
        }));
      };

      const reportHandler = (report: any) => {
        ws.send(JSON.stringify({
          type: "report-generated",
          report,
        }));
      };

      aiAgent.on("insight", insightHandler);
      aiAgent.on("check-completed", checkHandler);
      aiAgent.on("report-generated", reportHandler);

      ws.on("close", () => {
        aiAgent.off("insight", insightHandler);
        aiAgent.off("check-completed", checkHandler);
        aiAgent.off("report-generated", reportHandler);
        log("🔌 AI Agent WebSocket client disconnected");
      });

      ws.on("error", (error) => {
        log(`❌ WebSocket error: ${error.message}`);
      });
    });
  }

  // ───────────────── Error handler ─────────────────
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    log(`❌ Error: ${message}`);
  });

  // ───────────────── Vite / Static ─────────────────
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ───────────────── Listen ─────────────────
  const port = 5000;
  server.listen(port, "127.0.0.1", () => {
    log(`🚀 Server running on http://127.0.0.1:${port}`);
    
    if (aiAgent) {
      log(`🤖 AI Agent monitoring ${aiAgent.getStatus().endpointsMonitored} endpoints`);
      log(`📊 View dashboard at http://127.0.0.1:${port}/ai-agent`);
      log(`🔌 WebSocket endpoint: ws://127.0.0.1:${port}/ws/ai-agent`);
    } else {
      log(`💡 To enable AI Agent, add API key to .env file`);
      log(`   Example: AI_PROVIDER=gemini`);
      log(`   Get free key: https://makersuite.google.com/app/apikey`);
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log("⏹️  SIGTERM received, shutting down gracefully");
    
    if (aiAgent) {
      aiAgent.stopMonitoring();
    }
    
    server.close(() => {
      log("✅ Server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    log("\n⏹️  SIGINT received, shutting down gracefully");
    
    if (aiAgent) {
      aiAgent.stopMonitoring();
    }
    
    server.close(() => {
      log("✅ Server closed");
      process.exit(0);
    });
  });
})();
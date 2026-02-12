import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";

interface EndpointMonitorConfig {
  url: string;
  interval: number;
  expectedStatus?: number[];
  alertThreshold?: number;
}

interface AnalyticsInsight {
  timestamp: Date;
  type: "anomaly" | "trend" | "alert" | "recommendation";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  data: any;
}

interface EndpointCheckResult {
  url: string;
  status: number;
  responseTime: number;
  timestamp: Date;
  success: boolean;
  headers?: Record<string, string>;
  error?: string;
}

export class HTTPAnalyticsAgent extends EventEmitter {
  private anthropic: Anthropic;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private endpointHistory: Map<string, EndpointCheckResult[]> = new Map();
  private isRunning: boolean = false;
  private insightCache: Map<string, Date> = new Map();

  constructor(apiKey: string) {
    super();
    this.anthropic = new Anthropic({ apiKey });
  }

  async startMonitoring(configs: EndpointMonitorConfig[]) {
    this.isRunning = true;

    for (const config of configs) {
      await this.monitorEndpoint(config);
    }

    console.log(`🤖 AI Agent started monitoring ${configs.length} endpoints`);
  }

  private async monitorEndpoint(config: EndpointMonitorConfig) {
    const intervalId = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const result = await this.checkEndpoint(config.url);

        const history = this.endpointHistory.get(config.url) || [];
        history.push(result);

        if (history.length > 100) {
          history.shift();
        }
        this.endpointHistory.set(config.url, history);

        this.emit("check-completed", result);

        await this.analyzeEndpointHealth(config, history);
      } catch (error) {
        console.error(`Error monitoring ${config.url}:`, error);
        this.emit("error", { url: config.url, error });
      }
    }, config.interval);

    this.monitoringIntervals.set(config.url, intervalId);
  }

  async checkEndpoint(url: string): Promise<EndpointCheckResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      const responseTime = Date.now() - startTime;

      return {
        url,
        status: response.status,
        responseTime,
        timestamp: new Date(),
        success: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error: any) {
      return {
        url,
        status: 0,
        responseTime: Date.now() - startTime,
        timestamp: new Date(),
        success: false,
        error: error.message,
      };
    }
  }

  private async analyzeEndpointHealth(
    config: EndpointMonitorConfig,
    history: EndpointCheckResult[]
  ) {
    const recentChecks = history.slice(-10);

    const errorRate =
      recentChecks.filter((c) => !c.success).length / recentChecks.length;
    const avgResponseTime =
      recentChecks.reduce((sum, c) => sum + c.responseTime, 0) /
      recentChecks.length;
    const statusCodes = recentChecks.map((c) => c.status);

    // Throttle insights (max one per endpoint per 5 minutes)
    const lastInsight = this.insightCache.get(config.url);
    if (lastInsight && Date.now() - lastInsight.getTime() < 5 * 60 * 1000) {
      return;
    }

    if (errorRate > 0.3) {
      this.insightCache.set(config.url, new Date());
      await this.generateInsight(
        config.url,
        recentChecks,
        "High error rate detected"
      );
    }

    if (avgResponseTime > 5000) {
      this.insightCache.set(config.url, new Date());
      await this.generateInsight(
        config.url,
        recentChecks,
        "Slow response time detected"
      );
    }

    const uniqueStatuses = Array.from(new Set(statusCodes));
    if (uniqueStatuses.length > 3) {
      this.insightCache.set(config.url, new Date());
      await this.generateInsight(
        config.url,
        recentChecks,
        "Unstable status codes detected"
      );
    }
  }

  private async generateInsight(
    url: string,
    data: EndpointCheckResult[],
    context: string
  ) {
    try {
      const prompt = `Analyze this HTTP endpoint monitoring data:

URL: ${url}
Context: ${context}

Recent checks (last 10):
${JSON.stringify(data, null, 2)}

Provide:
1. What is happening?
2. Potential root causes
3. Recommended actions
4. Severity level (low/medium/high/critical)

Respond ONLY in valid JSON format (no markdown, no code blocks):
{
  "analysis": "brief analysis here",
  "rootCauses": ["cause 1", "cause 2"],
  "recommendations": ["action 1", "action 2"],
  "severity": "medium"
}`;

      const message = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const responseText =
        message.content[0].type === "text" ? message.content[0].text : "";

      const cleanedResponse = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const aiResponse = JSON.parse(cleanedResponse);

      const insight: AnalyticsInsight = {
        timestamp: new Date(),
        type: "alert",
        severity: aiResponse.severity,
        message: aiResponse.analysis,
        data: {
          url,
          rootCauses: aiResponse.rootCauses,
          recommendations: aiResponse.recommendations,
          checks: data,
        },
      };

      this.emit("insight", insight);

      console.log(`🔍 AI Insight for ${url}: ${aiResponse.analysis}`);
    } catch (error) {
      console.error("Error generating AI insight:", error);
    }
  }

  async generateReport(timeRange: { start: Date; end: Date }): Promise<string> {
    const allEndpoints = Array.from(this.endpointHistory.entries());

    const reportPrompt = `Generate a comprehensive HTTP analytics report:

Time Range: ${timeRange.start.toISOString()} to ${timeRange.end.toISOString()}

Endpoints monitored: ${allEndpoints.length}

Data summary:
${allEndpoints
  .map(([url, history]) => {
    const filtered = history.filter(
      (h) => h.timestamp >= timeRange.start && h.timestamp <= timeRange.end
    );

    if (filtered.length === 0) return "";

    const successRate =
      (filtered.filter((h) => h.success).length / filtered.length) * 100;
    const avgResponseTime =
      filtered.reduce((sum, h) => sum + h.responseTime, 0) / filtered.length;

    return `
URL: ${url}
- Total checks: ${filtered.length}
- Success rate: ${successRate.toFixed(2)}%
- Avg response time: ${avgResponseTime.toFixed(0)}ms
- Status codes: ${Array.from(new Set(filtered.map((h) => h.status))).join(", ")}
`;
  })
  .filter(Boolean)
  .join("\n")}

Provide a well-formatted report with:
1. Executive Summary
2. Overall system health assessment
3. Top 3 concerns or issues
4. Performance trends
5. Actionable recommendations

Format the response in markdown.`;

    const message = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: reportPrompt,
        },
      ],
    });

    const report =
      message.content[0].type === "text" ? message.content[0].text : "";

    this.emit("report-generated", {
      timestamp: new Date(),
      timeRange,
      report,
      data: Object.fromEntries(this.endpointHistory),
    });

    return report;
  }

  stopMonitoring() {
    this.isRunning = false;

    for (const [url, intervalId] of Array.from(this.monitoringIntervals.entries())) {
      clearInterval(intervalId);
    }

    this.monitoringIntervals.clear();
    console.log("🛑 AI Agent stopped monitoring");
  }

  addEndpoint(config: EndpointMonitorConfig) {
    if (!this.isRunning) {
      throw new Error("Agent is not running. Start monitoring first.");
    }

    this.monitorEndpoint(config);
  }

  removeEndpoint(url: string) {
    const intervalId = this.monitoringIntervals.get(url);
    if (intervalId) {
      clearInterval(intervalId);
      this.monitoringIntervals.delete(url);
      console.log(`Stopped monitoring ${url}`);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      endpointsMonitored: this.monitoringIntervals.size,
      totalChecks: Array.from(this.endpointHistory.values()).reduce(
        (sum, history) => sum + history.length,
        0
      ),
      endpoints: Array.from(this.monitoringIntervals.keys()),
      endpointHistory: Object.fromEntries(this.endpointHistory),
    };
  }

  getEndpointStats(url: string) {
    const history = this.endpointHistory.get(url) || [];
    if (history.length === 0) return null;

    const successRate =
      (history.filter((h) => h.success).length / history.length) * 100;
    const avgResponseTime =
      history.reduce((sum, h) => sum + h.responseTime, 0) / history.length;
    const statusCodes = Array.from(new Set(history.map((h) => h.status)));

    return {
      url,
      totalChecks: history.length,
      successRate: successRate.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(0),
      statusCodes,
      lastCheck: history[history.length - 1],
      recentChecks: history.slice(-10),
    };
  }
}
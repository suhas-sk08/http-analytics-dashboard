import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Brain,
  Activity,
  AlertTriangle,
  TrendingUp,
  Plus,
  Trash2,
  Download,
  RefreshCw,
} from "lucide-react";

interface AIInsight {
  timestamp: Date;
  type: "anomaly" | "trend" | "alert" | "recommendation";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  data: any;
}

interface AgentStatus {
  isRunning: boolean;
  endpointsMonitored: number;
  totalChecks: number;
  endpoints: string[];
}

export function AIAgentPanel() {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newInterval, setNewInterval] = useState("60000");

  useEffect(() => {
    fetchAgentStatus();

    const ws = new WebSocket(`ws://${window.location.host}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "ai-insight") {
          setInsights((prev) => [data.insight, ...prev].slice(0, 20));
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    };

    const statusInterval = setInterval(fetchAgentStatus, 30000);

    return () => {
      ws.close();
      clearInterval(statusInterval);
    };
  }, []);

  const fetchAgentStatus = async () => {
    try {
      const response = await fetch("/api/ai-agent/status");
      const data = await response.json();
      setAgentStatus(data);
    } catch (error) {
      console.error("Error fetching agent status:", error);
    }
  };

  const generateReport = async () => {
    setIsGeneratingReport(true);

    try {
      const response = await fetch("/api/ai-agent/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        }),
      });

      const data = await response.json();

      // Create downloadable report
      const blob = new Blob([data.report], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-report-${new Date().toISOString().split("T")[0]}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const addEndpoint = async () => {
    if (!newEndpoint) return;

    try {
      await fetch("/api/ai-agent/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newEndpoint,
          interval: parseInt(newInterval),
          expectedStatus: [200],
        }),
      });

      setNewEndpoint("");
      setNewInterval("60000");
      await fetchAgentStatus();
    } catch (error) {
      console.error("Error adding endpoint:", error);
    }
  };

  const removeEndpoint = async (url: string) => {
    try {
      await fetch(`/api/ai-agent/monitor/${encodeURIComponent(url)}`, {
        method: "DELETE",
      });

      await fetchAgentStatus();
    } catch (error) {
      console.error("Error removing endpoint:", error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      default:
        return "secondary";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
      case "high":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "medium":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <TrendingUp className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">AI Analytics Agent</h1>
        <Button onClick={fetchAgentStatus} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Agent Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agentStatus && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={agentStatus.isRunning ? "default" : "destructive"}
                  >
                    {agentStatus.isRunning ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Endpoints</p>
                  <p className="text-2xl font-bold">
                    {agentStatus.endpointsMonitored}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Checks</p>
                  <p className="text-2xl font-bold">{agentStatus.totalChecks}</p>
                </div>
              </div>

              <Button
                onClick={generateReport}
                disabled={isGeneratingReport}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {isGeneratingReport
                  ? "Generating Report..."
                  : "Download AI Report (24h)"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Endpoint Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Endpoint
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="endpoint-url">Endpoint URL</Label>
              <Input
                id="endpoint-url"
                placeholder="https://api.example.com/health"
                value={newEndpoint}
                onChange={(e) => setNewEndpoint(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="check-interval">Check Interval (ms)</Label>
              <Input
                id="check-interval"
                type="number"
                placeholder="60000"
                value={newInterval}
                onChange={(e) => setNewInterval(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Recommended: 60000ms (1 minute)
              </p>
            </div>
            <Button onClick={addEndpoint} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Endpoint
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Monitored Endpoints */}
      {agentStatus && agentStatus.endpoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Monitored Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {agentStatus.endpoints.map((url) => (
                <div
                  key={url}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <span className="text-sm font-mono truncate flex-1">
                    {url}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEndpoint(url)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {insights.length === 0 ? (
              <div className="text-center py-8">
                <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No insights yet. The AI agent is monitoring your endpoints.
                </p>
              </div>
            ) : (
              insights.map((insight, index) => (
                <Alert key={index} className="relative">
                  <div className="flex gap-3">
                    {getSeverityIcon(insight.severity)}
                    <div className="flex-1">
                      <AlertTitle className="flex items-center justify-between mb-2">
                        <span className="font-semibold">
                          {insight.type.toUpperCase()}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant={getSeverityColor(insight.severity)}>
                            {insight.severity}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {new Date(insight.timestamp).toLocaleTimeString()}
                          </Badge>
                        </div>
                      </AlertTitle>
                      <AlertDescription>
                        <p className="mb-2">{insight.message}</p>

                        {insight.data.rootCauses && (
                          <div className="mt-3 p-2 bg-muted rounded">
                            <p className="font-semibold text-sm mb-1">
                              Root Causes:
                            </p>
                            <ul className="list-disc list-inside text-sm space-y-1">
                              {insight.data.rootCauses.map(
                                (cause: string, i: number) => (
                                  <li key={i}>{cause}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}

                        {insight.data.recommendations && (
                          <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-950 rounded">
                            <p className="font-semibold text-sm mb-1">
                              Recommendations:
                            </p>
                            <ul className="list-disc list-inside text-sm space-y-1">
                              {insight.data.recommendations.map(
                                (rec: string, i: number) => (
                                  <li key={i}>{rec}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
type Metric = {
  statusCode: number;
  responseTime?: number; // optional for now
  timestamp: number;
};

const metricsWindow: Metric[] = [];
const WINDOW_MS = 60_000; // 1 minute
const MIN_SAMPLES = 10;  // 👈 lowered for testing

function pruneOld() {
  const cutoff = Date.now() - WINDOW_MS;
  while (metricsWindow.length && metricsWindow[0].timestamp < cutoff) {
    metricsWindow.shift();
  }
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], avg: number) {
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function analyze(metric: Metric) {
  metricsWindow.push(metric);
  pruneOld();

  if (metricsWindow.length < MIN_SAMPLES) {
    return null; // warm-up
  }

  // -----------------------------
  // 🚨 ERROR RATE ANOMALY (5xx)
  // -----------------------------
  const errors = metricsWindow.filter(m => m.statusCode >= 500).length;
  const errorRate = errors / metricsWindow.length;

  if (errorRate > 0.3) {
    return {
      type: "HIGH_ERROR_RATE",
      severity: "critical",
      message: `5xx error rate spiked to ${(errorRate * 100).toFixed(1)}%`,
      value: errorRate,
    };
  }

  // --------------------------------
  // 🐢 RESPONSE TIME SPIKE (optional)
  // --------------------------------
  const responseTimes = metricsWindow
    .map(m => m.responseTime)
    .filter((v): v is number => typeof v === "number");

  if (responseTimes.length >= MIN_SAMPLES && metric.responseTime) {
    const avg = mean(responseTimes);
    const deviation = std(responseTimes, avg);

    if (metric.responseTime > avg + 3 * deviation) {
      return {
        type: "RESPONSE_TIME_SPIKE",
        severity: "warning",
        message: `Response time spike: ${metric.responseTime}ms (baseline ${Math.round(avg)}ms)`,
        value: metric.responseTime,
        baseline: avg,
      };
    }
  }

  return null;
}

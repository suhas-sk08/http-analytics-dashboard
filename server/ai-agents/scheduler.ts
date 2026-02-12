import cron from "node-cron";
import { HTTPAnalyticsAgent } from "./agent";

export function setupScheduledReports(agent: HTTPAnalyticsAgent) {
  console.log("⏰ Setting up scheduled reports...");

  // Daily report at 9 AM
  cron.schedule("0 9 * * *", async () => {
    console.log("📊 Generating daily AI report...");

    try {
      const report = await agent.generateReport({
        start: new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      console.log("Daily Report Generated:");
      console.log(report);

      // You can send this via email, Slack, etc.
      // await sendEmail({
      //   to: "admin@example.com",
      //   subject: "Daily HTTP Analytics Report",
      //   body: report,
      // });
    } catch (error) {
      console.error("Error generating daily report:", error);
    }
  });

  // Weekly report on Monday at 9 AM
  cron.schedule("0 9 * * 1", async () => {
    console.log("📊 Generating weekly AI report...");

    try {
      const report = await agent.generateReport({
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      console.log("Weekly Report Generated:");
      console.log(report);

      // Send to management or store
    } catch (error) {
      console.error("Error generating weekly report:", error);
    }
  });

  // Monthly report on the 1st at 10 AM
  cron.schedule("0 10 1 * *", async () => {
    console.log("📊 Generating monthly AI report...");

    try {
      const report = await agent.generateReport({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      console.log("Monthly Report Generated:");
      console.log(report);
    } catch (error) {
      console.error("Error generating monthly report:", error);
    }
  });

  // Hourly health check (optional)
  cron.schedule("0 * * * *", () => {
    const status = agent.getStatus();
    console.log(`💓 Health Check - Monitoring ${status.endpointsMonitored} endpoints`);

    if (!status.isRunning) {
      console.warn("⚠️ WARNING: AI Agent is not running!");
      // Alert administrators
    }
  });

  console.log("✅ Scheduled reports configured:");
  console.log("  - Daily reports: 9:00 AM");
  console.log("  - Weekly reports: Monday 9:00 AM");
  console.log("  - Monthly reports: 1st of month 10:00 AM");
  console.log("  - Health checks: Every hour");
}

export function setupAlertRules(agent: HTTPAnalyticsAgent) {
  // Listen for critical insights
  agent.on("insight", (insight) => {
    if (insight.severity === "critical" || insight.severity === "high") {
      console.log("🚨 CRITICAL ALERT:", insight.message);

      // Send immediate notification
      // await sendSlackAlert(insight);
      // await sendPagerDutyAlert(insight);
      // await sendSMS(insight);
    }
  });

  // Listen for consecutive failures
  agent.on("check-completed", (result) => {
    const stats = agent.getEndpointStats(result.url);

    if (stats) {
      const recentChecks = stats.recentChecks.slice(-5);
      const allFailed = recentChecks.every((check: any) => !check.success);

      if (allFailed && recentChecks.length === 5) {
        console.log(`🚨 ENDPOINT DOWN: ${result.url} - 5 consecutive failures`);

        // Trigger emergency alert
        // await notifyOnCall(result.url);
      }
    }
  });
}
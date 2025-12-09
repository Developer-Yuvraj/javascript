import fs from 'fs';
import axios from 'axios';
import e from 'express';
import 'dotenv/config';

// Slack Webhook URL
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_WEBHOOK_URL_TEST = process.env.SLACK_WEBHOOK_URL_TEST;

export async function sendSlackAlert(message) {
    try {
        await axios.post(SLACK_WEBHOOK_URL_TEST, {
            text: message
        });

       // console.log("🚨 Slack alert sent:", message);

    } catch (err) {
        console.error("❌ Error sending Slack alert:", err.message);
    }
}

export async function sendSlackAlert1(message) {
    try {
        await axios.post(SLACK_WEBHOOK_URL, {
            text: message
        });

       // console.log("🚨 Slack alert sent:", message);

    } catch (err) {
        console.error("❌ Error sending Slack alert:", err.message);
    }
}

// function checkHeartbeat() {
    // try {
    //     const timestamp = parseInt(fs.readFileSync('/tmp/monitor_heartbeat.txt', 'utf8'));
    //     const now = Date.now();
    //     if (now - timestamp > 120_000) {
    //         sendSlackAlert("🚨 Monitoring app is DOWN!")
    //     } else {
    //         console.log("Monitoring script is alive ✅")
    //     }
    // } catch (err) {
    //     sendSlackAlert("🚨 Heartbeat file missing! Monitoring script may be down.");
    // }
// }

// Check at startup
// checkHeartbeat();

// Run the check at every min interwal
// setInterval(() => {
//     checkHeartbeat();
// }, 60_000);



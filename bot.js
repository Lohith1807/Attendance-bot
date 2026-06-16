require('dotenv').config();
const fs = require('fs');
const { exec } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // Channel for tracking posting
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // Channel for general logs
const AUTHORIZED_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Bot chat ID

if (!token) {
    console.error("❌ Please add TELEGRAM_TOKEN to your .env file!");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Define Semesters dynamically from .env
let TERM_MAP = {};
try {
    TERM_MAP = JSON.parse(process.env.SEMESTER_CODES || '{}');
} catch (e) {
    console.error("❌ Failed to parse SEMESTER_CODES from .env.");
}

// Helper to send logs to the log channel
function sendLog(message) {
    console.log(message);
    if (LOG_CHANNEL_ID) {
        bot.sendMessage(LOG_CHANNEL_ID, `📝 *LOG:* ${message}`, { parse_mode: 'Markdown' }).catch(() => {});
    }
}

// State variables for tracking
let trackingInterval = null;
let trackedTermId = null;
let previousAttendanceState = {};

// Refresh auth token automatically
function refreshAuthToken() {
    sendLog("🔄 Starting automatic token refresh...");
    exec('node utils/click.js', (error) => {
        if (error) {
            sendLog(`❌ Error refreshing token: ${error.message}`);
            return;
        }
        sendLog("✅ Token successfully refreshed automatically!");
    });
}

// Automatically refresh token every 6 days
setInterval(refreshAuthToken, 6 * 24 * 60 * 60 * 1000);

// Helper function to generate inline keyboard for semesters
function getSemesterKeyboard(actionPrefix) {
    const buttons = [];
    for (const [semName, termId] of Object.entries(TERM_MAP)) {
        buttons.push([{ text: semName, callback_data: `${actionPrefix}_${termId}` }]);
    }
    return { reply_markup: { inline_keyboard: buttons } };
}

// --- Auth Middleware (Optional but good since you gave a chat ID) ---
function isAuthorized(msg) {
    if (AUTHORIZED_CHAT_ID && msg.chat.id.toString() !== AUTHORIZED_CHAT_ID) {
        bot.sendMessage(msg.chat.id, "❌ You are not authorized to use this bot.");
        return false;
    }
    return true;
}

// --- 1. /getattendance ---
bot.onText(/\/getattendance/, (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(msg.chat.id, "Select a semester to view attendance:", getSemesterKeyboard('GET'));
});

// --- 2. /trackattendance ---
bot.onText(/\/trackattendance/, (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(msg.chat.id, "Select a semester to start tracking every minute:", getSemesterKeyboard('TRACK'));
});

// --- 3. /stoptracking ---
bot.onText(/\/stoptracking/, (msg) => {
    if (!isAuthorized(msg)) return;
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
        trackedTermId = null;
        previousAttendanceState = {};
        bot.sendMessage(msg.chat.id, "🛑 Attendance tracking stopped.");
        sendLog("🛑 Tracking stopped by user.");
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ Tracking is not currently running.");
    }
});

// Handle button clicks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (AUTHORIZED_CHAT_ID && chatId.toString() !== AUTHORIZED_CHAT_ID) return;

    const data = query.data; // e.g. GET_151 or TRACK_151
    bot.answerCallbackQuery(query.id);
    const [action, termId] = data.split('_');

    if (action === 'GET') {
        bot.sendMessage(chatId, `⏳ Fetching your attendance data for term ${termId}...`);
        const attendanceData = await fetchAttendanceData(termId);
        
        if (!attendanceData) {
            bot.sendMessage(chatId, "❌ Failed to fetch attendance. Your token might be expired. Running auto-refresh now... Try again in a minute!");
            refreshAuthToken();
            return;
        }

        const termName = Object.keys(TERM_MAP).find(k => TERM_MAP[k] === termId) || termId;
        const message = formatAttendanceMessage(attendanceData, termName);
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });

    } else if (action === 'TRACK') {
        if (!CHANNEL_ID) {
            bot.sendMessage(chatId, "❌ CHANNEL_ID is not set in the .env file! Please add it before tracking.");
            return;
        }

        if (trackingInterval) {
            clearInterval(trackingInterval);
        }

        trackedTermId = termId;
        previousAttendanceState = {}; // Reset state
        
        bot.sendMessage(chatId, `✅ Started tracking attendance for term ${termId} every 1 minute. Notifications will be sent to the tracking channel.`);
        sendLog(`✅ Tracking started for term ${termId} every 1 minute.`);

        // Initial fetch to populate the base state
        const initialData = await fetchAttendanceData(termId);
        if (initialData) {
            previousAttendanceState = extractAttendanceState(initialData);
        }

        // Start the 1-minute interval loop
        trackingInterval = setInterval(() => checkAttendanceUpdate(termId), 60 * 1000);
    }
});

// Core logic to fetch data
async function fetchAttendanceData(termId) {
    try {
        const authData = JSON.parse(fs.readFileSync('data/auth_dump.json', 'utf8'));
        const userInfo = JSON.parse(authData.localStorage.userInfo);
        const authToken = userInfo.token;

        const ATTENDANCE_API_URL = `https://apollouniversity.digiicampus.com/api/attendance/student/1023069/term/${termId}`;

        const response = await fetch(ATTENDANCE_API_URL, {
            method: 'GET',
            headers: {
                'auth-token': authToken,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://apollouniversity.digiicampus.com',
                'Referer': 'https://apollouniversity.digiicampus.com/userProfileCard/academics/1023069'
            }
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return await response.json();
    } catch (err) {
        sendLog(`⚠️ Fetch error: ${err.message}`);
        return null;
    }
}

// Map the API data into a simple object keyed by courseId to compare states easily
function extractAttendanceState(data) {
    const state = {};
    if (!data.courseAttendance) return state;
    
    data.courseAttendance.forEach(c => {
        state[c.courseId] = {
            name: c.courseName,
            present: c.totalPresent || 0,
            total: c.totalClasses || 0,
            percentage: c.percentage || 0
        };
    });
    return state;
}

// Logic that runs every 1 minute
async function checkAttendanceUpdate(termId) {
    const currentData = await fetchAttendanceData(termId);
    
    if (!currentData) {
        sendLog("⚠️ Could not fetch data during tracking loop. Might be token expiry. Triggering auto-refresh.");
        refreshAuthToken();
        return; 
    }

    const currentState = extractAttendanceState(currentData);
    let changesFound = false;
    let notificationMsg = `🚨 *ATTENDANCE UPDATE DETECTED!* 🚨\n`;

    for (const [courseId, currentSubject] of Object.entries(currentState)) {
        const previousSubject = previousAttendanceState[courseId];

        // If subject didn't exist before, skip tracking changes for it this round
        if (!previousSubject) continue;

        if (currentSubject.present !== previousSubject.present || currentSubject.total !== previousSubject.total) {
            changesFound = true;
            
            let statusName = "MODIFIED";
            let emoji = "🔄";
            
            if (currentSubject.present > previousSubject.present) {
                statusName = "PRESENT";
                emoji = "✅";
            } else if (currentSubject.total > previousSubject.total && currentSubject.present === previousSubject.present) {
                statusName = "ABSENT";
                emoji = "❌";
            }

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB');
            const timeStr = now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
            const percentStr = `${parseFloat(currentSubject.percentage).toFixed(2)}%`;

            notificationMsg += `\n${emoji} *${currentSubject.name}*\n`;
            notificationMsg += `📅 *Date:* ${dateStr}\n`;
            notificationMsg += `⏰ *Time:* ${timeStr}\n`;
            notificationMsg += `📊 *Status:* ${statusName}\n`;
            notificationMsg += `📈 *Percentage:* ${percentStr}\n`;
        }
    }

    if (changesFound) {
        sendLog("🚨 Update detected! Sending notification to attendance tracking channel.");
        bot.sendMessage(CHANNEL_ID, notificationMsg, { parse_mode: "Markdown" })
            .catch(err => sendLog(`❌ Failed to send tracking notification: ${err.message}`));
    }

    // Update the state for the next check
    previousAttendanceState = currentState;
}

// Format the normal /getattendance message
function formatAttendanceMessage(data, termName) {
    const totalSessions = data.totalClasses || 0;
    const present = data.totalPresent || 0;
    const absent = data.totalAbsent || 0;

    const overallPercentage = data.percentage ? parseFloat(data.percentage).toFixed(2) + "%" : "0.00%";

    let message = `📋 *Attendance Report*\n`;
    message += `*Term:* ${termName}\n\n`;

    message += `*📊 SUMMARY*\n`;
    message += `Total Sessions: \`${totalSessions}\`\n`;
    message += `Present: \`${present}\`\n`;
    message += `Absent: \`${absent}\`\n`;
    message += `Percentage: \`${overallPercentage}\`\n\n`;

    message += `*Subject-wise Breakdown:*\n\n`;

    if (data.courseAttendance) {
        data.courseAttendance.forEach(c => {
            const attPresent = c.totalPresent || 0;
            const attTotal = c.totalClasses || 0;
            const percent = c.percentage ? parseFloat(c.percentage).toFixed(2) : "0.00";
            
            let statusObj = "";
            let emoji = "";

            if (parseFloat(percent) >= 80) {
                statusObj = "Safe (80%+)";
                emoji = "🟢";
            } else {
                statusObj = "Critical";
                emoji = "🔴";
            }

            const attRatioStr = `${attPresent}/${attTotal}`;
            const percentStr = `${percent}%`;

            message += `${emoji} *${c.courseName}*\n`;
            message += `↳ Attended: \`${attRatioStr}\`\n`;
            message += `↳ Percentage: \`${percentStr}\`\n`;
            message += `↳ Status: \`${statusObj}\`\n\n`;
        });
    }

    // Append fetched time
    const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true };
    const fetchedTime = new Date().toLocaleString('en-GB', options);
    message += `🕒 _Fetched: ${fetchedTime}_\n`;

    return message;
}

sendLog("🤖 Telegram Bot is online! Waiting for commands...");

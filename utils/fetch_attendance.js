const fs = require('fs');

const path = require('path');

// 1. Read the token from the dump file we created
const authData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/auth_dump.json'), 'utf8'));
const userInfo = JSON.parse(authData.localStorage.userInfo);
const token = userInfo.token;

// 2. The API URL to get attendance (Update this to the exact API endpoint!)
const ATTENDANCE_API_URL = 'https://apollouniversity.digiicampus.com/api/attendance/student/1023069/term/151';

async function fetchAttendance() {
    console.log("Fetching attendance using JWT Token...");
    
    try {
        const response = await fetch(ATTENDANCE_API_URL, {
            method: 'GET', // Or 'POST' depending on the API
            headers: {
                'auth-token': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Origin': 'https://apollouniversity.digiicampus.com',
                'Referer': 'https://apollouniversity.digiicampus.com/userProfileCard/academics/1023069',
                'Cookie': authData.cookies.map(c => `${c.name}=${c.value}`).join('; ')
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} ${response.statusText} \nResponse: ${errorText}`);
        }

        const data = await response.json();
        fs.writeFileSync(path.join(__dirname, '../data/attendance_dump.json'), JSON.stringify(data, null, 2));
        console.log("✅ Attendance Data saved to attendance_dump.json");
    } catch (error) {
        console.error("❌ Failed to fetch attendance:", error.message);
        console.log("Make sure you have the correct ATTENDANCE_API_URL in the script.");
    }
}

fetchAttendance();

const fs = require('fs');

const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/attendance_dump.json'), 'utf8'));

console.log("=========================================");
console.log(`🎓 OVERALL ATTENDANCE: ${data.percentage.toFixed(2)}%`);
console.log(`📊 Classes: ${data.totalPresent} Present / ${data.totalClasses} Total`);
console.log("=========================================\n");

console.log("📚 SUBJECT-WISE BREAKDOWN:");
data.courseAttendance.forEach(c => {
    // Some courses might have 0 classes, we check for that to avoid 0/0
    const present = c.totalPresent || 0;
    const total = c.totalClasses || 0;
    const percent = c.percentage ? c.percentage.toFixed(2) : "0.00";
    
    console.log(`- ${c.courseName}`);
    console.log(`  Attendance: ${percent}% (${present}/${total} classes)\n`);
});

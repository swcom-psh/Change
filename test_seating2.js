const text = require('fs').readFileSync('c:\\Users\\SDHS\\Desktop\\Anti\\Change\\자리 바꾸기 설문조사!!(응답) - 시트2.csv', 'utf8');
const lines = text.trim().split(/\r?\n/).filter(line => line.trim() !== "");
lines.shift();
const students = lines.map((line, index) => {
    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => {
        let val = c.trim();
        if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1).trim();
        }
        return val.normalize('NFC');
    });
    return {
        name: cols[1],
        like: cols[2] ? cols[2].split(/[|\s,]+/).filter(Boolean) : [],
        dislike: cols[3] ? cols[3].split(/[|\s,]+/).filter(Boolean) : [],
        fixed: cols[4] || "",
        reason: cols[5] || ""
    };
});
console.log(students[1]);
console.log(students[2]);

let frontGroup = [], backGroup = [];
students.forEach(s => {
    if (s.fixed.includes('앞')) frontGroup.push(s);
    else if (s.fixed.includes('뒤')) backGroup.push(s);
});
console.log("frontGroup:", frontGroup.map(s => s.name));
console.log("backGroup:", backGroup.map(s => s.name));

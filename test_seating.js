const fs = require('fs');
const text = fs.readFileSync('c:\\Users\\SDHS\\Desktop\\Anti\\Change\\자리 바꾸기 설문조사!!(응답) - 시트2.csv', 'utf8');
const lines = text.trim().split(/\r?\n/).filter(line => line.trim() !== "");
lines.shift();
const students = lines.map((line, index) => {
    const cols = line.split(',').map(c => c.trim());
    return {
        name: cols[1],
        like: cols[2],
        dislike: cols[3],
        fixed: cols[4] || "",
        reason: cols[5] || ""
    };
});
console.log(students);

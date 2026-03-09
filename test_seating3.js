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
        fixed: cols[4] || "",
    };
});

let frontGroup = [], backGroup = [];
students.forEach(s => {
    console.log(`name: ${s.name}, fixed: '${s.fixed}', length: ${s.fixed.length}, bytes: ${Buffer.from(s.fixed).toString('hex')}`);
    if (s.fixed.includes('앞')) frontGroup.push(s);
    else if (s.fixed.includes('뒤')) backGroup.push(s);
});
console.log("frontGroup:", frontGroup);
console.log("backGroup:", backGroup);

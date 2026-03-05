// DOM Elements
const csvInput = document.getElementById('csvInput');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const editBtn = document.getElementById('editBtn');
const seatingGrid = document.getElementById('seatingGrid');
const classroomSection = document.querySelector('.classroom');
const classroomObjectsDiv = document.getElementById('classroomObjects');
const reportCardSection = document.getElementById('reportCard');
const reportContent = document.getElementById('reportContent');

// Configuration
const GRID_ROWS = 6;
const GRID_COLS = 6;
let TOTAL_SEATS = 26;

// Algorithm Constants
const SCORE_LIKE = 20;
const SCORE_DISLIKE = -100;
const ITERATIONS = 20000; // Optimization attempts

// Default Data Fallback (for local file:// protocol compatibility)
const DEFAULT_STUDENT_CSV = `번호,이름,같이앉고싶은친구,기피하는친구,희망고정자리,이유
1,권지훈
2,김다율
3,김서윤
4,김선민
5,김아린
6,김은비
7,김태민
8,김하빈
9,박기령
10,박소현
11,박자희
12,박재우
13,서민주
14,안성은
15,이서후
16,이온유
17,이재인
18,이채원
19,이효린
20,장주영
21,전수빈
22,전승민
23,조문준
24,차윤우
25,한소희
26,홍예은`;

// State
let students = [];
let activeSeats = []; // Array of {idx, row, col}
let isEditMode = false;

// Initialize Default Layout (2-6-6-6-6)
function initDefaultLayout() {
    activeSeats = [];
    // Row 0: 2 seats (indices 2, 3 in 6-col grid)
    activeSeats.push({ idx: 2, r: 0, c: 2 });
    activeSeats.push({ idx: 3, r: 0, c: 3 });
    // Rows 1-4: 6 seats each
    for (let r = 1; r <= 4; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            activeSeats.push({ idx: r * GRID_COLS + c, r: r, c: c });
        }
    }
    TOTAL_SEATS = activeSeats.length;
}
initDefaultLayout();

// Event Listeners
generateBtn.addEventListener('click', handleGenerate);
downloadBtn.addEventListener('click', handleDownload);
editBtn.addEventListener('click', toggleEditMode);

async function handleGenerate() {
    let text = "";
    const file = csvInput.files[0];

    try {
        if (file) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                students = await parseXLSX(file);
            } else {
                text = await file.text();
                students = parseCSV(text);
            }
        } else {
            // 파일을 선택하지 않은 경우 기본 파일 사용 시도
            try {
                const response = await fetch('student_sample_data.csv');
                if (response.ok) {
                    text = await response.text();
                } else {
                    text = DEFAULT_STUDENT_CSV;
                }
            } catch (e) {
                // Fetch failed (likely file:// protocol restriction), use fallback
                console.warn("Fetch failed, using local fallback data.");
                text = DEFAULT_STUDENT_CSV;
            }
            students = parseCSV(text);
        }

        if (students.length === 0) {
            alert("데이터가 없습니다.");
            return;
        }

        // Show loading state (simple)
        generateBtn.textContent = "계산 중...";
        generateBtn.disabled = true;

        if (isEditMode) toggleEditMode(); // Exit edit mode when generating

        // Allow UI to update before blocking
        setTimeout(() => {
            const assignment = optimizeSeating(students);
            renderSeating(assignment);

            generateBtn.textContent = "자리 배치하기";
            generateBtn.disabled = false;
        }, 50);

    } catch (err) {
        console.error(err);
        alert("오류 발생: " + err.message);
        generateBtn.textContent = "자리 배치하기";
        generateBtn.disabled = false;
    }
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(line => line.trim() !== "");
    // Remove header
    lines.shift();

    return lines.map((line, index) => {
        const cols = line.split(',').map(c => c.trim());
        return {
            id: index,
            displayNum: cols[0],
            name: cols[1],
            likes: cols[2] ? cols[2].split(/[| ]+/).filter(Boolean) : [],
            dislikes: cols[3] ? cols[3].split(/[| ]+/).filter(Boolean) : [],
            fixed: cols[4] || "",
            reason: cols[5] || ""
        };
    });
}

function getStudentAvatar(id, name) {
    const colors = ['#FFCDD2', '#F8BBD0', '#E1BEE7', '#D1C4E9', '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2', '#B2DFDB', '#C8E6C9', '#DCEDC8', '#F0F4C3', '#FFF9C4', '#FFECB3', '#FFE0B2', '#FFCCBC'];

    // Use student ID (displayNum) to pick consistent color
    const num = parseInt(id) || 0;
    const color = colors[num % colors.length];
    const initial = name ? name.charAt(0) : '?';

    return { initial, color };
}

function renderClassroomObjects() {
    classroomObjectsDiv.innerHTML = '';
    // User requested to remove icons like windows and boxes.
}

function parseXLSX(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                // jsonData[0] is header row
                const body = jsonData.slice(1).filter(row => row.length > 0 && row[1]);

                const parsed = body.map((cols, index) => {
                    return {
                        id: index,
                        displayNum: cols[0] || (index + 1),
                        name: String(cols[1] || "").trim(),
                        likes: cols[2] ? String(cols[2]).split(/[| ]+/).filter(Boolean) : [],
                        dislikes: cols[3] ? String(cols[3]).split(/[| ]+/).filter(Boolean) : [],
                        fixed: cols[4] || "",
                        reason: cols[5] || ""
                    };
                });
                resolve(parsed);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// Check adjacency between two seat objects
function isNeighbor(s1, s2) {
    if (!s1 || !s2) return false;
    const rDiff = Math.abs(s1.r - s2.r);
    const cDiff = Math.abs(s1.c - s2.c);

    // Adjacent (Horizontal, Vertical, Diagonal)
    return rDiff <= 1 && cDiff <= 1 && !(rDiff === 0 && cDiff === 0);
}

function calculateScore(seats) {
    let score = 0;

    // Map Name to seat index in the current 'seats' array
    const nameToIdx = {};
    seats.forEach((student, idx) => {
        if (student) nameToIdx[student.name] = idx;
    });

    seats.forEach((student, idx) => {
        if (!student) return;

        // Likes
        student.likes.forEach(friendName => {
            if (nameToIdx[friendName] !== undefined) {
                const friendIdx = nameToIdx[friendName];
                if (isNeighbor(activeSeats[idx], activeSeats[friendIdx])) {
                    score += SCORE_LIKE;
                }
            }
        });

        // Dislikes
        student.dislikes.forEach(enemyName => {
            if (nameToIdx[enemyName] !== undefined) {
                const enemyIdx = nameToIdx[enemyName];
                if (isNeighbor(activeSeats[idx], activeSeats[enemyIdx])) {
                    score += SCORE_DISLIKE;
                }
            }
        });
    });

    return score;
}

function optimizeSeating(studentList) {
    let seats = new Array(TOTAL_SEATS).fill(null);

    // 1. Separate based on Fixed Constraints
    const frontGroup = [];
    const backGroup = [];
    const normalGroup = [];

    studentList.forEach(s => {
        if (s.fixed.includes('앞')) frontGroup.push(s);
        else if (s.fixed.includes('뒤')) backGroup.push(s);
        else normalGroup.push(s);
    });

    // Indexes for regions (based on row relative to max row)
    // Sort activeSeats so that rows near the teacher (bottom) are assigned first
    activeSeats.sort((a, b) => {
        if (b.r !== a.r) return b.r - a.r; // Row descending
        return a.c - b.c; // Column ascending
    });

    const maxRow = activeSeats.length > 0 ? Math.max(...activeSeats.map(s => s.r)) : 0;
    const frontIndices = [];
    const backIndices = [];
    const middleIndices = [];

    activeSeats.forEach((seat, idx) => {
        if (seat.r >= maxRow - 1) frontIndices.push(idx);
        else if (seat.r <= 1) backIndices.push(idx);
        else middleIndices.push(idx);
    });

    // Helper to fill array
    function fillZone(zoneIndices, group) {
        group.sort(() => Math.random() - 0.5);
        const available = [...zoneIndices].filter(i => seats[i] === null);
        available.sort(() => Math.random() - 0.5);

        group.forEach(s => {
            if (available.length > 0) {
                seats[available.pop()] = s;
            } else {
                normalGroup.push(s);
            }
        });
    }

    fillZone(frontIndices, frontGroup);
    fillZone(backIndices, backGroup);

    // Fill remaining
    let emptyIndices = seats.map((s, i) => s === null ? i : -1).filter(i => i !== -1);
    normalGroup.sort(() => Math.random() - 0.5);

    normalGroup.forEach(s => {
        if (emptyIndices.length > 0) {
            const rndIdx = Math.floor(Math.random() * emptyIndices.length);
            seats[emptyIndices[rndIdx]] = s;
            emptyIndices.splice(rndIdx, 1);
        }
    });

    // 2. Optimization Loop (Hill Climbing)
    let currentScore = calculateScore(seats);

    for (let i = 0; i < ITERATIONS; i++) {
        const idx1 = Math.floor(Math.random() * TOTAL_SEATS);
        const idx2 = Math.floor(Math.random() * TOTAL_SEATS);

        if (idx1 === idx2) continue;

        const s1 = seats[idx1];
        const s2 = seats[idx2];

        if (!canBeAt(s1, idx2) || !canBeAt(s2, idx1)) {
            continue;
        }

        seats[idx1] = s2;
        seats[idx2] = s1;

        const newScore = calculateScore(seats);

        if (newScore > currentScore) {
            currentScore = newScore;
        } else {
            seats[idx1] = s1;
            seats[idx2] = s2;
        }
    }

    return seats;
}

function canBeAt(student, index) {
    if (!student) return true;
    const seat = activeSeats[index];
    const maxRow = activeSeats.length > 0 ? Math.max(...activeSeats.map(s => s.r)) : 0;

    if (student.fixed.includes('앞')) {
        return seat.r >= maxRow - 1;
    }
    if (student.fixed.includes('뒤')) {
        return seat.r <= 1;
    }
    return true;
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    editBtn.textContent = isEditMode ? "수정 완료" : "자리 구조 수정";
    editBtn.classList.toggle('btn-active', isEditMode);

    if (isEditMode) {
        renderEditGrid();
    } else {
        // Prepare for normal mode
        seatingGrid.innerHTML = '<div class="empty-state">배치 완료 후 결과가 표시됩니다.</div>';
    }
}

function renderEditGrid() {
    seatingGrid.innerHTML = '';
    const seatIdxs = new Set(activeSeats.map(s => s.idx));

    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            const idx = r * GRID_COLS + c;
            const cell = document.createElement('div');
            cell.className = 'seat-edit-cell';
            if (seatIdxs.has(idx)) cell.classList.add('active');

            cell.addEventListener('click', () => {
                if (seatIdxs.has(idx)) {
                    activeSeats = activeSeats.filter(s => s.idx !== idx);
                    cell.classList.remove('active');
                    seatIdxs.delete(idx);
                } else {
                    activeSeats.push({ idx, r, c });
                    cell.classList.add('active');
                    seatIdxs.add(idx);
                }
                TOTAL_SEATS = activeSeats.length;
            });

            seatingGrid.appendChild(cell);
        }
    }
}

// Render Function (with Animation)
async function renderSeating(seats) {
    if (isEditMode) toggleEditMode();

    // 1. Setup Grid first
    seatingGrid.innerHTML = '';
    const seatElements = [];

    // Sort activeSeats: Bottom rows first (near teacher)
    activeSeats.sort((a, b) => {
        if (b.r !== a.r) return b.r - a.r;
        return a.c - b.c;
    });
    const maxRow = activeSeats.length > 0 ? Math.max(...activeSeats.map(s => s.r)) : 0;

    for (let i = 0; i < TOTAL_SEATS; i++) {
        const seat = activeSeats[i];
        const seatDiv = document.createElement('div');
        seatDiv.className = 'seat';

        seatDiv.style.gridRow = seat.r + 1;
        seatDiv.style.gridColumn = seat.c + 1;
        seatDiv.setAttribute('data-row', seat.r);

        const numberDiv = document.createElement('div');
        numberDiv.className = 'seat-number';
        numberDiv.innerText = ""; // Initial empty, will be set after assignment

        const nameDiv = document.createElement('div');
        nameDiv.className = 'student-name';
        nameDiv.innerText = "";

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'student-avatar';
        avatarDiv.style.opacity = '0'; // Hide initially

        seatDiv.appendChild(numberDiv);
        seatDiv.appendChild(avatarDiv);
        seatDiv.appendChild(nameDiv);

        if (seat.r >= maxRow - 1) seatDiv.style.backgroundColor = "#e8f5e9"; // Front (Near teacher)
        if (seat.r <= 1) seatDiv.style.backgroundColor = "#ffebee"; // Back (Far from teacher)

        seatingGrid.appendChild(seatDiv);
        seatElements.push({ div: seatDiv, nameDiv: nameDiv, avatarDiv: avatarDiv });
    }

    renderClassroomObjects();
    reportCardSection.style.display = 'none';

    // 2. Animate Sequential Reveal
    generateBtn.disabled = true;
    generateBtn.textContent = "발표 중...";

    const runRoulette = (element, finalName, duration) => {
        return new Promise(resolve => {
            const possibleNames = students.map(s => s.name);
            let interval = setInterval(() => {
                element.innerText = possibleNames[Math.floor(Math.random() * possibleNames.length)];
                element.style.color = "#888";
            }, 50);

            setTimeout(() => {
                clearInterval(interval);
                element.innerText = finalName;
                element.style.color = "#000";
                element.style.fontWeight = "bold";
                element.parentElement.style.transform = "scale(1.1)";
                element.parentElement.style.zIndex = "100";
                setTimeout(() => {
                    element.parentElement.style.transform = "scale(1)";
                    element.parentElement.style.zIndex = "1";
                }, 200);
                resolve();
            }, duration);
        });
    };

    for (let i = 0; i < TOTAL_SEATS; i++) {
        if (!seats[i]) continue;

        classroomSection.classList.add('is-announcing');
        seatElements[i].div.classList.add('spotlight');

        await runRoulette(seatElements[i].nameDiv, seats[i].name, 400);

        const s = seats[i];
        const avatar = getStudentAvatar(s.displayNum, s.name);
        seatElements[i].avatarDiv.innerText = s.displayNum; // Display number in center circle
        seatElements[i].avatarDiv.style.backgroundColor = avatar.color;
        seatElements[i].avatarDiv.style.opacity = '1';

        seatElements[i].div.classList.remove('spotlight');

        // seatElements[i].div.querySelector('.seat-number').innerText = s.displayNum; // Removed top-left number

        let tooltip = `번호: ${s.displayNum}\n`;
        if (s.reason) tooltip += `사유: ${s.reason}\n`;
        if (s.likes.length) tooltip += `선호: ${s.likes.join(', ')}\n`;
        if (s.dislikes.length) tooltip += `기피: ${s.dislikes.join(', ')}`;
        seatElements[i].div.title = tooltip;
    }

    classroomSection.classList.remove('is-announcing');
    generateBtn.disabled = false;
    generateBtn.textContent = "자리 배치하기";

    // 3. Celebration & Report
    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
    });

    generateReport(seats);
}

function generateReport(seats) {
    reportCardSection.style.display = 'block';
    reportContent.innerHTML = '';

    const validStudents = seats.filter(Boolean);
    const frontRow = seats.filter((s, i) => activeSeats[i].r >= Math.max(...activeSeats.map(as => as.r)) - 1 && s);

    // Find "Lucky Pairs" (Neighbors who sit together and either like each other or just adjacent)
    const pairs = [];
    const nameToIdx = {};
    seats.forEach((s, i) => { if (s) nameToIdx[s.name] = i; });

    seats.forEach((s, i) => {
        if (!s) return;
        s.likes.forEach(like => {
            const friendIdx = nameToIdx[like];
            if (friendIdx !== undefined && isNeighbor(activeSeats[i], activeSeats[friendIdx]) && i < friendIdx) {
                pairs.push(`${s.name} & ${like}`);
            }
        });
    });

    const reportItems = [
        { title: "앞자리 수호신", content: frontRow.map(s => s.name).slice(0, 5).join(', ') + (frontRow.length > 5 ? ' 등' : '') },
        { title: "행운의 짝꿍", content: pairs.length > 0 ? pairs.slice(0, 3).join('<br>') : "새로운 친구와 친해질 시간!" },
        { title: "배치 만족도", content: `${Math.floor(calculateScore(seats) / 100 * 100)}%` }
    ];

    reportItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'report-item';
        div.innerHTML = `<h3>${item.title}</h3><p>${item.content}</p>`;
        reportContent.appendChild(div);
    });

    // Smooth scroll to report
    reportCardSection.scrollIntoView({ behavior: 'smooth' });
}

function handleDownload() {
    if (!seatingGrid.children.length || seatingGrid.querySelector('.empty-state')) {
        alert("저장할 배치도가 없습니다.");
        return;
    }

    // Create temporary date element
    const now = new Date();
    const dateStr = `${now.getFullYear()} - ${String(now.getMonth() + 1).padStart(2, '0')} - ${String(now.getDate()).padStart(2, '0')}`;

    const dateDiv = document.createElement('div');
    dateDiv.innerText = dateStr;
    dateDiv.style.position = 'absolute';
    dateDiv.style.bottom = '10px';
    dateDiv.style.left = '50%';
    dateDiv.style.transform = 'translateX(-50%)';
    dateDiv.style.fontSize = '1.2rem';
    dateDiv.style.fontFamily = "'Do Hyeon', sans-serif";
    dateDiv.style.color = '#666';
    dateDiv.className = 'temp-date-stamp';

    const classroom = document.querySelector('.classroom');
    const originalPosition = classroom.style.position;
    classroom.style.position = 'relative'; // Ensure absolute positioning works
    classroom.appendChild(dateDiv);

    html2canvas(classroom, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `자리배치도_${dateStr.replace(/ /g, '')}.png`;
        link.href = canvas.toDataURL();
        link.click();

        // Clean up
        dateDiv.remove();
        classroom.style.position = originalPosition;
    });
}

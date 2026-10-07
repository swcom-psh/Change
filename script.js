/**
 * script.js - Seating Chart Program
 * Refactored for better maintainability and clarity.
 */

/* ==========================================
   1. Configuration & Constants
   ========================================== */
const CONFIG = {
    GRID: { ROWS: 6, COLS: 6 }, // Will be updated dynamically if needed
    ALGORITHM: {
        ITERATIONS: 300000,
        TEMP_INITIAL: 1000.0,
        TEMP_FINAL: 0.1,
        DISLIKE_SAFE_DIST: 3 // 기피 학생과 이 거리(칸) 이상 떨어지면 벌점 없음
    },
    // 포스트잇 색 (학생 번호 순서대로 돌아가며 쓴다)
    COLORS: ['#fff3a8', '#ffd6de', '#cfe8ff', '#d6f2d0', '#ffe1c2', '#e6dcff']
};

// Fisher-Yates. sort(() => Math.random() - 0.5)는 치우쳐서 제대로 안 섞인다.
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/* ==========================================
   2. Global State
   ========================================== */
let students = [];           // All student objects parsed from file
let activeSeats = [];        // Array of {idx, r, c} currently used in the layout
let currentAssignment = [];  // Current student objects mapped to activeSeats indices
let TOTAL_SEATS = 0;

let isEditMode = false;      // Toggle for layout structure editing
let draggedSeatIndex = null; // State for dragging between seats
let draggedSidebarId = null;  // State for dragging from sidebar

/* ==========================================
   3. DOM Elements
   ========================================== */
const ELEMENTS = {
    csvInput: document.getElementById('csvInput'),
    generateBtn: document.getElementById('generateBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    editBtn: document.getElementById('editBtn'),
    templateBtn: document.getElementById('templateBtn'),
    seatingGrid: document.getElementById('seatingGrid'),
    classroom: document.querySelector('.classroom'),
    unassignedList: document.getElementById('unassignedList'),
    fileLabel: document.getElementById('fileLabel'),
    waitingCount: document.getElementById('waitingCount'),
    roomDate: document.getElementById('roomDate')
};

const GENERATE_LABEL = ELEMENTS.generateBtn.textContent;
const EDIT_LABEL = { off: ELEMENTS.editBtn.textContent, on: '고치기 끝 ✔' };

/* ==========================================
   4. Initialization & Layout
   ========================================== */
function initDefaultLayout(studentCount = 26) {
    activeSeats = [];
    
    // 1. Calculate required GRID size
    // Standard layout is 6x6. If more than 36 students, add rows.
    CONFIG.GRID.COLS = 6;
    CONFIG.GRID.ROWS = Math.max(6, Math.ceil(studentCount / CONFIG.GRID.COLS) + 1); // +1 for safety/spacing

    // 2. Define standard seats (indices 2, 3 in row 0, and rows 1-4)
    const standardIndices = new Set();
    [2, 3].forEach(c => standardIndices.add(0 * CONFIG.GRID.COLS + c));
    for (let r = 1; r <= 4; r++) {
        for (let c = 0; c < CONFIG.GRID.COLS; c++) {
            standardIndices.add(r * CONFIG.GRID.COLS + c);
        }
    }

    // 3. Populate activeSeats
    // Priority 1: Standard 26 seats
    standardIndices.forEach(idx => {
        const r = Math.floor(idx / CONFIG.GRID.COLS);
        const c = idx % CONFIG.GRID.COLS;
        activeSeats.push({ idx, r, c });
    });

    // Priority 2: Fill remaining of 6x6 if needed
    if (studentCount > activeSeats.length) {
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < CONFIG.GRID.COLS; c++) {
                const idx = r * CONFIG.GRID.COLS + c;
                if (!standardIndices.has(idx) && activeSeats.length < studentCount) {
                    activeSeats.push({ idx, r, c });
                }
            }
        }
    }

    // Priority 3: Add more if studentCount > 36
    if (studentCount > activeSeats.length) {
        for (let r = 6; r < CONFIG.GRID.ROWS; r++) {
            for (let c = 0; c < CONFIG.GRID.COLS; c++) {
                const idx = r * CONFIG.GRID.COLS + c;
                if (activeSeats.length < studentCount) {
                    activeSeats.push({ idx, r, c });
                }
            }
        }
    }

    TOTAL_SEATS = activeSeats.length;
}

/* ==========================================
   5. File Parsing Logic
   ========================================== */
// Converts full-width digits (e.g. ３) and other full-width chars to ASCII equivalents
function normalizeFixed(str) {
    return String(str || '').trim().replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(line => line.trim() !== "");
    lines.shift(); // Remove header

    return lines.map((line, index) => {
        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => {
            let val = c.trim();
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.substring(1, val.length - 1).trim();
            }
            return val.normalize('NFC');
        });

        return {
            id: index,
            displayNum: cols[0],
            name: cols[1],
            likes: cols[2] ? cols[2].split(/[|\s,]+/).filter(Boolean) : [],
            dislikes: cols[3] ? cols[3].split(/[|\s,]+/).filter(Boolean) : [],
            fixed: normalizeFixed(cols[4]),
            reason: cols[5] || ""
        };
    });
}

function parseXLSX(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                const body = jsonData.slice(1).filter(row => row.length > 0 && row[1]);
                const parsed = body.map((cols, index) => ({
                    id: index,
                    displayNum: cols[0] || (index + 1),
                    name: String(cols[1] || "").trim().normalize('NFC'),
                    likes: cols[2] ? String(cols[2]).normalize('NFC').split(/[|\s,]+/).filter(Boolean) : [],
                    dislikes: cols[3] ? String(cols[3]).normalize('NFC').split(/[|\s,]+/).filter(Boolean) : [],
                    fixed: normalizeFixed(cols[4]),
                    reason: String(cols[5] || "").trim().normalize('NFC')
                }));
                resolve(parsed);
            } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// 업로드 양식(.xlsx) 다운로드. 컬럼 순서는 parseXLSX/parseCSV가 읽는 순서와 같아야 한다.
function downloadTemplate() {
    const header = ['번호', '이름', '같이앉고싶은친구', '기피하는친구', '희망고정자리', '이유'];
    const rows = [
        header,
        [1, '홍길동', '', '', '', ''],
        [2, '김철수', '이영희', '박민수', '앞자리', '시력이 좋지 않아요'],
        [3, '이영희', '', '', '뒷자리', '키가 커요'],
        [4, '박민수', '', '', 7, '좌석 번호를 쓰면 그 자리에 고정됩니다']
    ];
    const guide = [
        ['항목', '작성 방법'],
        ['번호', '학생 번호'],
        ['이름', '학생 이름 (필수, 비어 있으면 해당 행은 무시됩니다)'],
        ['같이앉고싶은친구', '이름을 쉼표(,) 또는 공백으로 구분해서 입력'],
        ['기피하는친구', '이름을 쉼표(,) 또는 공백으로 구분해서 입력'],
        ['희망고정자리', '"앞자리" / "뒷자리" 또는 좌석 번호(예: 7). 번호를 쓰면 그 학생만 해당 자리에 고정됩니다. 비워두면 상관없음'],
        ['좌석 번호', '교실을 바라봤을 때 맨 오른쪽 열이 1번부터, 각 열은 교탁 쪽(아래)에서 위로 센 뒤 왼쪽 열로 넘어갑니다. 자리 구조를 수정하면 번호도 바뀝니다. 화면 각 자리 왼쪽 위의 숫자가 좌석 번호입니다.'],
        ['이유', '자유롭게 입력 (참고용 메모이며 화면에는 표시되지 않습니다)'],
        ['', ''],
        ['※', '첫 번째 시트만 읽으며, 첫 행(제목 줄)은 건너뜁니다. 예시 행은 지우고 사용하세요.']
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 36 }];
    const wsGuide = XLSX.utils.aoa_to_sheet(guide);
    wsGuide['!cols'] = [{ wch: 20 }, { wch: 70 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    XLSX.utils.book_append_sheet(wb, wsGuide, '작성 안내');
    XLSX.writeFile(wb, '자리배치_양식.xlsx');
}

/* ==========================================
   6. Seating Algorithm (Optimization)
   ========================================== */

/**
 * 좌석 번호: 교실을 바라봤을 때 맨 오른쪽 열이 1번부터, 각 열은 교탁에 가까운
 * 아랫줄부터 위로 센 뒤 다음 열(왼쪽)로 넘어간다. 빈 자리는 건너뛰므로
 * 자리 구조를 바꾸면 번호도 따라 바뀐다. 반환값은 activeSeats와 같은 인덱스의 번호 배열.
 */
function computeSeatNumbers() {
    const order = activeSeats.map((seat, i) => ({ seat, i }))
        .sort((a, b) => b.seat.c !== a.seat.c ? b.seat.c - a.seat.c : b.seat.r - a.seat.r);
    const numbers = new Array(activeSeats.length);
    order.forEach(({ i }, n) => { numbers[i] = n + 1; });
    return numbers;
}

// 희망고정자리가 "7", "7번" 같은 숫자면 그 좌석 번호를, 아니면 null을 돌려준다.
function parseFixedSeatNumber(fixed) {
    const m = /^(\d+)\s*번?$/.exec(fixed.trim());
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Main optimization controller
 */
function optimizeSeating(studentList, preAssigned = []) {
    let seats = preAssigned.length > 0 ? [...preAssigned] : new Array(TOTAL_SEATS).fill(null);

    // --- Hard-lock: 번호로 지정한 고정 자리 ---
    // 그 자리는 해당 학생 전용이다. 이미 다른 자리/다른 학생이 있었다면 비워서 대기 명단으로 돌린다.
    const seatNumbers = computeSeatNumbers();
    const claimed = new Set();
    studentList.forEach(student => {
        const num = parseFixedSeatNumber(student.fixed);
        if (num === null) return;
        const seatIdx = seatNumbers.indexOf(num);
        if (seatIdx === -1 || claimed.has(seatIdx)) return; // 없는 번호/중복 지정은 무시
        claimed.add(seatIdx);
        seats = seats.map(s => (s && s.id === student.id) ? null : s);
        seats[seatIdx] = student;
    });

    // Build the locked array so SA never swaps these seats
    const lockedSeats = [...seats];

    // Filter students already placed (including the hard-locked ones)
    const assignedIds = new Set(seats.filter(Boolean).map(s => s.id));
    const unassignedStudents = studentList.filter(s => !assignedIds.has(s.id));

    // Fill remaining seats greedily based on fixed constraints
    seats = fillGreedyInitialAssignment(seats, unassignedStudents);

    // Simulated Annealing Optimization (lockedSeats keeps hard-locked positions)
    return runSimulatedAnnealing(seats, lockedSeats);
}

function fillGreedyInitialAssignment(seats, unassigned) {
    let remainingUnassigned = [...unassigned];

    const groups = { front: [], back: [], normal: [] };
    
    // Instead of forcing lock, we still try to prioritize them into correct bins.
    remainingUnassigned.forEach(s => {
        if (s.fixed.includes('앞')) groups.front.push(s);
        else if (s.fixed.includes('뒤') || s.fixed.includes('뒷')) groups.back.push(s);
        else groups.normal.push(s);
    });

    const maxRow = Math.max(...activeSeats.map(s => s.r));
    const zones = {
        front: activeSeats.map((s, i) => s.r >= maxRow - 1 ? i : -1).filter(i => i !== -1),
        back: activeSeats.map((s, i) => s.r <= 1 ? i : -1).filter(i => i !== -1),
        all: activeSeats.map((_, i) => i)
    };

    const fill = (indices, studentsInGroup) => {
        // 학생뿐 아니라 '자리'도 섞어야 한다. 안 그러면 희망자가 한 명일 때
        // 늘 그 구역의 첫 번째 자리로만 배정된다.
        shuffleArray(studentsInGroup);
        shuffleArray(indices.filter(i => seats[i] === null)).forEach(i => {
            if (studentsInGroup.length) seats[i] = studentsInGroup.pop();
        });
        // Overflow to normal
        if (studentsInGroup.length) groups.normal.push(...studentsInGroup);
    };

    fill(zones.front, groups.front);
    fill(zones.back, groups.back);

    // Fill rest randomly
    const remainingEmpty = seats.map((s, i) => s === null ? i : -1).filter(i => i !== -1);
    groups.normal.sort(() => Math.random() - 0.5);
    groups.normal.forEach(s => {
        if (remainingEmpty.length) {
            const pick = Math.floor(Math.random() * remainingEmpty.length);
            seats[remainingEmpty.splice(pick, 1)[0]] = s;
        }
    });

    return seats;
}

function runSimulatedAnnealing(seats, lockedSeeds) {
    let currentScore = calculateScore(seats);
    let bestScore = currentScore;
    let bestSeats = [...seats];

    for (let i = 0; i < CONFIG.ALGORITHM.ITERATIONS; i++) {
        // Temperature schedule
        const temp = CONFIG.ALGORITHM.TEMP_INITIAL * Math.pow(CONFIG.ALGORITHM.TEMP_FINAL / CONFIG.ALGORITHM.TEMP_INITIAL, i / CONFIG.ALGORITHM.ITERATIONS);

        const idx1 = Math.floor(Math.random() * TOTAL_SEATS);
        const idx2 = Math.floor(Math.random() * TOTAL_SEATS);

        if (idx1 === idx2 || lockedSeeds[idx1] || lockedSeeds[idx2]) continue;

        const s1 = seats[idx1];
        const s2 = seats[idx2];

        // Swap (No canBeAt check anymore! Handled by huge penalty in calculateScore)
        seats[idx1] = s2;
        seats[idx2] = s1;

        const newScore = calculateScore(seats);
        const delta = newScore - currentScore;

        if (delta > 0 || Math.exp(delta / temp) > Math.random()) {
            currentScore = newScore;
            // '>' 였을 때는 첫 만점 배치에 갇혀서 매번 같은 결과가 나왔다.
            // 동점도 받아들여야 만점 배치들 사이에서 골고루 뽑힌다.
            if (currentScore >= bestScore) {
                bestScore = currentScore;
                bestSeats = [...seats];
            }
        } else {
            // Revert
            seats[idx1] = s1;
            seats[idx2] = s2;
        }
    }
    return bestSeats;
}

function calculateScore(seats) {
    let score = 0;
    const nameToIdx = {};
    const maxRow = Math.max(...activeSeats.map(s => s.r));
    
    seats.forEach((s, idx) => { if (s) nameToIdx[s.name] = idx; });

    seats.forEach((student, idx) => {
        if (!student) return;

        const seat = activeSeats[idx];
        
        // Fixed Seat Penalty (Lock-free behavior)
        if (student.fixed.includes('앞') && seat.r < maxRow - 1) {
            score -= 2000;
        }
        if ((student.fixed.includes('뒤') || student.fixed.includes('뒷')) && seat.r > 1) {
            score -= 2000;
        }

        // Like Score
        student.likes.forEach(friend => {
            const fIdx = nameToIdx[friend];
            if (fIdx !== undefined) {
                const dist = Math.sqrt(Math.pow(seat.r - activeSeats[fIdx].r, 2) + Math.pow(seat.c - activeSeats[fIdx].c, 2));
                const bonus = Math.max(0, 50 - (dist * 15));
                
                let partnerBonus = 0;
                if (Math.abs(seat.r - activeSeats[fIdx].r) === 0 && Math.abs(seat.c - activeSeats[fIdx].c) === 1) {
                    const minC = Math.min(seat.c, activeSeats[fIdx].c);
                    if (minC === 0 || minC === 2 || minC === 4) partnerBonus = 30;
                }
                
                score += (bonus + partnerBonus);
            }
        });

        // Dislike Score
        student.dislikes.forEach(enemy => {
            const eIdx = nameToIdx[enemy];
            if (eIdx !== undefined) {
                const s1 = activeSeats[idx];
                const s2 = activeSeats[eIdx];
                const dist = Math.sqrt(Math.pow(s1.r - s2.r, 2) + Math.pow(s1.c - s2.c, 2));
                
                // 충분히 떨어지면 만족. 멀수록 계속 가산하면 늘 같은 구석 자리가 유일한 최적해가 되어
                // 매번 같은 배치가 나온다. 기준 거리 이상이면 벌점이 없어야 최적해가 여러 개가 된다.
                if (dist > 0 && dist < CONFIG.ALGORITHM.DISLIKE_SAFE_DIST) {
                    score += Math.round(-300 / dist);
                }
            }
        });
    });
    return score;
}

/* ==========================================
   7. UI & Rendering
   ========================================== */

async function renderSeating(seats, isSilent = false, prevAssignment = []) {
    if (isEditMode) {
        isEditMode = false;
        ELEMENTS.editBtn.textContent = EDIT_LABEL.off;
        ELEMENTS.editBtn.classList.remove('btn-active');
        ELEMENTS.classroom.classList.remove('is-editing');
    }
    ELEMENTS.seatingGrid.innerHTML = '';
    ELEMENTS.seatingGrid.style.setProperty('--grid-cols', CONFIG.GRID.COLS);
    
    const seatElements = [];

    // Sort: Bottom rows (near teacher) first for sequential reveal
    activeSeats.sort((a, b) => b.r !== a.r ? b.r - a.r : a.c - b.c);
    const maxRow = Math.max(...activeSeats.map(s => s.r));

    const seatNumbers = computeSeatNumbers();
    activeSeats.forEach((seat, i) => {
        const div = createSeatElement(seat, i, maxRow);
        div.querySelector('.seat-number').textContent = seatNumbers[i];
        ELEMENTS.seatingGrid.appendChild(div);
        seatElements.push({ 
            div, 
            nameDiv: div.querySelector('.student-name'), 
            avatarDiv: div.querySelector('.student-avatar') 
        });
    });

    // Immediate render for fixed/silent seats
    seats.forEach((s, i) => {
        if (s && (isSilent || prevAssignment[i] === s)) {
            updateSeatContent(seatElements[i], s);
        }
    });

    if (isSilent) return;

    // Animation Loop
    ELEMENTS.generateBtn.disabled = true;
    ELEMENTS.generateBtn.textContent = "발표 중... 🥁";
    ELEMENTS.classroom.classList.add('is-announcing');

    for (let i = 0; i < TOTAL_SEATS; i++) {
        const s = seats[i];
        if (s && prevAssignment[i] !== s) {
            seatElements[i].div.classList.add('spotlight');
            await runRoulette(seatElements[i].nameDiv, s.name);
            seatElements[i].div.classList.remove('spotlight');
            updateSeatContent(seatElements[i], s);
        }
    }

    ELEMENTS.classroom.classList.remove('is-announcing');
    ELEMENTS.generateBtn.disabled = false;
    ELEMENTS.generateBtn.textContent = GENERATE_LABEL;
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    
    // Enable dragging
    ELEMENTS.seatingGrid.querySelectorAll('.seat').forEach(s => s.draggable = true);
}

// 포스트잇이 살짝씩 다르게 기울어지도록, 자리 위치로 정해지는 각도(-1.8 ~ 1.8도)
function seatTilt(key) {
    return (((key * 37) % 7) - 3) * 0.6;
}

function createSeatElement(seat, i, maxRow) {
    const div = document.createElement('div');
    div.className = 'seat';
    div.setAttribute('data-index', i);
    div.style.gridRow = seat.r + 1;
    div.style.gridColumn = seat.c + 1;
    div.style.setProperty('--tilt', `${seatTilt(seat.idx)}deg`);

    div.innerHTML = `
        <div class="seat-number"></div>
        <div class="student-avatar"></div>
        <div class="student-name"></div>
    `;

    div.addEventListener('click', handleSeatClick);
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('dragleave', handleDragLeave);
    div.addEventListener('drop', handleDrop);
    div.addEventListener('dragend', handleDragEnd);

    return div;
}

function updateSeatContent(el, s) {
    el.nameDiv.style.color = "";   // 룰렛이 칠한 회색을 지운다
    if (!s) {
        el.nameDiv.innerText = "";
        el.avatarDiv.innerText = "";
        el.div.classList.remove('filled');
        el.div.style.removeProperty('--note');
        el.div.title = "";
        return;
    }
    el.nameDiv.innerText = s.name;
    el.avatarDiv.innerText = s.displayNum;
    el.div.classList.add('filled');
    el.div.style.setProperty('--note', getStudentAvatar(s.displayNum, s.name).color);

    let tooltip = `번호: ${s.displayNum}\n`;
    if (s.likes.length) tooltip += `선호: ${s.likes.join(', ')}\n`;
    if (s.dislikes.length) tooltip += `기피: ${s.dislikes.join(', ')}`;
    el.div.title = tooltip;
}

function runRoulette(element, finalName) {
    return new Promise(resolve => {
        const names = students.map(s => s.name);
        let count = 0;
        const interval = setInterval(() => {
            element.innerText = names[Math.floor(Math.random() * names.length)];
            element.style.color = "#888";
            if (++count > 8) {
                clearInterval(interval);
                resolve();
            }
        }, 50);
    });
}

function renderUnassignedList() {
    if (!ELEMENTS.unassignedList) return;
    const assignedIds = new Set(currentAssignment.filter(Boolean).map(s => s.id));
    const unassigned = students.filter(s => !assignedIds.has(s.id));

    ELEMENTS.waitingCount.textContent = students.length ? `(${unassigned.length})` : '';
    if (students.length === 0) {
        ELEMENTS.unassignedList.innerHTML = '<div class="empty-list-msg">파일을 올리면<br>명단이 여기에 붙어요.</div>';
        return;
    }
    if (unassigned.length === 0) {
        ELEMENTS.unassignedList.innerHTML = '<div class="empty-list-msg">모두 자리를 찾았어요! 🎉</div>';
        return;
    }

    ELEMENTS.unassignedList.innerHTML = '';
    unassigned.forEach((s, i) => {
        const div = document.createElement('div');
        div.className = 'unassigned-student';
        div.draggable = true;
        div.setAttribute('data-id', s.id);
        div.style.setProperty('--note', getStudentAvatar(s.displayNum, s.name).color);
        div.style.setProperty('--tilt', `${seatTilt(i + 3) * 0.6}deg`);
        div.innerHTML = `
            <div class="unassigned-avatar">${s.displayNum}</div>
            <div class="unassigned-name">${s.name}</div>
        `;
        div.addEventListener('dragstart', handleSidebarDragStart);
        div.addEventListener('dragend', handleSidebarDragEnd);
        ELEMENTS.unassignedList.appendChild(div);
    });
}

function getStudentAvatar(id, name) {
    const num = parseInt(id) || 0;
    return { initial: name ? name.charAt(0) : '?', color: CONFIG.COLORS[num % CONFIG.COLORS.length] };
}

/* ==========================================
   8. Event Handlers
   ========================================== */

async function handleFileLoad() {
    const file = ELEMENTS.csvInput.files[0];
    if (!file) return;

    try {
        const fileName = file.name.toLowerCase();
        students = (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) 
            ? await parseXLSX(file) 
            : parseCSV(await file.text());
        
        initDefaultLayout(students.length);
        currentAssignment = new Array(TOTAL_SEATS).fill(null);
        renderUnassignedList();
        renderSeating(currentAssignment, true);
        ELEMENTS.fileLabel.textContent = file.name;
        ELEMENTS.fileLabel.parentElement.title = file.name;
    } catch (err) {
        alert("파일 읽기 오류: " + err.message);
    }
}

async function handleGenerate() {
    if (students.length === 0) {
        alert("학생 명단 파일(CSV 또는 엑셀)을 먼저 업로드해 주세요.\n양식은 '엑셀 양식 다운로드' 버튼으로 받을 수 있습니다.");
        return;
    }
    const assignment = optimizeSeating(students, currentAssignment);
    const prev = [...currentAssignment];
    currentAssignment = [...assignment];
    await renderSeating(currentAssignment, false, prev);
    renderUnassignedList();
}

function handleDownload() {
    if (isEditMode) {
        alert("자리 구조 고치기를 먼저 끝내 주세요.");
        return;
    }
    if (!ELEMENTS.seatingGrid.children.length || ELEMENTS.seatingGrid.querySelector('.empty-state')) {
        alert("저장할 배치도가 없습니다.");
        return;
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // 저장본 머리글의 날짜는 저장하는 날 기준으로
    ELEMENTS.roomDate.textContent = formatRoomDate(now);

    html2canvas(ELEMENTS.classroom, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        onclone: (clonedDoc) => {
            // 화면은 창 크기에 맞춰 늘어나지만, 저장본은 어떤 화면에서 눌러도 같은
            // 크기로 나오도록 고정 레이아웃으로 되돌린다. (100vh에 묶인 상위 높이도 푼다)
            [clonedDoc.body, clonedDoc.querySelector('.container'), clonedDoc.querySelector('.main-sheet')].forEach(el => {
                if (el) Object.assign(el.style, { height: 'auto', minHeight: '0', overflow: 'visible', flex: 'none' });
            });
            const clonedClassroom = clonedDoc.querySelector('.classroom');
            Object.assign(clonedClassroom.style, {
                flex: 'none', width: '900px', height: 'auto',
                padding: '34px 44px 36px', gap: '22px',
                background: '#ffffff'   // 모눈 없이 흰 바탕
            });
            const clonedGrid = clonedDoc.querySelector('.seating-grid');
            Object.assign(clonedGrid.style, {
                flex: 'none', maxWidth: 'none', gap: '18px 18px', gridAutoRows: '96px', padding: '10px 4px 4px'
            });
            clonedDoc.querySelectorAll('.seat').forEach(seat => {
                seat.style.transition = 'none';
                seat.classList.remove('spotlight', 'drag-over', 'dragging');
            });
            // 자리 번호는 화면 조작용이라 저장본에서는 뺀다
            clonedDoc.querySelectorAll('.seat-number').forEach(num => { num.style.display = 'none'; });
        }
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `자리배치도_${dateStr}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

/* ==========================================
   9. Interaction (Drag & Drop, Edit Mode)
   ========================================== */
function toggleEditMode() {
    isEditMode = !isEditMode;
    ELEMENTS.editBtn.textContent = isEditMode ? EDIT_LABEL.on : EDIT_LABEL.off;
    ELEMENTS.editBtn.classList.toggle('btn-active', isEditMode);
    ELEMENTS.classroom.classList.toggle('is-editing', isEditMode);
    
    if (isEditMode) {
        renderEditGrid();
    } else {
        if (currentAssignment.length !== TOTAL_SEATS) {
            const newAssignment = new Array(TOTAL_SEATS).fill(null);
            for (let i = 0; i < Math.min(currentAssignment.length, TOTAL_SEATS); i++) {
                newAssignment[i] = currentAssignment[i];
            }
            currentAssignment = newAssignment;
        }
        renderSeating(currentAssignment, true);
    }
}

function renderEditGrid() {
    ELEMENTS.seatingGrid.innerHTML = '';
    ELEMENTS.seatingGrid.style.setProperty('--grid-cols', CONFIG.GRID.COLS);
    const seatIdxs = new Set(activeSeats.map(s => s.idx));
    for (let r = 0; r < CONFIG.GRID.ROWS; r++) {
        for (let c = 0; c < CONFIG.GRID.COLS; c++) {
            const idx = r * CONFIG.GRID.COLS + c;
            const cell = document.createElement('div');
            cell.className = 'seat-edit-cell' + (seatIdxs.has(idx) ? ' active' : '');
            cell.addEventListener('click', () => {
                if (seatIdxs.has(idx)) {
                    activeSeats = activeSeats.filter(s => s.idx !== idx);
                    cell.classList.remove('active');
                } else {
                    activeSeats.push({ idx, r, c });
                    cell.classList.add('active');
                }
                TOTAL_SEATS = activeSeats.length;
            });
            ELEMENTS.seatingGrid.appendChild(cell);
        }
    }
}

// Drag & Drop
function handleSidebarDragStart(e) {
    if (isEditMode || ELEMENTS.classroom.classList.contains('is-announcing')) { e.preventDefault(); return; }
    draggedSidebarId = parseInt(this.getAttribute('data-id'));
    draggedSeatIndex = null;
    this.classList.add('dragging');
}

// 배치된 학생을 클릭하면 자리에서 빼서 대기 명단으로 돌린다.
function handleSeatClick() {
    if (isEditMode || ELEMENTS.classroom.classList.contains('is-announcing')) return;
    const idx = parseInt(this.getAttribute('data-index'));
    if (!currentAssignment[idx]) return;
    currentAssignment[idx] = null;
    updateSingleSeatDOM(idx);
    renderUnassignedList();
}

function handleSidebarDragEnd() { this.classList.remove('dragging'); }

function handleDragStart(e) {
    if (isEditMode || ELEMENTS.classroom.classList.contains('is-announcing')) { e.preventDefault(); return; }
    draggedSeatIndex = parseInt(this.getAttribute('data-index'));
    draggedSidebarId = null;
    this.classList.add('dragging');
}

function handleDragOver(e) { e.preventDefault(); this.classList.add('drag-over'); }
function handleDragLeave() { this.classList.remove('drag-over'); }
function handleDragEnd() { 
    this.classList.remove('dragging');
    ELEMENTS.seatingGrid.querySelectorAll('.seat').forEach(s => s.classList.remove('drag-over'));
}

function handleDrop(e) {
    this.classList.remove('drag-over');
    const targetIdx = parseInt(this.getAttribute('data-index'));

    if (draggedSidebarId !== null) {
        currentAssignment[targetIdx] = students.find(s => s.id === draggedSidebarId);
        updateSingleSeatDOM(targetIdx);
        renderUnassignedList();
    } else if (draggedSeatIndex !== null && draggedSeatIndex !== targetIdx) {
        [currentAssignment[draggedSeatIndex], currentAssignment[targetIdx]] = [currentAssignment[targetIdx], currentAssignment[draggedSeatIndex]];
        updateSingleSeatDOM(draggedSeatIndex);
        updateSingleSeatDOM(targetIdx);
    }
}

function updateSingleSeatDOM(idx) {
    const student = currentAssignment[idx];
    const div = ELEMENTS.seatingGrid.querySelector(`.seat[data-index="${idx}"]`);
    if (div) updateSeatContent({ div, nameDiv: div.querySelector('.student-name'), avatarDiv: div.querySelector('.student-avatar') }, student);
}

/* ==========================================
   10. Global Listeners & Start
   ========================================== */
ELEMENTS.csvInput.addEventListener('change', handleFileLoad);
ELEMENTS.generateBtn.addEventListener('click', handleGenerate);
ELEMENTS.downloadBtn.addEventListener('click', handleDownload);
ELEMENTS.editBtn.addEventListener('click', toggleEditMode);
ELEMENTS.templateBtn.addEventListener('click', downloadTemplate);

if (ELEMENTS.unassignedList) {
    ELEMENTS.unassignedList.addEventListener('dragover', e => {
        e.preventDefault();
        if (draggedSeatIndex !== null) ELEMENTS.unassignedList.classList.add('drag-over');
    });
    ELEMENTS.unassignedList.addEventListener('dragleave', e => {
        if (!ELEMENTS.unassignedList.contains(e.relatedTarget)) ELEMENTS.unassignedList.classList.remove('drag-over');
    });
    ELEMENTS.unassignedList.addEventListener('drop', e => {
        ELEMENTS.unassignedList.classList.remove('drag-over');
        if (draggedSeatIndex !== null) {
            currentAssignment[draggedSeatIndex] = null;
            updateSingleSeatDOM(draggedSeatIndex);
            renderUnassignedList();
        }
    });
}

function formatRoomDate(d) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
}
ELEMENTS.roomDate.textContent = formatRoomDate(new Date());

// 기본 명단 없이 빈 교실로 시작한다. 명단은 파일 업로드로만 불러온다.
function initEmptyClassroom() {
    initDefaultLayout();
    currentAssignment = new Array(TOTAL_SEATS).fill(null);
    renderUnassignedList();
    renderSeating(currentAssignment, true);
}

initEmptyClassroom();

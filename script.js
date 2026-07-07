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
        TEMP_FINAL: 0.1
    },
    COLORS: [
        '#b3e5fc', '#80deea', '#e0f2f1', '#e8f5e9', '#fff9c4', '#ffe0b2', '#ffccbc', '#d1c4e9',
        '#81d4fa', '#4dd0e1', '#b2dfdb', '#c8e6c9', '#fff59d', '#ffb74d', '#ffab91', '#b39ddb'
    ]
};

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
    seatingGrid: document.getElementById('seatingGrid'),
    classroom: document.querySelector('.classroom'),
    unassignedList: document.getElementById('unassignedList'),
    classroomObjects: document.getElementById('classroomObjects')
};

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

/* ==========================================
   6. Seating Algorithm (Optimization)
   ========================================== */

/**
 * Main optimization controller
 */
function optimizeSeating(studentList, preAssigned = []) {
    let seats = preAssigned.length > 0 ? [...preAssigned] : new Array(TOTAL_SEATS).fill(null);

    // --- Hard-lock: fixed seat positions ---
    // fixed='3' → r=1,c=1 (맨 뒤에서 왼쪽 2번째)
    const fixed3Student = studentList.find(s => s.fixed.trim() === '3');
    if (fixed3Student) {
        const seatIdx = activeSeats.findIndex(s => s.r === 1 && s.c === 1);
        if (seatIdx !== -1) seats[seatIdx] = fixed3Student;
    }
    // fixed='2' → r=1,c=0 (3번 자리 왼쪽)
    const fixed2Student = studentList.find(s => s.fixed.trim() === '2');
    if (fixed2Student) {
        const seatIdx = activeSeats.findIndex(s => s.r === 1 && s.c === 0);
        if (seatIdx !== -1) seats[seatIdx] = fixed2Student;
    }

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
    // fixed='3' → r=1,c=1
    const idx3 = activeSeats.findIndex(s => s.r === 1 && s.c === 1);
    if (idx3 !== -1 && seats[idx3] === null) {
        const i = remainingUnassigned.findIndex(s => s.fixed.trim() === '3');
        if (i !== -1) { seats[idx3] = remainingUnassigned[i]; remainingUnassigned.splice(i, 1); }
    }
    // fixed='2' → r=1,c=0 (3번 자리 왼쪽)
    const idx2 = activeSeats.findIndex(s => s.r === 1 && s.c === 0);
    if (idx2 !== -1 && seats[idx2] === null) {
        const i = remainingUnassigned.findIndex(s => s.fixed.trim() === '2');
        if (i !== -1) { seats[idx2] = remainingUnassigned[i]; remainingUnassigned.splice(i, 1); }
    }

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
        studentsInGroup.sort(() => Math.random() - 0.5);
        indices.filter(i => seats[i] === null).forEach(i => {
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
            if (currentScore > bestScore) {
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
        if (student.fixed.trim() === '3' && !(seat.r === 1 && seat.c === 1)) {
            score -= 100000;
        }
        if (student.fixed.trim() === '2' && !(seat.r === 1 && seat.c === 0)) {
            score -= 100000;
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
                
                if (dist > 0) {
                    const penalty = Math.round(-300 / dist);
                    score += penalty;
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
        ELEMENTS.editBtn.textContent = "자리 구조 수정";
        ELEMENTS.editBtn.classList.remove('btn-active');
    }
    ELEMENTS.seatingGrid.innerHTML = '';
    ELEMENTS.seatingGrid.style.setProperty('--grid-cols', CONFIG.GRID.COLS);
    
    const seatElements = [];

    // Sort: Bottom rows (near teacher) first for sequential reveal
    activeSeats.sort((a, b) => b.r !== a.r ? b.r - a.r : a.c - b.c);
    const maxRow = Math.max(...activeSeats.map(s => s.r));

    activeSeats.forEach((seat, i) => {
        const div = createSeatElement(seat, i, maxRow);
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
    ELEMENTS.generateBtn.textContent = "발표 중...";
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
    ELEMENTS.generateBtn.textContent = "자리 배치하기";
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    
    // Enable dragging
    ELEMENTS.seatingGrid.querySelectorAll('.seat').forEach(s => s.draggable = true);
}

function createSeatElement(seat, i, maxRow) {
    const div = document.createElement('div');
    div.className = 'seat';
    div.setAttribute('data-index', i);
    div.style.gridRow = seat.r + 1;
    div.style.gridColumn = seat.c + 1;

    div.innerHTML = `
        <div class="seat-number"></div>
        <div class="student-avatar" style="opacity: 0"></div>
        <div class="student-name"></div>
    `;

    if (seat.r >= maxRow - 1) div.classList.add('zone-front');
    if (seat.r <= 1) div.classList.add('zone-back');

    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('dragleave', handleDragLeave);
    div.addEventListener('drop', handleDrop);
    div.addEventListener('dragend', handleDragEnd);

    return div;
}

function updateSeatContent(el, s) {
    if (!s) {
        el.nameDiv.innerText = "";
        el.avatarDiv.style.opacity = '0';
        el.div.title = "";
        return;
    }
    el.nameDiv.innerText = s.name;
    el.nameDiv.style.color = "#000";
    el.nameDiv.style.fontWeight = "bold";

    const avatar = getStudentAvatar(s.displayNum, s.name);
    el.avatarDiv.innerText = s.displayNum;
    el.avatarDiv.style.backgroundColor = avatar.color;
    el.avatarDiv.style.opacity = '1';

    let tooltip = `번호: ${s.displayNum}\n`;
    if (s.reason) tooltip += `사유: ${s.reason}\n`;
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

    if (students.length === 0) {
        ELEMENTS.unassignedList.innerHTML = '<div class="empty-list-msg">파일을 업로드하면<br>명단이 표시됩니다.</div>';
        return;
    }
    if (unassigned.length === 0) {
        ELEMENTS.unassignedList.innerHTML = '<div class="empty-list-msg">모든 학생이<br>배치되었습니다.</div>';
        return;
    }

    ELEMENTS.unassignedList.innerHTML = '';
    unassigned.forEach(s => {
        const div = document.createElement('div');
        div.className = 'unassigned-student';
        div.draggable = true;
        div.setAttribute('data-id', s.id);
        const avatar = getStudentAvatar(s.displayNum, s.name);
        div.innerHTML = `
            <div class="unassigned-avatar" style="background-color: ${avatar.color}">${s.displayNum}</div>
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
    } catch (err) {
        alert("파일 읽기 오류: " + err.message);
    }
}

async function handleGenerate() {
    if (students.length === 0) {
        alert("학생 명단 파일(CSV 또는 엑셀)을 먼저 업로드해 주세요.\n양식이 없다면 정보T에게 문의하세요.");
        return;
    }
    const assignment = optimizeSeating(students, currentAssignment);
    const prev = [...currentAssignment];
    currentAssignment = [...assignment];
    await renderSeating(currentAssignment, false, prev);
    renderUnassignedList();
}

function handleDownload() {
    if (!ELEMENTS.seatingGrid.children.length || ELEMENTS.seatingGrid.querySelector('.empty-state')) {
        alert("저장할 배치도가 없습니다.");
        return;
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // Temp stamp
    const stamp = document.createElement('div');
    stamp.innerText = dateStr;
    stamp.className = 'temp-date-stamp';
    stamp.style = "position:absolute; bottom:10px; left:50%; transform:translateX(-50%); font-size:1.2rem; color:#666; font-family:'Do Hyeon';";
    
    ELEMENTS.classroom.style.position = 'relative';
    ELEMENTS.classroom.appendChild(stamp);

    html2canvas(ELEMENTS.classroom, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        // html2canvas는 backdrop-filter(글래스 블러)를 지원하지 않아 반투명 배경이
        // 흐릿하게 뽑힌다. 캡처용 복제본에서만 블러를 없애고 배경을 불투명으로 강제한다.
        onclone: (clonedDoc) => {
            const clonedClassroom = clonedDoc.querySelector('.classroom');
            if (clonedClassroom) {
                clonedClassroom.style.backdropFilter = 'none';
                clonedClassroom.style.webkitBackdropFilter = 'none';
                clonedClassroom.style.background = '#ffffff';
            }
            // 인쇄 대비 보정: 화면에선 옅은 테두리/글자가 예쁘지만 프린터에선
            // 날아가 흐리게 나온다. 저장본에서만 좌석을 불투명 흰색 + 진한 테두리로,
            // 번호는 진한 회색으로 강제해 또렷하게 인쇄되도록 한다.
            clonedDoc.querySelectorAll('.seat').forEach(seat => {
                seat.style.background = '#ffffff';
                seat.style.border = '2px solid #6b7785';
                seat.style.boxShadow = 'none';
            });
            clonedDoc.querySelectorAll('.seat-number').forEach(num => {
                num.style.color = '#333333';
            });
            // 교탁 테두리(점선)도 진하게
            const clonedDesk = clonedDoc.querySelector('.teacher-desk');
            if (clonedDesk) clonedDesk.style.border = '2px solid #4a6a80';
        }
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `자리배치도_${dateStr}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        stamp.remove();
    });
}

/* ==========================================
   9. Interaction (Drag & Drop, Edit Mode)
   ========================================== */
function toggleEditMode() {
    isEditMode = !isEditMode;
    ELEMENTS.editBtn.textContent = isEditMode ? "수정 완료" : "자리 구조 수정";
    ELEMENTS.editBtn.classList.toggle('btn-active', isEditMode);
    
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

if (ELEMENTS.unassignedList) {
    ELEMENTS.unassignedList.addEventListener('dragover', e => e.preventDefault());
    ELEMENTS.unassignedList.addEventListener('drop', e => {
        if (draggedSeatIndex !== null) {
            currentAssignment[draggedSeatIndex] = null;
            updateSingleSeatDOM(draggedSeatIndex);
            renderUnassignedList();
        }
    });
}

const DEFAULT_CSV_DATA = `번호,이름,같이앉고싶은친구,기피하는친구,희망고정자리,이유
1,권지훈,,,,
2,김다율,,,뒷자리,시력이 좋다
3,김서윤,,,,
4,김선민,,,뒷자리,키가 커서 앞에 앉으면 앞을 다 가림
5,김아린,,"이서후, 김태민",뒷자리,배에서 소리나면 민망해서 최대한 뒤에 가고싶어요ㅠ
6,김은비,,,,
7,김태민,,,,
8,김하빈,,"차윤우, 김다율, 박재우, 권지훈",,
9,박기령,,,,
10,박소현,,,앞자리,공부!!!!!!!!집중!!!!!!!!!!
11,박자희,,,,
12,박재우,,,,
13,서민주,,"차윤우, 박재우",,
14,안성은,,,,
15,이서후,,"장주영, 김아린, 김태민, 김선민, 전승민, 이온유",,
16,이온유,,,,
17,이재인,,차윤우,,
18,이채원,,,,
19,이효린,,,뒷자리,뒷쪽에 앉아서 판서 내용과 수업의 흐름을 한눈에 파악하고 싶기 때문입니다
20,장주영,,,,
21,전수빈,,,,
22,전승민,,,,
23,조문준,,,,
24,차윤우,,,,
25,한소희,,,,
26,홍예은,,,,`;

async function loadDefaultData() {
    let csvText = "";
    try {
        const response = await fetch('자리 바꾸기 설문조사!!(응답) - 시트3.csv');
        if (response.ok) {
            csvText = await response.text();
            console.log("Loaded student data from external CSV file.");
        } else {
            throw new Error("Fetch failed with status: " + response.status);
        }
    } catch (e) {
        console.warn("Failed to fetch external CSV, using local fallback data: ", e);
        csvText = DEFAULT_CSV_DATA;
    }

    try {
        students = parseCSV(csvText);
        initDefaultLayout(students.length);
        currentAssignment = new Array(TOTAL_SEATS).fill(null);
        renderUnassignedList();
        renderSeating(currentAssignment, true);
    } catch (err) {
        console.error("Error parsing default data:", err);
    }
}

loadDefaultData();

/* ==========================================
   11. Initialize ParticlesJS (Summer Bubble Background)
   ========================================== */
if (window.particlesJS) {
    particlesJS('particles-js', {
        "particles": {
            "number": {
                "value": 40,
                "density": {
                    "enable": true,
                    "value_area": 800
                }
            },
            "color": {
                "value": "#ffffff"
            },
            "shape": {
                "type": "circle"
            },
            "opacity": {
                "value": 0.4,
                "random": true,
                "anim": {
                    "enable": true,
                    "speed": 0.5,
                    "opacity_min": 0.1,
                    "sync": false
                }
            },
            "size": {
                "value": 8,
                "random": true,
                "anim": {
                    "enable": true,
                    "speed": 1.2,
                    "size_min": 2,
                    "sync": false
                }
            },
            "line_linked": {
                "enable": false
            },
            "move": {
                "enable": true,
                "speed": 1.5,
                "direction": "top",
                "random": true,
                "straight": false,
                "out_mode": "out",
                "bounce": false
            }
        },
        "interactivity": {
            "detect_on": "canvas",
            "events": {
                "onhover": {
                    "enable": false
                },
                "onclick": {
                    "enable": false
                },
                "resize": true
            }
        },
        "retina_detect": true
    });
}

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
        ITERATIONS: 20000,
        SCORE_LIKE: 20,
        SCORE_DISLIKE: -100
    },
    COLORS: [
        '#FFCDD2', '#F8BBD0', '#E1BEE7', '#D1C4E9', '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2', 
        '#B2DFDB', '#C8E6C9', '#DCEDC8', '#F0F4C3', '#FFF9C4', '#FFECB3', '#FFE0B2', '#FFCCBC'
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
            fixed: cols[4] || "",
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
                    fixed: String(cols[4] || "").normalize('NFC'),
                    reason: String(cols[5] || "").normalize('NFC')
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

    // Filter students already manually placed
    const assignedIds = new Set(seats.filter(Boolean).map(s => s.id));
    const unassignedStudents = studentList.filter(s => !assignedIds.has(s.id));

    // Fill remaining seats greedily based on fixed constraints (Front/Back)
    seats = fillGreedyInitialAssignment(seats, unassignedStudents);

    // Hill Climbing Optimization
    return runHillClimbing(seats, preAssigned);
}

function fillGreedyInitialAssignment(seats, unassigned) {
    const groups = { front: [], back: [], normal: [] };
    unassigned.forEach(s => {
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

function runHillClimbing(seats, lockedSeeds) {
    let currentScore = calculateScore(seats);

    for (let i = 0; i < CONFIG.ALGORITHM.ITERATIONS; i++) {
        const idx1 = Math.floor(Math.random() * TOTAL_SEATS);
        const idx2 = Math.floor(Math.random() * TOTAL_SEATS);

        if (idx1 === idx2 || lockedSeeds[idx1] || lockedSeeds[idx2]) continue;

        const s1 = seats[idx1];
        const s2 = seats[idx2];

        if (!canBeAt(s1, idx2) || !canBeAt(s2, idx1)) continue;

        // Swap
        seats[idx1] = s2;
        seats[idx2] = s1;

        const newScore = calculateScore(seats);
        if (newScore > currentScore || (newScore === currentScore && Math.random() < 0.2)) {
            currentScore = newScore;
        } else {
            // Revert
            seats[idx1] = s1;
            seats[idx2] = s2;
        }
    }
    return seats;
}

function calculateScore(seats) {
    let score = 0;
    const nameToIdx = {};
    seats.forEach((s, idx) => { if (s) nameToIdx[s.name] = idx; });

    seats.forEach((student, idx) => {
        if (!student) return;

        // Like Score
        student.likes.forEach(friend => {
            const fIdx = nameToIdx[friend];
            if (fIdx !== undefined) {
                const weight = getNeighborWeight(activeSeats[idx], activeSeats[fIdx]);
                if (weight > 0) score += CONFIG.ALGORITHM.SCORE_LIKE * weight;
            }
        });

        // Dislike Score
        student.dislikes.forEach(enemy => {
            const eIdx = nameToIdx[enemy];
            if (eIdx !== undefined) {
                const s1 = activeSeats[idx];
                const s2 = activeSeats[eIdx];
                if (Math.abs(s1.r - s2.r) <= 1 && Math.abs(s1.c - s2.c) <= 1) {
                    score += CONFIG.ALGORITHM.SCORE_DISLIKE;
                }
            }
        });
    });
    return score;
}

function getNeighborWeight(s1, s2) {
    const rDiff = Math.abs(s1.r - s2.r);
    const cDiff = Math.abs(s1.c - s2.c);

    if (rDiff === 0 && cDiff === 1) {
        const minC = Math.min(s1.c, s2.c);
        return (minC === 0 || minC === 2 || minC === 4) ? 1.0 : 0; // Partner vs Aisle
    }
    if (rDiff === 1 && cDiff === 0) return 0.5; // Vertical
    if (rDiff === 1 && cDiff === 1) return 0.3; // Diagonal
    return 0;
}

function canBeAt(student, index) {
    if (!student) return true;
    const seat = activeSeats[index];
    const maxRow = Math.max(...activeSeats.map(s => s.r));

    if (student.fixed.includes('앞')) return seat.r >= maxRow - 1;
    if (student.fixed.includes('뒤') || student.fixed.includes('뒷')) return seat.r <= 1;
    return true;
}

/* ==========================================
   7. UI & Rendering
   ========================================== */

async function renderSeating(seats, isSilent = false, prevAssignment = []) {
    if (isEditMode) toggleEditMode();
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

    if (seat.r >= maxRow - 1) div.style.backgroundColor = "#e8f5e9";
    if (seat.r <= 1) div.style.backgroundColor = "#ffebee";

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

    html2canvas(ELEMENTS.classroom, { backgroundColor: "#ffffff", scale: 2, useCORS: true }).then(canvas => {
        const link = document.createElement('a');
        link.download = `자리배치도_${dateStr}.png`;
        link.href = canvas.toDataURL();
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
    if (isEditMode) renderEditGrid();
    else ELEMENTS.seatingGrid.innerHTML = '<div class="empty-state">배치 완료 후 결과가 표시됩니다.</div>';
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

initDefaultLayout();

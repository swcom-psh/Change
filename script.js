// DOM Elements
const csvInput = document.getElementById('csvInput');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const editBtn = document.getElementById('editBtn');
const seatingGrid = document.getElementById('seatingGrid');
const classroomSection = document.querySelector('.classroom');
const classroomObjectsDiv = document.getElementById('classroomObjects');
const unassignedList = document.getElementById('unassignedList');

// Configuration
const GRID_ROWS = 6;
const GRID_COLS = 6;
let TOTAL_SEATS = 26;

// Algorithm Constants
const SCORE_LIKE = 20;
const SCORE_DISLIKE = -100;
const ITERATIONS = 20000; // Optimization attempts

// Default Data Fallback (for local file:// protocol compatibility)
// Removed default data per user request

// State
let students = [];
let activeSeats = []; // Array of {idx, row, col}
let currentAssignment = []; // Array of students currently in activeSeats
let isEditMode = false;
let draggedSeatIndex = null;
let draggedSidebarId = null;

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
csvInput.addEventListener('change', handleFileLoad);
generateBtn.addEventListener('click', handleGenerate);
downloadBtn.addEventListener('click', handleDownload);
editBtn.addEventListener('click', toggleEditMode);

if (unassignedList) {
    unassignedList.addEventListener('dragover', (e) => {
        e.preventDefault();
        unassignedList.classList.add('drag-over');
    });

    unassignedList.addEventListener('dragleave', () => {
        unassignedList.classList.remove('drag-over');
    });

    unassignedList.addEventListener('drop', (e) => {
        e.preventDefault();
        unassignedList.classList.remove('drag-over');
        
        if (draggedSeatIndex !== null) {
            // Move from seat to sidebar
            currentAssignment[draggedSeatIndex] = null;
            updateSeatDOM(draggedSeatIndex);
            renderUnassignedList();
            draggedSeatIndex = null;
        }
    });
}

async function handleFileLoad() {
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
            
            currentAssignment = new Array(TOTAL_SEATS).fill(null);
            renderUnassignedList();
            renderSeating(currentAssignment, true);
        }
    } catch (err) {
        console.error(err);
        alert("파일 읽기 오류: " + err.message);
    }
}

async function handleGenerate() {
    try {
        if (students.length === 0) {
            alert("학생 명단 파일(CSV 또는 엑셀)을 먼저 업로드해 주세요.\n양식이 없다면 정보T에게 문의하세요.");
            return;
        }

        generateBtn.textContent = "계산 중...";
        generateBtn.disabled = true;

        if (isEditMode) toggleEditMode();

        setTimeout(() => {
            const assignment = optimizeSeating(students, currentAssignment);
            const prevAssignment = [...currentAssignment];
            currentAssignment = [...assignment];
            renderSeating(currentAssignment, false, prevAssignment);

            generateBtn.textContent = "자리 배치하기";
            generateBtn.disabled = false;
            renderUnassignedList();
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
                        name: String(cols[1] || "").trim().normalize('NFC'),
                        likes: cols[2] ? String(cols[2]).normalize('NFC').split(/[|\s,]+/).filter(Boolean) : [],
                        dislikes: cols[3] ? String(cols[3]).normalize('NFC').split(/[|\s,]+/).filter(Boolean) : [],
                        fixed: String(cols[4] || "").normalize('NFC'),
                        reason: String(cols[5] || "").normalize('NFC')
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

// Check adjacency and return weight (1.0: Horizontal, 0.5: Vertical, 0.3: Diagonal, 0: None)
function getNeighborWeight(s1, s2) {
    if (!s1 || !s2) return 0;
    const rDiff = Math.abs(s1.r - s2.r);
    const cDiff = Math.abs(s1.c - s2.c);

    if (rDiff === 0 && cDiff === 1) {
        // Horizontal (Side-by-side)
        // Only (0,1), (2,3), (4,5) are real partners in a 6-col grid (1-2, 3-4, 5-6)
        const minC = Math.min(s1.c, s2.c);
        if (minC === 0 || minC === 2 || minC === 4) {
            return 1.0;
        }
        return 0; // Separated by aisle (1-2 or 3-4 column gap)
    }
    if (rDiff === 1 && cDiff === 0) return 0.5; // Vertical (Front-back)
    if (rDiff === 1 && cDiff === 1) return 0.3; // Diagonal
    return 0;
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
                const weight = getNeighborWeight(activeSeats[idx], activeSeats[friendIdx]);
                if (weight > 0) {
                    score += SCORE_LIKE * weight;
                }
            }
        });

        // Dislikes
        student.dislikes.forEach(enemyName => {
            if (nameToIdx[enemyName] !== undefined) {
                const enemyIdx = nameToIdx[enemyName];
                const s1 = activeSeats[idx];
                const s2 = activeSeats[enemyIdx];
                if (!s1 || !s2) return;

                const rDiff = Math.abs(s1.r - s2.r);
                const cDiff = Math.abs(s1.c - s2.c);

                // If they are within 1 row and 1 col of each other (including diagonal and across aisle)
                if (rDiff <= 1 && cDiff <= 1) {
                    score += SCORE_DISLIKE;
                }
            }
        });
    });

    return score;
}

function optimizeSeating(studentList, preAssigned = []) {
    let seats = preAssigned.length > 0 ? [...preAssigned] : new Array(TOTAL_SEATS).fill(null);

    // 1. Separate based on Fixed Constraints
    const frontGroup = [];
    const backGroup = [];
    const normalGroup = [];

    const assignedIds = new Set(seats.filter(Boolean).map(s => s.id));
    const unassignedStudents = studentList.filter(s => !assignedIds.has(s.id));

    unassignedStudents.forEach(s => {
        if (s.fixed.includes('앞')) frontGroup.push(s);
        else if (s.fixed.includes('뒤') || s.fixed.includes('뒷')) backGroup.push(s);
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

        // Skip if either seat was locked/pre-assigned by user
        if (preAssigned[idx1] || preAssigned[idx2]) continue;

        const s1 = seats[idx1];
        const s2 = seats[idx2];

        if (!canBeAt(s1, idx2) || !canBeAt(s2, idx1)) {
            continue;
        }

        seats[idx1] = s2;
        seats[idx2] = s1;

        const newScore = calculateScore(seats);

        // >= currentScore allows swapping even for the same score, increasing randomness
        if (newScore > currentScore || (newScore === currentScore && Math.random() < 0.2)) {
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
    if (student.fixed.includes('뒤') || student.fixed.includes('뒷')) {
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

function renderUnassignedList() {
    if (!unassignedList) return;
    unassignedList.innerHTML = '';
    
    const assignedIds = new Set(currentAssignment.filter(Boolean).map(s => s.id));
    const unassigned = students.filter(s => !assignedIds.has(s.id));
    
    if (unassigned.length === 0 && students.length > 0) {
        unassignedList.innerHTML = '<div class="empty-list-msg">모든 학생이<br>배치되었습니다.</div>';
        return;
    } else if (students.length === 0) {
        unassignedList.innerHTML = '<div class="empty-list-msg">파일을 업로드하면<br>명단이 표시됩니다.</div>';
        return;
    }

    unassigned.forEach(student => {
        const div = document.createElement('div');
        div.className = 'unassigned-student';
        div.draggable = true;
        div.setAttribute('data-id', student.id);
        
        const avatar = getStudentAvatar(student.displayNum, student.name);
        
        div.innerHTML = `
            <div class="unassigned-avatar" style="background-color: ${avatar.color}">${student.displayNum}</div>
            <div class="unassigned-name">${student.name}</div>
        `;
        
        div.addEventListener('dragstart', handleSidebarDragStart);
        div.addEventListener('dragend', handleSidebarDragEnd);
        
        unassignedList.appendChild(div);
    });
}

function handleSidebarDragStart(e) {
    if (isEditMode || classroomSection.classList.contains('is-announcing')) {
        e.preventDefault();
        return;
    }
    draggedSidebarId = parseInt(this.getAttribute('data-id'));
    draggedSeatIndex = null;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleSidebarDragEnd() {
    this.classList.remove('dragging');
    seatingGrid.querySelectorAll('.seat').forEach(s => s.classList.remove('drag-over'));
}

// Render Function (with Animation)
async function renderSeating(seats, isSilent = false, prevAssignment = []) {
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
        seatDiv.setAttribute('data-index', i);

        // Drag and Drop Attributes & Listeners
        seatDiv.addEventListener('dragstart', handleDragStart);
        seatDiv.addEventListener('dragover', handleDragOver);
        seatDiv.addEventListener('dragleave', handleDragLeave);
        seatDiv.addEventListener('drop', handleDrop);
        seatDiv.addEventListener('dragend', handleDragEnd);

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

    // 2. Animate Sequential Reveal
    if (!isSilent) {
        generateBtn.disabled = true;
        generateBtn.textContent = "발표 중...";
    }

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

    // First pass: immediately render pre-assigned students to prevent them from "disappearing" while other seats animate
    for (let i = 0; i < TOTAL_SEATS; i++) {
        const s = seats[i];
        if (!s) continue;
        
        if (isSilent || prevAssignment[i] === s) {
            seatElements[i].nameDiv.innerText = s.name;
            seatElements[i].nameDiv.style.color = "#000";
            seatElements[i].nameDiv.style.fontWeight = "bold";

            const avatar = getStudentAvatar(s.displayNum, s.name);
            seatElements[i].avatarDiv.innerText = s.displayNum;
            seatElements[i].avatarDiv.style.backgroundColor = avatar.color;
            seatElements[i].avatarDiv.style.opacity = '1';

            let tooltip = `번호: ${s.displayNum}\n`;
            if (s.reason) tooltip += `사유: ${s.reason}\n`;
            if (s.likes.length) tooltip += `선호: ${s.likes.join(', ')}\n`;
            if (s.dislikes.length) tooltip += `기피: ${s.dislikes.join(', ')}`;
            seatElements[i].div.title = tooltip;
        }
    }

    for (let i = 0; i < TOTAL_SEATS; i++) {
        const s = seats[i];
        if (!s) continue;

        // Skip animating if it's already pre-assigned
        if (!isSilent && prevAssignment[i] !== s) {
            classroomSection.classList.add('is-announcing');
            seatElements[i].div.classList.add('spotlight');

            await runRoulette(seatElements[i].nameDiv, s.name, 400);

            seatElements[i].div.classList.remove('spotlight');
            
            // Set final content
            seatElements[i].nameDiv.innerText = s.name;
            seatElements[i].nameDiv.style.color = "#000";
            seatElements[i].nameDiv.style.fontWeight = "bold";

            const avatar = getStudentAvatar(s.displayNum, s.name);
            seatElements[i].avatarDiv.innerText = s.displayNum; 
            seatElements[i].avatarDiv.style.backgroundColor = avatar.color;
            seatElements[i].avatarDiv.style.opacity = '1';

            let tooltip = `번호: ${s.displayNum}\n`;
            if (s.reason) tooltip += `사유: ${s.reason}\n`;
            if (s.likes.length) tooltip += `선호: ${s.likes.join(', ')}\n`;
            if (s.dislikes.length) tooltip += `기피: ${s.dislikes.join(', ')}`;
            seatElements[i].div.title = tooltip;
        }
    }

    if (!isSilent) {
        classroomSection.classList.remove('is-announcing');
        generateBtn.disabled = false;
        generateBtn.textContent = "자리 배치하기";

        // Enable dragging after animation
        seatingGrid.querySelectorAll('.seat').forEach(s => s.draggable = true);

        // 3. Celebration
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 }
        });
    } else {
        seatingGrid.querySelectorAll('.seat').forEach(s => s.draggable = true);
    }
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

// Drag & Drop Handlers
function handleDragStart(e) {
    if (isEditMode || classroomSection.classList.contains('is-announcing')) {
        e.preventDefault();
        return;
    }
    draggedSeatIndex = parseInt(this.getAttribute('data-index'));
    draggedSidebarId = null;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    this.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDragEnd() {
    this.classList.remove('dragging');
    seatingGrid.querySelectorAll('.seat').forEach(s => s.classList.remove('drag-over'));
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    this.classList.remove('drag-over');

    const targetIndex = parseInt(this.getAttribute('data-index'));

    if (draggedSidebarId !== null) {
        const student = students.find(s => s.id === draggedSidebarId);
        currentAssignment[targetIndex] = student;
        updateSeatDOM(targetIndex);
        renderUnassignedList();
        draggedSidebarId = null;
    } else if (draggedSeatIndex !== null && draggedSeatIndex !== targetIndex) {
        // Swap students in currentAssignment
        const temp = currentAssignment[draggedSeatIndex];
        currentAssignment[draggedSeatIndex] = currentAssignment[targetIndex];
        currentAssignment[targetIndex] = temp;

        // Update DOM for both seats
        updateSeatDOM(draggedSeatIndex);
        updateSeatDOM(targetIndex);
    }

    return false;
}

function updateSeatDOM(index) {
    const student = currentAssignment[index];
    const seatDiv = seatingGrid.querySelector(`.seat[data-index="${index}"]`);
    if (!seatDiv) return;

    const nameDiv = seatDiv.querySelector('.student-name');
    const avatarDiv = seatDiv.querySelector('.student-avatar');

    if (student) {
        nameDiv.innerText = student.name;
        nameDiv.style.color = "#000";
        nameDiv.style.fontWeight = "bold";

        const avatar = getStudentAvatar(student.displayNum, student.name);
        avatarDiv.innerText = student.displayNum;
        avatarDiv.style.backgroundColor = avatar.color;
        avatarDiv.style.opacity = '1';

        let tooltip = `번호: ${student.displayNum}\n`;
        if (student.reason) tooltip += `사유: ${student.reason}\n`;
        if (student.likes.length) tooltip += `선호: ${student.likes.join(', ')}\n`;
        if (student.dislikes.length) tooltip += `기피: ${student.dislikes.join(', ')}`;
        seatDiv.title = tooltip;
    } else {
        nameDiv.innerText = "";
        avatarDiv.innerText = "";
        avatarDiv.style.opacity = '0';
        seatDiv.title = "";
    }
}

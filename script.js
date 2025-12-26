// DOM Elements
const csvInput = document.getElementById('csvInput');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const seatingGrid = document.getElementById('seatingGrid');

// Configuration
const ROWS = 6;
const COLS = 5;
const TOTAL_SEATS = ROWS * COLS;

// Algorithm Constants
const SCORE_LIKE = 20;
const SCORE_DISLIKE = -100;
const ITERATIONS = 20000; // Optimization attempts

// State
let students = [];

// Event Listeners
generateBtn.addEventListener('click', handleGenerate);
downloadBtn.addEventListener('click', handleDownload);

async function handleGenerate() {
    const file = csvInput.files[0];
    if (!file) {
        alert("먼저 CSV 파일을 선택해주세요!");
        return;
    }

    try {
        const text = await file.text();
        students = parseCSV(text);

        if (students.length === 0) {
            alert("데이터가 없습니다.");
            return;
        }

        // Show loading state (simple)
        generateBtn.textContent = "계산 중...";
        generateBtn.disabled = true;

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
        // Handle CSV split more robustly (ignoring commas in quotes if needed, but simple split for now)
        const cols = line.split(',').map(c => c.trim());

        // CSV: 번호,이름,같이앉고싶은친구,기피하는친구,희망고정자리,이유
        return {
            id: index, // Internal ID
            displayNum: cols[0],
            name: cols[1],
            likes: cols[2] ? cols[2].split(/[| ]+/).filter(Boolean) : [],
            dislikes: cols[3] ? cols[3].split(/[| ]+/).filter(Boolean) : [],
            fixed: cols[4] || "", // '앞자리', '뒷자리'
            reason: cols[5] || ""
        };
    });
}

// Check adjacency between two seat indices
function isNeighbor(i, j) {
    const r1 = Math.floor(i / COLS);
    const c1 = i % COLS;
    const r2 = Math.floor(j / COLS);
    const c2 = j % COLS;

    const rDiff = Math.abs(r1 - r2);
    const cDiff = Math.abs(c1 - c2);

    // Adjacent (Horizontal, Vertical, Diagonal)
    // Distance 1 in Grid (Chebyshev distance = 1)
    return rDiff <= 1 && cDiff <= 1 && !(rDiff === 0 && cDiff === 0);
}

function calculateScore(seats) {
    let score = 0;

    // Map Name to Seat Index for fast lookup
    const nameToSeat = {};
    seats.forEach((s, idx) => {
        if (s) nameToSeat[s.name] = idx;
    });

    seats.forEach((student, idx) => {
        if (!student) return;

        // Likes
        student.likes.forEach(friendName => {
            if (nameToSeat[friendName] !== undefined) {
                if (isNeighbor(idx, nameToSeat[friendName])) {
                    score += SCORE_LIKE;
                }
            }
        });

        // Dislikes
        student.dislikes.forEach(enemyName => {
            if (nameToSeat[enemyName] !== undefined) {
                if (isNeighbor(idx, nameToSeat[enemyName])) {
                    score += SCORE_DISLIKE;
                }
            }
        });
    });

    return score; // Divide by 2 strictly speaking as pairs are counted twice, but fine for optimization
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

    // Indexes for regions
    const frontIndices = []; // Rows 0,1
    const backIndices = [];  // Rows 4,5
    const middleIndices = []; // Rows 2,3 (or leftovers)

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const idx = r * COLS + c;
            if (r < 2) frontIndices.push(idx);
            else if (r >= 4) backIndices.push(idx);
            else middleIndices.push(idx);
        }
    }

    // Assign Fixed Seats Randomly within their zones first
    // Helper to fill array
    function fillZone(zoneIndices, group) {
        // Shuffle group
        group.sort(() => Math.random() - 0.5);
        // Shuffle available seats
        const available = [...zoneIndices].filter(i => seats[i] === null);
        available.sort(() => Math.random() - 0.5);

        group.forEach(s => {
            if (available.length > 0) {
                seats[available.pop()] = s;
            } else {
                // Overflow (Shouldn't happen with valid constraint counts, but fallback to any empty)
                normalGroup.push(s);
            }
        });
    }

    fillZone(frontIndices, frontGroup);
    fillZone(backIndices, backGroup);

    // Fill remaining seats with normal group
    // Gather all empty seats
    let emptyIndices = seats.map((s, i) => s === null ? i : -1).filter(i => i !== -1);
    // Shuffle normal group
    normalGroup.sort(() => Math.random() - 0.5);

    normalGroup.forEach(s => {
        if (emptyIndices.length > 0) {
            // Pick a random empty slot
            const rndIdx = Math.floor(Math.random() * emptyIndices.length);
            seats[emptyIndices[rndIdx]] = s;
            emptyIndices.splice(rndIdx, 1);
        }
    });

    // 2. Optimization Loop (Hill Climbing / Simulated Annealing Lite)
    let currentScore = calculateScore(seats);

    for (let i = 0; i < ITERATIONS; i++) {
        // Pick two random indices
        const idx1 = Math.floor(Math.random() * TOTAL_SEATS);
        const idx2 = Math.floor(Math.random() * TOTAL_SEATS);

        if (idx1 === idx2) continue;

        const s1 = seats[idx1];
        const s2 = seats[idx2];

        // Check Constraints before swap
        // Can s1 go to idx2? Can s2 go to idx1?
        if (!canBeAt(s1, idx2) || !canBeAt(s2, idx1)) {
            continue;
        }

        // Try Swap
        seats[idx1] = s2;
        seats[idx2] = s1;

        const newScore = calculateScore(seats);

        if (newScore > currentScore) {
            currentScore = newScore;
            // Keep swap
        } else {
            // Revert swap (Standard Hill Climbing - reject if worse)
            // Or accept with probability if Simulated Annealing (skipping for simplicity/speed)
            seats[idx1] = s1;
            seats[idx2] = s2;
        }
    }

    return seats;
}

function canBeAt(student, index) {
    if (!student) return true; // Empty slot can be anywhere
    const row = Math.floor(index / COLS);

    if (student.fixed.includes('앞')) {
        return row < 2;
    }
    if (student.fixed.includes('뒤')) {
        return row >= 4;
    }
    return true;
}


// Render Function (with Animation)
async function renderSeating(seats) {
    // 1. Setup Grid first (Empty seats with numbers)
    seatingGrid.innerHTML = '';

    // Create all seat elements in "Empty" or "Waiting" state
    const seatElements = [];
    for (let i = 0; i < TOTAL_SEATS; i++) {
        const seatDiv = document.createElement('div');
        seatDiv.className = 'seat';
        const row = Math.floor(i / COLS);
        seatDiv.setAttribute('data-row', row);

        const numberDiv = document.createElement('div');
        numberDiv.className = 'seat-number';
        numberDiv.innerText = i + 1;

        const nameDiv = document.createElement('div');
        nameDiv.className = 'student-name';
        nameDiv.innerText = ""; // Initially empty

        seatDiv.appendChild(numberDiv);
        seatDiv.appendChild(nameDiv);

        // Visual Backgrounds for zones
        if (row < 2) seatDiv.style.backgroundColor = "#e8f5e9";
        if (row >= 4) seatDiv.style.backgroundColor = "#ffebee";

        seatingGrid.appendChild(seatDiv);
        seatElements.push({ div: seatDiv, nameDiv: nameDiv });
    }

    // 2. Animate Sequential Reveal
    generateBtn.disabled = true;
    generateBtn.textContent = "발표 중...";

    // Helper for Roulette Effect
    const runRoulette = (element, finalName, duration) => {
        return new Promise(resolve => {
            const possibleNames = students.map(s => s.name);
            let startTime = Date.now();

            // Fast text change
            let interval = setInterval(() => {
                element.innerText = possibleNames[Math.floor(Math.random() * possibleNames.length)];
                element.style.color = "#888"; // Dim color during spin
            }, 50);

            // Stop after duration
            setTimeout(() => {
                clearInterval(interval);
                element.innerText = finalName;
                element.style.color = "#000"; // Black color for result
                element.style.fontWeight = "bold";

                // Pop effect
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

    // Sequential Loop
    for (let i = 0; i < TOTAL_SEATS; i++) {
        if (!seats[i]) continue; // Skip if for some reason empty (shouldn't be)

        // highlight current seat processing
        seatElements[i].div.style.border = "3px solid #ffeb3b"; // Bright Yellow highlight

        // Run roulette
        await runRoulette(seatElements[i].nameDiv, seats[i].name, 400); // 400ms per seat

        // Restore border color (or keep it highlighted?) -> Let's revert to black or zone color
        // Actually style.css defines border color via class but inline overrides priority
        // Resetting inline border to allow CSS hover to work or just keep specific border
        seatElements[i].div.style.border = "";

        // Add Title/Tooltip after reveal
        const s = seats[i];
        let tooltip = `번호: ${s.displayNum}\n`;
        if (s.reason) tooltip += `사유: ${s.reason}\n`;
        if (s.likes.length) tooltip += `선호: ${s.likes.join(', ')}\n`;
        if (s.dislikes.length) tooltip += `기피: ${s.dislikes.join(', ')}`;
        seatElements[i].div.title = tooltip;
    }

    generateBtn.disabled = false;
    generateBtn.textContent = "자리 배치하기";
}

function handleDownload() {
    if (!seatingGrid.children.length || seatingGrid.querySelector('.empty-state')) {
        alert("저장할 배치도가 없습니다.");
        return;
    }
    html2canvas(document.querySelector('.classroom'), {
        backgroundColor: "#ffffff",
        scale: 2
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = '자리배치도.png';
        link.href = canvas.toDataURL();
        link.click();
    });
}

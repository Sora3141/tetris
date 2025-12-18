const VERSION = "v2.3.0 (SRS Refined)";

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;
const NEXT_COUNT = 5;

const canvas = document.getElementById('tetris-canvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const renElement = document.getElementById('ren-display');
const versionDiv = document.getElementById('version-display');
if (versionDiv) versionDiv.innerText = VERSION;

const holdCanvas = document.getElementById('hold-piece-canvas');
const holdCtx = holdCanvas.getContext('2d');
const nextCanvases = Array.from(document.querySelectorAll('.next-canvas'));
const nextContexts = nextCanvases.map(c => c.getContext('2d'));

canvas.width = COLS * BLOCK_SIZE;
canvas.height = ROWS * BLOCK_SIZE;

// ==================== ミノ定義 (SRS画像に基づいた初期配置) ====================
const PIECES = [
    { name: 'I', color: '#00f0f0', shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
    { name: 'J', color: '#0000f0', shape: [[1,0,0],[1,1,1],[0,0,0]] },
    { name: 'L', color: '#f0a000', shape: [[0,0,1],[1,1,1],[0,0,0]] },
    { name: 'O', color: '#f0f000', shape: [[1,1],[1,1]] },
    { name: 'S', color: '#00f0f0', shape: [[0,1,1],[1,1,0],[0,0,0]] },
    { name: 'T', color: '#a000f0', shape: [[0,1,0],[1,1,1],[0,0,0]] },
    { name: 'Z', color: '#f00000', shape: [[1,1,0],[0,1,1],[0,0,0]] }
];

// SRS Kick (J,L,S,T,Z)
const KICK_TABLE = [
    [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], // 0->1
    [[0,0],[1,0],[1,-1],[0,2],[1,2]],    // 1->2
    [[0,0],[1,0],[1,1],[0,-2],[1,-2]],   // 2->3
    [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]]  // 3->0
];

// SRS Kick (I)
const KICK_TABLE_I = [
    [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],  // 0->1
    [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],  // 1->2
    [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],  // 2->3
    [[0,0],[1,0],[-2,0],[1,-2],[-2,1]]   // 3->0
];

let score = 0, level = 1, linesTotal = 0, ren = -1, board = [];
let currentPiece = null, nextQueue = [], holdPiece = null, canHold = true;
let gameLoop = null, interval = 800;

// ==================== 描画関数 ====================
function drawBlock(x, y, color, context, size) {
    context.fillStyle = color;
    context.fillRect(x * size, y * size, size, size);
    context.strokeStyle = 'rgba(0,0,0,0.3)';
    context.strokeRect(x * size, y * size, size, size);
    context.fillStyle = 'rgba(255,255,255,0.2)';
    context.fillRect(x * size, y * size, size, 3);
    context.fillRect(x * size, y * size, 3, size);
}

function drawCentered(piece, context, cw, ch, isLocked = false) {
    const shape = piece.shape;
    const color = isLocked ? '#555' : piece.color;
    context.clearRect(0, 0, cw, ch);
    let minR = shape.length, maxR = -1, minC = shape[0].length, maxC = -1;
    shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
    }));
    const rw = maxC - minC + 1, rh = maxR - minR + 1, bs = 18;
    const ox = (cw - rw * bs) / 2, oy = (ch - rh * bs) / 2;
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            if (shape[r][c]) drawBlock((ox/bs)+(c-minC), (oy/bs)+(r-minR), color, context, bs);
        }
    }
}

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#222';
    for(let x=0; x<=COLS; x++) { ctx.beginPath(); ctx.moveTo(x*BLOCK_SIZE,0); ctx.lineTo(x*BLOCK_SIZE,canvas.height); ctx.stroke(); }
    for(let y=0; y<=ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*BLOCK_SIZE); ctx.lineTo(canvas.width,y*BLOCK_SIZE); ctx.stroke(); }
    board.forEach((row, r) => row.forEach((v, c) => { if (v) drawBlock(c, r, v, ctx, BLOCK_SIZE); }));
    if (currentPiece) {
        const dy = getDropY();
        ctx.globalAlpha = 0.15;
        currentPiece.shape.forEach((row, r) => row.forEach((v, c) => { if(v) drawBlock(currentPiece.x+c, dy+r, currentPiece.color, ctx, BLOCK_SIZE); }));
        ctx.globalAlpha = 1;
        currentPiece.shape.forEach((row, r) => row.forEach((v, c) => { if(v && currentPiece.y+r>=0) drawBlock(currentPiece.x+c, currentPiece.y+r, currentPiece.color, ctx, BLOCK_SIZE); }));
    }
}

// ==================== ロジック ====================
function rotate(m) { return m[0].map((_, c) => m.map(r => r[c]).reverse()); }
function rotateCCW(m) { return m[0].map((_, c) => m.map(r => r[m[0].length-1-c])); }

function check(dx, dy, shape = currentPiece.shape, x = currentPiece.x, y = currentPiece.y) {
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c]) {
                const nx = x+dx+c, ny = y+dy+r;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
                if (ny >= 0 && board[ny][nx]) return true;
            }
        }
    }
    return false;
}

function getDropY() {
    let y = currentPiece.y;
    while (!check(0, 1, currentPiece.shape, currentPiece.x, y)) y++;
    return y;
}

function spawn() {
    while (nextQueue.length < NEXT_COUNT) {
        const p = PIECES[Math.floor(Math.random() * PIECES.length)];
        nextQueue.push({ ...p, shape: p.shape.map(r => [...r]) });
    }
    const n = nextQueue.shift();
    currentPiece = { ...n, x: Math.floor(COLS/2)-Math.floor(n.shape[0].length/2), y: 0, rotation: 0 };
    nextContexts.forEach((nc, i) => { if(nextQueue[i]) drawCentered(nextQueue[i], nc, 90, 90); });
    if (check(0, 0)) { clearInterval(gameLoop); alert("GameOver"); init(); }
}

function updateScore(l) {
    if (l > 0) {
        ren++;
        score += [0, 100, 300, 500, 800][l] * level + (ren > 0 ? ren * 50 * level : 0);
        linesTotal += l;
        if (Math.floor(linesTotal/10) >= level) { level++; interval *= 0.9; resetLoop(); }
    } else ren = -1;
    scoreElement.innerText = `${score} (Lv.${level})`;
    renElement.innerText = ren > 0 ? `${ren} REN!` : "";
    renElement.style.opacity = ren > 0 ? "1" : "0";
}

function solidify() {
    currentPiece.shape.forEach((row, r) => row.forEach((v, c) => { if(v && currentPiece.y+r>=0) board[currentPiece.y+r][currentPiece.x+c] = currentPiece.color; }));
    let l = 0;
    for (let r = ROWS-1; r >= 0; r--) { if (board[r].every(v => v !== 0)) { board.splice(r, 1); board.unshift(Array(COLS).fill(0)); l++; r++; } }
    updateScore(l);
    canHold = true;
    if (holdPiece) drawCentered(holdPiece, holdCtx, 150, 150, false);
    spawn();
}

function resetLoop() {
    if (gameLoop) clearInterval(gameLoop);
    gameLoop = setInterval(() => { if (!check(0, 1)) currentPiece.y++; else solidify(); drawBoard(); }, interval);
}

function init() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    score = 0; level = 1; ren = -1; linesTotal = 0; interval = 800;
    holdPiece = null; canHold = true; nextQueue = []; currentPiece = null;
    updateScore(0); drawBoard();
}

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !gameLoop) { spawn(); resetLoop(); return; }
    if (!currentPiece) return;
    if (e.key === 'ArrowLeft' && !check(-1, 0)) currentPiece.x--;
    if (e.key === 'ArrowRight' && !check(1, 0)) currentPiece.x++;
    if (e.key === 'ArrowDown' && !check(0, 1)) { currentPiece.y++; score++; updateScore(0); }
    if (e.key === 'ArrowUp' || e.key === 'x') {
        const ns = rotate(currentPiece.shape);
        const ks = (currentPiece.name === 'I') ? KICK_TABLE_I[currentPiece.rotation] : KICK_TABLE[currentPiece.rotation];
        for (let [dx, dy] of ks) { if (!check(dx, -dy, ns)) { currentPiece.shape = ns; currentPiece.x += dx; currentPiece.y -= dy; currentPiece.rotation = (currentPiece.rotation + 1) % 4; break; } }
    }
    if (e.key === 'z') {
        const ns = rotateCCW(currentPiece.shape);
        if (!check(0, 0, ns)) { currentPiece.shape = ns; currentPiece.rotation = (currentPiece.rotation + 3) % 4; }
    }
    if (e.key === 'c' && canHold) {
        const type = PIECES.find(p => p.name === currentPiece.name);
        if (!holdPiece) { holdPiece = { ...type }; spawn(); }
        else { const t = holdPiece; holdPiece = { ...type }; currentPiece = { ...t, x: Math.floor(COLS/2)-Math.floor(t.shape[0].length/2), y: 0, rotation: 0 }; }
        canHold = false; drawCentered(holdPiece, holdCtx, 150, 150, true);
    }
    if (e.key === ' ') { score += (getDropY() - currentPiece.y) * 2; currentPiece.y = getDropY(); solidify(); }
    drawBoard();
});

init();
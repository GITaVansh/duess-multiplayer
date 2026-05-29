const socket = io();

// DOM Elements
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const lobbyMessages = document.getElementById('lobby-messages');

const timerDisplay = document.getElementById('timer-display');
const wordHintDisplay = document.getElementById('word-hint-display');
const roundInfo = document.getElementById('round-info');
const playersList = document.getElementById('players-list');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const gameOverlay = document.getElementById('game-overlay');
const overlayTitle = document.getElementById('overlay-title');
const wordChoicesDiv = document.getElementById('word-choices');
const overlayMessage = document.getElementById('overlay-message');
const toolbox = document.getElementById('toolbox');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const eraserBtn = document.getElementById('eraser-btn');
const fillBtn = document.getElementById('fill-btn');
const undoBtn = document.getElementById('undo-btn');
const clearBtn = document.getElementById('clear-btn');
const hintBtn = document.getElementById('hint-btn');

// Game State
let myId = null;
let myRole = 'GUESSER';
let currentDrawerId = null;
let gameState = 'LOBBY';
let isDrawing = false;
let lastX = 0;
let lastY = 0;

let currentTool = 'pen'; // 'pen', 'eraser', 'fill'
let undoStack = [];

function saveState() {
    if (myRole !== 'DRAWER') return;
    undoStack.push(canvas.toDataURL());
    if (undoStack.length > 20) undoStack.shift();
}

function restoreState(isLocal) {
    if (undoStack.length > 0) {
        const dataUrl = undoStack.pop();
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    if (isLocal) {
        socket.emit('undo');
    }
}

// Initialize CrazyGames SDK
let cgInitialized = false;
async function initCrazyGames() {
    try {
        if (window.CrazyGames && window.CrazyGames.SDK) {
            await window.CrazyGames.SDK.game.sdkGameLoadingStart();
            await window.CrazyGames.SDK.game.sdkGameLoadingStop();
            cgInitialized = true;
            console.log("CrazyGames SDK initialized");
        }
    } catch (e) {
        console.error("CrazyGames SDK Error:", e);
    }
}
// Call init on load
initCrazyGames();

function addSystemMessage(text, isCorrect = false) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(isCorrect ? 'correct' : 'system');
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addChatMessage(username, text) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.innerHTML = `<strong>${username}:</strong> ${text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Socket Event Handlers
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('system_message', (msg) => {
    addSystemMessage(msg, msg.includes("guessed the word"));
    
    // Also show in lobby if active
    if (gameState === 'LOBBY') {
        const div = document.createElement('div');
        div.classList.add('message', 'system');
        div.textContent = msg;
        lobbyMessages.appendChild(div);
    }
});

socket.on('chat_message', ({ username, text }) => {
    addChatMessage(username, text);
});

socket.on('room_update', (room) => {
    gameState = room.state;
    currentDrawerId = room.currentDrawerId;
    
    // Switch Views
    if (gameState !== 'LOBBY') {
        lobbyContainer.classList.add('hidden');
        lobbyContainer.classList.remove('active');
        gameContainer.classList.remove('hidden');
        gameContainer.classList.add('active');
    }

    // Update Round Info
    roundInfo.textContent = `Round: ${room.round}/${room.maxRounds}`;
    
    // Update Players List
    playersList.innerHTML = '';
    const me = room.players.find(p => p.id === myId);
    if (me) {
        myRole = me.role;
    }

    room.players.forEach(p => {
        const card = document.createElement('div');
        card.classList.add('player-card');
        if (p.id === currentDrawerId) card.classList.add('drawer');
        if (p.hasGuessed) card.classList.add('guessed');
        
        card.innerHTML = `
            <div class="player-info">
                <div class="player-name">
                    ${p.username} 
                    ${p.id === currentDrawerId ? '✏️' : ''}
                    ${p.hasGuessed ? '✅' : ''}
                </div>
                <div class="player-score">${p.score} pts</div>
            </div>
        `;
        playersList.appendChild(card);
    });

    // Handle Roles & Tools Visibility
    if (myRole === 'DRAWER') {
        toolbox.classList.remove('hidden');
        chatInput.placeholder = "You are drawing. No chatting!";
        chatInput.disabled = true;
        hintBtn.classList.add('hidden');
    } else {
        toolbox.classList.add('hidden');
        chatInput.placeholder = me && me.hasGuessed ? "You guessed it!" : "Type your guess here...";
        chatInput.disabled = me && me.hasGuessed;
        if (gameState === 'PLAYING' && !(me && me.hasGuessed)) {
            hintBtn.classList.remove('hidden');
        } else {
            hintBtn.classList.add('hidden');
        }
    }

    // Handle Overlays based on State
    if (gameState === 'CHOOSING_WORD') {
        if (myRole === 'DRAWER') {
            gameOverlay.classList.remove('hidden');
            overlayTitle.textContent = "Choose a Word";
            wordChoicesDiv.classList.remove('hidden');
            overlayMessage.textContent = "Pick a word to draw!";
        } else {
            gameOverlay.classList.remove('hidden');
            overlayTitle.textContent = "Waiting for Drawer...";
            wordChoicesDiv.classList.add('hidden');
            overlayMessage.textContent = "The drawer is choosing a word.";
        }
    } else if (gameState === 'PLAYING') {
        gameOverlay.classList.add('hidden');
        undoStack = []; // Reset undo stack on new round
        if (cgInitialized) {
             try { window.CrazyGames.SDK.game.gameplayStart(); } catch(e){}
        }
    } else if (gameState === 'ROUND_END') {
        gameOverlay.classList.remove('hidden');
        overlayTitle.textContent = "Round Over!";
        wordChoicesDiv.classList.add('hidden');
        overlayMessage.textContent = "";
        if (cgInitialized) {
            try { window.CrazyGames.SDK.game.gameplayStop(); } catch(e){}
       }
    } else if (gameState === 'GAME_OVER') {
        gameOverlay.classList.remove('hidden');
        overlayTitle.textContent = "Game Over!";
        wordChoicesDiv.classList.add('hidden');
        
        // Find winner
        const sorted = [...room.players].sort((a,b) => b.score - a.score);
        overlayMessage.textContent = sorted.length > 0 ? `Winner: ${sorted[0].username} with ${sorted[0].score} points!` : "";
    }
});

socket.on('word_choices', (choices) => {
    wordChoicesDiv.innerHTML = '';
    choices.forEach(choiceData => {
        const btn = document.createElement('button');
        btn.classList.add('word-choice-btn');
        btn.innerHTML = `<strong>${choiceData.word}</strong><br><small style="font-size:0.8rem">${choiceData.difficulty} (${choiceData.points} pts)</small>`;
        btn.onclick = () => {
            socket.emit('word_chosen', choiceData);
            gameOverlay.classList.add('hidden');
        };
        wordChoicesDiv.appendChild(btn);
    });
});

socket.on('receive_hint', (hintString) => {
    wordHintDisplay.textContent = hintString;
});

socket.on('word_hint', (length) => {
    if (myRole === 'GUESSER') {
        wordHintDisplay.textContent = Array(length).fill('_').join(' ');
    } else {
        wordHintDisplay.textContent = "You are Drawing"; // Word logic could be handled differently if needed, keeping simple.
    }
});

socket.on('timer_update', (time) => {
    timerDisplay.textContent = time;
});

// Canvas Drawing Logic
function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
}

function drawLine(x0, y0, x1, y1, color, size, isEraser, emit) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = isEraser ? '#FFFFFF' : color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();

    if (!emit) return;
    
    socket.emit('draw_data', {
        x0, y0, x1, y1, color, size, isEraser
    });
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function floodFill(startX, startY, fillColorHex, emit) {
    const targetColor = ctx.getImageData(startX, startY, 1, 1).data;
    const fillRgb = hexToRgb(fillColorHex);
    
    // Simplistic fill (filling whole canvas) if we don't want to block UI thread with a full JS floodfill
    // For a real production app, you'd use a web worker or a robust library.
    // For this, we'll do a basic whole-canvas background fill if they click empty space, 
    // or just fill a rectangle to keep it performant for now.
    ctx.fillStyle = fillColorHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (emit) {
        socket.emit('fill_event', { x: startX, y: startY, color: fillColorHex });
    }
}

function onMouseDown(e) {
    if (myRole !== 'DRAWER' || gameState !== 'PLAYING') return;
    const pos = getMousePos(e.touches ? e.touches[0] : e);
    
    saveState(); // Save state before action

    if (currentTool === 'fill') {
        floodFill(pos.x, pos.y, colorPicker.value, true);
        return;
    }

    isDrawing = true;
    lastX = pos.x;
    lastY = pos.y;
}

function onMouseUp(e) {
    if (myRole !== 'DRAWER' || !isDrawing) return;
    isDrawing = false;
}

function onMouseMove(e) {
    if (myRole !== 'DRAWER' || !isDrawing || currentTool === 'fill') return;
    e.preventDefault(); // Prevent scrolling on touch
    
    const pos = getMousePos(e.touches ? e.touches[0] : e);
    drawLine(lastX, lastY, pos.x, pos.y, colorPicker.value, brushSize.value, currentTool === 'eraser', true);
    lastX = pos.x;
    lastY = pos.y;
}

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('mouseout', onMouseUp);
canvas.addEventListener('mousemove', onMouseMove);

canvas.addEventListener('touchstart', onMouseDown, {passive: false});
canvas.addEventListener('touchend', onMouseUp);
canvas.addEventListener('touchcancel', onMouseUp);
canvas.addEventListener('touchmove', onMouseMove, {passive: false});

socket.on('draw_data', (data) => {
    drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, data.isEraser, false);
});

socket.on('fill_event', (data) => {
    saveState(); // Ensure undo stack has pre-fill state for non-drawers
    floodFill(data.x, data.y, data.color, false);
});

socket.on('undo', () => {
    restoreState(false);
});

socket.on('clear_canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

clearBtn.addEventListener('click', () => {
    if (myRole === 'DRAWER') {
        saveState();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear_canvas');
    }
});

// Tool Selection
function setActiveTool(btn, toolName) {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = toolName;
}

eraserBtn.addEventListener('click', () => setActiveTool(eraserBtn, 'eraser'));
fillBtn.addEventListener('click', () => setActiveTool(fillBtn, 'fill'));
colorPicker.addEventListener('change', () => {
    // Automatically switch back to pen if they choose a new color while using another tool
    if (currentTool !== 'pen') {
        setActiveTool(document.createElement('div'), 'pen'); // just remove active classes
        currentTool = 'pen';
    }
});
undoBtn.addEventListener('click', () => {
    if (myRole === 'DRAWER') restoreState(true);
});

// UI Event Listeners
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomInput.value.trim();
    
    if (username && roomId) {
        socket.emit('join_room', { roomId, username });
        joinBtn.disabled = true;
        joinBtn.textContent = "Joining...";
    } else {
        alert("Please enter both username and room ID");
    }
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('chat_message', msg);
        chatInput.value = '';
    }
});

hintBtn.addEventListener('click', () => {
    if (window.CrazyGames && window.CrazyGames.SDK) {
        // Show rewarded ad
        const callbacks = {
            adFinished: () => {
                socket.emit('request_hint');
                addSystemMessage("You watched an ad and received a hint!", false);
            },
            adError: (error) => {
                console.error("Ad error:", error);
                addSystemMessage("Ad failed to load. No hint awarded.", false);
            },
            adStarted: () => {
                console.log("Ad started");
            }
        };
        window.CrazyGames.SDK.ad.requestAd('rewarded', callbacks);
    } else {
        // Fallback for local testing if SDK is not active
        console.log("Mocking Ad request");
        socket.emit('request_hint');
    }
});

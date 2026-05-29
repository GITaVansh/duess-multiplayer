const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Categorized Word List
const WORDS = {
    easy: { points: 50, list: ['apple', 'car', 'dog', 'cat', 'sun', 'moon', 'star', 'house', 'tree', 'flower', 'fish', 'bird', 'pizza', 'cake', 'shoe', 'hat', 'chair', 'table', 'book', 'pen'] },
    medium: { points: 100, list: ['clock', 'window', 'phone', 'computer', 'mouse', 'keyboard', 'glass', 'plate', 'spoon', 'fork', 'knife', 'camera', 'guitar', 'piano', 'drum', 'bridge', 'castle', 'dragon'] },
    hard: { points: 150, list: ['helicopter', 'motorcycle', 'telescope', 'microscope', 'astronaut', 'submarine', 'electricity', 'philosophy', 'shakespeare', 'chameleon', 'hippopotamus', 'rhinoceros'] }
};

// Game State Management
const rooms = new Map();

function getRandomWords() {
    const easyWord = WORDS.easy.list[Math.floor(Math.random() * WORDS.easy.list.length)];
    const medWord = WORDS.medium.list[Math.floor(Math.random() * WORDS.medium.list.length)];
    const hardWord = WORDS.hard.list[Math.floor(Math.random() * WORDS.hard.list.length)];
    
    return [
        { word: easyWord, points: WORDS.easy.points, difficulty: 'Easy' },
        { word: medWord, points: WORDS.medium.points, difficulty: 'Medium' },
        { word: hardWord, points: WORDS.hard.points, difficulty: 'Hard' }
    ];
}

function broadcastRoomState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Sanitize room data to send to clients (hide currentWord from guessers)
    const sanitizedPlayers = room.players.map(p => ({
        id: p.id,
        username: p.username,
        score: p.score,
        role: p.role,
        hasGuessed: p.hasGuessed
    }));

    io.to(roomId).emit('room_update', {
        roomId: room.id,
        players: sanitizedPlayers,
        state: room.state,
        round: room.round,
        maxRounds: room.maxRounds,
        timer: room.timer,
        currentDrawerId: room.currentDrawerId
    });
}

function startRound(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
        room.state = 'LOBBY';
        io.to(roomId).emit('system_message', 'Not enough players to start round.');
        broadcastRoomState(roomId);
        return;
    }

    room.state = 'CHOOSING_WORD';
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    room.currentDrawerId = room.players[room.currentDrawerIndex].id;
    room.players.forEach(p => { p.hasGuessed = false; p.hintRevealed = []; });
    room.currentWord = '';
    room.currentWordPoints = 0;
    
    // Assign roles
    room.players.forEach(p => {
        p.role = p.id === room.currentDrawerId ? 'DRAWER' : 'GUESSER';
    });

    const choices = getRandomWords();
    
    io.to(room.currentDrawerId).emit('word_choices', choices);
    io.to(roomId).emit('system_message', `${room.players[room.currentDrawerIndex].username} is choosing a word...`);
    io.to(roomId).emit('clear_canvas');
    
    broadcastRoomState(roomId);
    
    // Auto-pick if not chosen in 15s (implement later if needed, keeping simple for now)
}

function startGame(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) return;
    
    room.round = 1;
    room.currentDrawerIndex = -1;
    room.players.forEach(p => p.score = 0);
    
    startRound(roomId);
}

function endRound(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    clearInterval(room.intervalId);
    room.state = 'ROUND_END';
    
    io.to(roomId).emit('system_message', `Round over! The word was: ${room.currentWord}`);
    broadcastRoomState(roomId);
    
    setTimeout(() => {
        if (room.currentDrawerIndex >= room.players.length - 1) {
            room.round++;
            if (room.round > room.maxRounds) {
                // Game Over
                room.state = 'GAME_OVER';
                io.to(roomId).emit('system_message', 'Game Over!');
                broadcastRoomState(roomId);
                return;
            }
        }
        startRound(roomId);
    }, 5000);
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username;

        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                players: [],
                state: 'LOBBY',
                currentDrawerIndex: -1,
                currentDrawerId: null,
                currentWord: '',
                currentWordPoints: 0,
                timer: 0,
                round: 0,
                maxRounds: 3,
                intervalId: null
            });
        }

        const room = rooms.get(roomId);
        room.players.push({
            id: socket.id,
            username,
            score: 0,
            role: 'GUESSER',
            hasGuessed: false,
            hintRevealed: []
        });

        io.to(roomId).emit('system_message', `${username} joined the room.`);
        broadcastRoomState(roomId);
        
        // Auto-start game if lobby has >= 2 players and is waiting
        if (room.state === 'LOBBY' && room.players.length >= 2) {
             io.to(roomId).emit('system_message', 'Game starting soon...');
             setTimeout(() => startGame(roomId), 3000);
        }
    });

    socket.on('word_chosen', (choiceData) => {
        const room = rooms.get(socket.roomId);
        if (!room || socket.id !== room.currentDrawerId || room.state !== 'CHOOSING_WORD') return;

        room.currentWord = choiceData.word;
        room.currentWordPoints = choiceData.points;
        room.state = 'PLAYING';
        room.timer = 60; // 60 seconds per round

        io.to(socket.roomId).emit('system_message', `${socket.username} is drawing!`);
        broadcastRoomState(socket.roomId);
        
        // Send word length to guessers
        io.to(socket.roomId).emit('word_hint', choiceData.word.length);

        clearInterval(room.intervalId);
        room.intervalId = setInterval(() => {
            room.timer--;
            io.to(socket.roomId).emit('timer_update', room.timer);
            
            if (room.timer <= 0) {
                endRound(socket.roomId);
            }
        }, 1000);
    });

    socket.on('draw_data', (data) => {
        const room = rooms.get(socket.roomId);
        if (room && socket.id === room.currentDrawerId && room.state === 'PLAYING') {
            socket.to(socket.roomId).emit('draw_data', data);
        }
    });

    socket.on('undo', () => {
        const room = rooms.get(socket.roomId);
        if (room && socket.id === room.currentDrawerId && room.state === 'PLAYING') {
            socket.to(socket.roomId).emit('undo');
        }
    });

    socket.on('fill_event', (data) => {
        const room = rooms.get(socket.roomId);
        if (room && socket.id === room.currentDrawerId && room.state === 'PLAYING') {
            socket.to(socket.roomId).emit('fill_event', data);
        }
    });

    socket.on('clear_canvas', () => {
        const room = rooms.get(socket.roomId);
        if (room && socket.id === room.currentDrawerId) {
            socket.to(socket.roomId).emit('clear_canvas');
        }
    });

    socket.on('chat_message', (msg) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (room.state === 'PLAYING' && player.role === 'GUESSER' && !player.hasGuessed) {
            if (msg.trim().toLowerCase() === room.currentWord.toLowerCase()) {
                // Correct guess
                player.hasGuessed = true;
                // Points: base points * (time/60) + 10 minimum
                const timeMultiplier = Math.max(0.1, room.timer / 60);
                const points = Math.floor(room.currentWordPoints * timeMultiplier) + 10;
                player.score += points;
                
                // Drawer gets half points
                const drawer = room.players.find(p => p.id === room.currentDrawerId);
                if (drawer) drawer.score += Math.floor(points / 2);

                io.to(socket.roomId).emit('system_message', `${player.username} guessed the word!`);
                broadcastRoomState(socket.roomId);

                // Check if all guessers have guessed
                const allGuessed = room.players.every(p => p.role === 'DRAWER' || p.hasGuessed);
                if (allGuessed) {
                    endRound(socket.roomId);
                }
                return;
            }
        }

        // Normal chat message
        io.to(socket.roomId).emit('chat_message', { username: player.username, text: msg });
    });

    socket.on('request_hint', () => {
        const room = rooms.get(socket.roomId);
        if (!room || room.state !== 'PLAYING') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.role !== 'GUESSER' || player.hasGuessed) return;

        // Reveal a random unrevealed letter
        const word = room.currentWord;
        let unrevealedIndexes = [];
        for (let i = 0; i < word.length; i++) {
            if (word[i] !== ' ' && !player.hintRevealed.includes(i)) {
                unrevealedIndexes.push(i);
            }
        }

        if (unrevealedIndexes.length > 0) {
            const randomIndex = unrevealedIndexes[Math.floor(Math.random() * unrevealedIndexes.length)];
            player.hintRevealed.push(randomIndex);
            
            // Send back the hint array to this specific user
            const hintArray = Array(word.length).fill('_');
            for (let i = 0; i < word.length; i++) {
                if (word[i] === ' ' || player.hintRevealed.includes(i)) {
                    hintArray[i] = word[i];
                }
            }
            socket.emit('receive_hint', hintArray.join(' '));
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            io.to(socket.roomId).emit('system_message', `${socket.username} left the room.`);
            
            if (room.players.length === 0) {
                clearInterval(room.intervalId);
                rooms.delete(socket.roomId);
            } else if (socket.id === room.currentDrawerId && room.state === 'PLAYING') {
                endRound(socket.roomId);
            } else {
                broadcastRoomState(socket.roomId);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

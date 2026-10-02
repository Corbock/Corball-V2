const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.env.PORT) || 8000;
const root = __dirname;
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.sql': 'text/plain; charset=utf-8'
};

const httpServer = http.createServer((request, response) => {
    const requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = path.resolve(root, `.${requestedPath}`);
    if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, contents) => {
        if (error) {
            response.writeHead(error.code === 'ENOENT' ? 404 : 500);
            response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
        }
        response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
        response.end(contents);
    });
});

const socketServer = new WebSocket.Server({ server: httpServer });
const rooms = new Map();
const sessions = new Map();

function broadcast(room, message) {
    const payload = JSON.stringify(message);
    for (const client of room.keys()) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
}

function endRoomMatch(room, score, reason) {
    if (room.ended) return;
    room.ended = true;
    const winnerRole = score[0] === score[1] ? null : score[0] > score[1] ? 'p1' : 'p2';
    broadcast(room, { type: 'match-end', score, winnerRole, reason });
}

function createRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (rooms.has(code));
    return code;
}

function normalizePlayerName(name) {
    return String(name || '').trim().slice(0, 20) || 'Player';
}

socketServer.on('connection', (socket) => {
    socket.on('message', (rawMessage) => {
        let message;
        try {
            message = JSON.parse(rawMessage.toString());
        } catch {
            return;
        }
        if (message.type === 'create-room') {
            const code = createRoomCode();
            const playerNames = { p1: normalizePlayerName(message.playerName), p2: null };
            const room = new Map([[socket, 'p1']]);
            room.started = false;
            room.ended = false;
            room.settings = null;
            room.endsAt = 0;
            room.playerNames = playerNames;
            rooms.set(code, room);
            sessions.set(socket, { room, code, role: 'p1' });
            socket.send(JSON.stringify({ type: 'room-created', code, playerNames }));
            socket.send(JSON.stringify({ type: 'role', role: 'p1', code, playerCount: 1, playerNames }));
            return;
        }
        if (message.type === 'join-room') {
            const code = String(message.code || '').toUpperCase();
            const room = rooms.get(code);
            if (!room) {
                socket.send(JSON.stringify({ type: 'error', message: 'Room not found.', fatal: true }));
                return;
            }
            if (room.size >= 2 || room.started) {
                socket.send(JSON.stringify({ type: 'error', message: 'That room is full.', fatal: true }));
                return;
            }
            room.playerNames.p2 = normalizePlayerName(message.playerName);
            room.set(socket, 'p2');
            sessions.set(socket, { room, code, role: 'p2' });
            socket.send(JSON.stringify({ type: 'role', role: 'p2', code, playerCount: 2, playerNames: room.playerNames }));
            broadcast(room, { type: 'player-count', playerCount: 2, playerNames: room.playerNames });
            return;
        }
        const session = sessions.get(socket);
        if (!session) return;
        if (message.type === 'hit') {
            if (session.role === 'p2') {
                for (const [client, role] of session.room) {
                    if (role === 'p1' && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'hit',
                            playerRole: session.role,
                            hitId: message.hitId,
                            player: message.player,
                            ball: message.ball
                        }));
                    }
                }
            }
            return;
        }
        if (message.type === 'start-match') {
            if (session.role !== 'p1' || session.room.size !== 2 || session.room.started) return;
            const rule = message.settings?.rule;
            const limit = Number(message.settings?.limit);
            const maximum = rule === 'timer' ? 30 : rule === 'goals' ? 20 : 0;
            if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
                socket.send(JSON.stringify({ type: 'error', message: 'Invalid match settings.' }));
                return;
            }
            session.room.started = true;
            session.room.ended = false;
            session.room.settings = { rule, limit };
            session.room.endsAt = rule === 'timer' ? Date.now() + limit * 60000 : 0;
            broadcast(session.room, { type: 'match-start', settings: session.room.settings });
            return;
        }
        if (message.type === 'end-match') {
            if (session.role === 'p1' && session.room.started && Array.isArray(message.score) && message.score.length === 2 && message.score.every(value => Number.isSafeInteger(value) && value >= 0)) {
                endRoomMatch(session.room, message.score, 'host');
            }
            return;
        }
        if (message.type !== 'state') return;
        if (session.room.ended) return;
        if (session.role === 'p1' && session.room.started && Array.isArray(message.score) && message.score.length === 2) {
            const validScore = message.score.every(value => Number.isSafeInteger(value) && value >= 0);
            if (validScore && session.room.settings.rule === 'goals' && Math.max(...message.score) >= session.room.settings.limit) {
                endRoomMatch(session.room, message.score, 'goals');
            } else if (validScore && session.room.settings.rule === 'timer' && Date.now() >= session.room.endsAt) {
                endRoomMatch(session.room, message.score, 'timer');
            }
            if (session.room.ended) return;
        }
        for (const client of session.room.keys()) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'state',
                    playerRole: session.role,
                    player: message.player,
                    ball: message.ball,
                    score: message.score,
                    goalEvent: message.goalEvent,
                    resetSequence: message.resetSequence,
                    remainingSeconds: message.remainingSeconds,
                    acknowledgedHitId: message.acknowledgedHitId
                }));
            }
        }
    });

    socket.on('close', () => {
        const session = sessions.get(socket);
        if (!session) return;
        session.room.delete(socket);
        sessions.delete(socket);
        session.room.playerNames[session.role] = null;
        if (session.room.size) {
            session.room.started = false;
            session.room.ended = false;
            session.room.settings = null;
            session.room.endsAt = 0;
            broadcast(session.room, { type: 'player-count', playerCount: session.room.size, playerNames: session.room.playerNames });
        } else {
            rooms.delete(session.code);
        }
    });
});

httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Corball online server listening on http://0.0.0.0:${port}`);
});

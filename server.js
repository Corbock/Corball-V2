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
    const winnerTeam = score[0] === score[1] ? null : score[0] > score[1] ? 'blue' : 'orange';
    const winnerRole = winnerTeam === 'blue' ? 'p1' : room.playerLimit === 2 ? 'p2' : 'p3';
    broadcast(room, { type: 'match-end', score, winnerRole: winnerTeam ? winnerRole : null, winnerTeam, reason });
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
            const playerLimit = Number(message.playerLimit);
            if (playerLimit !== 2 && playerLimit !== 4) {
                socket.send(JSON.stringify({ type: 'error', message: 'Choose a room size of 2 or 4 players.', fatal: true }));
                return;
            }
            const code = createRoomCode();
            const playerNames = { p1: normalizePlayerName(message.playerName), p2: null, p3: null, p4: null };
            const room = new Map([[socket, 'p1']]);
            room.started = false;
            room.ended = false;
            room.settings = null;
            room.endsAt = 0;
            room.playerLimit = playerLimit;
            room.playerNames = playerNames;
            rooms.set(code, room);
            sessions.set(socket, { room, code, role: 'p1' });
            socket.send(JSON.stringify({ type: 'room-created', code, playerNames, playerLimit }));
            socket.send(JSON.stringify({ type: 'role', role: 'p1', code, playerCount: 1, playerLimit, playerNames }));
            return;
        }
        if (message.type === 'join-room') {
            const code = String(message.code || '').toUpperCase();
            const room = rooms.get(code);
            if (!room) {
                socket.send(JSON.stringify({ type: 'error', message: 'Room not found.', fatal: true }));
                return;
            }
            if (room.size >= room.playerLimit || room.started) {
                socket.send(JSON.stringify({ type: 'error', message: 'That room is full.', fatal: true }));
                return;
            }
            const role = ['p1', 'p2', 'p3', 'p4'].find(candidate => ![...room.values()].includes(candidate));
            room.playerNames[role] = normalizePlayerName(message.playerName);
            room.set(socket, role);
            sessions.set(socket, { room, code, role });
            socket.send(JSON.stringify({ type: 'role', role, code, playerCount: room.size, playerLimit: room.playerLimit, playerNames: room.playerNames }));
            broadcast(room, { type: 'player-count', playerCount: room.size, playerLimit: room.playerLimit, playerNames: room.playerNames });
            return;
        }
        const session = sessions.get(socket);
        if (!session) return;
        if (message.type === 'hit') {
            if (session.role !== 'p1') {
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
            if (session.role !== 'p1' || session.room.size !== session.room.playerLimit || session.room.started) return;
            const mode = message.settings?.mode;
            const rule = message.settings?.rule;
            const limit = Number(message.settings?.limit);
            const maximum = rule === 'timer' ? 30 : rule === 'goals' ? mode === 'hot_potato' ? 100 : 20 : 0;
            if (mode !== 'normal' && mode !== 'hot_potato') {
                socket.send(JSON.stringify({ type: 'error', message: 'Invalid game mode.' }));
                return;
            }
            if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
                socket.send(JSON.stringify({ type: 'error', message: 'Invalid match settings.' }));
                return;
            }
            session.room.started = true;
            session.room.ended = false;
            session.room.settings = { mode, rule, limit, playerLimit: session.room.playerLimit };
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
                    lastHitter: message.lastHitter,
                    score: message.score,
                    goalEvent: message.goalEvent,
                    resetSequence: message.resetSequence,
                    remainingSeconds: message.remainingSeconds,
                    acknowledgedHitIds: message.acknowledgedHitIds
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
            broadcast(session.room, { type: 'player-count', playerCount: session.room.size, playerLimit: session.room.playerLimit, playerNames: session.room.playerNames });
        } else {
            rooms.delete(session.code);
        }
    });
});

httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Corball online server listening on http://0.0.0.0:${port}`);
});

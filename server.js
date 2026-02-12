const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servir la interfaz web
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Variables globales
let ptyProcess = null;

io.on('connection', (socket) => {
    console.log('Usuario conectado a la interfaz web');

    socket.on('start_agent', (config) => {
        if (ptyProcess) {
            socket.emit('log', { msg: '⚠ El agente ya está corriendo. Detenlo primero.', type: 'warning' });
            return;
        }

        const { apiKey, model } = config;

        // Entorno seguro para el proceso
        const env = Object.assign({}, process.env, {
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            MODEL_NAME: model || 'claude-3-5-sonnet'
        });

        // Ejecutar OpenClaw dentro del contenedor
        // Asumimos que el comando de arranque es 'npm start' dentro de la carpeta clonada
        ptyProcess = pty.spawn('npm', ['start'], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: path.join(__dirname, 'openclaw-engine'),
            env: env
        });

        socket.emit('status', 'running');

        // Escuchar lo que dice el agente
        ptyProcess.on('data', (data) => {
            // Convertimos colores ANSI a HTML simple o texto crudo si es necesario
            socket.emit('terminal_data', data);
        });

        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `El agente se detuvo (Código: ${code})`, type: 'error' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    });

    socket.on('send_command', (command) => {
        if (ptyProcess) {
            ptyProcess.write(command + '\r');
        }
    });

    socket.on('stop_agent', () => {
        if (ptyProcess) {
            ptyProcess.kill();
            ptyProcess = null;
            socket.emit('status', 'stopped');
            socket.emit('log', { msg: 'Agente detenido manualmente.', type: 'success' });
        }
    });
});

server.listen(PORT, () => {
    console.log(`☁ Servidor Cloud corriendo en puerto ${PORT}`);
});
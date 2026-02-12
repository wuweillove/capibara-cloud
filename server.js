const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let ptyProcess = null;

io.on('connection', (socket) => {
    console.log('Usuario conectado');

    socket.on('start_agent', (config) => {
        if (ptyProcess) {
            socket.emit('log', { msg: '⚠ El agente ya está corriendo.', type: 'warning' });
            return;
        }

        const { apiKey, model } = config;

        // Configuramos el entorno
        const env = Object.assign({}, process.env, {
            // Pasamos la API Key a todos los posibles proveedores
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            // Nombre del modelo
            MODEL_NAME: model,
            // Variables de optimización para Railway
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900'
        });

        try {
            // --- CAMBIO DEFINITIVO PARA CHATEAR ---
            // 1. Quitamos 'gateway'. Al no poner comando, arranca el modo "Chat/Principal".
            // 2. Mantenemos '--allow-unconfigured' para que no pida el archivo toml.
            // 3. Añadimos '--interactive' por si acaso el agente lo requiere explícitamente.
            const cmd = 'node';
            const args = ['openclaw.mjs', '--allow-unconfigured', '--interactive']; 

            ptyProcess = pty.spawn(cmd, args, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: path.join(__dirname, 'openclaw-engine'),
                env: env
            });

            socket.emit('status', 'running');

            ptyProcess.on('data', (data) => {
                socket.emit('terminal_data', data);
            });

            ptyProcess.on('exit', (code) => {
                // Si se cierra, avisamos.
                if (code !== 0) {
                     socket.emit('log', { msg: `El agente se desconectó (Código: ${code}).`, type: 'info' });
                }
                socket.emit('status', 'stopped');
                ptyProcess = null;
            });
        } catch (e) {
            socket.emit('log', { msg: `Error al iniciar: ${e.message}`, type: 'error' });
        }
    });

    socket.on('send_command', (command) => {
        if (ptyProcess) {
            // Enviamos lo que escribes al agente
            ptyProcess.write(command + '\r');
        }
    });

    socket.on('stop_agent', () => {
        if (ptyProcess) {
            ptyProcess.kill();
            ptyProcess = null;
            socket.emit('status', 'stopped');
        }
    });
});

server.listen(PORT, () => {
    console.log(`☁ Servidor listo en puerto ${PORT}`);
});
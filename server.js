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

        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            MODEL_NAME: model,
            NODE_ENV: 'production',
            // Mantenemos el límite de memoria para que no crashee en Railway Free
            NODE_OPTIONS: '--max-old-space-size=900' 
        });

        try {
            // --- CAMBIO FINAL ---
            // Usamos el comando 'gateway' que vimos en tu captura de pantalla.
            // Esto inicia el servidor WebSocket y lo mantiene encendido (ONLINE).
            const cmd = 'node';
            const args = ['openclaw.mjs', 'gateway']; 

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
                // El código 1 suele ser cierre normal de CLI si falta argumentos.
                // Si ves logs, ignora este mensaje.
                if (code !== 0) {
                     socket.emit('log', { msg: `El proceso se detuvo (Código: ${code}).`, type: 'info' });
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
            // Enviamos el comando a la terminal del proceso
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
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');
const fs = require('fs'); // <--- NUEVO: Necesario para crear el archivo

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

        // 1. CREACIÓN AUTOMÁTICA DEL ARCHIVO DE CONFIGURACIÓN
        // Esto soluciona el error "Missing config" permanentemente.
        const enginePath = path.join(__dirname, 'openclaw-engine');
        const configPath = path.join(enginePath, 'openclaw.toml');
        
        try {
            // Escribimos una configuración mínima válida
            const configContent = `
[gateway]
mode = "local"

[llm]
model = "${model || 'gemini-3-pro-preview'}"
`;
            fs.writeFileSync(configPath, configContent);
            socket.emit('log', { msg: '✅ Configuración creada exitosamente.', type: 'success' });
        } catch (err) {
            socket.emit('log', { msg: 'Error creando config: ' + err.message, type: 'error' });
        }

        // 2. Entorno
        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900' 
        });

        try {
            // 3. EJECUCIÓN LIMPIA
            // Ya no necesitamos banderas raras porque el archivo config ya existe.
            // Al no poner argumentos, arranca el MODO CHAT por defecto.
            const cmd = 'node';
            const args = ['openclaw.mjs']; 

            ptyProcess = pty.spawn(cmd, args, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: enginePath,
                env: env
            });

            socket.emit('status', 'running');

            ptyProcess.on('data', (data) => {
                socket.emit('terminal_data', data);
            });

            ptyProcess.on('exit', (code) => {
                if (code !== 0) {
                     socket.emit('log', { msg: `Agente desconectado (Código: ${code}).`, type: 'info' });
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
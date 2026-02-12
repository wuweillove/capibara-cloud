const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Simplificar la estructura estática
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Estado global
let ptyProcess = null;

// Configuración básica
const openclawDir = '/root/.openclaw';
const configPath = path.join(openclawDir, 'openclaw.json');

// Funciones principales
io.on('connection', (socket) => {
    console.log('Usuario conectado');
    
    socket.emit('status', ptyProcess ? 'running' : 'stopped');

    socket.on('start_agent', (config) => {
        if (ptyProcess) {
            return socket.emit('log', { msg: 'El agente ya está corriendo', type: 'warning' });
        }

        const { apiKey, model } = config;
        startOpenClaw(socket, apiKey, model);
    });

    socket.on('send_command', (command) => {
        if (ptyProcess) {
            ptyProcess.write(command + '\r');
        } else {
            socket.emit('log', { msg: 'El agente no está en ejecución', type: 'warning' });
        }
    });

    socket.on('stop_agent', () => {
        if (ptyProcess) {
            ptyProcess.kill();
            ptyProcess = null;
            socket.emit('status', 'stopped');
            socket.emit('log', { msg: 'Agente detenido', type: 'success' });
        }
    });
});

// Función simplificada para iniciar OpenClaw
function startOpenClaw(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: 'Preparando OpenClaw...', type: 'info' });
        
        // Crear directorio
        if (!fs.existsSync(openclawDir)) {
            fs.mkdirSync(openclawDir, { recursive: true });
            fs.mkdirSync(path.join(openclawDir, 'workspace'), { recursive: true });
            fs.mkdirSync(path.join(openclawDir, 'credentials'), { recursive: true });
        }
        
        // Configuración mínima en JSON
        const config = {
            agents: { defaults: { workspace: path.join(openclawDir, 'workspace') } },
            gateway: { port: 18789, host: "0.0.0.0" },
            llms: {
                providers: {
                    google: { apiKey: apiKey },
                    openai: { apiKey: apiKey }
                },
                defaults: { provider: "google", model: model || "gemini-1.5-pro" }
            }
        };
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // Variables de entorno mínimas
        const env = {
            ...process.env,
            GOOGLE_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            OPENCLAWCONFIGPATH: configPath,
            OPENCLAWSTATEDIR: openclawDir,
            OPENCLAWGATEWAYPORT: "18789"
        };
        
        socket.emit('log', { msg: 'Iniciando OpenClaw...', type: 'info' });
        
        // Usar OpenClaw global
        ptyProcess = pty.spawn('openclaw', ['gateway', '--port', '18789'], {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: process.cwd(),
            env: env
        });
        
        socket.emit('status', 'running');
        
        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
            
            if (data.includes('Server listening')) {
                socket.emit('log', { msg: 'Gateway iniciado con éxito', type: 'success' });
            }
        });
        
        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `Agente desconectado (${code})`, type: 'warning' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `Error: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

server.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
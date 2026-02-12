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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let ptyProcess = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

io.on('connection', (socket) => {
    console.log('Usuario conectado');
    
    // Enviar estado actual al conectar
    if (ptyProcess) {
        socket.emit('status', 'running');
    } else {
        socket.emit('status', 'stopped');
    }

    socket.on('start_agent', (config) => {
        if (ptyProcess) {
            socket.emit('log', { msg: '⚠ El agente ya está corriendo.', type: 'warning' });
            return;
        }

        const { apiKey, model } = config;
        restartAttempts = 0;
        
        startAgent(socket, apiKey, model);
    });

    socket.on('send_command', (command) => {
        if (ptyProcess) {
            ptyProcess.write(command + '\r');
        } else {
            socket.emit('log', { msg: '⚠ El agente no está en ejecución.', type: 'warning' });
        }
    });

    socket.on('stop_agent', () => {
        if (ptyProcess) {
            ptyProcess.kill();
            ptyProcess = null;
            socket.emit('status', 'stopped');
            socket.emit('log', { msg: '✅ Agente detenido manualmente.', type: 'success' });
        }
    });
});

function startAgent(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: '🚀 Iniciando agente...', type: 'info' });
        
        // Verificar estructura de directorios
        const enginePath = path.join(__dirname, 'openclaw-engine');
        const configPath = path.join(enginePath, 'openclaw.toml');
        
        // Verificar que el directorio exista
        if (!fs.existsSync(enginePath)) {
            socket.emit('log', { msg: '⚠ Ruta del motor no encontrada. Verificando estructura...', type: 'warning' });
            // Listar directorios para diagnóstico
            const dirs = fs.readdirSync(__dirname);
            socket.emit('log', { msg: `📂 Directorios disponibles: ${dirs.join(', ')}`, type: 'info' });
            
            return socket.emit('log', { msg: '❌ No se encontró el directorio openclaw-engine.', type: 'error' });
        }
        
        // Crear archivo de configuración
        try {
            // Configuración básica que sabemos que funciona
            const configContent = `
[gateway]
mode = "local"

[llm]
model = "${model || 'gemini-3-pro-preview'}"
`;
            
            fs.writeFileSync(configPath, configContent);
            socket.emit('log', { msg: '✅ Configuración creada exitosamente.', type: 'success' });
        } catch (err) {
            socket.emit('log', { msg: `❌ Error creando config: ${err.message}`, type: 'error' });
            return;
        }

        // Entorno con variables esenciales
        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900'
        });

        // Intentar primero sin argumentos (modo más compatible)
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
        socket.emit('log', { msg: '▶️ Ejecutando: node openclaw.mjs', type: 'info' });

        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
            
            // Detectar errores comunes
            if (data.includes('Missing config')) {
                socket.emit('log', { msg: '⚠ Error de configuración detectado.', type: 'warning' });
            }
        });

        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `⚠ Agente desconectado (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            
            // Reintentar con diferentes comandos si falló
            if (code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
                restartAttempts++;
                socket.emit('log', { msg: `🔄 Reintentando (${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`, type: 'info' });
                
                // Opciones de comando simplificadas que sabemos que existen
                setTimeout(() => {
                    if (restartAttempts === 1) {
                        startAgentWithCommand(socket, apiKey, model, ['openclaw.mjs', 'gateway']);
                    } else if (restartAttempts === 2) {
                        // Probar con el asistente de configuración interactivo
                        startAgentWithCommand(socket, apiKey, model, ['openclaw.mjs', 'config', 'init']);
                    } else {
                        // Último intento: solo el archivo
                        startAgentWithCommand(socket, apiKey, model, ['openclaw.mjs']);
                    }
                }, 3000);
            } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
                socket.emit('log', { msg: '❌ Demasiados intentos fallidos.', type: 'error' });
                socket.emit('log', { msg: 'ℹ️ Sugerencia: Intenta ejecutar Railway en modo Development para ver más detalles.', type: 'info' });
            }
            
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error al iniciar: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

function startAgentWithCommand(socket, apiKey, model, args) {
    try {
        const enginePath = path.join(__dirname, 'openclaw-engine');
        
        // Entorno
        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900'
        });

        socket.emit('log', { msg: `▶️ Ejecutando: node ${args.join(' ')}`, type: 'info' });
        
        ptyProcess = pty.spawn('node', args, {
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
            socket.emit('log', { msg: `⚠ Intento fallido (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error en reintento: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

server.listen(PORT, () => {
    console.log(`☁ Servidor listo en puerto ${PORT}`);
});
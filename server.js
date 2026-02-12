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
        
        // 1. CREACIÓN AUTOMÁTICA DEL ARCHIVO DE CONFIGURACIÓN
        const enginePath = path.join(__dirname, 'openclaw-engine');
        const configPath = path.join(enginePath, 'openclaw.toml');
        
        // Crear carpeta si no existe
        if (!fs.existsSync(enginePath)) {
            socket.emit('log', { msg: '⚠ Ruta del motor no encontrada, verificando estructura...', type: 'warning' });
            // Listar directorios para diagnóstico
            const dirs = fs.readdirSync(__dirname);
            socket.emit('log', { msg: `📂 Directorios disponibles: ${dirs.join(', ')}`, type: 'info' });
        }
        
        try {
            // Configuración más completa con más opciones
            const configContent = `
[gateway]
mode = "local"

[llm]
model = "${model || 'gemini-3-pro-preview'}"
temperature = 0.7
max_tokens = 4000

[memory]
type = "volatile"
            `;
            
            fs.writeFileSync(configPath, configContent);
            socket.emit('log', { msg: '✅ Configuración creada exitosamente.', type: 'success' });
        } catch (err) {
            socket.emit('log', { msg: `❌ Error creando config: ${err.message}`, type: 'error' });
            socket.emit('log', { msg: `📂 Ruta: ${configPath}`, type: 'info' });
        }

        // 2. Entorno con más variables
        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900',
            DEBUG: 'openclaw:*' // Habilitar logs de debug
        });

        // 3. EJECUCIÓN CON BANDERAS DE SEGURIDAD
        const cmd = 'node';
        // Intentar con una combinación diferente de argumentos que funcione mejor
        const args = ['openclaw.mjs', '--verbose']; 

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
            
            // Analizar salida para detectar errores comunes
            if (data.includes('Error: Missing config')) {
                socket.emit('log', { msg: '⚠ Error de configuración detectado, intentando solución alternativa...', type: 'warning' });
                // Podríamos implementar una solución alternativa aquí
            }
        });

        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `⚠ Agente desconectado (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            
            // Reintentar automáticamente si falló
            if (code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
                restartAttempts++;
                socket.emit('log', { msg: `🔄 Reintentando (${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`, type: 'info' });
                
                // Intentar con diferentes argumentos en cada reintento
                setTimeout(() => {
                    if (restartAttempts === 1) {
                        startAgentWithArgs(socket, apiKey, model, ['openclaw.mjs', '--verbose', '--allow-unconfigured']);
                    } else if (restartAttempts === 2) {
                        startAgentWithArgs(socket, apiKey, model, ['openclaw.mjs', 'gateway']);
                    } else {
                        startAgentWithArgs(socket, apiKey, model, ['openclaw.mjs']);
                    }
                }, 3000);
            } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
                socket.emit('log', { msg: '❌ Demasiados intentos fallidos. Revisa los logs para más información.', type: 'error' });
            }
            
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error al iniciar: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

function startAgentWithArgs(socket, apiKey, model, args) {
    try {
        const enginePath = path.join(__dirname, 'openclaw-engine');
        
        // Entorno
        const env = Object.assign({}, process.env, {
            GOOGLE_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900',
            DEBUG: 'openclaw:*'
        });

        socket.emit('log', { msg: `🔄 Intentando con: node ${args.join(' ')}`, type: 'info' });
        
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
            socket.emit('log', { msg: `⚠ Agente desconectado en reintento (Código: ${code}).`, type: 'warning' });
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
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let ptyProcess = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

// Directorio OpenClaw correcto según la documentación
const openclawDir = path.join('/tmp', '.openclaw'); // Usar /tmp para permisos en Railway
const configPath = path.join(openclawDir, 'openclaw.json');

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
        
        setupAndStartOpenClaw(socket, apiKey, model);
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

// Configurar y arrancar OpenClaw según la documentación oficial
function setupAndStartOpenClaw(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: '🚀 Preparando entorno de OpenClaw...', type: 'info' });
        
        // 1. Asegurarse de que exista el directorio .openclaw en /tmp (para Railway)
        if (!fs.existsSync(openclawDir)) {
            socket.emit('log', { msg: '📂 Creando directorio OpenClaw...', type: 'info' });
            fs.mkdirSync(openclawDir, { recursive: true });
            fs.mkdirSync(path.join(openclawDir, 'workspace'), { recursive: true });
            fs.mkdirSync(path.join(openclawDir, 'credentials'), { recursive: true });
        }
        
        // 2. Crear configuración JSON correcta
        const configContent = {
            agents: { 
                defaults: { 
                    workspace: path.join(openclawDir, 'workspace') 
                }
            },
            gateway: { 
                port: 18789,
                host: "0.0.0.0",
                auth: {
                    token: apiKey.substring(0, 16) // Usar parte de la API key como token
                }
            },
            llms: {
                providers: {
                    openai: { apiKey: apiKey },
                    anthropic: { apiKey: apiKey },
                    google: { apiKey: apiKey }
                },
                defaults: {
                    provider: "google",
                    model: model || "gemini-1.5-pro"
                }
            }
        };
        
        fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));
        socket.emit('log', { msg: '✅ Configuración creada correctamente.', type: 'success' });
        
        // 3. Configurar variables de entorno
        const env = Object.assign({}, process.env, {
            OPENAI_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            GOOGLE_API_KEY: apiKey,
            OPENCLAWCONFIGPATH: configPath,
            OPENCLAWSTATEDIR: openclawDir,
            OPENCLAWGATEWAYPORT: "18789",
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900'
        });
        
        // 5. Usar OpenClaw directamente desde node_modules
        socket.emit('log', { msg: '🔌 Iniciando gateway de OpenClaw...', type: 'info' });
        
        // Usar la ruta local desde node_modules
        let openclawBin = path.join(__dirname, 'node_modules', '.bin', 'openclaw');
        
        // Verificar que exista
        if (!fs.existsSync(openclawBin)) {
            socket.emit('log', { msg: '⚠ Ejecutable OpenClaw no encontrado. Verificando node_modules...', type: 'warning' });
            
            // Listar node_modules para diagnóstico
            if (fs.existsSync(path.join(__dirname, 'node_modules'))) {
                const dirs = fs.readdirSync(path.join(__dirname, 'node_modules'));
                socket.emit('log', { msg: `📦 Módulos instalados: ${dirs.join(', ')}`, type: 'info' });
                
                // Verificar si existe openclaw pero no el binario
                if (dirs.includes('openclaw')) {
                    socket.emit('log', { msg: '🔍 OpenClaw instalado pero binario no encontrado.', type: 'info' });
                    
                    // Intentar encontrarlo en la estructura interna
                    const possiblePaths = [
                        path.join(__dirname, 'node_modules', 'openclaw', 'bin', 'openclaw'),
                        path.join(__dirname, 'node_modules', 'openclaw', 'dist', 'openclaw'),
                        path.join(__dirname, 'node_modules', 'openclaw', 'openclaw')
                    ];
                    
                    for (const possiblePath of possiblePaths) {
                        if (fs.existsSync(possiblePath)) {
                            socket.emit('log', { msg: `✅ Encontrado en: ${possiblePath}`, type: 'success' });
                            openclawBin = possiblePath;
                            break;
                        }
                    }
                } else {
                    return socket.emit('log', { msg: '❌ OpenClaw no está instalado. Agregue "openclaw": "latest" al package.json.', type: 'error' });
                }
            } else {
                return socket.emit('log', { msg: '❌ Directorio node_modules no encontrado.', type: 'error' });
            }
        }
        
        socket.emit('log', { msg: `▶️ Ejecutando: ${openclawBin} gateway --port 18789`, type: 'info' });
        
        // Usar npx para ejecutar openclaw desde node_modules
        ptyProcess = pty.spawn(openclawBin, ['gateway', '--port', '18789'], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: process.cwd(),
            env: env
        });
        
        socket.emit('status', 'running');
        
        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
            
            // Detectar mensajes importantes
            if (data.includes('Server listening')) {
                socket.emit('log', { msg: '✅ Gateway iniciado exitosamente.', type: 'success' });
            }
        });
        
        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `⚠ Agente desconectado (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            
            // Reintentar con diferentes opciones si falló
            if (code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
                restartAttempts++;
                socket.emit('log', { msg: `🔄 Reintentando (${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`, type: 'info' });
                
                setTimeout(() => {
                    if (restartAttempts === 1) {
                        // Intento con opciones simples
                        startWithCommand(socket, apiKey, model, openclawBin, ['gateway']);
                    } else if (restartAttempts === 2) {
                        // Intento con diagnóstico (si está disponible)
                        startWithCommand(socket, apiKey, model, openclawBin, ['doctor']);
                    } else {
                        // Último intento: modo forzado
                        startWithCommand(socket, apiKey, model, openclawBin, ['gateway', '--force']);
                    }
                }, 3000);
            } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
                socket.emit('log', { msg: '❌ Demasiados intentos fallidos.', type: 'error' });
                socket.emit('log', { msg: 'ℹ️ Verifica que "openclaw" esté en package.json como dependencia.', type: 'info' });
            }
            
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error de configuración: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

// Función genérica para ejecutar comandos de OpenClaw
function startWithCommand(socket, apiKey, model, openclawBin, args) {
    try {
        socket.emit('log', { msg: `▶️ Ejecutando: ${openclawBin} ${args.join(' ')}`, type: 'info' });
        
        const env = {
            ...process.env,
            OPENAI_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            GOOGLE_API_KEY: apiKey,
            OPENCLAWCONFIGPATH: configPath,
            OPENCLAWSTATEDIR: openclawDir,
            OPENCLAWGATEWAYPORT: "18789",
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-old-space-size=900'
        };
        
        ptyProcess = pty.spawn(openclawBin, args, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: process.cwd(),
            env: env
        });
        
        socket.emit('status', 'running');
        
        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
        });
        
        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `⚠ Comando finalizado (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error ejecutando comando: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

server.listen(PORT, () => {
    console.log(`☁ Servidor listo en puerto ${PORT}`);
});
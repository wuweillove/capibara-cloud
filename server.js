const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

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
const openclawDir = path.join(os.homedir(), '.openclaw');
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
        
        // 1. Asegurarse de que exista el directorio .openclaw
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
        
        // 4. Instalación global de OpenClaw si no existe
        try {
            const npmGlobalPath = execSync('npm root -g').toString().trim();
            const openClawInstalled = fs.existsSync(path.join(npmGlobalPath, 'openclaw'));
            
            if (!openClawInstalled) {
                socket.emit('log', { msg: '📦 OpenClaw no encontrado. Instalando globalmente...', type: 'info' });
                execSync('npm install -g openclaw@latest', { stdio: 'inherit' });
                socket.emit('log', { msg: '✅ OpenClaw instalado exitosamente.', type: 'success' });
            }
        } catch (err) {
            socket.emit('log', { msg: `⚠ Verificación de instalación: ${err.message}. Continuando...`, type: 'warning' });
        }
        
        // 5. Iniciar OpenClaw correctamente usando el comando gateway
        socket.emit('log', { msg: '🔌 Iniciando gateway de OpenClaw...', type: 'info' });
        
        // El comando correcto según la documentación
        let openclawCommand = 'openclaw';
        let openclawArgs = ['gateway', '--port', '18789'];
        
        // Verificar si OpenClaw está en el PATH
        try {
            execSync('which openclaw', { stdio: 'ignore' });
        } catch (err) {
            // Si no está en el PATH, usar la ruta completa desde node_modules
            socket.emit('log', { msg: '⚠ OpenClaw no encontrado en PATH, buscando en node_modules...', type: 'warning' });
            try {
                openclawCommand = path.join(__dirname, 'node_modules', '.bin', 'openclaw');
                if (!fs.existsSync(openclawCommand)) {
                    // Última opción: instalarlo localmente
                    socket.emit('log', { msg: '📦 Instalando OpenClaw localmente...', type: 'info' });
                    execSync('npm install openclaw@latest', { stdio: 'inherit' });
                }
            } catch (err) {
                socket.emit('log', { msg: `❌ Error encontrando OpenClaw: ${err.message}`, type: 'error' });
                return;
            }
        }
        
        socket.emit('log', { msg: `▶️ Ejecutando: ${openclawCommand} ${openclawArgs.join(' ')}`, type: 'info' });
        
        ptyProcess = pty.spawn(openclawCommand, openclawArgs, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
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
                        // Intento con diagnóstico
                        runDiagnostics(socket, apiKey, model);
                    } else if (restartAttempts === 2) {
                        // Intento con reinstalación
                        reinstallAndStart(socket, apiKey, model);
                    } else {
                        // Último intento: modo forzado
                        startWithForceOption(socket, apiKey, model);
                    }
                }, 3000);
            } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
                socket.emit('log', { msg: '❌ Demasiados intentos fallidos.', type: 'error' });
                socket.emit('log', { msg: 'ℹ️ Ejecuta "openclaw doctor" manualmente para diagnosticar.', type: 'info' });
            }
            
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error de configuración: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

// Ejecutar diagnósticos con openclaw doctor
function runDiagnostics(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: '🔍 Ejecutando diagnóstico...', type: 'info' });
        
        const env = {
            ...process.env,
            OPENAI_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            GOOGLE_API_KEY: apiKey,
            OPENCLAWCONFIGPATH: configPath,
            OPENCLAWSTATEDIR: openclawDir
        };
        
        ptyProcess = pty.spawn('openclaw', ['doctor'], {
            name: 'xterm-color',
            cols: 80, 
            rows: 30,
            env: env
        });
        
        socket.emit('status', 'running');
        
        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
        });
        
        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `🔍 Diagnóstico completado (Código: ${code}).`, type: 'info' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error en diagnóstico: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

// Reinstalar OpenClaw y reiniciar
function reinstallAndStart(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: '🔄 Reinstalando OpenClaw...', type: 'info' });
        
        execSync('npm uninstall -g openclaw && npm install -g openclaw@latest', { stdio: 'inherit' });
        socket.emit('log', { msg: '✅ Reinstalación completada.', type: 'success' });
        
        // Reiniciar con configuración limpia
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
        
        setupAndStartOpenClaw(socket, apiKey, model);
    } catch (e) {
        socket.emit('log', { msg: `❌ Error en reinstalación: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

// Iniciar con opción --force
function startWithForceOption(socket, apiKey, model) {
    try {
        socket.emit('log', { msg: '💪 Iniciando con opción --force...', type: 'info' });
        
        const env = {
            ...process.env,
            OPENAI_API_KEY: apiKey,
            ANTHROPIC_API_KEY: apiKey,
            GOOGLE_API_KEY: apiKey,
            OPENCLAWCONFIGPATH: configPath,
            OPENCLAWSTATEDIR: openclawDir,
            OPENCLAWGATEWAYPORT: "18789",
            NODE_ENV: 'production'
        };
        
        ptyProcess = pty.spawn('openclaw', ['gateway', '--port', '18789', '--force'], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            env: env
        });
        
        socket.emit('status', 'running');
        
        ptyProcess.on('data', (data) => {
            socket.emit('terminal_data', data);
        });
        
        ptyProcess.on('exit', (code) => {
            socket.emit('log', { msg: `⚠ Gateway forzado desconectado (Código: ${code}).`, type: 'warning' });
            socket.emit('status', 'stopped');
            ptyProcess = null;
        });
    } catch (e) {
        socket.emit('log', { msg: `❌ Error en inicio forzado: ${e.message}`, type: 'error' });
        socket.emit('status', 'stopped');
    }
}

server.listen(PORT, () => {
    console.log(`☁ Servidor listo en puerto ${PORT}`);
});
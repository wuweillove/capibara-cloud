# Usamos Node 22 (Bookworm) compatible con OpenClaw
FROM node:22-bookworm

# 1. INSTALACIÓN CRÍTICA: Instalar pnpm globalmente
RUN npm install -g pnpm

# 2. Instalar herramientas básicas de sistema
RUN apt-get update && apt-get install -y git python3 make g++

# Crear directorio de trabajo
WORKDIR /app

# 3. Copiar y configurar TU servidor (Capibara Cloud)
COPY package*.json ./
COPY server.js ./
COPY public ./public

# Instalar dependencias de tu servidor
RUN npm install

# 4. Clonar OpenClaw
RUN git clone https://github.com/openclaw/openclaw.git openclaw-engine

# 5. Configurar OpenClaw usando PNPM
WORKDIR /app/openclaw-engine

# Usamos pnpm install en lugar de npm install (detectará el pnpm-lock.yaml correctamente)
RUN pnpm install

# Construimos el proyecto (ahora el comando 'pnpm' sí existirá)
RUN pnpm run build

# 6. Finalizar
WORKDIR /app
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]

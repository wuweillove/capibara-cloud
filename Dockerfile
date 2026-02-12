FROM node:22-slim

WORKDIR /app

# Instalar dependencias incluyendo git
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiar archivos del proyecto
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

# Instalar OpenClaw globalmente
RUN npm install -g openclaw@latest

# Copiar código
COPY . .

# Iniciar aplicación
CMD ["node", "server.js"]
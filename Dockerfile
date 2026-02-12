# CAMBIO IMPORTANTE: Usamos Node 22 (Bookworm) que es lo que pide OpenClaw ahora
FROM node:22-bookworm

# Instalar herramientas básicas de sistema
RUN apt-get update && apt-get install -y git python3 make g++

# Crear directorio de trabajo en la nube
WORKDIR /app

# Copiar los archivos de TU interfaz y servidor
COPY package*.json ./
COPY server.js ./
COPY public ./public

# Instalar dependencias de TU servidor
RUN npm install

# Clonar OpenClaw (el cerebro) dentro del contenedor
RUN git clone https://github.com/openclaw/openclaw.git openclaw-engine

# Instalar dependencias de OpenClaw
WORKDIR /app/openclaw-engine
# Forzamos la instalación omitiendo conflictos menores de dependencias opcionales
RUN npm install --legacy-peer-deps
RUN npm run build --if-present

# Volver a la raíz y exponer el puerto
WORKDIR /app
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]

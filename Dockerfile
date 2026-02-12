# Usamos una imagen ligera de Node.js
FROM node:18-bullseye

# Instalar herramientas básicas de sistema (git, python para dependencias)
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
RUN npm install
RUN npm run build --if-present

# Volver a la raíz y exponer el puerto
WORKDIR /app
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]
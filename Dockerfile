FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

# Data (JSON db, photos, VAPID keys) lives here — mount a volume to persist it.
ENV DATA_DIR=/app/data
ENV PORT=3060

EXPOSE 3060

CMD ["node", "server.js"]

# Lifeline - production image for Google Cloud Run
# Zero runtime dependencies: no npm install step, tiny attack surface.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY package.json server.js ./
COPY src ./src
COPY public ./public

# Run as the unprivileged built-in "node" user.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]

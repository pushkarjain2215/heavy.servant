# Backend (Playwright + Node) - full bookworm for Playwright system deps
FROM node:20-bookworm AS backend

WORKDIR /app

COPY ggsipu-backend/package.json ggsipu-backend/package-lock.json ./
RUN npm ci --omit=dev

# Install Chromium and system dependencies for headless browser
RUN npx playwright install chromium --with-deps

COPY ggsipu-backend/index.js ./

ENV NODE_ENV=production
EXPOSE 9999

# Use PORT from environment (e.g. Render sets PORT)
CMD ["node", "index.js"]

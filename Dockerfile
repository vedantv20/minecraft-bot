FROM ghcr.io/puppeteer/puppeteer:24.6.1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgbm-dev \
    libxshmfence-dev \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

USER pptruser

CMD ["node", "index.js"]